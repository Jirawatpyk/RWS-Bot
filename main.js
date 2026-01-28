require('dotenv').config();
const dayjs = require('dayjs');

// Core subsystems
const { startListeningEmails } = require('./IMAP/imapClient');
const { cleanupFetcher } = require('./IMAP/fetcher');
const { trackAmountWords, resetIfNewDay } = require('./Task/wordQuotaTracker');
const { pushStatusUpdate, broadcastToClients } = require('./Dashboard/server');
const { defaultConcurrency, DEFAULT_SHEET_KEY } = require('./Config/configs');
const { initLoginSession } = require('./LoginSession/initLoginSession');
const { appendStatusToMainSheet } = require('./Sheets/sheetWriter');
const { markStatusWithRetry } = require('./Sheets/markStatusByOrderId');
const { TaskQueue } = require('./Task/taskQueue');
const { startTaskSchedule, stopTaskSchedule } = require('./Task/taskScheduler');
const { appendAcceptedTask, removeTaskCapacity } = require('./Task/taskReporter');
const { saveCookies } = require('./Session/sessionManager');
const runTaskInNewBrowser = require('./Task/runTaskInNewBrowser');
const { initializeBrowserPool, closeBrowserPool, getBrowserPoolStatus } = require('./Task/runTaskInNewBrowser');
const { applyCapacity } = require('./Task/CapacityTracker');

// Logging & notifications
const { logSuccess, logFail, logInfo, logProgress, logBanner } = require('./Logs/logger');
const { notifyGoogleChat } = require('./Logs/notifier');
const { incrementStatus } = require('./Dashboard/statusManager/taskStatusStore');
const { recordFailure, resetFailure } = require('./Task/consecutiveFailureTracker');

// NEW: centralized acceptance engine (best practice)
const { evaluateTaskAcceptance, REASONS } = require('./Task/taskAcceptance');

const { cloneProfiles } = require('./tools/cloneProfile');

const MAX_LOGIN_RETRIES = 3;
let browserHolder = { value: null };

/* ========================= Helpers ========================= */
function mapRejectReasonToSheetStatus(code) {
  // Always write 'Declined' to the Sheet, regardless of internal reason
  return 'Declined';
}

