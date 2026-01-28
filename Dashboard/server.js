// ✅ server.js — now includes REST API for override and capacity dashboard

const express = require('express');
const dayjs = require('dayjs');
const fs = require('fs');
const http = require("http");
const path = require('path');
const WebSocket = require("ws");

async function writeCapacityLog(entry) {
  const logFile = path.join(__dirname, '../public', 'capacityLog.json');
  const dir = path.dirname(logFile);
  try {
    await fs.promises.mkdir(dir, { recursive: true });

    let logs = [];
    if (fs.existsSync(logFile)) {
      try {
        logs = JSON.parse(await fs.promises.readFile(logFile, 'utf8'));
      } catch (e) {
        console.error("❌ Error parsing capacityLog.json:", e.message);
      }
    }
    logs.push({ ...entry, timestamp: new Date().toISOString() });
    await fs.promises.writeFile(logFile, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error("❌ writeCapacityLog failed:", err.message);
  }
}
const { getAllStatus } = require("./statusManager/taskStatusStore");
const { logSuccess, logInfo } = require("../Logs/logger");
const { pauseImap, resumeImap, isImapPaused } = require("../IMAP/imapClient");
const { TIMEOUTS } = require('../Config/constants');
const { withFileLock, saveJSONAtomic } = require('../Utils/fileUtils');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const {
  loadDailyOverride,
  saveDailyOverride,
  getCapacityMap,
  getOverrideMap,
  adjustCapacity,
  resetCapacityMap,
  releaseCapacity,
  getRemainingCapacity,
  syncCapacityWithTasks
} = require('../Task/CapacityTracker');

const {
  loadAndFilterTasks,
  summarizeTasks,
  acceptedTasksPath
} = require('../Task/taskReporter');

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// GET override.json
app.get('/api/override', (req, res) => {
  const override = loadDailyOverride();
  res.json(override);
});

// POST override.json
app.post('/api/override', async (req, res) => {
  const override = req.body;
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return res.status(400).json({ error: 'Invalid override format' });
  }
  saveDailyOverride(override);
  logSuccess("📝 Override updated via Dashboard");

  for (const [date, amount] of Object.entries(override)) {
    await writeCapacityLog({ type: "override", date, amount, user: "system" });
    broadcastToClients({ type: "capacityUpdated", date });
  }

  res.json({ success: true });
});

// GET capacity.json (read-only)
app.get('/api/capacity', (req, res) => {
  const cap = getCapacityMap();
  res.json(cap);
});

// POST reset capacity
app.post('/api/capacity/reset', async (req, res) => {
  await resetCapacityMap();
  res.json({ success: true });
});

