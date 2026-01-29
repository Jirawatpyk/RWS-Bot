/**
 * Core/bootstrapper.js
 * Handles system initialization (boot) and graceful shutdown.
 * Extracted from main.js to keep it as a thin orchestrator.
 */
const { initLoginSession } = require('../LoginSession/initLoginSession');
const { saveCookies } = require('../Session/sessionManager');
const { cloneProfiles } = require('../tools/cloneProfile');
const { initializeBrowserPool, closeBrowserPool, getBrowserPoolStatus } = require('../Task/runTaskInNewBrowser');
const { resetIfNewDay } = require('../Task/wordQuotaTracker');
const { startTaskSchedule, stopTaskSchedule } = require('../Task/taskScheduler');
const { startListeningEmails } = require('../IMAP/imapClient');
const { cleanupFetcher } = require('../IMAP/fetcher');
const { defaultConcurrency } = require('../Config/configs');
const { RETRIES, EXIT_CODES, TIMEOUTS, STATUS_SYNC } = require('../Config/constants');
const { logSuccess, logFail, logInfo, logBanner } = require('../Logs/logger');
const { notifyGoogleChat } = require('../Logs/notifier');
const { metricsCollector } = require('../Metrics/metricsCollector');
const { MoraviaStatusSync } = require('../Features/moraviaStatusSync');
const taskReporter = require('../Task/taskReporter');
const { broadcastToClients, setStatusSync, setPostAcceptVerifier } = require('../Dashboard/server');
const { syncCapacityWithTasks } = require('../Task/CapacityTracker');
const { stateManager } = require('../State/stateManager');

const MAX_LOGIN_RETRIES = RETRIES.LOGIN_SESSION;

class SystemBootstrapper {
  /**
   * @param {import('./eventBus').SystemEventBus} eventBus
   * @param {object} [options]
   * @param {import('./taskHandler').TaskHandler} [options.taskHandler] - for initializing verifier after pool is ready
   */
  constructor(eventBus, options = {}) {
    this.eventBus = eventBus;
    this.taskHandler = options.taskHandler || null;
    this.statusSync = null;
  }

  /**
   * Full system boot sequence:
   *  1. Login via SSO
   *  2. Clone browser profiles
   *  3. Initialize browser pool
   *  4. Reset daily word quota
   *  5. Start IMAP email listener
   *  6. Emit system:ready
   *
   * @param {Function} onEmailReceived - callback invoked for each incoming email task
   */
  async boot(onEmailReceived) {
    logBanner();
    try { stateManager.setSystemStatus('initializing'); } catch (_) { /* non-critical */ }
    startTaskSchedule();

    // --- Step 1: Login ---
    let loginBrowser = null;
    let loginSuccess = false;

    for (let attempt = 1; attempt <= MAX_LOGIN_RETRIES; attempt++) {
      try {
        logInfo(`Attempting Login ${attempt}...`);
        const { browser, mainPage } = await initLoginSession();
        await saveCookies(mainPage);
        loginBrowser = browser;
        logSuccess('Login successful! Starting task automation system...');
        loginSuccess = true;
        break;
      } catch (err) {
        logFail(`[Auto RWS] Login failed (${attempt}): ${err.message}`, true);
      }
    }

    if (!loginSuccess) {
      logFail('[Auto RWS] Login failed after all attempts. Exiting system.', true);
      process.exit(EXIT_CODES.ERROR_EXIT);
    }

    // Close login browser -- pool will be used for real tasks
    if (loginBrowser) {
      await loginBrowser.close();
      loginBrowser = null;
      logInfo('Login browser closed - switching to browser pool');
    }

    // --- Step 2: Clone profiles ---
    await cloneProfiles({ count: defaultConcurrency });
    logSuccess('Profiles cloned successfully');

    // --- Step 3: Browser pool ---
    try {
      await initializeBrowserPool(defaultConcurrency, {
        metricsCollector,
        notifier: { notifyGoogleChat },
      });
      const poolStatus = getBrowserPoolStatus();
      logSuccess(`Browser pool ready: ${poolStatus.availableBrowsers}/${poolStatus.totalBrowsers} browsers available`);
      try {
        stateManager.setSystemStatus('ready');
        stateManager.updateBrowserPool({
          active: poolStatus.totalBrowsers - poolStatus.availableBrowsers,
          total: poolStatus.totalBrowsers,
          available: poolStatus.availableBrowsers,
        });
      } catch (_) { /* non-critical */ }
    } catch (err) {
      logFail(`Failed to initialize browser pool: ${err.message}`, true);
      process.exit(EXIT_CODES.ERROR_EXIT);
    }

    // --- Step 3b: Initialize post-accept verifier (uses browser pool) ---
    if (this.taskHandler) {
      try {
        const { getBrowserPool } = require('../Task/runTaskInNewBrowser');
        const pool = getBrowserPool();
        if (pool) {
          this.taskHandler.initVerifier(pool);
          // Inject verifier into Dashboard for API access
          const verifier = this.taskHandler.getVerifier();
          if (verifier) setPostAcceptVerifier(verifier);
        }
      } catch (err) {
        logFail(`[PostVerify] Failed to initialize: ${err.message}`);
        // Non-fatal: system continues without post-accept verification
      }
    }

    // --- Step 4: Daily quota reset ---
    await resetIfNewDay();

    // --- Step 5: Start IMAP listener ---
    startListeningEmails(onEmailReceived);
    // Note: stateManager IMAP status is updated by imapClient.js on actual connection success

    // --- Step 6: Signal ready ---
    this.eventBus.emitSystemReady();
    try { stateManager.setSystemStatus('running'); } catch (_) { /* non-critical */ }

    // --- Step 7: Start Moravia Status Sync polling ---
    if (STATUS_SYNC.ENABLED) {
      try {
        this.statusSync = new MoraviaStatusSync({
          taskReporter,
          broadcastToClients,
          notifier: notifyGoogleChat,
          eventBus: this.eventBus,
          capacitySync: syncCapacityWithTasks
        });
        setStatusSync(this.statusSync);
        this.statusSync.startPolling(STATUS_SYNC.POLLING_INTERVAL);
        logSuccess('[StatusSync] Moravia status polling initialized');
      } catch (err) {
        logFail(`[StatusSync] Failed to initialize: ${err.message}`);
        // Non-fatal: system continues without status sync
      }
    }
  }

