/**
 * State/stateSyncService.js
 * Synchronize StateManager changes to WebSocket clients.
 *
 * Design decisions:
 *   - Listens to all state:* events from StateManager
 *   - Broadcasts formatted payloads to all connected WebSocket clients
 *   - Debounces rapid-fire events (e.g. bulk capacity updates) to avoid flooding
 *   - Decoupled from Dashboard/server.js: receives broadcast function via constructor
 */

const { logInfo, logFail } = require('../Logs/logger');

/** Default debounce interval in milliseconds for state broadcasts */
const DEFAULT_DEBOUNCE_MS = 100;

class StateSyncService {
  /**
   * @param {import('./stateManager').StateManager} stateManager - The centralized state manager
   * @param {Function} broadcastToClients - Function that sends data to all WebSocket clients
   * @param {Object} [options]
   * @param {number} [options.debounceMs=100] - Debounce interval for rapid events
   */
  constructor(stateManager, broadcastToClients, options = {}) {
    if (!stateManager) throw new Error('StateSyncService requires a stateManager instance');
    if (typeof broadcastToClients !== 'function') throw new Error('StateSyncService requires a broadcastToClients function');

    this.stateManager = stateManager;
    this.broadcast = broadcastToClients;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

    /** @type {Map<string, NodeJS.Timeout>} Active debounce timers keyed by event type */
    this._debounceTimers = new Map();

    /** @type {Function[]} Bound listener references for cleanup */
    this._listeners = [];

    this._setupListeners();

    logInfo('[StateSyncService] Initialized - listening for state changes');
  }

  /**
   * Register listeners for all state change events.
   * Each listener broadcasts the relevant data to WebSocket clients.
   */
  _setupListeners() {
    this._addListener('state:capacity', () => {
      // Use a factory function so payload is built at broadcast time (after debounce),
      // not at event time, ensuring clients receive the latest state.
      this._debouncedBroadcast('capacityUpdated', () => ({
        type: 'capacityUpdated',
        capacity: this.stateManager.getCapacityMap()
      }));
    });

    this._addListener('state:tasks', (detail) => {
      this._debouncedBroadcast('tasksUpdated', () => ({
        type: 'tasksUpdated',
        tasks: this.stateManager.getActiveTasks(),
        action: detail?.action,
        count: this.stateManager.getActiveTaskCount()
      }));
    });

    this._addListener('state:browserPool', (status) => {
      this._safeBroadcast({
        type: 'browserPoolUpdated',
        browserPool: status
      });
    });

    this._addListener('state:imap', (status) => {
      this._safeBroadcast({
        type: 'imapUpdated',
        imap: status
      });
    });

    this._addListener('state:system', (info) => {
      this._safeBroadcast({
        type: 'systemUpdated',
        system: info
      });
    });

    this._addListener('state:reset', () => {
      this._safeBroadcast({
        type: 'stateReset',
        snapshot: this.stateManager.getSnapshot()
      });
    });
  }

  /**
   * Broadcast with error protection.
   * Prevents broadcast errors from crashing the event listener chain.
   * @param {Object} payload - Data to broadcast
   */
  _safeBroadcast(payload) {
    try {
      this.broadcast(payload);
    } catch (err) {
      logFail(`[StateSyncService] Broadcast error: ${err.message}`);
    }
  }

  /**
   * Register a listener on the state manager and track it for cleanup.
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  _addListener(event, handler) {
    this.stateManager.on(event, handler);
    this._listeners.push({ event, handler });
  }

  /**
   * Debounce rapid-fire broadcasts of the same type.
   * If multiple state:capacity events fire within debounceMs,
   * only the last one triggers a broadcast.
   *
   * @param {string} key - Unique key for debouncing (e.g. 'capacityUpdated')
   * @param {Object|Function} payloadOrFactory - Data to broadcast, or a factory function
   *   that returns the payload. Using a factory ensures the payload reflects the latest
   *   state at broadcast time rather than event time.
   */
  _debouncedBroadcast(key, payloadOrFactory) {
    if (this.debounceMs <= 0) {
      const payload = typeof payloadOrFactory === 'function' ? payloadOrFactory() : payloadOrFactory;
      this._safeBroadcast(payload);
      return;
    }

    // Clear previous timer for this key
    const existing = this._debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this._debounceTimers.delete(key);
      try {
        const payload = typeof payloadOrFactory === 'function' ? payloadOrFactory() : payloadOrFactory;
        this.broadcast(payload);
      } catch (err) {
        logFail(`[StateSyncService] Broadcast error for ${key}: ${err.message}`);
      }
    }, this.debounceMs);

    this._debounceTimers.set(key, timer);
  }

  /**
   * Send the full state snapshot to a single client (e.g. on new connection).
   * @param {Function} sendToClient - Function to send data to one client
   */
  sendFullState(sendToClient) {
    if (typeof sendToClient !== 'function') return;
    try {
      sendToClient({
        type: 'fullState',
        snapshot: this.stateManager.getSnapshot()
      });
    } catch (err) {
      logFail(`[StateSyncService] Failed to send full state: ${err.message}`);
    }
  }

  /**
   * Clean up all listeners and timers.
   * Call this during graceful shutdown.
   */
  destroy() {
    // Clear all debounce timers
    for (const timer of this._debounceTimers.values()) {
      clearTimeout(timer);
    }
    this._debounceTimers.clear();

    // Remove all registered listeners
    for (const { event, handler } of this._listeners) {
      this.stateManager.removeListener(event, handler);
    }
    this._listeners = [];

    logInfo('[StateSyncService] Destroyed - all listeners removed');
  }
}

module.exports = { StateSyncService };
