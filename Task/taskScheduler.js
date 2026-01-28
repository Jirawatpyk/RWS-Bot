// /Task/taskScheduler.js
const dayjs = require('dayjs');
const isBusinessDay = require('./isBusinessDay');
const {
  loadAndFilterTasks,
  summarizeTasks,
  formatReport,
  sendToGoogleChat,
  acceptedTasksPath,
  readStatusMapFromSheet
} = require('./taskReporter');
const fs = require('fs');
const { logSuccess, logFail, logInfo } = require('../Logs/logger');

// Constants
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_CHECK_INTERVAL_MS = 15 * 60 * 1000;

// Report schedule times
const REPORT_TIMES = [
  { hour: 9, minute: 0, label: '09:00 Report' },
  { hour: 15, minute: 0, label: '15:00 Report' },
  { hour: 18, minute: 0, label: '18:00 Report' }
];

// Timer tracking for cleanup
const activeTimers = {
  timeouts: [],
  intervals: []
};

/**
 * Run daily report and send to Google Chat
 */
async function runDailyReport() {
  const { activeTasks, completedCount } = await loadAndFilterTasks();
  const summary = summarizeTasks(activeTasks);
  summary.completedCount = completedCount;
  const message = formatReport(summary);
  await sendToGoogleChat(message);
}

/**
 * Schedule a task to run daily at a specific time
 */
function scheduleDailyAt(hour, minute, taskFn, label) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const delay = target - now;

  logInfo(`🕘 [INIT] Scheduled daily "${label}" in ${Math.round(delay / 1000)} sec`);

  const timeoutId = setTimeout(() => {
    const wrapped = async () => {
      if (!isBusinessDay(dayjs())) {
        logInfo(`[SKIP] ${label} – Not a business day`);
        return;
      }
      try {
        await taskFn();
      } catch (err) {
        logFail(`❌ ${label} failed:`, err);
      }
    };
    wrapped(); // run first time
    const intervalId = setInterval(wrapped, ONE_DAY_MS);
    activeTimers.intervals.push(intervalId);
  }, delay);

  activeTimers.timeouts.push(timeoutId);
}

/**
 * Check for tasks due within 15 minutes and send alerts
 */
async function checkAlerts() {
  if (!isBusinessDay(dayjs())) return;

  try {
    if (!fs.existsSync(acceptedTasksPath)) return;

    const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
    const allTasks = JSON.parse(raw);
    const statusMap = await readStatusMapFromSheet();

    const activeTasks = allTasks.filter(task => {
      const status = (statusMap[task.workflowName] || '').toLowerCase();
      return status !== 'completed';
    });

    const summary = summarizeTasks(activeTasks);
    if (summary.alerts.length > 0) {
      const alertMessage = [
        `⚠️ *RWS Alert — Orders Due < 15 mins!*`,
        ...summary.alerts.map(t => `• ${t.workflowName} (due ${t.due.format('HH:mm')})`)
      ].join('\n');
      await sendToGoogleChat(alertMessage);
      logSuccess(`⚠️ Alert sent: ${summary.alerts.length} orders`);
    }
  } catch (err) {
    logFail(`❌ Alert checker failed: ${err.message || err}`, true);
  }
}

/**
 * Start all scheduled tasks
 */
function startTaskSchedule() {
  // Schedule daily reports
  REPORT_TIMES.forEach(({ hour, minute, label }) => {
    scheduleDailyAt(hour, minute, async () => {
      logSuccess(`📅 Running daily task report at ${label}...`);
      await runDailyReport();
    }, label);
  });

  // Alert checker (every 15 minutes)
  const alertIntervalId = setInterval(checkAlerts, ALERT_CHECK_INTERVAL_MS);
  activeTimers.intervals.push(alertIntervalId);
}

/**
 * Stop all scheduled tasks (for graceful shutdown)
 */
function stopTaskSchedule() {
  activeTimers.timeouts.forEach(id => clearTimeout(id));
  activeTimers.intervals.forEach(id => clearInterval(id));
  activeTimers.timeouts = [];
  activeTimers.intervals = [];
  logInfo('[SCHEDULER] All timers cleared');
}

module.exports = { startTaskSchedule, stopTaskSchedule };
