/**
 * Auto RWS Dashboard - WebSocket Service
 * WebSocket connection manager with auto-reconnect
 */

import { CONFIG } from '../config.js';
import store from '../state/store.js';

class WebSocketService {
  constructor() {
    this.socket = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.messageHandlers = new Map();
    this.isManualClose = false;
  }

  /**
   * Connect to WebSocket server
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      // Close existing socket if any
      this.disconnect();

      // Determine WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      console.log('[WebSocket] Connecting to:', wsUrl);
      store.set('reconnecting', true);

      try {
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          console.log('[WebSocket] Connected');
          this.reconnectAttempts = 0;
          store.set('connected', true);
          store.set('reconnecting', false);
          store.set('lastSync', new Date().toISOString());

          // Start ping interval
          this.startPing();

          resolve();
        };

        this.socket.onclose = (event) => {
          console.log('[WebSocket] Disconnected:', event.code, event.reason);
          store.set('connected', false);
          this.stopPing();

          if (!this.isManualClose) {
            this.scheduleReconnect();
          }
        };

        this.socket.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          store.set('connected', false);
          reject(error);
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event);
        };
      } catch (error) {
        console.error('[WebSocket] Connection failed:', error);
        store.set('connected', false);
        store.set('reconnecting', false);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    this.isManualClose = true;
    this.stopPing();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    store.set('connected', false);
    store.set('reconnecting', false);
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= CONFIG.WS.MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebSocket] Max reconnect attempts reached');
      store.set('reconnecting', false);

      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: {
          type: 'error',
          title: 'Connection Lost',
          message: 'Unable to reconnect to server. Please refresh the page.'
        }
      }));
      return;
    }

    store.set('reconnecting', true);
    this.reconnectAttempts++;

    const delay = CONFIG.WS.RECONNECT_DELAY * Math.min(this.reconnectAttempts, 5);
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.isManualClose = false;
      this.connect().catch(() => {
        // Error handled in connect()
      });
    }, delay);
  }

  /**
   * Start ping interval
   */
  startPing() {
    this.stopPing();

    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, CONFIG.WS.PING_INTERVAL);
  }

  /**
   * Stop ping interval
   */
  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Handle incoming message
   * @param {MessageEvent} event - WebSocket message event
   */
  handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      const { type, payload, ...rest } = data;

      // Server may send data at root level or in payload - normalize it
      const messageData = payload || rest;

      // Update last sync time
      store.set('lastSync', new Date().toISOString());

      // Handle specific message types
      switch (type) {
        case 'pong':
          // Ping response, connection is alive
          break;

        case 'updateStatus':
        case 'status':
          this.handleStatusUpdate(messageData);
          break;

        case 'capacityUpdated':
        case 'capacity':
          this.handleCapacityUpdate(messageData);
          break;

        case 'tasksUpdated':
        case 'tasks':
          this.handleTasksUpdate(messageData);
          break;

        case 'logEntry':
        case 'log':
          this.handleLogEntry(messageData);
          break;

        case 'togglePause':
        case 'imapStatus':
          this.handleImapStatus(messageData);
          break;

        case 'alert':
          this.handleAlert(messageData);
          break;

        default:
          // Check for custom handlers
          const handler = this.messageHandlers.get(type);
          if (handler) {
            handler(messageData);
          } else {
            console.log('[WebSocket] Unknown message type:', type, messageData);
          }
      }

      // Emit raw message event
      document.dispatchEvent(new CustomEvent('ws:message', { detail: data }));

    } catch (error) {
      console.error('[WebSocket] Failed to parse message:', error, event.data);
    }
  }

  /**
   * Handle status update
   * @param {object} payload - Status data
   */
  handleStatusUpdate(payload) {
    const currentStatus = store.get('status') || {};
    store.set('status', { ...currentStatus, ...payload });
  }

  /**
   * Handle capacity update
   * @param {object} payload - Capacity data
   */
  handleCapacityUpdate(payload) {
    if (payload.capacity) {
      store.set('capacity', payload.capacity);
    }
    if (payload.override) {
      store.set('override', payload.override);
    }
  }

  /**
   * Handle tasks update
   * @param {object} payload - Tasks data
   */
  handleTasksUpdate(payload) {
    if (Array.isArray(payload)) {
      store.set('tasks', payload);
    } else if (payload.tasks) {
      store.set('tasks', payload.tasks);
    }
  }

  /**
   * Handle log entry
   * @param {object} payload - Log entry data
   */
  handleLogEntry(payload) {
    // Could emit an event for a log viewer component
    console.log('[Log]', payload.message || payload);

    // Show toast for important log entries
    if (payload.level === 'error') {
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: {
          type: 'error',
          title: 'Error',
          message: payload.message || 'An error occurred'
        }
      }));
    }
  }

  /**
   * Handle IMAP status change
   * @param {object} payload - IMAP status data
   */
  handleImapStatus(payload) {
    const currentStatus = store.get('status') || {};
    store.set('status', {
      ...currentStatus,
      imapPaused: payload.paused ?? payload.isPaused ?? currentStatus.imapPaused,
      imapStatus: payload.status || (payload.paused ? 'Paused' : 'Running')
    });
  }

  /**
   * Handle alert
   * @param {object} payload - Alert data
   */
  handleAlert(payload) {
    document.dispatchEvent(new CustomEvent('toast:show', {
      detail: {
        type: payload.type || 'info',
        title: payload.title || 'Alert',
        message: payload.message
      }
    }));
  }

  /**
   * Send message to server
   * @param {object} data - Data to send
   * @returns {boolean} - Success status
   */
  send(data) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Cannot send - not connected');
      return false;
    }

    try {
      this.socket.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('[WebSocket] Send failed:', error);
      return false;
    }
  }

  /**
   * Toggle IMAP pause state
   * @param {boolean} pause - True to pause, false to resume
   */
  toggleImap(pause) {
    this.send({
      type: 'togglePause',
      payload: { pause }
    });
  }

  /**
   * Request data refresh
   */
  requestRefresh() {
    this.send({ type: 'refresh' });
  }

  /**
   * Register custom message handler
   * @param {string} type - Message type
   * @param {Function} handler - Handler function
   * @returns {Function} - Unregister function
   */
  on(type, handler) {
    this.messageHandlers.set(type, handler);
    return () => this.messageHandlers.delete(type);
  }

  /**
   * Get connection state
   * @returns {boolean} - True if connected
   */
  isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

// Create singleton instance
const ws = new WebSocketService();

export { ws, WebSocketService };
export default ws;
