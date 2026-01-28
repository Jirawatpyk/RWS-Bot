/**
 * Auto RWS Dashboard - Notification Service
 * Toast notification system
 */

import { CONFIG, ICONS } from '../config.js';
import { generateId } from '../utils/helpers.js';

class NotificationService {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.maxVisible = CONFIG.TOAST.MAX_VISIBLE;
    this.defaultDuration = CONFIG.TOAST.DURATION;
    this._initialized = false;

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  /**
   * Initialize the notification container
   */
  init() {
    // Prevent double initialization
    if (this._initialized) return;
    this._initialized = true;

    // Create container if not exists
    this.container = document.getElementById('toast-container');

    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }

    // Listen for toast events
    document.addEventListener('toast:show', (e) => {
      this.show(e.detail);
    });

    document.addEventListener('toast:hide', (e) => {
      if (e.detail?.id) {
        this.hide(e.detail.id);
      }
    });

    document.addEventListener('toast:clear', () => {
      this.clear();
    });
  }

  /**
   * Show a toast notification
   * @param {object} options - Toast options
   * @returns {string} - Toast ID
   */
  show(options = {}) {
    const {
      type = 'info',
      title = '',
      message = '',
      duration = this.defaultDuration,
      dismissible = true,
      action = null
    } = options;

    const id = generateId('toast');

    // Create toast element
    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `toast toast--${type}`;
    toast.innerHTML = this.template({ id, type, title, message, dismissible, action });

    // Add to tracking array
    this.toasts.push({ id, element: toast, timer: null });

    // Remove oldest if exceeds max
    while (this.toasts.length > this.maxVisible) {
      const oldest = this.toasts.shift();
      this.removeElement(oldest.id);
    }

    // Add to container
    this.container.appendChild(toast);

    // Bind events
    this.bindToastEvents(toast, id);

    // Auto-dismiss
    if (duration > 0) {
      const toastData = this.toasts.find(t => t.id === id);
      if (toastData) {
        toastData.timer = setTimeout(() => {
          this.hide(id);
        }, duration);
      }
    }

    return id;
  }

  /**
   * Generate toast HTML template
   * @param {object} options - Toast options
   * @returns {string} - HTML template
   */
  template({ id, type, title, message, dismissible, action }) {
    const icons = {
      success: ICONS.success,
      error: ICONS.error,
      warning: ICONS.warning,
      info: ICONS.info
    };

    return `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${this.escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="toast-message">${this.escapeHtml(message)}</div>` : ''}
        ${action ? `
          <button class="btn btn-sm btn-secondary toast-action" data-action="${action.id || 'action'}">
            ${this.escapeHtml(action.label)}
          </button>
        ` : ''}
      </div>
      ${dismissible ? `
        <button class="toast-close" data-dismiss="${id}" aria-label="Dismiss">
          ${ICONS.close}
        </button>
      ` : ''}
    `;
  }

  /**
   * Escape HTML
   * @param {string} str - String to escape
   * @returns {string} - Escaped string
   */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Bind events to toast element
   * @param {HTMLElement} toast - Toast element
   * @param {string} id - Toast ID
   */
  bindToastEvents(toast, id) {
    // Close button
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hide(id));
    }

    // Action button
    const actionBtn = toast.querySelector('.toast-action');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        const actionId = actionBtn.dataset.action;
        document.dispatchEvent(new CustomEvent('toast:action', {
          detail: { toastId: id, actionId }
        }));
        this.hide(id);
      });
    }

    // Pause timer on hover
    toast.addEventListener('mouseenter', () => {
      const toastData = this.toasts.find(t => t.id === id);
      if (toastData?.timer) {
        clearTimeout(toastData.timer);
        toastData.timer = null;
      }
    });

    // Resume timer on mouse leave
    toast.addEventListener('mouseleave', () => {
      const toastData = this.toasts.find(t => t.id === id);
      if (toastData && !toastData.timer) {
        toastData.timer = setTimeout(() => {
          this.hide(id);
        }, 2000); // Shorter delay after hover
      }
    });
  }

  /**
   * Hide a toast
   * @param {string} id - Toast ID
   */
  hide(id) {
    const toastData = this.toasts.find(t => t.id === id);
    if (!toastData) return;

    // Clear timer
    if (toastData.timer) {
      clearTimeout(toastData.timer);
    }

    // Animate out
    const element = toastData.element;
    if (element) {
      element.style.animation = 'fadeOut 0.3s ease forwards';
      setTimeout(() => {
        this.removeElement(id);
      }, 300);
    }
  }

  /**
   * Remove toast element from DOM
   * @param {string} id - Toast ID
   */
  removeElement(id) {
    const index = this.toasts.findIndex(t => t.id === id);
    if (index >= 0) {
      const toastData = this.toasts[index];
      if (toastData.element?.parentNode) {
        toastData.element.parentNode.removeChild(toastData.element);
      }
      this.toasts.splice(index, 1);
    }
  }

  /**
   * Clear all toasts
   */
  clear() {
    this.toasts.forEach(({ id, timer }) => {
      if (timer) clearTimeout(timer);
      this.removeElement(id);
    });
    this.toasts = [];
  }

  // Convenience methods

  /**
   * Show success toast
   * @param {string} message - Message
   * @param {string} title - Title (optional)
   * @returns {string} - Toast ID
   */
  success(message, title = 'Success') {
    return this.show({ type: 'success', title, message });
  }

  /**
   * Show error toast
   * @param {string} message - Message
   * @param {string} title - Title (optional)
   * @returns {string} - Toast ID
   */
  error(message, title = 'Error') {
    return this.show({ type: 'error', title, message, duration: 8000 });
  }

  /**
   * Show warning toast
   * @param {string} message - Message
   * @param {string} title - Title (optional)
   * @returns {string} - Toast ID
   */
  warning(message, title = 'Warning') {
    return this.show({ type: 'warning', title, message });
  }

  /**
   * Show info toast
   * @param {string} message - Message
   * @param {string} title - Title (optional)
   * @returns {string} - Toast ID
   */
  info(message, title = 'Info') {
    return this.show({ type: 'info', title, message });
  }

  /**
   * Show toast with action button
   * @param {object} options - Options including action
   * @returns {string} - Toast ID
   */
  withAction(options) {
    return this.show({
      ...options,
      duration: 0 // Don't auto-dismiss if there's an action
    });
  }
}

// Add fadeOut animation
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeOut {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(20px); }
    }
  `;
  document.head.appendChild(style);
}

// Create singleton instance
const notification = new NotificationService();

export { notification, NotificationService };
export default notification;
