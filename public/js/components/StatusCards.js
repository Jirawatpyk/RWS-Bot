/**
 * Auto RWS Dashboard - Status Cards Component
 * Display pending, success, error counts and IMAP status
 */

import { ICONS } from '../config.js';
import store from '../state/store.js';
import { formatNumber } from '../utils/helpers.js';

class StatusCards {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('StatusCards: Container not found:', containerSelector);
      return;
    }

    // Subscribe to store updates (debounce to avoid double-render)
    this._renderTimer = null;
    const scheduleRender = () => {
      clearTimeout(this._renderTimer);
      this._renderTimer = setTimeout(() => this.render(), 16);
    };
    store.subscribe('status', scheduleRender);
    store.subscribe('tasks', scheduleRender);
  }

  /**
   * Render the status cards
   */
  render() {
    if (!this.container) return;

    const status = store.get('status') || {};
    const tasks = store.get('tasks') || [];
    const { success = 0, error = 0, imapPaused = false, imapStatus = 'Running' } = status;
    const pending = tasks.length;

    this.container.innerHTML = `
      <div class="status-cards">
        ${this.cardTemplate({
          type: 'pending',
          icon: ICONS.pending,
          label: 'Pending',
          value: pending,
          subtext: 'Tasks in queue'
        })}
        ${this.cardTemplate({
          type: 'success',
          icon: ICONS.success,
          label: 'Accepted',
          value: success,
          subtext: 'Tasks accepted'
        })}
        ${this.cardTemplate({
          type: 'error',
          icon: ICONS.error,
          label: 'Failed',
          value: error,
          subtext: 'Tasks failed'
        })}
        ${this.imapCardTemplate(imapPaused, imapStatus)}
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Generate card template
   * @param {object} options - Card options
   * @returns {string} - HTML template
   */
  cardTemplate({ type, icon, label, value, subtext, change = null }) {
    const changeHtml = change !== null ? `
      <div class="status-card-change ${change >= 0 ? 'status-card-change--up' : 'status-card-change--down'}">
        <span>${change >= 0 ? '▲' : '▼'}</span>
        <span>${Math.abs(change)} today</span>
      </div>
    ` : '';

    return `
      <div class="status-card status-card--${type}">
        <div class="status-card-header">
          <span class="status-card-label">${label}</span>
          <div class="status-card-icon">${icon}</div>
        </div>
        <div class="status-card-value">${formatNumber(value)}</div>
        <div class="status-card-change text-muted">
          <span>${subtext}</span>
        </div>
        ${changeHtml}
      </div>
    `;
  }

  /**
   * Generate IMAP status card template
   * @param {boolean} isPaused - IMAP paused status
   * @param {string} status - IMAP status text
   * @returns {string} - HTML template
   */
  imapCardTemplate(isPaused, status) {
    const statusClass = isPaused ? 'error' : 'info';
    const statusText = isPaused ? 'Paused' : status;
    const icon = isPaused ? ICONS.pause : ICONS.play;

    return `
      <div class="status-card status-card--${statusClass}">
        <div class="status-card-header">
          <span class="status-card-label">IMAP Status</span>
          <div class="status-card-icon">${icon}</div>
        </div>
        <div class="status-card-value" style="font-size: var(--font-xl);">${statusText}</div>
        <div class="status-card-change text-muted">
          <span>Email listener</span>
        </div>
        <div class="status-card-action">
          <button class="btn btn-sm ${isPaused ? 'btn-success' : 'btn-secondary'}" id="btn-imap-toggle-card">
            ${isPaused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    const toggleBtn = document.getElementById('btn-imap-toggle-card');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const imapPaused = store.get('status.imapPaused');
        document.dispatchEvent(new CustomEvent('dashboard:toggleImap', {
          detail: { pause: !imapPaused }
        }));
      });
    }
  }

  /**
   * Update a specific card value with animation
   * @param {string} type - Card type
   * @param {number} value - New value
   */
  updateCard(type, value) {
    const card = this.container?.querySelector(`.status-card--${type} .status-card-value`);
    if (card) {
      const oldValue = parseInt(card.textContent.replace(/,/g, ''), 10);
      if (oldValue !== value) {
        card.classList.add('animate-scale-in');
        card.textContent = formatNumber(value);
        setTimeout(() => card.classList.remove('animate-scale-in'), 300);
      }
    }
  }

  /**
   * Set loading state
   * @param {boolean} loading - Loading state
   */
  setLoading(loading) {
    if (!this.container) return;

    if (loading) {
      this.container.innerHTML = `
        <div class="status-cards">
          <div class="status-card loading-skeleton" style="height: 140px;"></div>
          <div class="status-card loading-skeleton" style="height: 140px;"></div>
          <div class="status-card loading-skeleton" style="height: 140px;"></div>
          <div class="status-card loading-skeleton" style="height: 140px;"></div>
        </div>
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

export default StatusCards;
