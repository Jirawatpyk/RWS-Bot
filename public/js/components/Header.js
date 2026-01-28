/**
 * Auto RWS Dashboard - Header Component
 * Logo, title, connection status, actions
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';

class Header {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('Header: Container not found:', containerSelector);
      return;
    }

    // Subscribe to store updates
    store.subscribe('connected', () => this.updateConnectionStatus());
    store.subscribe('reconnecting', () => this.updateConnectionStatus());
    store.subscribe('lastSync', () => this.updateLastSync());
    store.subscribe('status.imapPaused', () => this.updateImapStatus());
  }

  /**
   * Render the header
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = this.template();
    this.bindEvents();
  }

  /**
   * Generate header HTML
   * @returns {string} - HTML template
   */
  template() {
    const connected = store.get('connected');
    const reconnecting = store.get('reconnecting');
    const lastSync = store.get('lastSync');
    const imapPaused = store.get('status.imapPaused');

    const connectionClass = reconnecting ? 'connecting' : (connected ? 'online' : 'offline');
    const connectionText = reconnecting ? 'Reconnecting...' : (connected ? 'Connected' : 'Disconnected');

    return `
      <header class="header">
        <div class="container">
          <div class="header-content">
            <div class="header-brand">
              <div class="header-logo">R</div>
              <div>
                <div class="header-title">${CONFIG.APP_NAME}</div>
                <div class="header-subtitle">v${CONFIG.APP_VERSION}</div>
              </div>
            </div>

            <div class="header-actions">
              <!-- Last Sync -->
              <div class="header-status" id="header-last-sync" data-tooltip="Last synchronized">
                <span>${ICONS.refresh}</span>
                <span id="last-sync-text">${lastSync ? dayjs(lastSync).format('HH:mm:ss') : '--:--:--'}</span>
              </div>

              <!-- Connection Status -->
              <div class="header-status" id="header-connection">
                <span class="status-dot status-dot--${connectionClass}"></span>
                <span id="connection-text">${connectionText}</span>
              </div>

              <!-- IMAP Status -->
              <button class="btn ${imapPaused ? 'btn-success' : 'btn-secondary'}" id="btn-toggle-imap" data-tooltip="${imapPaused ? 'Resume IMAP' : 'Pause IMAP'}">
                <span>${imapPaused ? ICONS.play : ICONS.pause}</span>
                <span class="hide-mobile">${imapPaused ? 'Resume' : 'Pause'}</span>
              </button>

              <!-- Refresh Button -->
              <button class="btn btn-primary" id="btn-refresh" data-tooltip="Refresh data (R)">
                <span>${ICONS.refresh}</span>
                <span class="hide-mobile">Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </header>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Refresh button
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.handleRefresh());
    }

    // Toggle IMAP button
    const imapBtn = document.getElementById('btn-toggle-imap');
    if (imapBtn) {
      imapBtn.addEventListener('click', () => this.handleToggleImap());
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key.toLowerCase() === CONFIG.SHORTCUTS.REFRESH) {
        e.preventDefault();
        this.handleRefresh();
      }

      if (e.key.toLowerCase() === CONFIG.SHORTCUTS.PAUSE) {
        e.preventDefault();
        this.handleToggleImap();
      }
    });
  }

  /**
   * Handle refresh action
   */
  handleRefresh() {
    const btn = document.getElementById('btn-refresh');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('loading');
    }

    // Dispatch custom event for app to handle
    document.dispatchEvent(new CustomEvent('dashboard:refresh'));

    // Re-enable button after short delay
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    }, 1000);
  }

  /**
   * Handle IMAP toggle
   */
  handleToggleImap() {
    const imapPaused = store.get('status.imapPaused');

    // Dispatch custom event for WebSocket to handle
    document.dispatchEvent(new CustomEvent('dashboard:toggleImap', {
      detail: { pause: !imapPaused }
    }));
  }

  /**
   * Update connection status display
   */
  updateConnectionStatus() {
    const connected = store.get('connected');
    const reconnecting = store.get('reconnecting');

    const statusDot = this.container?.querySelector('#header-connection .status-dot');
    const statusText = document.getElementById('connection-text');

    if (statusDot) {
      statusDot.className = 'status-dot';
      if (reconnecting) {
        statusDot.classList.add('status-dot--connecting');
      } else if (connected) {
        statusDot.classList.add('status-dot--online');
      } else {
        statusDot.classList.add('status-dot--offline');
      }
    }

    if (statusText) {
      if (reconnecting) {
        statusText.textContent = 'Reconnecting...';
      } else if (connected) {
        statusText.textContent = 'Connected';
      } else {
        statusText.textContent = 'Disconnected';
      }
    }
  }

  /**
   * Update last sync timestamp
   */
  updateLastSync() {
    const lastSync = store.get('lastSync');
    const syncText = document.getElementById('last-sync-text');

    if (syncText && lastSync) {
      syncText.textContent = dayjs(lastSync).format('HH:mm:ss');
    }
  }

  /**
   * Update IMAP status button
   */
  updateImapStatus() {
    const imapPaused = store.get('status.imapPaused');
    const btn = document.getElementById('btn-toggle-imap');

    if (btn) {
      btn.className = `btn ${imapPaused ? 'btn-success' : 'btn-secondary'}`;
      btn.setAttribute('data-tooltip', imapPaused ? 'Resume IMAP' : 'Pause IMAP');
      btn.innerHTML = `
        <span>${imapPaused ? ICONS.play : ICONS.pause}</span>
        <span class="hide-mobile">${imapPaused ? 'Resume' : 'Pause'}</span>
      `;
    }
  }

  /**
   * Mount component
   */
  mount() {
    this.render();
  }
}

export default Header;
