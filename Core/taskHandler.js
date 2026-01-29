/**
 * Core/taskHandler.js
 * Centralized task processing logic.
 * Handles: task evaluation, queue management, success/error/on-hold flows.
 * Extracted from main.js to decouple business logic from orchestration.
 */
const dayjs = require('dayjs');

const { TaskQueue } = require('../Task/taskQueue');
const { evaluateTaskAcceptance } = require('../Task/taskAcceptance');
const { appendAcceptedTask, removeTaskCapacity } = require('../Task/taskReporter');
const { applyCapacity } = require('../Task/CapacityTracker');
const { trackAmountWords } = require('../Task/wordQuotaTracker');
const { markStatusWithRetry } = require('../Sheets/markStatusByOrderId');
const runTaskInNewBrowser = require('../Task/runTaskInNewBrowser');
const { getBrowserPoolStatus } = require('../Task/runTaskInNewBrowser');
const { pushStatusUpdate, broadcastToClients, setTaskQueue } = require('../Dashboard/server');
const { defaultConcurrency } = require('../Config/configs');
const { logSuccess, logFail, logInfo, logProgress } = require('../Logs/logger');
const { notifyGoogleChat } = require('../Logs/notifier');
const { metricsCollector } = require('../Metrics/metricsCollector');
const { recordFailure, resetFailure } = require('../Task/consecutiveFailureTracker');
const { capacityLearner } = require('../Features/capacityLearner');
const { PostAcceptVerifier } = require('../Features/postAcceptVerifier');
const capacityTracker = require('../Task/CapacityTracker');
const { stateManager } = require('../State/stateManager');

class TaskHandler {
  /**
   * @param {import('./eventBus').SystemEventBus} eventBus
   */
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.totalTasks = 0;
    this.successful = 0;

    /** @type {PostAcceptVerifier|null} - initialized after browser pool is ready */
    this.verifier = null;

