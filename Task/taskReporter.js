require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');
const { logSuccess, logFail, logInfo, logProgress } = require('../Logs/logger');

const { jobLinks } = require('../Config/configs');
const TRACKING_SHEET_ID = process.env.SHEET_ID_Tracking;
const CHAT_WEBHOOK = process.env.GOOGLE_CHAT_Moravia;
const acceptedTasksPath = path.join(__dirname, 'acceptedTasks.json');

// Assignment config จาก configs.js
const assignmentConfig = jobLinks.TrackingSheet?.Assignment || {};
const assignmentTabName = assignmentConfig.tabName || 'Assignment';

// แปลง column letter → 0-based index
function colToIndex(letter) {
  return letter.toUpperCase().charCodeAt(0) - 65;
}

const ASSIGNMENT_COL = {
  workflowName: colToIndex(assignmentConfig.workflowNameColumn || 'F'),
  projectStatus: colToIndex(assignmentConfig.projectStatusColumn || 'L'),
  receivedDate: colToIndex(assignmentConfig.receivedDateColumn || 'D')
};

/**
 * Normalize date string เพื่อเทียบ - ลบ leading zero จากชั่วโมง
 * "2026-01-27 02:52 PM" → "2026-01-27 2:52 PM"
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.trim().replace(/\s0(\d:)/, ' $1');
}

// Lazy load credentials to avoid crash if file missing
let CREDENTIALS = null;
function getCredentials() {
  if (!CREDENTIALS) {
    try {
      CREDENTIALS = require('../credentials.json');
    } catch (err) {
      logFail('[taskReporter] credentials.json not found');
      throw new Error('Missing credentials.json');
    }
  }
  return CREDENTIALS;
}

// Validate required env for Google Sheets operations
function validateSheetConfig() {
  if (!TRACKING_SHEET_ID) {
    throw new Error('Missing required environment variable: SHEET_ID_Tracking');
  }
}

function appendAcceptedTask(task) {
  let data = [];
  if (fs.existsSync(acceptedTasksPath)) {
    try {
      const raw = fs.readFileSync(acceptedTasksPath);
      data = JSON.parse(raw);
    } catch (err) {
      console.error('❌ Failed to parse acceptedTasks.json:', err);
    }
  }
  data.push(task);
  try {
    fs.writeFileSync(acceptedTasksPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('❌ Failed to write acceptedTasks.json:', err);
  }
}

async function removeTaskCapacity(orderId, receivedDate = null) {
  try {
    if (!fs.existsSync(acceptedTasksPath)) {
      logInfo(`[removeTaskCapacity] No acceptedTasks.json found, nothing to remove for Order ID: ${orderId}`);
      return { ok: true, removed: false, remaining: 0, totalWords: 0 };
    }

    const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
    const tasks = JSON.parse(raw);

    const before = tasks.length;
    const next = tasks.filter(t => {
      const idMatch = String(t.orderId) === String(orderId);
      if (!idMatch) return true; // ไม่ตรง Order ID → เก็บไว้
      // ทั้งคู่มี receivedDate → normalize แล้วเทียบ
      if (receivedDate && t.receivedDate) {
        return normalizeDate(t.receivedDate) !== normalizeDate(receivedDate);
      }
      // caller ส่ง receivedDate มา แต่ task ไม่มี → ไม่ลบ (legacy task, ไม่แน่ใจว่าตรงตัวไหน)
      if (receivedDate && !t.receivedDate) {
        return true;
      }
      // caller ไม่ส่ง receivedDate แต่ task มี → ไม่ลบ (ป้องกันลบผิดตัวเมื่อ orderId ซ้ำ)
      if (!receivedDate && t.receivedDate) {
        return true;
      }
      // ทั้งคู่ไม่มี receivedDate → ลบ (backward compatible)
      return false;
    });
    const removed = before - next.length;

    if (removed > 0) {
      fs.writeFileSync(acceptedTasksPath, JSON.stringify(next, null, 2));
      const totalWords = next.reduce((sum, t) => sum + (t.amountWords || 0), 0);

      logSuccess(`✅ [removeTaskCapacity] Order ID ${orderId} (Date: ${receivedDate || 'N/A'}) removed. Remaining: ${next.length} | Words Left: ${totalWords}`);
      return { ok: true, removed: true, remaining: next.length, totalWords };
    } else {
      const totalWords = tasks.reduce((sum, t) => sum + (t.amountWords || 0), 0);
      logInfo(`⚠️ [removeTaskCapacity] Order ID ${orderId} (Date: ${receivedDate || 'N/A'}) not found. Remaining: ${before} | Words Left: ${totalWords}`);
      return { ok: true, removed: false, remaining: before, totalWords };
    }
  } catch (err) {
    logFail(`[removeTaskCapacity] Error for Order ID ${orderId}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function loadAndFilterTasks() {
  if (!fs.existsSync(acceptedTasksPath)) {
    return { activeTasks: [], completedCount: 0 };
  }

  let allTasks = [];
  try {
    const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
    allTasks = JSON.parse(raw);
  } catch (err) {
    console.error('❌ Failed to parse acceptedTasks.json:', err.message);
    return { activeTasks: [], completedCount: 0 };
  }

  validateSheetConfig();
  const credentials = getCredentials();

  const doc = new GoogleSpreadsheet(TRACKING_SHEET_ID);
  await doc.useServiceAccountAuth({
    client_email: credentials.client_email,
    private_key: credentials.private_key.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[assignmentTabName];
  const rows = await sheet.getRows({ headerRow: 5, offset: 0 });

  let completedCount = 0;
  let onHoldCount = 0;
  const activeTasks = [];

  for (const task of allTasks) {
    const row = rows.find(r => {
      const wfMatch = r._rawData[ASSIGNMENT_COL.workflowName] === task.workflowName;
      if (!wfMatch) return false;
      // ทั้งคู่มี receivedDate → normalize แล้วเทียบ
      if (task.receivedDate && r._rawData[ASSIGNMENT_COL.receivedDate]) {
        return normalizeDate(r._rawData[ASSIGNMENT_COL.receivedDate]) === normalizeDate(task.receivedDate);
      }
      // task มี receivedDate แต่ sheet ไม่มี → ไม่ match (ป้องกัน match ผิดแถว)
      if (task.receivedDate && !r._rawData[ASSIGNMENT_COL.receivedDate]) {
        return false;
      }
      return true; // backward compatible - task ไม่มี receivedDate → match by workflowName
    });
    const status = (row?._rawData[ASSIGNMENT_COL.projectStatus] || '').trim().toLowerCase();

    if (status === 'completed') {
      completedCount++;
      continue;
    }

    if (status === 'on hold') {
      onHoldCount++;
      continue;
    }

    activeTasks.push(task);
  }

  fs.writeFileSync(acceptedTasksPath, JSON.stringify(activeTasks, null, 2));

  if (completedCount > 0) {
    logSuccess(`✅ Removed ${completedCount} completed tasks`);
  }
  if (onHoldCount > 0) {
    logSuccess(`⏸ Removed ${onHoldCount} on-hold tasks`);
  }

  return { activeTasks, completedCount, onHoldCount };
}


async function readStatusMapFromSheet() {
  validateSheetConfig();
  const credentials = getCredentials();

  const doc = new GoogleSpreadsheet(TRACKING_SHEET_ID);
  await doc.useServiceAccountAuth({
    client_email: credentials.client_email,
    private_key: credentials.private_key.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[assignmentTabName];
  const rows = await sheet.getRows({ headerRow: 5, offset: 0 });

  const map = {};
  for (const row of rows) {
    const workflowName = row._rawData[ASSIGNMENT_COL.workflowName]?.trim();
    const status = row._rawData[ASSIGNMENT_COL.projectStatus]?.trim().toLowerCase();
    if (workflowName) {
      map[workflowName] = status;
    }
  }

  return map;
}

function summarizeTasks(tasks) {
  const now = dayjs();
  const today = now.startOf('day');
  const tomorrow = today.add(1, 'day');
  const WORK_START_HOUR = 10;

  // Apply night deadline shift: if deadline before work start hour, count as previous day
  const parsed = tasks.map(task => {
    let due = dayjs(task.plannedEndDate);
    if (due.hour() < WORK_START_HOUR) {
      due = due.subtract(1, 'day');
    }
    return { ...task, due };
  });

  const todayTasks = parsed.filter(t => t.due.isSame(today, 'day'));
  const tomorrowTasks = parsed.filter(t => t.due.isSame(tomorrow, 'day'));
  const afterTasks = parsed.filter(t => t.due.isAfter(tomorrow, 'day'));
  const alerts = parsed.filter(t => {
    const diffMinutes = dayjs(t.plannedEndDate).diff(now, 'minute');
    return diffMinutes > 0 && diffMinutes <= 15;
  });

  const sumWords = list => list.reduce((sum, t) => sum + (t.amountWords || 0), 0);

  return {
    totalOrders: parsed.length,
    totalWords: sumWords(parsed),
    todayOrders: todayTasks.length,
    todayWords: sumWords(todayTasks),
    tomorrowOrders: tomorrowTasks.length,
    tomorrowWords: sumWords(tomorrowTasks),
    afterOrders: afterTasks.length,
    afterWords: sumWords(afterTasks),
    alerts,
    tasks: parsed
  };
}

function formatReport(summary) {
  const now = dayjs().format('YYYY-MM-DD HH:mm');

  const lines = [
    `📊 *RWS Task Report* _(as of ${now})_`,
    `- In Progress: ${summary.totalOrders} orders (${summary.totalWords} words)`
  ];

  summary.tasks.forEach(t => {
    lines.push(`         • ${t.workflowName}`);
  });

  if (summary.completedCount > 0) {
    lines.push(`- Completed Today: ${summary.completedCount} orders`);
  }

  lines.push(
    `- Due Today: ${summary.todayOrders} orders (${summary.todayWords} words)`,
    `- Due Tomorrow: ${summary.tomorrowOrders} orders (${summary.tomorrowWords} words)`,
    `- Due After Tomorrow: ${summary.afterOrders} orders (${summary.afterWords} words)`
  );

  return lines.join('\n');
}

async function sendToGoogleChat(text) {
  if (!CHAT_WEBHOOK) {
    logInfo('[sendToGoogleChat] No webhook configured, skipping');
    return;
  }
  try {
    await axios.post(CHAT_WEBHOOK, { text }, { timeout: 10000 });
  } catch (err) {
    logFail(`[sendToGoogleChat] Failed: ${err.message}`);
  }
} 

module.exports = {
  appendAcceptedTask,
  loadAndFilterTasks,
  summarizeTasks,
  formatReport,
  sendToGoogleChat,
  acceptedTasksPath,
  readStatusMapFromSheet,
  removeTaskCapacity
};