// POST sync capacity with tasks
app.post('/api/capacity/sync', async (req, res) => {
  try {
    const result = await syncCapacityWithTasks();
    if (result.success) {
      // Broadcast ไปทุก client
      const dates = Object.keys(result.after);
      dates.forEach(date => {
        broadcastToClients({ type: 'capacityUpdated', date });
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/release
app.post('/api/release', async (req, res) => {
  const plan = req.body; // [{ date, amount }]
  if (!Array.isArray(plan)) return res.status(400).json({ error: 'Invalid plan format' });
  await releaseCapacity(plan);
  res.json({ success: true });
});

// POST /api/adjust
app.post('/api/adjust', async (req, res) => {
  const { date, amount } = req.body;
  if (!date || typeof amount !== 'number') return res.status(400).json({ error: 'Invalid input' });
  await adjustCapacity({ date, amount });
  res.json({ success: true });
});

// GET /api/capacity/:date
app.get('/api/capacity/:date', (req, res) => {
  const remaining = getRemainingCapacity(req.params.date);
  res.json({ remaining });
});

// GET /api/tasks - ดึงข้อมูล tasks (read-only, ไม่เคลียร์ completed)
app.get('/api/tasks', (req, res) => {
  try {
    if (!fs.existsSync(acceptedTasksPath)) {
      return res.json({ tasks: [], summary: null, lastUpdated: new Date().toISOString() });
    }
    const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
    const tasks = JSON.parse(raw);
    const summary = summarizeTasks(tasks);
    res.json({ tasks, summary, lastUpdated: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/refresh - ดึงจาก Sheet + เคลียร์ completed/on-hold + sync capacity (รวมทุกอย่างเป็น API เดียว)
app.post('/api/tasks/refresh', async (req, res) => {
  let activeTasks = [];
  let completedCount = 0;
  let onHoldCount = 0;
  let summary = null;
  let syncResult = { success: false, after: {}, diff: 0, deletedOverrides: [] };
  const errors = [];

  // Step 1: Query Sheet + ลบ completed/on-hold tasks
  try {
    const result = await loadAndFilterTasks();
    activeTasks = result.activeTasks;
    completedCount = result.completedCount;
    onHoldCount = result.onHoldCount || 0;
    summary = summarizeTasks(activeTasks);
  } catch (err) {
    errors.push({ step: 'loadAndFilterTasks', error: err.message });
  }

  // Step 2: Sync capacity กับ tasks (คำนวณใหม่จาก allocationPlan)
  try {
    syncResult = await syncCapacityWithTasks();
  } catch (err) {
    errors.push({ step: 'syncCapacityWithTasks', error: err.message });
  }

  // Step 3: Broadcast ไปทุก client (ทำแม้มี error บางส่วน)
  if (completedCount > 0 || onHoldCount > 0) {
    broadcastToClients({
      type: 'tasksUpdated',
      completedCount,
      onHoldCount
    });
  }

  // Broadcast capacityUpdated ถ้ามีการเปลี่ยนแปลง
  if (syncResult.success && syncResult.diff !== 0) {
    const dates = Object.keys(syncResult.after || {});
    dates.forEach(date => {
      broadcastToClients({ type: 'capacityUpdated', date });
    });
  }

  res.json({
    success: errors.length === 0,
    tasks: activeTasks,
    summary,
    completedCount,
    onHoldCount,
    capacity: syncResult?.after ?? {},
    synced: syncResult.success,
    syncDiff: syncResult?.diff ?? 0,
    deletedOverrides: syncResult?.deletedOverrides ?? [],
    lastUpdated: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined
  });
});

async function cleanupOldCapacityAndOverride(datesToDelete = null) {
  const today = dayjs().format("YYYY-MM-DD");
  const capacityPath = path.join(__dirname, '../public/capacity.json');
  const overridePath = path.join(__dirname, '../public/dailyOverride.json');

  let cap = getCapacityMap();
  let override = getOverrideMap();
  let deleted = [];

  const shouldDelete = (date) => {
    if (datesToDelete) return datesToDelete.includes(date);
    return date < today;
  };

  // ลบเฉพาะ allocationPlan ของวันที่เลือก (ไม่ลบ task ทั้งตัว)
  let allocationsRemoved = 0;
  let tasksRemoved = 0;
  try {
    if (fs.existsSync(acceptedTasksPath)) {
      const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
      const tasks = JSON.parse(raw);

      const updatedTasks = tasks.map(task => {
        if (!task.allocationPlan) return task;

        const originalLength = task.allocationPlan.length;
        task.allocationPlan = task.allocationPlan.filter(plan => !shouldDelete(plan.date));
        allocationsRemoved += originalLength - task.allocationPlan.length;

        return task;
      }).filter(task => {
        // ลบ task ถ้าไม่เหลือ allocationPlan เลย
        if (task.allocationPlan && task.allocationPlan.length === 0) {
          tasksRemoved++;
          return false;
        }
        return true;
      });

      if (allocationsRemoved > 0 || tasksRemoved > 0) {
        fs.writeFileSync(acceptedTasksPath, JSON.stringify(updatedTasks, null, 2));
      }
    }
  } catch (err) {
    console.error("❌ Failed to cleanup tasks:", err.message);
  }

  for (const date of Object.keys(cap)) {
    if (shouldDelete(date)) {
      delete cap[date];
      deleted.push(date);
    }
  }

  for (const date of Object.keys(override)) {
    if (shouldDelete(date)) {
      delete override[date];
      if (!deleted.includes(date)) deleted.push(date);
    }
  }

  try {
    await withFileLock(capacityPath, () => {
      saveJSONAtomic(capacityPath, cap);
    });
    // dailyOverride.json is not concurrently written, but use atomic write for safety
    saveJSONAtomic(overridePath, override);
  } catch (err) {
    console.error("❌ Failed to write capacity/override:", err.message);
  }

  if (deleted.length > 0 || allocationsRemoved > 0) {
    logInfo(`🧹 ลบ capacity/override วันที่: ${deleted.join(", ")} | Allocations: ${allocationsRemoved} | Tasks: ${tasksRemoved}`);
    for (const d of deleted) {
      broadcastToClients({ type: "capacityUpdated", date: d });
    }
    if (allocationsRemoved > 0 || tasksRemoved > 0) {
      broadcastToClients({ type: "tasksUpdated" });
    }
  }

  return { deleted, allocationsRemoved, tasksRemoved };
}


app.post("/api/cleanup", async (req, res) => {
  try {
    const dates = req.body?.dates;
    const result = await cleanupOldCapacityAndOverride(dates);
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

function broadcastToClients(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        console.warn("❌ Failed to send to WebSocket client:", err.message);
      }
    }
  });
}

function pushStatusUpdate() {
  const status = getAllStatus();
  broadcastToClients({ type: "updateStatus", ...status, imapPaused: isImapPaused() });
}

wss.on("connection", (ws) => {
  logSuccess("✅ WebSocket connected");

  const { pending, success, error } = getAllStatus();
  ws.send(JSON.stringify({
    type: "updateStatus",
    pending,
    success,
    error,
    imapPaused: isImapPaused()
  }));

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // Handle ping from frontend
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // Handle refresh request
      if (data.type === "refresh") {
        const { pending, success, error } = getAllStatus();
        ws.send(JSON.stringify({
          type: "updateStatus",
          pending,
          success,
          error,
          imapPaused: isImapPaused()
        }));
        return;
      }

      if (data.type === "togglePause") {
        if (isImapPaused()) {
          resumeImap();
        } else {
          pauseImap();
        }
        const { pending, success, error } = getAllStatus();
        broadcastToClients({
          type: "updateStatus",
          pending,
          success,
          error,
          imapPaused: isImapPaused()
        });
      }
    } catch (err) {
      console.error("❌ Failed to handle message:", err.message);
    }
  });

  ws.isAlive = true;
  ws.on("pong", () => ws.isAlive = true);
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, TIMEOUTS.WEBSOCKET_PING_INTERVAL);

wss.on("close", () => clearInterval(interval));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const DEFAULT_PORT = 3000;
const PORT = process.env.PORT || DEFAULT_PORT;

// Don't auto-start server in test environment
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    logInfo(`✅ WebMonitor listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  pushStatusUpdate,
  broadcastToClients,
  server,
  wss,
  app
};