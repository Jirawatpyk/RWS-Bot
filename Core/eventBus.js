/**
 * Core/eventBus.js
 * Centralized Event Bus for inter-module communication.
 * Uses Node.js built-in EventEmitter - no external dependencies.
 *
 * Event naming convention: "domain:action"
 *   - task:received, task:accepted, task:rejected, task:completed, task:failed, task:onhold
 *   - system:ready, system:shutdown, system:login_expired
 *   - capacity:updated
 */
const EventEmitter = require('events');

class SystemEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);

    // Default error handler to prevent unhandled 'error' events from crashing the process.
    // Modules can add their own 'error' listeners; this ensures a safe fallback.
    this.on('error', (err) => {
      const { logFail } = require('../Logs/logger');
      logFail(`[EventBus] Unhandled error event: ${err?.message || err}`);
    });
  }

  // ---- Task events ----
  emitTaskReceived(task) {
    this.emit('task:received', task);
  }

  emitTaskAccepted(task, evalResult) {
    this.emit('task:accepted', task, evalResult);
  }

  emitTaskRejected(task, evalResult) {
    this.emit('task:rejected', task, evalResult);
  }

  emitTaskCompleted(result) {
    this.emit('task:completed', result);
  }

  emitTaskFailed(error) {
    this.emit('task:failed', error);
  }

  emitOnHoldDetected(task) {
    this.emit('task:onhold', task);
  }

  // ---- System events ----
  emitSystemReady() {
    this.emit('system:ready');
  }

  emitSystemShutdown(reason) {
    this.emit('system:shutdown', reason);
  }

  emitLoginExpired() {
    this.emit('system:login_expired');
  }

  // ---- Capacity events ----
  emitCapacityUpdated(date) {
    this.emit('capacity:updated', date);
  }
}

// Singleton instance shared across the entire application
const eventBus = new SystemEventBus();

module.exports = { eventBus, SystemEventBus };
