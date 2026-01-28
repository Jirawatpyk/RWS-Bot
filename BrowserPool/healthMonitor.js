// BrowserPool/healthMonitor.js
// Monitors browser pool health: memory usage per browser, page counts,
// and auto-recycles browsers that exceed thresholds.

const { logSuccess, logFail, logInfo, logProgress } = require('../Logs/logger');
const { BROWSER_HEALTH } = require('../Config/constants');

class BrowserHealthMonitor {
  /**
   * @param {import('./browserPool')} browserPool - BrowserPool instance
   * @param {import('../Metrics/metricsCollector').MetricsCollector} [metricsCollector] - optional metrics
   * @param {{ notifyGoogleChat: Function }} [notifier] - optional notifier
   */
  constructor(browserPool, metricsCollector = null, notifier = null) {
    if (!browserPool) {
      throw new Error('BrowserHealthMonitor requires a BrowserPool instance');
    }

    this.pool = browserPool;
    this.metrics = metricsCollector;
    this.notifier = notifier;
    this.healthHistory = [];
    this.recycleCount = 0;
    this._interval = null;
    this._running = false;

    // Thresholds from constants (allow override via constructor options in future)
    this._memoryWarnMB = BROWSER_HEALTH.MEMORY_WARN_MB;
    this._memoryRecycleMB = BROWSER_HEALTH.MEMORY_RECYCLE_MB;
    this._maxPages = BROWSER_HEALTH.MAX_PAGES_PER_BROWSER;
    this._historySize = BROWSER_HEALTH.HEALTH_HISTORY_SIZE;
  }

  /**
   * Start periodic health monitoring.
   * @param {number} [intervalMs] - check interval in milliseconds
   */
  startMonitoring(intervalMs = BROWSER_HEALTH.CHECK_INTERVAL) {
    if (this._interval) {
      logInfo('[HealthMonitor] Already running, skipping duplicate start');
      return;
    }

    logInfo(`[HealthMonitor] Starting browser health monitoring (every ${Math.round(intervalMs / 1000)}s)`);
    this._running = true;

    // Run first check immediately (non-blocking)
    this.checkHealth().catch(err => {
      logFail(`[HealthMonitor] Initial health check failed: ${err.message}`);
    });

    this._interval = setInterval(() => {
      this.checkHealth().catch(err => {
        logFail(`[HealthMonitor] Health check failed: ${err.message}`);
      });
    }, intervalMs);

    // unref() so the interval does not prevent Node.js from exiting
    if (this._interval.unref) {
      this._interval.unref();
    }
  }

