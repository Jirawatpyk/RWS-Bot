/**
 * Features/postAcceptVerifier.js
 * Post-Acceptance Verification - verifies that tasks were actually accepted on Moravia.
 *
 * After execAccept completes successfully, this module revisits the task URL
 * after a configurable delay to confirm the status changed to "Accepted" or "In Progress".
 * If verification fails, it rolls back the allocated capacity and notifies via Google Chat.
 *
 * Design decisions:
 * - Sequential queue processing to avoid flooding Moravia with concurrent requests
 * - Bounded results (configurable MAX_RESULTS) to prevent memory growth
 * - Uses existing BrowserPool (getBrowser/releaseBrowser + getPage/releasePage)
 * - Delay-based scheduling: waits DELAY_MS after accept before verifying
 */

const { logInfo, logFail, logSuccess } = require('../Logs/logger');

// Lazy-load constants to avoid circular dependency issues at startup
let _constants = null;
function getConstants() {
  if (!_constants) {
    _constants = require('../Config/constants');
  }
  return _constants.VERIFICATION;
}

class PostAcceptVerifier {
  /**
   * @param {object} options
   * @param {import('../BrowserPool/browserPool')} options.browserPool - shared browser pool instance
   * @param {object} options.capacityTracker - CapacityTracker module (must have releaseCapacity)
   * @param {Function} options.notifier - notification function (e.g., notifyGoogleChat)
   */
  constructor({ browserPool, capacityTracker, notifier }) {
    if (!browserPool) throw new Error('PostAcceptVerifier requires browserPool');
    if (!capacityTracker) throw new Error('PostAcceptVerifier requires capacityTracker');
    if (!notifier || typeof notifier !== 'function') {
      throw new Error('PostAcceptVerifier requires notifier function');
    }

    this.browserPool = browserPool;
    this.capacityTracker = capacityTracker;
    this.notifier = notifier;

    /** @type {Array<VerificationQueueItem>} */
    this.verificationQueue = [];

    /** @type {Array<VerificationResult>} */
    this.results = [];

    /** @type {boolean} processing lock to prevent concurrent _processQueue runs */
    this._processing = false;

    /** @type {boolean} flag to stop processing during shutdown */
    this._stopped = false;
  }

  /**
   * Schedule a verification check for a successfully accepted task.
   * Called from TaskHandler.onSuccess after browser automation completes.
   *
   * @param {object} task
   * @param {string} task.orderId - the order identifier
   * @param {string} task.url - the Moravia task URL to revisit
   * @param {Array<{date: string, amount: number}>} [task.allocationPlan] - for capacity rollback
   * @param {number} [task.amountWords] - word count (for logging)
   */
  scheduleVerification(task) {
    if (!task || !task.orderId || !task.url) {
      logFail('[PostVerify] Cannot schedule: missing orderId or url');
      return;
    }

    const config = getConstants();

    const item = {
      orderId: task.orderId,
      url: task.url,
      allocationPlan: task.allocationPlan || [],
      amountWords: task.amountWords || 0,
      scheduledAt: Date.now(),
      verifyAfterMs: config.DELAY_MS,
    };

    this.verificationQueue.push(item);
    logInfo(`[PostVerify] Scheduled verification for Order ${task.orderId} in ${config.DELAY_MS / 1000}s`);

    // Trigger processing (non-blocking, only one loop runs at a time)
    this._processQueue();
  }

  /**
   * Process the verification queue sequentially.
   * Only one _processQueue loop runs at a time (_processing guard).
   * Items are processed in FIFO order with delay-based scheduling.
   */
  async _processQueue() {
    if (this._processing) return;
    this._processing = true;

    try {
      while (this.verificationQueue.length > 0 && !this._stopped) {
        const item = this.verificationQueue[0];
        const elapsed = Date.now() - item.scheduledAt;
        const remaining = item.verifyAfterMs - elapsed;

        // Wait until the verification delay has passed
        if (remaining > 0) {
          await new Promise(resolve => setTimeout(resolve, remaining));
        }

        // Check if stopped during wait
        if (this._stopped) break;

        // Remove from queue and verify
        this.verificationQueue.shift();
        await this._verify(item);
      }
    } catch (err) {
      logFail(`[PostVerify] Queue processing error: ${err.message}`);
    } finally {
      this._processing = false;
    }
  }

