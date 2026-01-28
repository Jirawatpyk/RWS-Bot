/**
 * Auto RWS Dashboard - Alert Banner Component
 * Display urgent task alerts
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import { getRelativeTime, escapeHtml } from '../utils/helpers.js';

class AlertBanner {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('AlertBanner: Container not found:', containerSelector);
      return;
    }

    this.dismissed = new Set(); // Track dismissed alerts

    // Subscribe to store updates
    store.subscribe('tasks', () => this.render());
    store.subscribe('alerts', () => this.render());
    store.subscribe('connected', () => this.render());
    store.subscribe('status', () => this.render());
  }

  /**
   * Render the alert banner
   */
  render() {
    if (!this.container) return;

    const alerts = this.getActiveAlerts();

    if (alerts.length === 0) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'block';
    this.container.innerHTML = alerts.map(alert => this.alertTemplate(alert)).join('');
    this.bindEvents();
  }

  /**
   * Get active alerts
   * @returns {Array} - Active alerts
   */
  getActiveAlerts() {
    const alerts = [];

    // Check for urgent tasks
    const tasks = store.get('tasks') || [];
    const now = dayjs();
    let urgentCount = 0;
    let criticalCount = 0;

    tasks.forEach(task => {
      if (this.dismissed.has(task.orderId)) return;

      const deadline = dayjs(task.deadline);
      const diffMinutes = deadline.diff(now, 'minute');

      if (diffMinutes <= 15 && diffMinutes >= 0) {
        criticalCount++;
      } else if (diffMinutes < CONFIG.TASK.URGENT_HOURS * 60 && diffMinutes > 15) {
        urgentCount++;
      }
    });

    // Add critical alert
    if (criticalCount > 0 && !this.dismissed.has('critical')) {
      alerts.push({
        id: 'critical',
        type: 'urgent',
        icon: ICONS.warning,
        message: `${criticalCount} task${criticalCount > 1 ? 's' : ''} due within 15 minutes!`,
        dismissible: true
      });
    }

    // Add urgent alert
    if (urgentCount > 0 && !this.dismissed.has('urgent')) {
      alerts.push({
        id: 'urgent',
        type: 'warning',
        icon: ICONS.warning,
        message: `${urgentCount} task${urgentCount > 1 ? 's' : ''} due within ${CONFIG.TASK.URGENT_HOURS} hours`,
        dismissible: true
      });
    }

    // Check for connection issues
    const connected = store.get('connected');
    if (!connected && !this.dismissed.has('disconnected')) {
      alerts.push({
        id: 'disconnected',
        type: 'warning',
        icon: ICONS.connection,
        message: 'Disconnected from server. Attempting to reconnect...',
        dismissible: false
      });
    }

    // Check for IMAP paused
    const imapPaused = store.get('status.imapPaused');
    if (imapPaused && !this.dismissed.has('imap-paused')) {
      alerts.push({
        id: 'imap-paused',
        type: 'warning',
        icon: ICONS.pause,
        message: 'IMAP listener is paused. No new tasks will be detected.',
        dismissible: true
      });
    }

    // Add custom alerts from store
    const customAlerts = store.get('alerts') || [];
    customAlerts.forEach(alert => {
      if (!this.dismissed.has(alert.id)) {
        alerts.push(alert);
      }
    });

    return alerts;
  }

  /**
   * Generate alert template
   * @param {object} alert - Alert data
   * @returns {string} - HTML template
   */
  alertTemplate(alert) {
    const typeClass = alert.type === 'urgent' ? 'alert-banner--urgent' : '';

    return `
      <div class="alert-banner ${typeClass}" data-alert-id="${escapeHtml(alert.id)}">
        <div class="alert-banner-content">
          <span class="alert-banner-icon">${escapeHtml(alert.icon)}</span>
          <span class="alert-banner-text">${escapeHtml(alert.message)}</span>
        </div>
        ${alert.dismissible ? `
          <button class="alert-banner-close" data-dismiss="${escapeHtml(alert.id)}" title="Dismiss">
            ${ICONS.close}
          </button>
        ` : ''}
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Dismiss buttons
    this.container.querySelectorAll('.alert-banner-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const alertId = e.target.closest('[data-dismiss]').dataset.dismiss;
        this.dismissAlert(alertId);
      });
    });
  }

  /**
   * Dismiss an alert
   * @param {string} alertId - Alert ID to dismiss
   */
  dismissAlert(alertId) {
    this.dismissed.add(alertId);

    // Animate out
    const alertEl = this.container.querySelector(`[data-alert-id="${alertId}"]`);
    if (alertEl) {
      alertEl.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => this.render(), 300);
    }

    // Auto-reset dismissed state after 5 minutes for recurring alerts
    if (['critical', 'urgent', 'imap-paused'].includes(alertId)) {
      setTimeout(() => {
        this.dismissed.delete(alertId);
        this.render();
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Show a custom alert
   * @param {object} alert - Alert configuration
   */
  showAlert(alert) {
    const alerts = store.get('alerts') || [];
    const existing = alerts.findIndex(a => a.id === alert.id);

    if (existing >= 0) {
      alerts[existing] = alert;
    } else {
      alerts.push(alert);
    }

    store.set('alerts', alerts);
  }

  /**
   * Hide a custom alert
   * @param {string} alertId - Alert ID to hide
   */
  hideAlert(alertId) {
    const alerts = store.get('alerts') || [];
    store.set('alerts', alerts.filter(a => a.id !== alertId));
  }

  /**
   * Clear all dismissed alerts
   */
  clearDismissed() {
    this.dismissed.clear();
    this.render();
  }

  /**
   * Mount component
   */
  mount() {
    // Add fadeOut animation style
    if (!document.getElementById('alert-banner-styles')) {
      const style = document.createElement('style');
      style.id = 'alert-banner-styles';
      style.textContent = `
        @keyframes fadeOut {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(-10px); }
        }
      `;
      document.head.appendChild(style);
    }

    this.render();
  }
}

export default AlertBanner;