  /**
   * Graceful shutdown sequence.
   * @param {string} reason - e.g. 'SIGINT', 'SIGTERM', 'uncaughtException'
   * @param {object} [options]
   * @param {boolean} [options.notify=true] - send Google Chat notification
   * @param {number}  [options.exitCode]    - override exit code
   */
  async shutdown(reason, options = {}) {
    const { notify = true, exitCode = EXIT_CODES.NORMAL_EXIT } = options;

    logInfo(`Shutdown initiated (${reason})...`);
    try { stateManager.setSystemStatus('shutting_down'); } catch (_) { /* non-critical */ }

    if (notify) {
      await notifyGoogleChat(`[Auto RWS] System shutdown initiated (${reason})`);
    }

    try {
      if (this.taskHandler) this.taskHandler.stopVerifier();
      if (this.statusSync) this.statusSync.stopPolling();
      stopTaskSchedule();
      await closeBrowserPool();
      await cleanupFetcher();
      logSuccess('Shutdown completed successfully');
    } catch (err) {
      logFail(`Error during shutdown: ${err.message}`);
    }

    try { stateManager.saveToFile(); } catch (_) { /* non-critical */ }
    this.eventBus.emitSystemShutdown(reason);
    process.exit(exitCode);
  }

  /**
   * Handle login-expired restart: cleanup everything then exit with code 12
   * so PM2 restarts the process.
   */
  async restartForLoginExpired() {
    logFail('Login expired -> restarting system', true);
    try {
      stateManager.setLastError('Login expired');
      stateManager.setSystemStatus('shutting_down');
    } catch (_) { /* non-critical */ }
    await notifyGoogleChat('[Auto RWS] Login expired. Restarting system...');

    try {
      stopTaskSchedule();
      await closeBrowserPool();
      await cleanupFetcher();
    } catch { /* best-effort cleanup */ }

    try { stateManager.saveToFile(); } catch (_) { /* non-critical */ }
    await new Promise(res => setTimeout(res, TIMEOUTS.MEDIUM_DELAY));
    process.exit(EXIT_CODES.LOGIN_EXPIRED);
  }

  /**
   * Handle fatal error (uncaughtException / unhandledRejection).
   * @param {string} label
   * @param {Error|*} err
   */
  async handleFatalError(label, err) {
    logFail(`${label}:`, err);
    try {
      stateManager.setLastError(err || label);
      stateManager.setSystemStatus('error');
    } catch (_) { /* non-critical */ }
    await notifyGoogleChat(`[Auto RWS] ${label}: ${err?.message || err}`);

    try {
      await closeBrowserPool();
    } catch { /* best-effort */ }

    try {
      await cleanupFetcher();
    } catch { /* best-effort */ }

    try { stateManager.saveToFile(); } catch (_) { /* non-critical */ }
    await new Promise(res => setTimeout(res, TIMEOUTS.MEDIUM_DELAY));
    process.exit(EXIT_CODES.ERROR_EXIT);
  }
}

module.exports = { SystemBootstrapper };
