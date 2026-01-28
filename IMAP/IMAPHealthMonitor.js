/**
 * IMAPHealthMonitor - Centralized IMAP health tracking and alerting
 *
 * Tracks reconnect frequency per mailbox and consecutive health-check failures.
 * Sends Google Chat alerts when thresholds are breached.
 * Exposes a JSON-serialisable snapshot for the Dashboard API.
 */

const { logInfo, logFail } = require('../Logs/logger');
const { IMAP_HEALTH } = require('../Config/constants');

class IMAPHealthMonitor {
  /**
   * @param {Function} notifier - notifyGoogleChat(message) function
   */
  constructor(notifier) {
    this.notifier = notifier;

    // { mailbox: string, timestamp: number }[]
    this.reconnectHistory = [];

    // mailbox -> { healthy, lastCheck, lastError, consecutiveFailures }
    this.healthStatus = new Map();

    this.alertThresholds = {
      reconnectsPerWindow: IMAP_HEALTH.RECONNECT_ALERT_THRESHOLD,
      windowMs: IMAP_HEALTH.RECONNECT_ALERT_WINDOW,
      maxConsecutiveFailures: IMAP_HEALTH.MAX_CONSECUTIVE_FAILURES,
    };

    // Max reconnect history entries to prevent unbounded memory growth
    this._maxHistorySize = 500;

    // Alert cooldown: prevent repeated alerts within the same window
    // mailbox -> timestamp of last alert sent
    this._lastReconnectAlert = new Map();
    this._lastFailureAlert = new Map();

    // Periodic prune timer (auto-cleanup old history entries)
    this._pruneTimer = setInterval(() => {
      this._pruneOldHistory();
    }, IMAP_HEALTH.HISTORY_PRUNE_INTERVAL);

    // Allow Node to exit even if timer is still active
    if (this._pruneTimer.unref) {
      this._pruneTimer.unref();
    }
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /**
   * Record a reconnect event. Called from imapClient.js attemptReconnect().
   * @param {string} mailboxName
   */
  recordReconnect(mailboxName) {
    const now = Date.now();
    this.reconnectHistory.push({ mailbox: mailboxName, timestamp: now });

    // Cap reconnect history to prevent unbounded memory growth
    if (this.reconnectHistory.length > this._maxHistorySize) {
      this.reconnectHistory = this.reconnectHistory.slice(-this._maxHistorySize);
    }

    logInfo(`[IMAPHealthMonitor] Reconnect recorded for "${mailboxName}"`);

    // Ensure mailbox entry exists
    this._ensureMailbox(mailboxName);

    // Check whether reconnect frequency crosses threshold
    this._checkReconnectFrequency(mailboxName);
  }

  /**
   * Record the result of a health check. Called from fetcher.js after performHealthCheckIfNeeded().
   * @param {string} mailboxName
   * @param {boolean} healthy
   * @param {Error|string|null} error
   */
  recordHealthCheck(mailboxName, healthy, error = null) {
    this._ensureMailbox(mailboxName);

    const status = this.healthStatus.get(mailboxName);
    status.healthy = healthy;
    status.lastCheck = Date.now();

    if (healthy) {
      // Reset consecutive failures on success
      status.consecutiveFailures = 0;
      status.lastError = null;
    } else {
      status.consecutiveFailures += 1;
      status.lastError = error instanceof Error ? error.message : error;

      logFail(`[IMAPHealthMonitor] Health check failed for "${mailboxName}" (${status.consecutiveFailures} consecutive)`);

      if (status.consecutiveFailures >= this.alertThresholds.maxConsecutiveFailures) {
        // Only alert once when crossing the threshold (exactly at threshold, or every N multiples)
        if (status.consecutiveFailures === this.alertThresholds.maxConsecutiveFailures ||
            status.consecutiveFailures % this.alertThresholds.maxConsecutiveFailures === 0) {
          const msg = `[Auto RWS] IMAP "${mailboxName}" health check failed ${status.consecutiveFailures} times consecutively. Last error: ${status.lastError}`;
          this._sendAlert(msg);
        }
      }
    }
  }

  /**
   * Return a plain object snapshot suitable for JSON serialisation (Dashboard API).
   * @returns {Object}
   */
  getHealthSnapshot() {
    const now = Date.now();

    // Per-mailbox status
    const mailboxes = {};
    for (const [mb, st] of this.healthStatus.entries()) {
      const recentReconnects = this.reconnectHistory.filter(
        (r) => r.mailbox === mb && now - r.timestamp <= this.alertThresholds.windowMs
      ).length;

      mailboxes[mb] = {
        healthy: st.healthy,
        lastCheck: st.lastCheck,
        lastError: st.lastError,
        consecutiveFailures: st.consecutiveFailures,
        recentReconnects,
      };
    }

    return {
      timestamp: now,
      thresholds: { ...this.alertThresholds },
      totalReconnectsTracked: this.reconnectHistory.length,
      mailboxes,
    };
  }

  /**
   * Stop internal timers (for graceful shutdown / tests).
   */
  destroy() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  /** Ensure a mailbox has an entry in healthStatus. */
  _ensureMailbox(mailboxName) {
    if (!this.healthStatus.has(mailboxName)) {
      this.healthStatus.set(mailboxName, {
        healthy: true,
        lastCheck: null,
        lastError: null,
        consecutiveFailures: 0,
      });
    }
  }

  /**
   * Check whether the recent reconnect frequency for a mailbox exceeds the threshold.
   * If so, fire an alert via notifier.
   * @param {string} mailboxName
   */
  _checkReconnectFrequency(mailboxName) {
    const now = Date.now();
    const windowStart = now - this.alertThresholds.windowMs;

    const recentCount = this.reconnectHistory.filter(
      (r) => r.mailbox === mailboxName && r.timestamp >= windowStart
    ).length;

    if (recentCount >= this.alertThresholds.reconnectsPerWindow) {
      // Cooldown: only alert once per window to prevent flooding
      const lastAlert = this._lastReconnectAlert.get(mailboxName) || 0;
      if (now - lastAlert < this.alertThresholds.windowMs) return;

      this._lastReconnectAlert.set(mailboxName, now);
      const windowMinutes = Math.round(this.alertThresholds.windowMs / 60000);
      const msg = `[Auto RWS] IMAP "${mailboxName}" reconnected ${recentCount} times in the last ${windowMinutes} minutes (threshold: ${this.alertThresholds.reconnectsPerWindow})`;
      this._sendAlert(msg);
    }
  }

  /**
   * Remove reconnect history entries older than the prune window.
   */
  _pruneOldHistory() {
    // Retain entries at least as long as the alert window so threshold checks work correctly
    const retentionMs = Math.max(IMAP_HEALTH.HISTORY_PRUNE_INTERVAL, this.alertThresholds.windowMs);
    const cutoff = Date.now() - retentionMs;
    const before = this.reconnectHistory.length;
    this.reconnectHistory = this.reconnectHistory.filter((r) => r.timestamp >= cutoff);
    const pruned = before - this.reconnectHistory.length;
    if (pruned > 0) {
      logInfo(`[IMAPHealthMonitor] Pruned ${pruned} old reconnect entries`);
    }
  }

  /**
   * Send alert through the configured notifier. Silently catches errors.
   * @param {string} message
   */
  _sendAlert(message) {
    logFail(`[IMAPHealthMonitor ALERT] ${message}`);
    if (typeof this.notifier === 'function') {
      Promise.resolve(this.notifier(message)).catch((err) => {
        logFail(`[IMAPHealthMonitor] Failed to send alert: ${err.message}`);
      });
    }
  }
}

module.exports = { IMAPHealthMonitor };
