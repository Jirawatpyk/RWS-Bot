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
const { stateManager } = require('../State/stateManager');
const { StateSyncService } = require('../State/stateSyncService');
const { pauseImap, resumeImap, isImapPaused, getConnectionStats, getIMAPHealthStatus } = require("../IMAP/imapClient");
const { getBrowserPoolStatus, getBrowserHealthStatus } = require('../Task/runTaskInNewBrowser');
const { metricsCollector } = require('../Metrics/metricsCollector');
const { TIMEOUTS } = require('../Config/constants');
const { withFileLock, saveJSONAtomic } = require('../Utils/fileUtils');
const { workingHoursManager } = require('../Task/workingHoursManager');
const { getSheetCircuitBreakerStatus } = require('../Sheets/sheetCircuitBreaker');
const { capacityLearner } = require('../Features/capacityLearner');
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

// GET browser health status (memory, pages, recycle history)
app.get('/api/health/browser', (req, res) => {
  try {
    const health = getBrowserHealthStatus();
    const poolStatus = getBrowserPoolStatus();
    res.json({ pool: poolStatus, health });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET IMAP health status (connection stats + health monitor snapshot)
app.get('/api/health/imap', (req, res) => {
  try {
    const stats = getConnectionStats();
    const health = getIMAPHealthStatus();
    res.json({ connection: stats, health });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Google Sheets circuit breaker health status
app.get('/api/health/sheets', (req, res) => {
  try {
    const status = getSheetCircuitBreakerStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

/* ========================= Capacity Learning API ========================= */
// IMPORTANT: Static routes MUST be registered before parameterized /:date route
// to prevent Express from matching "/api/capacity/analysis" as { date: "analysis" }

// GET /api/capacity/analysis — full analysis of past performance
app.get('/api/capacity/analysis', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const analysis = capacityLearner.analyzePastPerformance(days);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/capacity/suggestions — suggestions only (lightweight)
app.get('/api/capacity/suggestions', (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const analysis = capacityLearner.analyzePastPerformance(days);
    res.json({
      period: analysis.period,
      totalDays: analysis.totalDays,
      avgUtilization: analysis.avgUtilization,
      suggestions: analysis.suggestions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/capacity/summary — dashboard-friendly summary with recommendation
app.get('/api/capacity/summary', (req, res) => {
  try {
    const summary = capacityLearner.getSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/capacity/:date — parameterized route MUST come after static routes
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

// GET /api/metrics - system observability metrics snapshot
app.get('/api/metrics', (req, res) => {
  try {
    const poolStatus = getBrowserPoolStatus ? getBrowserPoolStatus() : {};
    metricsCollector.updateBrowserPoolStatus(poolStatus);
  } catch {
    // Browser pool may not be initialized yet
  }

  try {
    const imapStats = getConnectionStats ? getConnectionStats() : {};
    metricsCollector.updateIMAPStatus(imapStats);
  } catch {
    // IMAP may not be connected yet
  }

  res.json(metricsCollector.getSnapshot());
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


/* ========================= Working Hours API ========================= */

// GET /api/working-hours — current working hours status + schedule
app.get('/api/working-hours', (req, res) => {
  try {
    const status = workingHoursManager.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/working-hours/:date — working hours for a specific date
app.get('/api/working-hours/:date', (req, res) => {
  try {
    const { date } = req.params;
    const hours = workingHoursManager.getWorkingHours(date);
    const isWorking = hours !== null;
    res.json({ date, hours, isWorkingDay: isWorking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/working-hours/overtime — set overtime schedule for a date
app.post('/api/working-hours/overtime', (req, res) => {
  try {
    const { date, start, end } = req.body;
    if (!date || typeof start !== 'number' || typeof end !== 'number') {
      return res.status(400).json({ error: 'Required: date (string), start (number), end (number)' });
    }
    workingHoursManager.setOvertimeSchedule(date, { start, end });
    logSuccess(`OT schedule set: ${date} ${start}:00-${end}:00`);
    broadcastToClients({ type: 'workingHoursUpdated', date });
    res.json({ success: true, date, hours: { start, end } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/working-hours/overtime/:date — remove overtime for a date
app.delete('/api/working-hours/overtime/:date', (req, res) => {
  try {
    const { date } = req.params;
    const removed = workingHoursManager.removeOvertimeSchedule(date);
    if (removed) {
      logInfo(`OT schedule removed: ${date}`);
      broadcastToClients({ type: 'workingHoursUpdated', date });
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/working-hours/overtime — get all overtime schedules
app.get('/api/working-hours/overtime', (req, res) => {
  try {
    const schedule = workingHoursManager.getOvertimeSchedule();
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================= Holidays API ========================= */

// GET /api/holidays — get holidays (optionally filter by year)
app.get('/api/holidays', (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : undefined;
    const holidays = workingHoursManager.getHolidays(year);
    res.json(holidays);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/holidays — add a company extra holiday
app.post('/api/holidays', (req, res) => {
  try {
    const { date } = req.body;
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Required: date (YYYY-MM-DD string)' });
    }
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const added = workingHoursManager.addHoliday(date);
    if (added) {
      logInfo(`Holiday added: ${date}`);
      broadcastToClients({ type: 'workingHoursUpdated', date });
    }
    res.json({ success: true, added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/holidays/:date — remove a company extra holiday
app.delete('/api/holidays/:date', (req, res) => {
  try {
    const { date } = req.params;
    const removed = workingHoursManager.removeHoliday(date);
    if (removed) {
      logInfo(`Holiday removed: ${date}`);
      broadcastToClients({ type: 'workingHoursUpdated', date });
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/holidays/working — mark a public holiday as a working day
app.post('/api/holidays/working', (req, res) => {
  try {
    const { date } = req.body;
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Required: date (YYYY-MM-DD string)' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const added = workingHoursManager.addWorkingHoliday(date);
    if (added) {
      logInfo(`Working holiday added: ${date}`);
      broadcastToClients({ type: 'workingHoursUpdated', date });
    }
    res.json({ success: true, added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/holidays/working/:date — remove working holiday override
app.delete('/api/holidays/working/:date', (req, res) => {
  try {
    const { date } = req.params;
    const removed = workingHoursManager.removeWorkingHoliday(date);
    if (removed) {
      logInfo(`Working holiday removed: ${date}`);
      broadcastToClients({ type: 'workingHoursUpdated', date });
    }
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================= Status Sync API ========================= */

// Lazy reference - set by bootstrapper after MoraviaStatusSync is created
let _moraviaStatusSync = null;

/**
 * Allow bootstrapper to inject the MoraviaStatusSync instance after creation.
 * This avoids circular dependency and keeps server.js decoupled.
 */
function setStatusSync(instance) {
  _moraviaStatusSync = instance;
}

// GET /api/sync/status - current sync status
app.get('/api/sync/status', (req, res) => {
  if (!_moraviaStatusSync) {
    return res.json({ enabled: false, message: 'StatusSync not initialized' });
  }
  res.json(_moraviaStatusSync.getStatus());
});

// POST /api/sync/trigger - trigger manual sync
app.post('/api/sync/trigger', async (req, res) => {
  if (!_moraviaStatusSync) {
    return res.status(503).json({ error: 'StatusSync not initialized' });
  }
  try {
    const result = await _moraviaStatusSync.sync();
    if (result === null) {
      return res.status(409).json({ error: 'Sync already in progress' });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================= Post-Accept Verification API ========================= */

let _postAcceptVerifier = null;

/**
 * Allow bootstrapper/taskHandler to inject PostAcceptVerifier instance.
 * Follows same setter pattern as setStatusSync to avoid circular deps.
 */
function setPostAcceptVerifier(instance) {
  _postAcceptVerifier = instance;
}

// GET /api/verification/status - current verification queue status
app.get('/api/verification/status', (req, res) => {
  if (!_postAcceptVerifier) {
    return res.json({ enabled: false, message: 'PostAcceptVerifier not initialized' });
  }
  res.json({ enabled: true, ...(_postAcceptVerifier.getStatus()) });
});

// GET /api/verification/results - recent verification results (last 100)
app.get('/api/verification/results', (req, res) => {
  if (!_postAcceptVerifier) {
    return res.json({ enabled: false, results: [] });
  }
  res.json({ enabled: true, results: _postAcceptVerifier.getResults() });
});

/* ========================= State API ========================= */

// GET /api/state - full state snapshot from centralized StateManager
app.get('/api/state', (req, res) => {
  try {
    const snapshot = stateManager.getSnapshot();
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ========================= Persistent Queue API ========================= */

// Lazy reference - set by caller (bootstrapper/taskHandler) after queue is created
let _persistentQueueRef = null;

/**
 * Allow external code to inject the TaskQueue instance for dashboard access.
 * @param {import('../Task/taskQueue').TaskQueue} queue
 */
function setTaskQueue(queue) {
  _persistentQueueRef = queue;
}

// GET /api/queue/status — persistent queue stats
app.get('/api/queue/status', (req, res) => {
  if (!_persistentQueueRef) {
    return res.json({ enabled: false, message: 'Queue reference not set' });
  }
  const persistentStatus = _persistentQueueRef.getPersistentStatus();
  if (!persistentStatus) {
    return res.json({
      enabled: false,
      inMemory: {
        queued: _persistentQueueRef.queue.length,
        processing: _persistentQueueRef.processing.size,
      },
    });
  }
  res.json({
    enabled: true,
    persistent: persistentStatus,
    inMemory: {
      queued: _persistentQueueRef.queue.length,
      processing: _persistentQueueRef.processing.size,
    },
  });
});

// GET /api/queue/recent — recent tasks from persistent store
app.get('/api/queue/recent', (req, res) => {
  if (!_persistentQueueRef) {
    return res.json({ enabled: false, tasks: [] });
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const tasks = _persistentQueueRef.getRecentTasks(limit);
  res.json({ enabled: tasks !== null, tasks: tasks || [] });
});

// POST /api/queue/retry/:id — requeue a failed task by persistent ID
app.post('/api/queue/retry/:id', (req, res) => {
  if (!_persistentQueueRef) {
    return res.status(503).json({ success: false, message: 'Queue reference not set' });
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, message: 'Invalid task ID' });
  }
  const result = _persistentQueueRef.requeueTask(id);
  if (!result.success) {
    return res.status(result.message === 'Persistence not enabled' ? 503 : 400).json(result);
  }
  broadcastToClients({ type: 'queueUpdated' });
  res.json(result);
});

// POST /api/queue/cleanup — delete old completed/failed tasks
app.post('/api/queue/cleanup', (req, res) => {
  if (!_persistentQueueRef) {
    return res.status(503).json({ success: false, message: 'Queue reference not set' });
  }
  const olderThanMs = req.body?.olderThanMs;
  const deleted = _persistentQueueRef.cleanupOldTasks(olderThanMs);
  res.json({ success: true, deleted });
});

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

// Initialize StateSyncService to auto-broadcast state changes to WebSocket clients
const stateSyncService = new StateSyncService(stateManager, broadcastToClients);

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
  setStatusSync,
  setPostAcceptVerifier,
  setTaskQueue,
  stateSyncService,
  stateManager,
  server,
  wss,
  app
};