/* ========================= Bootstrap ========================= */
(async () => {
  logBanner();
  startTaskSchedule();

  // --- Login first (single browser only for SSO/cookies) ---
  let loginSuccess = false;
  for (let attempt = 1; attempt <= MAX_LOGIN_RETRIES; attempt++) {
    try {
      logInfo(`🔁 Attempting Login ${attempt}...`);
      const { browser, mainPage } = await initLoginSession();
      await saveCookies(mainPage);
      browserHolder.value = browser;
      logSuccess(`✅ Login successful! Starting task automation system...`);
      loginSuccess = true;
      break;
    } catch (err) {
      logFail(`⚠️ [Auto RWS] Login failed (${attempt}): ${err.message}`, true);
    }
  }

  if (!loginSuccess) {
    logFail(`❌ [Auto RWS] Login failed after all attempts. Exiting system.`, true);
    process.exit(1);
  }

  // Close the login browser, we will use the pool for real tasks
  if (browserHolder.value) {
    await browserHolder.value.close();
    browserHolder.value = null;
    logInfo('🔀 Login browser closed - switching to browser pool');
  }

  // หลังจาก login browser ถูกปิดแล้ว
  await cloneProfiles({ count: defaultConcurrency });
  logSuccess('✅ Profiles cloned successfully');

  // --- Browser pool ---
  try {
    await initializeBrowserPool(defaultConcurrency);
    const poolStatus = getBrowserPoolStatus();
    logSuccess(`🟢 Browser pool ready: ${poolStatus.availableBrowsers}/${poolStatus.totalBrowsers} browsers available`);
  } catch (err) {
    logFail(`❌ Failed to initialize browser pool: ${err.message}`, true);
    process.exit(1);
  }

  // Daily quota reset
  await resetIfNewDay();

  let totalTasks = 0;
  let successful = 0;

  const metaQueue = new TaskQueue({
    concurrency: 2,
    onError: (err) => logFail(`❌ MetaQueue error: ${err.message}`),
    onQueueEmpty: () => logInfo('🟢 MetaQueue Idle')
  });

  function enqueueOnHold(orderId, workflowName, receivedDate = null) {
    metaQueue.addTask(async () => {
      await markStatusWithRetry(orderId, 'On Hold', 'DTP', receivedDate);
      const result = await removeTaskCapacity(orderId, receivedDate);

      if (result.ok && result.removed) {
        await notifyGoogleChat(`⛔ [On Hold] Workflow: ${workflowName} | Words Left: ${result.totalWords}`);
      }
    });
  }

  const queue = new TaskQueue({
    concurrency: defaultConcurrency,
    onSuccess: async (res) => {
      successful++;
      resetFailure();

      const allocationPlan = res?.context?.allocationPlan || [];
      const planStr = allocationPlan.map(d => `${d.date} (${d.amount})`).join(', ');
      const words = res.amountWords || 0;
      logSuccess(`✅ Task completed | Order ID: ${res.orderId} | Applied ${words} words | Allocated: ${planStr}`, true);

      if (res?.orderId) {
        appendAcceptedTask({
          timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          orderId: res.orderId,
          workflowName: res.workflowName,
          url: res.url,
          amountWords: res.amountWords,
          plannedEndDate: res.context?.effectiveDeadline || res.plannedEndDate,
          receivedDate: res.receivedDate || null,
          allocationPlan
        });

        await applyCapacity(allocationPlan);
        await markStatusWithRetry(res.orderId, 'Accepted', 'DTP', res.receivedDate);
        await trackAmountWords(res.amountWords, notifyGoogleChat);
      }

      broadcastToClients({ type: 'capacityUpdated' });
    },

    onError: async (err) => {
      const reasonText = (err.message || '').toLowerCase();
      await recordFailure();

      // Handle login expired - trigger system restart
      if (err.message === 'LOGIN_EXPIRED') {
        await restartForLoginExpired();
        return;
      }

      if (reasonText.includes('on hold')) {
        logFail(`❌ Task failed (On Hold) | Order ID: ${err.orderId}`, true);
        await markStatusWithRetry(err.orderId, 'On Hold', 'DTP', err.receivedDate);
        return;
      }

      if (reasonText.includes('404') || reasonText.includes('step 1 failed') || reasonText.includes('Unable to read status')) {
        logFail(`❌ Task failed (Missed) | Order ID: ${err.orderId} | Reason: ${err.message}`, true);
        await markStatusWithRetry(err.orderId, 'Missed', 'DTP', err.receivedDate);
        return;
      }

      logFail(`❌ Task failed | Order ID: ${err.orderId} | Reason: ${err.message}`, true);
    },

    onQueueEmpty: async () => {
      const poolStatus = getBrowserPoolStatus();
      logInfo(`🎯 Task Summary: Total: ${totalTasks} | Success: ${successful}`);
      logInfo(`🟢 TaskQueue Idle | Pool Status: ${poolStatus.availableBrowsers}/${poolStatus.totalBrowsers} available`);
    }
  });

  /* ========================= Event Listener ========================= */
  startListeningEmails(async ({ orderId, workflowName, url, amountWords, plannedEndDate, status, receivedDate }) => {
    // 0) System-side status handling
    if ((status || '').toLowerCase() === 'on hold') {
      logInfo(`⏸ On hold detected | Order ID: ${orderId} | Workflow: ${workflowName}`);
      enqueueOnHold(orderId, workflowName, receivedDate);
      return;
    }
		
    // 1) Evaluate acceptance using centralized rules
    const evalRes = evaluateTaskAcceptance({ orderId, amountWords, plannedEndDate });

    if (!evalRes.accepted) {
      const sheetStatus = mapRejectReasonToSheetStatus(evalRes.code); // always 'Declined'
      logFail(`⛔ Rejected | Order ID: ${orderId} | ${evalRes.code} | ${evalRes.message} | raw=${evalRes.rawDeadline} effective=${evalRes.effectiveDeadline || '-'}`, true);
      await markStatusWithRetry(orderId, sheetStatus, 'DTP', receivedDate);
      return;
    }

    const { allocationPlan, effectiveDeadline, code } = evalRes;
    const dateList = allocationPlan.map(d => d.date).join(', ');
    logInfo(`⏳ Allocated for ${orderId}: ${dateList} | raw=${evalRes.rawDeadline} | effective=${effectiveDeadline}`);

    totalTasks++;
    const taskStartTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const poolStatus = getBrowserPoolStatus();
    logProgress(`⚙️ Task ${totalTasks} | Pool: ${poolStatus.availableBrowsers}/${poolStatus.totalBrowsers} available | Order ID: ${orderId}`);

    // 2) Enqueue worker task
    queue.addTask(async () => {
      const context = { allocationPlan, acceptanceCode: code };

      incrementStatus('pending');
      pushStatusUpdate();

      // Optional: write to main sheet (disabled by default)
      /*
      await appendStatusToMainSheet({
        timestamp: taskStartTime,
        url,
        status: '⚙️ In Progress',
        reason: 'Started',
        sheetKey: DEFAULT_SHEET_KEY
      });
      */

      broadcastToClients({
        type: 'logEntry',
        log: { time: taskStartTime, url, status: '⚙️ In Progress', reason: 'Started' }
      });

      const result = await runTaskInNewBrowser({ task: { url, orderId } });

      const taskEndTime = dayjs().format('YYYY-MM-DD HH:mm:ss');

      /*
      await appendStatusToMainSheet({
        timestamp: taskEndTime,
        url: result.url,
        status: result.success ? '✅ Success' : '❌ Fail',
        reason: result.reason || '',
        sheetKey: DEFAULT_SHEET_KEY
      });
      */

      incrementStatus(result.success ? 'success' : 'error');
      pushStatusUpdate();

      setTimeout(() => {
        broadcastToClients({
          type: 'logEntry',
          log: { time: taskStartTime, url, status: result.success ? '✅ Success' : '❌ Fail', reason: result.reason || '' }
        });
      }, 50);

      if (!result.success) {
        const error = new Error(result.reason);
        error.orderId = orderId;
        error.receivedDate = receivedDate;
        throw error; // Handled by queue.onError
      }

      // Attach enriched context to queue onSuccess consumer
      return { ...result, orderId, workflowName, url, amountWords, plannedEndDate: evalRes.rawDeadline, status, receivedDate, context };
    });
  });
})();