    this._initMetaQueue();
    this._initTaskQueue();
  }

  /**
   * Initialize the post-accept verifier.
   * Must be called after browser pool is ready (from bootstrapper).
   *
   * Why deferred init:
   *   PostAcceptVerifier needs a live BrowserPool instance which is only
   *   available after bootstrapper.boot() completes Step 3.
   *
   * @param {import('../BrowserPool/browserPool')} browserPool
   */
  initVerifier(browserPool) {
    this.verifier = new PostAcceptVerifier({
      browserPool,
      capacityTracker,
      notifier: notifyGoogleChat,
    });
    logInfo('[TaskHandler] PostAcceptVerifier initialized');
  }

  // ------------------------------------------------------------------ Queues

  /** Meta queue for lightweight side-effects (on-hold marking, etc.) */
  _initMetaQueue() {
    this.metaQueue = new TaskQueue({
      concurrency: 2,
      onError: (err) => logFail(`MetaQueue error: ${err.message}`),
      onQueueEmpty: () => logInfo('MetaQueue Idle'),
    });
  }

  /** Main task queue that runs browser automation */
  _initTaskQueue() {
    this.queue = new TaskQueue({
      concurrency: defaultConcurrency,

      onSuccess: async (res) => {
        this.successful++;
        resetFailure();

        // Metrics
        const processingTimeMs = res?.context?.processingStartMs
          ? Date.now() - res.context.processingStartMs
          : 0;
        metricsCollector.recordTaskCompleted(processingTimeMs);

        const allocationPlan = res?.context?.allocationPlan || [];
        const planStr = allocationPlan.map(d => `${d.date} (${d.amount})`).join(', ');
        const words = res.amountWords || 0;
        logSuccess(`Task completed | Order ID: ${res.orderId} | Applied ${words} words | Allocated: ${planStr}`, true);

        if (res?.orderId) {
          try { stateManager.removeActiveTask(res.orderId); } catch (_) { /* non-critical */ }
          appendAcceptedTask({
            timestamp: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            orderId: res.orderId,
            workflowName: res.workflowName,
            url: res.url,
            amountWords: res.amountWords,
            plannedEndDate: res.context?.effectiveDeadline || res.plannedEndDate,
            receivedDate: res.receivedDate || null,
            allocationPlan,
          });

          await applyCapacity(allocationPlan);
          await markStatusWithRetry(res.orderId, 'Accepted', 'DTP', res.receivedDate);
          await trackAmountWords(res.amountWords, notifyGoogleChat);

          // Record performance for capacity learning
          for (const plan of allocationPlan) {
            capacityLearner.recordPerformance({
              date: plan.date,
              orderId: res.orderId,
              allocatedWords: plan.amount,
              completionTimeMs: processingTimeMs,
            });
          }
        }

        broadcastToClients({ type: 'capacityUpdated' });

        // Schedule post-accept verification to confirm Moravia status
        if (this.verifier && res?.orderId && res?.url) {
          this.verifier.scheduleVerification({
            orderId: res.orderId,
            url: res.url,
            allocationPlan,
            amountWords: res.amountWords,
          });
        }

        this.eventBus.emitTaskCompleted(res);
      },

      onError: async (err) => {
        metricsCollector.recordTaskFailed();
        const reasonText = (err.message || '').toLowerCase();
        await recordFailure();

        // Login expired -- delegate to bootstrapper via event
        if (err.message === 'LOGIN_EXPIRED') {
          this.eventBus.emitLoginExpired();
          return;
        }

        if (reasonText.includes('on hold')) {
          logFail(`Task failed (On Hold) | Order ID: ${err.orderId}`, true);
          try { if (err.orderId) stateManager.removeActiveTask(err.orderId); } catch (_) { /* non-critical */ }
          await markStatusWithRetry(err.orderId, 'On Hold', 'DTP', err.receivedDate);
          this.eventBus.emitTaskFailed(err);
          return;
        }

        if (
          reasonText.includes('404') ||
          reasonText.includes('step 1 failed') ||
          reasonText.includes('unable to read status')
        ) {
          logFail(`Task failed (Missed) | Order ID: ${err.orderId} | Reason: ${err.message}`, true);
          try { if (err.orderId) stateManager.removeActiveTask(err.orderId); } catch (_) { /* non-critical */ }
          await markStatusWithRetry(err.orderId, 'Missed', 'DTP', err.receivedDate);
          this.eventBus.emitTaskFailed(err);
          return;
        }

        logFail(`Task failed | Order ID: ${err.orderId} | Reason: ${err.message}`, true);
        try { if (err.orderId) stateManager.removeActiveTask(err.orderId); } catch (_) { /* non-critical */ }
        this.eventBus.emitTaskFailed(err);
      },

      onQueueEmpty: async () => {
        const poolStatus = getBrowserPoolStatus();
        logInfo(`Task Summary: Total: ${this.totalTasks} | Success: ${this.successful}`);
        logInfo(`TaskQueue Idle | Pool Status: ${poolStatus.availableBrowsers}/${poolStatus.totalBrowsers} available`);
      },
    });

    // Inject queue reference for Dashboard API
    setTaskQueue(this.queue);
  }

  // --------------------------------------------------------- Public API

  /**
   * Handle an incoming email task.
   * This is the callback passed to startListeningEmails via bootstrapper.
   */
  handleIncomingTask({ orderId, workflowName, url, amountWords, plannedEndDate, status, receivedDate }) {
    metricsCollector.recordTaskReceived();

    // On-hold tasks bypass evaluation
    if ((status || '').toLowerCase() === 'on hold') {
      logInfo(`On hold detected | Order ID: ${orderId} | Workflow: ${workflowName}`);
      this._enqueueOnHold(orderId, workflowName, receivedDate);
      this.eventBus.emitOnHoldDetected({ orderId, workflowName, receivedDate });
      return;
    }

    // Evaluate acceptance using centralized rules
    const evalRes = evaluateTaskAcceptance({ orderId, amountWords, plannedEndDate });

    if (!evalRes.accepted) {
      metricsCollector.recordTaskRejected(evalRes.code);
      logFail(
        `Rejected | Order ID: ${orderId} | ${evalRes.code} | ${evalRes.message} | raw=${evalRes.rawDeadline} effective=${evalRes.effectiveDeadline || '-'}`,
        true,
      );
      markStatusWithRetry(orderId, 'Declined', 'DTP', receivedDate);
      this.eventBus.emitTaskRejected(
        { orderId, workflowName, url, amountWords, plannedEndDate, receivedDate },
        evalRes,
      );
      return;
    }

    metricsCollector.recordTaskAccepted();

    const { allocationPlan, effectiveDeadline, code } = evalRes;
    const dateList = allocationPlan.map(d => d.date).join(', ');
    logInfo(`Allocated for ${orderId}: ${dateList} | raw=${evalRes.rawDeadline} | effective=${effectiveDeadline}`);

    this.totalTasks++;
    const taskStartTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const poolStatus = getBrowserPoolStatus();
    logProgress(`Task ${this.totalTasks} | Pool: ${poolStatus.availableBrowsers}/${poolStatus.totalBrowsers} available | Order ID: ${orderId}`);

    this.eventBus.emitTaskAccepted(
      { orderId, workflowName, url, amountWords, plannedEndDate, receivedDate },
      evalRes,
    );

    try {
      stateManager.addActiveTask({
        orderId,
        workflowName,
        amountWords,
        plannedEndDate: effectiveDeadline || plannedEndDate,
        allocationPlan,
        addedAt: Date.now(),
      });
    } catch (_) { /* non-critical */ }

    // Enqueue browser automation work
    this.queue.addTask(async () => {
      const context = { allocationPlan, acceptanceCode: code, processingStartMs: Date.now(), effectiveDeadline };

      pushStatusUpdate();

      broadcastToClients({
        type: 'logEntry',
        log: { time: taskStartTime, url, status: 'In Progress', reason: 'Started' },
      });

      const result = await runTaskInNewBrowser({ task: { url, orderId } });

      pushStatusUpdate();

      setTimeout(() => {
        broadcastToClients({
          type: 'logEntry',
          log: {
            time: taskStartTime,
            url,
            status: result.success ? 'Success' : 'Fail',
            reason: result.reason || '',
          },
        });
      }, 50);

      if (!result.success) {
        const error = new Error(result.reason);
        error.orderId = orderId;
        error.receivedDate = receivedDate;
        throw error; // Handled by queue.onError
      }

      return {
        ...result,
        orderId,
        workflowName,
        url,
        amountWords,
        plannedEndDate: evalRes.rawDeadline,
        status,
        receivedDate,
        context,
      };
    });
  }

  // --------------------------------------------------------- Private helpers

  /**
   * Get the verifier instance (for Dashboard API access).
   * @returns {PostAcceptVerifier|null}
   */
  getVerifier() {
    return this.verifier;
  }

  /**
   * Stop the verifier during shutdown.
   */
  stopVerifier() {
    if (this.verifier) {
      this.verifier.stop();
    }
  }

  /** Enqueue on-hold side-effect (mark sheet + remove capacity) */
  _enqueueOnHold(orderId, workflowName, receivedDate = null) {
    this.metaQueue.addTask(async () => {
      await markStatusWithRetry(orderId, 'On Hold', 'DTP', receivedDate);

      // Isolate capacity release so a failure here doesn't lose the sheet status update above
      try {
        const result = await removeTaskCapacity(orderId, receivedDate);
        if (result.ok && result.removed) {
          await notifyGoogleChat(`[On Hold] Workflow: ${workflowName} | Words Left: ${result.totalWords}`);
        }
      } catch (capErr) {
        logFail(`[TaskHandler] Failed to release capacity for On Hold ${orderId}: ${capErr.message}`);
        await notifyGoogleChat(`[WARNING] On Hold ${orderId}: capacity release failed. Manual check needed.`);
      }
    });
  }
}

module.exports = { TaskHandler };
