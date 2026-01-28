/**
 * Auto RWS Dashboard - State Management
 * Simple pub/sub store for state management
 */

class Store {
  constructor(initialState = {}) {
    this._state = initialState;
    this._subscribers = new Map();
    this._globalSubscribers = new Set();
    this._history = [];
    this._maxHistory = 50;
  }

  /**
   * Get current state or specific key
   * @param {string} key - Optional state key
   * @returns {*} - State value
   */
  get(key) {
    if (key === undefined) {
      return { ...this._state };
    }

    // Support nested keys like 'user.name'
    return key.split('.').reduce((obj, k) => obj?.[k], this._state);
  }

  /**
   * Set state value
   * @param {string} key - State key
   * @param {*} value - New value
   * @param {boolean} silent - Skip notifications
   */
  set(key, value, silent = false) {
    const oldValue = this.get(key);

    // Don't update if value hasn't changed
    if (JSON.stringify(oldValue) === JSON.stringify(value)) {
      return;
    }

    // Save to history
    this._saveHistory(key, oldValue, value);

    // Update state
    if (key.includes('.')) {
      // Handle nested keys
      const keys = key.split('.');
      const lastKey = keys.pop();
      const parent = keys.reduce((obj, k) => {
        if (!obj[k]) obj[k] = {};
        return obj[k];
      }, this._state);
      parent[lastKey] = value;
    } else {
      this._state[key] = value;
    }

    // Notify subscribers
    if (!silent) {
      this._notify(key, value, oldValue);
    }
  }

  /**
   * Update multiple state values at once
   * @param {object} updates - Object with key-value pairs
   * @param {boolean} silent - Skip notifications
   */
  update(updates, silent = false) {
    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value, true);
    });

    if (!silent) {
      this._notifyGlobal(updates);
    }
  }

  /**
   * Subscribe to changes for a specific key
   * @param {string|Function} keyOrCallback - State key or global callback
   * @param {Function} callback - Callback function (if key provided)
   * @returns {Function} - Unsubscribe function
   */
  subscribe(keyOrCallback, callback) {
    // Global subscription (no key)
    if (typeof keyOrCallback === 'function') {
      this._globalSubscribers.add(keyOrCallback);
      return () => this._globalSubscribers.delete(keyOrCallback);
    }

    // Key-specific subscription
    const key = keyOrCallback;
    if (!this._subscribers.has(key)) {
      this._subscribers.set(key, new Set());
    }
    this._subscribers.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const subs = this._subscribers.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this._subscribers.delete(key);
        }
      }
    };
  }

  /**
   * Subscribe to multiple keys
   * @param {Array<string>} keys - State keys
   * @param {Function} callback - Callback function
   * @returns {Function} - Unsubscribe function
   */
  subscribeMany(keys, callback) {
    const unsubscribers = keys.map(key => this.subscribe(key, callback));
    return () => unsubscribers.forEach(unsub => unsub());
  }

  /**
   * Subscribe once (auto-unsubscribe after first notification)
   * @param {string} key - State key
   * @param {Function} callback - Callback function
   */
  once(key, callback) {
    const unsubscribe = this.subscribe(key, (value, oldValue) => {
      unsubscribe();
      callback(value, oldValue);
    });
  }

  /**
   * Reset state to initial values
   * @param {object} initialState - New initial state
   */
  reset(initialState = {}) {
    this._state = initialState;
    this._history = [];
    this._notifyGlobal(this._state);
  }

  /**
   * Get state history
   * @returns {Array} - History entries
   */
  getHistory() {
    return [...this._history];
  }

  /**
   * Save state change to history
   * @private
   */
  _saveHistory(key, oldValue, newValue) {
    this._history.push({
      key,
      oldValue,
      newValue,
      timestamp: Date.now()
    });

    // Trim history if too long
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(-this._maxHistory);
    }
  }

  /**
   * Notify subscribers for a specific key
   * @private
   */
  _notify(key, value, oldValue) {
    // Notify key-specific subscribers
    const subs = this._subscribers.get(key);
    if (subs) {
      subs.forEach(callback => {
        try {
          callback(value, oldValue, key);
        } catch (error) {
          console.error(`Store subscriber error for key "${key}":`, error);
        }
      });
    }

    // Also notify parent key subscribers for nested updates
    if (key.includes('.')) {
      const parentKey = key.split('.')[0];
      const parentSubs = this._subscribers.get(parentKey);
      if (parentSubs) {
        parentSubs.forEach(callback => {
          try {
            callback(this.get(parentKey), undefined, parentKey);
          } catch (error) {
            console.error(`Store subscriber error for key "${parentKey}":`, error);
          }
        });
      }
    }

    // Notify global subscribers
    this._globalSubscribers.forEach(callback => {
      try {
        callback({ [key]: value }, key);
      } catch (error) {
        console.error('Store global subscriber error:', error);
      }
    });
  }

  /**
   * Notify global subscribers for batch updates
   * @private
   */
  _notifyGlobal(updates) {
    this._globalSubscribers.forEach(callback => {
      try {
        callback(updates, null);
      } catch (error) {
        console.error('Store global subscriber error:', error);
      }
    });

    // Notify key-specific subscribers for each updated key
    Object.entries(updates).forEach(([key, value]) => {
      const subs = this._subscribers.get(key);
      if (subs) {
        subs.forEach(callback => {
          try {
            callback(value, undefined, key);
          } catch (error) {
            console.error(`Store subscriber error for key "${key}":`, error);
          }
        });
      }
    });
  }
}

// Initial state for the dashboard
const initialState = {
  // Connection
  connected: false,
  reconnecting: false,
  lastSync: null,

  // Status counts
  status: {
    pending: 0,
    success: 0,
    error: 0,
    imapPaused: false,
    imapStatus: 'Running'
  },

  // Capacity data
  capacity: {},
  override: {},

  // Tasks
  tasks: [],
  filteredTasks: [],
  taskFilter: 'all',
  taskSearch: '',
  taskSort: { key: 'deadline', direction: 'asc' },
  taskPage: 1,
  taskPageSize: 10,

  // UI State
  loading: {
    capacity: false,
    tasks: false,
    override: false
  },
  errors: {},

  // Alerts
  alerts: [],

  // Selected dates for capacity operations
  selectedDates: []
};

// Create singleton instance
const store = new Store(initialState);

// Export for debugging
if (typeof window !== 'undefined') {
  window.__store = store;
}

export { store, Store };
export default store;