  /**
   * Stop periodic health monitoring.
   */
  stopMonitoring() {
    this._running = false;
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      logInfo('[HealthMonitor] Browser health monitoring stopped');
    }
  }

  /**
   * Run a single health check across all browsers in the pool.
   * For each browser: count pages, measure memory, decide if recycling is needed.
   * @returns {Promise<Object>} health snapshot for this check
   */
  async checkHealth() {
    const browsers = this.pool.browsers;
    if (!browsers || browsers.size === 0) {
      return { timestamp: Date.now(), browsers: [], healthy: true };
    }

    const snapshot = {
      timestamp: Date.now(),
      browsers: [],
      healthy: true,
      recycledSlots: [],
    };

    for (const [slotIndex, browser] of browsers) {
      const browserHealth = {
        slot: slotIndex,
        connected: false,
        pageCount: 0,
        memoryMB: 0,
        status: 'unknown',
      };

      try {
        // Check if browser is still connected
        if (!browser || !browser.isConnected()) {
          browserHealth.status = 'disconnected';
          snapshot.healthy = false;
          snapshot.browsers.push(browserHealth);
          continue;
        }

        browserHealth.connected = true;

        // Count pages
        let pages = [];
        try {
          pages = await browser.pages();
        } catch {
          browserHealth.status = 'error_pages';
          snapshot.browsers.push(browserHealth);
          continue;
        }
        browserHealth.pageCount = pages.length;

        // Get memory usage via CDP
        browserHealth.memoryMB = await this._getMemoryUsage(browser, pages);

        // Evaluate health status
        const needsRecycle = this._evaluateHealth(browserHealth, slotIndex);

        if (needsRecycle) {
          snapshot.healthy = false;
          snapshot.recycledSlots.push(slotIndex);
          await this._recycleBrowser(slotIndex, browserHealth.status);
        }
      } catch (err) {
        browserHealth.status = `error: ${err.message}`;
        logFail(`[HealthMonitor] Error checking slot ${slotIndex}: ${err.message}`);
      }

      snapshot.browsers.push(browserHealth);
    }

    // Record in health history (bounded)
    this.healthHistory.push(snapshot);
    if (this.healthHistory.length > this._historySize) {
      this.healthHistory.shift();
    }

    // Update MetricsCollector if available
    if (this.metrics) {
      try {
        const poolStatus = this.pool.getStatus();
        this.metrics.updateBrowserPoolStatus({
          ...poolStatus,
          healthCheck: {
            healthy: snapshot.healthy,
            recycleCount: this.recycleCount,
            lastCheck: snapshot.timestamp,
          },
        });
      } catch {
        // MetricsCollector may not support extended fields yet - safe to ignore
      }
    }

    // Log summary
    const healthyCount = snapshot.browsers.filter(b => b.status === 'healthy').length;
    const total = snapshot.browsers.length;
    if (snapshot.healthy) {
      logInfo(`[HealthMonitor] All browsers healthy (${healthyCount}/${total})`);
    } else {
      logProgress(`[HealthMonitor] Health check: ${healthyCount}/${total} healthy, recycled: [${snapshot.recycledSlots.join(', ')}]`);
    }

    return snapshot;
  }

  /**
   * Get memory usage for a browser via CDP page.metrics().
   * Falls back to 0 if metrics are unavailable (browser crashed, no pages, etc.)
   *
   * @param {import('puppeteer').Browser} browser
   * @param {import('puppeteer').Page[]} pages - pre-fetched pages array
   * @returns {Promise<number>} memory usage in MB (rounded to 2 decimals)
   */
  async _getMemoryUsage(browser, pages) {
    try {
      // Use existing page if available, otherwise fallback
      const targetPage = pages.length > 0 ? pages[0] : null;
      if (!targetPage) return 0;

      // page.metrics() returns JSHeapUsedSize in bytes
      const metrics = await targetPage.metrics();
      if (metrics && typeof metrics.JSHeapUsedSize === 'number') {
        return Math.round((metrics.JSHeapUsedSize / (1024 * 1024)) * 100) / 100;
      }

      return 0;
    } catch {
      // Browser disconnected or page crashed - fail safe
      return 0;
    }
  }

  /**
   * Evaluate a browser's health and determine if it needs recycling.
   * Sets browserHealth.status as a side effect.
   *
   * @param {Object} browserHealth - mutable health object
   * @param {number} slotIndex
   * @returns {boolean} true if browser should be recycled
   */
  _evaluateHealth(browserHealth, slotIndex) {
    const { memoryMB, pageCount } = browserHealth;

    // Check memory threshold (recycle)
    if (memoryMB > this._memoryRecycleMB) {
      browserHealth.status = `recycle_memory (${memoryMB}MB > ${this._memoryRecycleMB}MB)`;
      logFail(`[HealthMonitor] Slot ${slotIndex}: memory ${memoryMB}MB exceeds recycle threshold ${this._memoryRecycleMB}MB`);
      return true;
    }

    // Check page count threshold (recycle)
    if (pageCount > this._maxPages) {
      browserHealth.status = `recycle_pages (${pageCount} > ${this._maxPages})`;
      logFail(`[HealthMonitor] Slot ${slotIndex}: ${pageCount} pages exceeds max ${this._maxPages}`);
      return true;
    }

    // Check memory warning (log only, no recycle)
    if (memoryMB > this._memoryWarnMB) {
      browserHealth.status = `warning_memory (${memoryMB}MB > ${this._memoryWarnMB}MB)`;
      logProgress(`[HealthMonitor] Slot ${slotIndex}: memory ${memoryMB}MB exceeds warning threshold ${this._memoryWarnMB}MB`);
      return false;
    }

    browserHealth.status = 'healthy';
    return false;
  }

  /**
   * Recycle a browser in the given slot: close it and let the pool recreate it.
   * Only recycles if the slot is currently idle (available). If it's busy,
   * we skip and log - the task in progress should not be interrupted.
   *
   * @param {number} slotIndex
   * @param {string} reason - human-readable reason for recycling
   */
  async _recycleBrowser(slotIndex, reason) {
    // Safety: only recycle idle browsers to avoid killing in-progress tasks
    if (this.pool.busySlots.has(slotIndex)) {
      logInfo(`[HealthMonitor] Slot ${slotIndex} is busy, deferring recycle (reason: ${reason})`);
      return;
    }

    logProgress(`[HealthMonitor] Recycling browser slot ${slotIndex} (reason: ${reason})`);

    try {
      // Remove from available slots first to prevent new acquisitions
      const availIdx = this.pool.availableSlots.indexOf(slotIndex);
      if (availIdx !== -1) {
        this.pool.availableSlots.splice(availIdx, 1);
      }

      // Close the old browser
      const oldBrowser = this.pool.browsers.get(slotIndex);
      if (oldBrowser) {
        try {
          if (oldBrowser.isConnected()) {
            await oldBrowser.close();
          }
        } catch (closeErr) {
          logInfo(`[HealthMonitor] Error closing old browser slot ${slotIndex}: ${closeErr.message}`);
          // Try force kill if close fails
          try { oldBrowser.process()?.kill(); } catch {}
        }
      }

      // Recreate the browser
      const newBrowser = await this.pool.createBrowser(slotIndex);
      this.pool.browsers.set(slotIndex, newBrowser);
      this.pool._makeSlotAvailable(slotIndex);

      this.recycleCount++;
      logSuccess(`[HealthMonitor] Successfully recycled browser slot ${slotIndex} (total recycles: ${this.recycleCount})`);

      // Notify if notifier is available
      if (this.notifier?.notifyGoogleChat) {
        this.notifier.notifyGoogleChat(
          `[HealthMonitor] Browser slot ${slotIndex} recycled (reason: ${reason})`
        ).catch(() => {}); // fire and forget
      }
    } catch (err) {
      logFail(`[HealthMonitor] Failed to recycle browser slot ${slotIndex}: ${err.message}`);
      // Remove stale browser entry from the map so pool can recreate it on next acquire
      this.pool.browsers.delete(slotIndex);
      // Re-add slot to available to prevent permanent loss
      this.pool._makeSlotAvailable(slotIndex);
    }
  }

  /**
   * Get a serializable snapshot of current health state for the Dashboard API.
   * @returns {Object}
   */
  getHealthSnapshot() {
    const latestCheck = this.healthHistory.length > 0
      ? this.healthHistory[this.healthHistory.length - 1]
      : null;

    return {
      monitoring: this._running,
      recycleCount: this.recycleCount,
      historySize: this.healthHistory.length,
      thresholds: {
        memoryWarnMB: this._memoryWarnMB,
        memoryRecycleMB: this._memoryRecycleMB,
        maxPagesPerBrowser: this._maxPages,
      },
      latestCheck,
      recentHistory: this.healthHistory.slice(-5),
    };
  }
}

module.exports = BrowserHealthMonitor;
