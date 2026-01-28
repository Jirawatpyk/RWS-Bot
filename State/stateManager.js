/**
 * State/stateManager.js
 * Centralized State Manager - Single Source of Truth
 *
 * รวม state ที่กระจายอยู่ 4 ที่ (Memory, JSON files, Google Sheets, WebSocket)
 * ให้เป็น centralized state เดียว ผ่าน EventEmitter-based pub/sub
 *
 * Design decisions:
 *   - Singleton pattern: ทุก module ใช้ instance เดียวกัน
 *   - EventEmitter: notify subscribers เมื่อ state เปลี่ยน (state:capacity, state:tasks, etc.)
 *   - Deep copy ใน getSnapshot(): ป้องกัน external mutation
 *   - Persistence: saveToFile/loadFromFile ผ่าน Utils/fileUtils.js
 *   - Additive only: ไม่แทนที่ CapacityTracker ที่มีอยู่ แค่เพิ่ม layer ด้านบน
 */

const EventEmitter = require('events');
const path = require('path');
const { loadJSON, saveJSON } = require('../Utils/fileUtils');
const { logInfo, logFail } = require('../Logs/logger');

const STATE_FILE_PATH = path.join(__dirname, '..', 'data', 'state.json');

/**
 * Deep clone an object using JSON serialization.
 * Safe for plain data objects (no functions, Date objects become strings).
 * @param {*} obj - Object to clone
 * @returns {*} Deep copy of the object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}

class StateManager extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.state = this._createInitialState();
  }

  /**
   * Create a fresh initial state structure.
   * Extracted to a method so it can be reused for reset scenarios.
   */
  _createInitialState() {
    return {
      capacity: {},           // { 'YYYY-MM-DD': remaining_words }
      activeTasks: [],        // [{ orderId, workflowName, wordCount, deadline, ... }]
      browserPool: {
        active: 0,
        total: 0,
        available: 0
      },
      imap: {
        connected: false,
        paused: false,
        mailboxes: []
      },
      system: {
        status: 'initializing',  // 'initializing' | 'ready' | 'running' | 'paused' | 'error' | 'shutting_down'
        startTime: Date.now(),
        lastError: null
      }
    };
  }

  // ═══════════════════════════════════════════════════
  //  CAPACITY
  // ═══════════════════════════════════════════════════

  /**
   * Update capacity for a specific date.
   * @param {string} date - Date in YYYY-MM-DD format
   * @param {number} amount - Word count used for this date
   */
  updateCapacity(date, amount) {
    if (typeof date !== 'string' || typeof amount !== 'number') {
      throw new TypeError('updateCapacity requires (string date, number amount)');
    }
    this.state.capacity[date] = amount;
    this.emit('state:capacity', { date, amount });
  }

  /**
   * Bulk update the entire capacity map (e.g. after sync).
   * @param {Object} capacityMap - { 'YYYY-MM-DD': number }
   */
  setCapacityMap(capacityMap) {
    if (!capacityMap || typeof capacityMap !== 'object' || Array.isArray(capacityMap)) {
      throw new TypeError('setCapacityMap requires a plain object');
    }
    this.state.capacity = { ...capacityMap };
    this.emit('state:capacity', { bulk: true });
  }

  /**
   * Get capacity for a specific date.
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {number} Used capacity or 0 if not set
   */
  getCapacity(date) {
    return this.state.capacity[date] || 0;
  }

  /**
   * Get the full capacity map (deep copy).
   * @returns {Object} { 'YYYY-MM-DD': number }
   */
  getCapacityMap() {
    return deepClone(this.state.capacity);
  }

  /**
   * Remove a date entry from capacity.
   * @param {string} date - Date to remove
   */
  removeCapacityDate(date) {
    if (date in this.state.capacity) {
      delete this.state.capacity[date];
      this.emit('state:capacity', { date, removed: true });
    }
  }

  // ═══════════════════════════════════════════════════
  //  ACTIVE TASKS
  // ═══════════════════════════════════════════════════

  /**
   * Add a task to the active tasks list.
   * Prevents duplicate orderId entries.
   * @param {Object} task - Task object (must have orderId)
   */
  addActiveTask(task) {
    if (!task || !task.orderId) {
      throw new TypeError('addActiveTask requires a task with orderId');
    }
    // Prevent duplicates
    const exists = this.state.activeTasks.some(t => t.orderId === task.orderId);
    if (!exists) {
      this.state.activeTasks.push(deepClone(task));
      this.emit('state:tasks', { action: 'add', orderId: task.orderId });
    }
  }

  /**
   * Remove a task from the active tasks list.
   * @param {string} orderId - The order ID to remove
   * @returns {Object|null} The removed task or null
   */
  removeActiveTask(orderId) {
    const index = this.state.activeTasks.findIndex(t => t.orderId === orderId);
    if (index === -1) return null;

    const [removed] = this.state.activeTasks.splice(index, 1);
    this.emit('state:tasks', { action: 'remove', orderId });
    return removed;
  }

  /**
   * Replace the entire active tasks list (e.g. after refresh from file/sheet).
   * @param {Array} tasks - Array of task objects
   */
  setActiveTasks(tasks) {
    if (!Array.isArray(tasks)) {
      throw new TypeError('setActiveTasks requires an array');
    }
    this.state.activeTasks = deepClone(tasks);
    this.emit('state:tasks', { action: 'replace', count: tasks.length });
  }

  /**
   * Get all active tasks (deep copy).
   * @returns {Array} Active tasks
   */
  getActiveTasks() {
    return deepClone(this.state.activeTasks);
  }

  /**
   * Find an active task by orderId.
   * @param {string} orderId
   * @returns {Object|undefined} Deep copy of the task or undefined
   */
  findTask(orderId) {
    const task = this.state.activeTasks.find(t => t.orderId === orderId);
    return task ? deepClone(task) : undefined;
  }

  /**
   * Get count of active tasks.
   * @returns {number}
   */
  getActiveTaskCount() {
    return this.state.activeTasks.length;
  }

  // ═══════════════════════════════════════════════════
  //  BROWSER POOL
  // ═══════════════════════════════════════════════════

  /**
   * Update browser pool status.
   * @param {Object} status - { active, total, available }
   */
  updateBrowserPool(status) {
    if (!status || typeof status !== 'object') {
      throw new TypeError('updateBrowserPool requires a status object');
    }
    const prev = { ...this.state.browserPool };
    this.state.browserPool = {
      active: typeof status.active === 'number' ? status.active : prev.active,
      total: typeof status.total === 'number' ? status.total : prev.total,
      available: typeof status.available === 'number' ? status.available : prev.available
    };
    this.emit('state:browserPool', this.getBrowserPoolStatus());
  }

  /**
   * Get browser pool status (shallow copy, all primitives).
   * @returns {Object} { active, total, available }
   */
  getBrowserPoolStatus() {
    return { ...this.state.browserPool };
  }

  // ═══════════════════════════════════════════════════
  //  IMAP
  // ═══════════════════════════════════════════════════

  /**
   * Update IMAP connection status.
   * @param {Object} status - { connected, paused, mailboxes }
   */
  updateIMAPStatus(status) {
    if (!status || typeof status !== 'object') {
      throw new TypeError('updateIMAPStatus requires a status object');
    }
    const prev = this.state.imap;
    this.state.imap = {
      connected: typeof status.connected === 'boolean' ? status.connected : prev.connected,
      paused: typeof status.paused === 'boolean' ? status.paused : prev.paused,
      mailboxes: Array.isArray(status.mailboxes) ? [...status.mailboxes] : prev.mailboxes
    };
    this.emit('state:imap', this.getIMAPStatus());
  }

  /**
   * Get IMAP status (deep copy).
   * @returns {Object} { connected, paused, mailboxes }
   */
  getIMAPStatus() {
    return deepClone(this.state.imap);
  }

  // ═══════════════════════════════════════════════════
  //  SYSTEM
  // ═══════════════════════════════════════════════════

  /**
   * Set system status.
   * @param {string} status - One of: 'initializing', 'ready', 'running', 'paused', 'error', 'shutting_down'
   */
  setSystemStatus(status) {
    const validStatuses = ['initializing', 'ready', 'running', 'paused', 'error', 'shutting_down'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid system status: "${status}". Valid: ${validStatuses.join(', ')}`);
    }
    this.state.system.status = status;
    this.emit('state:system', { status });
  }

  /**
   * Record the last error that occurred.
   * @param {Error|string} error - The error to record
   */
  setLastError(error) {
    this.state.system.lastError = {
      message: error instanceof Error ? error.message : String(error),
      timestamp: Date.now()
    };
    this.emit('state:system', {
      status: this.state.system.status,
      lastError: this.state.system.lastError
    });
  }

  /**
   * Get current system status.
   * @returns {Object} { status, startTime, lastError }
   */
  getSystemStatus() {
    return deepClone(this.state.system);
  }

  // ═══════════════════════════════════════════════════
  //  SNAPSHOT & PERSISTENCE
  // ═══════════════════════════════════════════════════

  /**
   * Get a deep copy of the entire state.
   * Safe to pass to external consumers without risk of mutation.
   * @returns {Object} Full state snapshot
   */
  getSnapshot() {
    return deepClone(this.state);
  }

  /**
   * Save current state to data/state.json.
   * Saves only serializable data (capacity, activeTasks, system status).
   */
  saveToFile() {
    try {
      const snapshot = {
        capacity: this.state.capacity,
        activeTasks: this.state.activeTasks,
        system: {
          status: this.state.system.status,
          startTime: this.state.system.startTime,
          lastError: this.state.system.lastError
        },
        savedAt: new Date().toISOString()
      };
      saveJSON(STATE_FILE_PATH, snapshot);
      logInfo('[StateManager] State saved to file');
    } catch (err) {
      logFail(`[StateManager] Failed to save state: ${err.message}`);
    }
  }

  /**
   * Load state from data/state.json.
   * Merges with current state - only overwrites fields that exist in the file.
   * Browser pool and IMAP status are runtime-only, not restored from file.
   */
  loadFromFile() {
    try {
      const saved = loadJSON(STATE_FILE_PATH, null);
      if (!saved) {
        logInfo('[StateManager] No saved state file found, using defaults');
        return false;
      }

      // Restore capacity
      if (saved.capacity && typeof saved.capacity === 'object' && !Array.isArray(saved.capacity)) {
        this.state.capacity = saved.capacity;
      }

      // Restore active tasks
      if (Array.isArray(saved.activeTasks)) {
        this.state.activeTasks = saved.activeTasks;
      }

      // Restore system info (keep current startTime, restore lastError)
      if (saved.system) {
        if (saved.system.lastError) {
          this.state.system.lastError = saved.system.lastError;
        }
      }

      logInfo(`[StateManager] State restored from file (saved at: ${saved.savedAt || 'unknown'})`);
      return true;
    } catch (err) {
      logFail(`[StateManager] Failed to load state: ${err.message}`);
      return false;
    }
  }

  /**
   * Reset state to initial values.
   * Useful for testing or after a critical error recovery.
   */
  reset() {
    this.state = this._createInitialState();
    this.emit('state:reset');
  }
}

// ─── Singleton Export ───────────────────────────────
const stateManager = new StateManager();

module.exports = { stateManager, StateManager };