  /**
   * Verify a single task by navigating to its URL and checking the status element.
   *
   * Why we check #entityStatus:
   *   Moravia platform displays the task status in this element.
   *   After successful accept, it should show "Accepted" or "In Progress".
   *
   * @param {object} item - queue item with orderId, url, allocationPlan
   * @returns {Promise<VerificationResult>}
   */
  async _verify(item) {
    const config = getConstants();
    let browser = null;
    let page = null;

    try {
      browser = await this.browserPool.getBrowser();
      page = await this.browserPool.getPage(browser);

      await page.goto(item.url, {
        waitUntil: 'networkidle2',
        timeout: config.PAGE_TIMEOUT,
      });

      // Extract the current task status from Moravia platform
      const status = await page.$eval(
        '#entityStatus',
        el => el.innerText.trim().toLowerCase()
      );

      const verified = status === 'accepted' || status === 'in progress';

      const result = {
        orderId: item.orderId,
        url: item.url,
        verified,
        actualStatus: status,
        verifiedAt: Date.now(),
      };

      this._addResult(result);

      if (verified) {
        logSuccess(`[PostVerify] Order ${item.orderId} verified: status="${status}"`);
      } else {
        logFail(`[PostVerify] Order ${item.orderId} NOT verified: status="${status}". Rolling back capacity.`);

        // Rollback capacity allocation
        if (item.allocationPlan && item.allocationPlan.length > 0) {
          try {
            await this.capacityTracker.releaseCapacity(item.allocationPlan);
            logInfo(`[PostVerify] Capacity rolled back for Order ${item.orderId}`);
          } catch (rollbackErr) {
            logFail(`[PostVerify] Capacity rollback failed for Order ${item.orderId}: ${rollbackErr.message}`);
          }
        }

        // Notify team
        await this.notifier(
          `[Post-Verify] Order ${item.orderId} NOT accepted. Status: "${status}". Capacity rolled back.`
        );
      }

      return result;
    } catch (err) {
      const result = {
        orderId: item.orderId,
        url: item.url,
        verified: false,
        error: err.message,
        verifiedAt: Date.now(),
      };

      this._addResult(result);
      logFail(`[PostVerify] Error verifying Order ${item.orderId}: ${err.message}`);

      return result;
    } finally {
      // Always release browser resources back to pool
      if (page) {
        try { await this.browserPool.releasePage(page); } catch (_) { /* ignore */ }
      }
      if (browser) {
        try { await this.browserPool.releaseBrowser(browser); } catch (_) { /* ignore */ }
      }
    }
  }

  /**
   * Add a result to the bounded results array.
   * Keeps only the last MAX_RESULTS entries to prevent unbounded memory growth.
   */
  _addResult(result) {
    const config = getConstants();
    this.results.push(result);
    while (this.results.length > config.MAX_RESULTS) {
      this.results.shift();
    }
  }

  /**
   * Get a copy of all stored verification results.
   * @returns {Array<VerificationResult>}
   */
  getResults() {
    return [...this.results];
  }

  /**
   * Get current verifier status (for Dashboard API).
   * @returns {{ pending: number, completed: number, lastVerification: object|null }}
   */
  getStatus() {
    return {
      pending: this.verificationQueue.length,
      completed: this.results.length,
      processing: this._processing,
      lastVerification: this.results.length > 0
        ? this.results[this.results.length - 1]
        : null,
    };
  }

  /**
   * Stop processing and clear the queue.
   * Called during system shutdown to prevent lingering async work.
   */
  stop() {
    this._stopped = true;
    const pendingCount = this.verificationQueue.length;
    this.verificationQueue = [];
    if (pendingCount > 0) {
      logInfo(`[PostVerify] Stopped with ${pendingCount} pending verifications cleared`);
    }
  }
}

module.exports = { PostAcceptVerifier };
