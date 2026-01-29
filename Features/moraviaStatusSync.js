/**
 * Features/moraviaStatusSync.js
 * Real-time Status Sync from Moravia via Google Sheet polling.
 *
 * Moravia does not provide webhooks, so this module polls the tracking sheet
 * at a configurable interval to detect completed / on-hold tasks and broadcasts
 * changes to all connected WebSocket clients.
 *
 * Design decisions:
 *  - Uses existing loadAndFilterTasks() from taskReporter to avoid duplicate logic.
 *  - _syncing guard prevents overlapping sync calls (the Google Sheet query is slow).
 *  - setInterval with .unref() so this timer does not keep the process alive during shutdown.
 *  - Emits events via eventBus so other modules can react to status changes.
 */

const { logInfo, logSuccess, logFail } = require('../Logs/logger');
const { STATUS_SYNC } = require('../Config/constants');
const { stateManager } = require('../State/stateManager');

class MoraviaStatusSync {
  /**
   * @param {object} deps
   * @param {object} deps.taskReporter  - must expose loadAndFilterTasks()
   * @param {Function} deps.broadcastToClients - broadcast(data) to WebSocket clients
   * @param {Function} deps.notifier - notifyGoogleChat(message)
   * @param {import('../Core/eventBus').SystemEventBus} deps.eventBus
   */
  constructor({ taskReporter, broadcastToClients, notifier, eventBus, capacitySync }) {
    if (!taskReporter || typeof taskReporter.loadAndFilterTasks !== 'function') {
      throw new Error('MoraviaStatusSync requires taskReporter with loadAndFilterTasks()');
    }
    if (typeof broadcastToClients !== 'function') {
      throw new Error('MoraviaStatusSync requires broadcastToClients function');
    }

    this.taskReporter = taskReporter;
    this.broadcast = broadcastToClients;
    this.notifier = notifier;
    this.eventBus = eventBus;
    this.capacitySync = capacitySync || null;

    this._interval = null;
    this._syncing = false;
    this.lastSyncResult = null;
    this._syncCount = 0;
  }

  /**
   * Start periodic polling.
   * @param {number} [intervalMs] - polling interval in ms (default from constants)
   */
  startPolling(intervalMs) {
    const interval = intervalMs || STATUS_SYNC.POLLING_INTERVAL;

    if (this._interval) {
      logInfo('[StatusSync] Polling already active, skipping startPolling()');
      return;
    }

    this._interval = setInterval(() => this.sync(), interval);
    this._interval.unref();

    logInfo(`[StatusSync] Polling started (every ${Math.round(interval / 1000)}s)`);
  }

  /**
   * Stop periodic polling.
   */
  stopPolling() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      logInfo('[StatusSync] Polling stopped');
    }
  }

  /**
   * Run a single sync cycle.
   * Safe to call manually (e.g. from /api/sync/trigger).
   * Concurrent calls are silently ignored while a sync is in progress.
   *
   * @returns {object} sync result or null if skipped due to concurrency guard
   */
  async sync() {
    if (this._syncing) {
      logInfo('[StatusSync] Sync already in progress, skipping');
      return null;
    }

    this._syncing = true;
    this._syncCount++;
    const syncId = this._syncCount;

    try {
      logInfo(`[StatusSync] Sync #${syncId} started`);

      // loadAndFilterTasks reads acceptedTasks.json, queries Google Sheet,
      // removes completed/on-hold tasks, and returns counts.
      const result = await this.taskReporter.loadAndFilterTasks();

      const completedCount = result.completedCount || 0;
      const onHoldCount = result.onHoldCount || 0;

      // Sync active tasks to centralized StateManager
      if (Array.isArray(result.activeTasks)) {
        try { stateManager.setActiveTasks(result.activeTasks); } catch (_) { /* non-critical */ }
      }

      // Sync capacity with remaining tasks (recalculate from allocationPlan)
      let capacitySyncResult = null;
      if (typeof this.capacitySync === 'function') {
        try {
          capacitySyncResult = await this.capacitySync();
        } catch (capErr) {
          logFail(`[StatusSync] Capacity sync failed: ${capErr.message}`);
        }
      }

      // Broadcast to WebSocket clients when there are status changes
      if (completedCount > 0 || onHoldCount > 0) {
        this.broadcast({
          type: 'tasksUpdated',
          completedCount,
          onHoldCount,
          activeTasks: result.activeTasks.length,
          timestamp: Date.now()
        });

        // Emit event bus events for other modules
        if (this.eventBus) {
          if (completedCount > 0) {
            this.eventBus.emit('sync:completed', { count: completedCount });
          }
          if (onHoldCount > 0) {
            this.eventBus.emit('sync:onhold', { count: onHoldCount });
          }
        }

        // Notify Google Chat only when tasks completed (reduce noise)
        if (completedCount > 0 && typeof this.notifier === 'function') {
          try {
            await this.notifier(
              `[Status Sync] ${completedCount} tasks completed, ${onHoldCount} on hold`
            );
          } catch (notifyErr) {
            logFail(`[StatusSync] Notification failed: ${notifyErr.message}`);
          }
        }
      }

      // Broadcast capacity update if changed
      if (capacitySyncResult?.success && capacitySyncResult.diff !== 0) {
        const dates = Object.keys(capacitySyncResult.after || {});
        dates.forEach(date => {
          this.broadcast({ type: 'capacityUpdated', date });
        });
      }

      this.lastSyncResult = {
        timestamp: Date.now(),
        syncId,
        activeTasks: result.activeTasks.length,
        completedCount,
        onHoldCount,
        capacity: capacitySyncResult,
        success: true
      };

      logSuccess(
        `[StatusSync] Sync #${syncId} done: ` +
        `active=${result.activeTasks.length}, completed=${completedCount}, onHold=${onHoldCount}`
      );

      // Return full data for API callers (includes tasks array)
      // lastSyncResult stores only count to avoid memory waste
      return {
        ...this.lastSyncResult,
        activeTasksList: result.activeTasks
      };

    } catch (err) {
      this.lastSyncResult = {
        timestamp: Date.now(),
        syncId,
        success: false,
        error: err.message
      };

      logFail(`[StatusSync] Sync #${syncId} failed: ${err.message}`);
      return this.lastSyncResult;

    } finally {
      this._syncing = false;
    }
  }

  /**
   * Get current status (for /api/sync/status endpoint).
   * @returns {object}
   */
  getStatus() {
    return {
      ...this.lastSyncResult,
      isPolling: !!this._interval,
      syncCount: this._syncCount,
      isSyncing: this._syncing
    };
  }
}

module.exports = { MoraviaStatusSync };
