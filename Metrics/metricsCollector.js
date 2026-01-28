/**
 * MetricsCollector - Singleton for collecting system observability metrics.
 *
 * Tracks task counters, rejection reasons, processing times,
 * browser pool status, and IMAP connection status.
 *
 * Usage:
 *   const { metricsCollector } = require('./Metrics/metricsCollector');
 *   metricsCollector.recordTaskReceived();
 *   const snapshot = metricsCollector.getSnapshot();
 */

class MetricsCollector {
  constructor() {
    this.counters = {
      tasksReceived: 0,
      tasksAccepted: 0,
      tasksRejected: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
    };
    this.rejectionReasons = {};       // e.g. { REJECT_CAPACITY: 5 }
    this.processingTimes = [];        // last N processing times in ms
    this.browserPool = { active: 0, total: 0, available: 0, activePages: 0 };
    this.imapStatus = { connected: false, mailboxes: 0, isPaused: false, totalReconnects: 0 };
    this.systemStartTime = Date.now();
    this._maxHistorySize = 100;
  }

  // --- Task counters ---

  recordTaskReceived() {
    this.counters.tasksReceived++;
  }

  recordTaskAccepted() {
    this.counters.tasksAccepted++;
  }

  recordTaskRejected(reasonCode) {
    this.counters.tasksRejected++;
    this.rejectionReasons[reasonCode] = (this.rejectionReasons[reasonCode] || 0) + 1;
  }

  recordTaskCompleted(processingTimeMs) {
    this.counters.tasksCompleted++;
    this.processingTimes.push(processingTimeMs);
    if (this.processingTimes.length > this._maxHistorySize) {
      this.processingTimes.shift();
    }
  }

  recordTaskFailed() {
    this.counters.tasksFailed++;
  }

  // --- Subsystem status ---

  updateBrowserPoolStatus(status) {
    this.browserPool = {
      active: status.busyBrowsers || 0,
      total: status.totalBrowsers || 0,
      available: status.availableBrowsers || 0,
      activePages: status.activePages || 0,
    };
  }

  updateIMAPStatus(status) {
    this.imapStatus = {
      connected: status.totalConnections > 0,
      mailboxes: status.mailboxes?.length || 0,
      isPaused: status.isPaused || false,
      totalReconnects: status.totalReconnects || 0,
    };
  }

  // --- Computed metrics ---

  getAverageProcessingTime() {
    if (this.processingTimes.length === 0) return 0;
    const sum = this.processingTimes.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.processingTimes.length);
  }

  getAcceptanceRate() {
    const total = this.counters.tasksAccepted + this.counters.tasksRejected;
    return total === 0 ? 0 : Math.round((this.counters.tasksAccepted / total) * 100);
  }

  getSuccessRate() {
    const total = this.counters.tasksCompleted + this.counters.tasksFailed;
    return total === 0 ? 0 : Math.round((this.counters.tasksCompleted / total) * 100);
  }

  // --- Snapshot (serializable plain object for API) ---

  getSnapshot() {
    return {
      timestamp: Date.now(),
      uptimeMs: Date.now() - this.systemStartTime,
      counters: { ...this.counters },
      rates: {
        acceptanceRate: this.getAcceptanceRate(),
        successRate: this.getSuccessRate(),
      },
      performance: {
        avgProcessingTimeMs: this.getAverageProcessingTime(),
        recentProcessingTimes: [...this.processingTimes.slice(-10)],
      },
      rejectionReasons: { ...this.rejectionReasons },
      browserPool: { ...this.browserPool },
      imap: { ...this.imapStatus },
    };
  }

  // --- Reset (for testing) ---

  reset() {
    this.counters = {
      tasksReceived: 0,
      tasksAccepted: 0,
      tasksRejected: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
    };
    this.rejectionReasons = {};
    this.processingTimes = [];
    this.browserPool = { active: 0, total: 0, available: 0, activePages: 0 };
    this.imapStatus = { connected: false, mailboxes: 0, isPaused: false, totalReconnects: 0 };
  }
}

// Singleton instance
const metricsCollector = new MetricsCollector();

module.exports = { metricsCollector, MetricsCollector };