/* ========================= Process-level safety ========================= */
process.on('uncaughtException', async (err) => {
  logFail('🔥 Uncaught Exception:', err);
  await notifyGoogleChat(`❌ [Auto RWS] System crash: ${err.message}`);
  try {
    await closeBrowserPool();
  } catch {}
  await cleanupFetcher();
  await new Promise(res => setTimeout(res, 500));
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  logFail('🔥 Unhandled Promise Rejection:', reason);
  await notifyGoogleChat(`❌ [Auto RWS] Unhandled rejection: ${reason}`);
  try {
    await closeBrowserPool();
  } catch {}
  await cleanupFetcher();
  await new Promise(res => setTimeout(res, 500));
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logProgress('Received SIGINT, shutting down gracefully...');
  await notifyGoogleChat('🔴 [Auto RWS] System shutdown initiated (SIGINT)');

  try {
    stopTaskSchedule();
    await closeBrowserPool();
    await cleanupFetcher();
    logSuccess('Shutdown completed successfully');
    process.exit(0);
  } catch (err) {
    logFail(`Error during shutdown: ${err.message}`);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logProgress('Received SIGTERM, shutting down gracefully...');
  try {
    stopTaskSchedule();
    await closeBrowserPool();
    logSuccess('Shutdown completed successfully');
    process.exit(0);
  } catch (err) {
    logFail(`Error during shutdown: ${err.message}`);
    process.exit(1);
  }
});

/* ========================= LOGIN-EXPIRED RESTART ========================= */
async function restartForLoginExpired(reason = 'LOGIN_EXPIRED') {
  logFail(`🔐 Login expired → restarting system`, true);
  await notifyGoogleChat(`🔄 [Auto RWS] Login expired. Restarting system...`);

  try {
    stopTaskSchedule();
    await closeBrowserPool();
    await cleanupFetcher();
  } catch {}

  await new Promise(res => setTimeout(res, 500));

  process.exit(12);
}