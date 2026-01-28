/**
 * Auto RWS Dashboard - Set Daily Limit Component
 * Form for setting daily capacity overrides
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { formatNumber, formatDate } from '../utils/helpers.js';

class SetDailyLimit {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('SetDailyLimit: Container not found:', containerSelector);
      return;
    }

    this.isSubmitting = false;
  }

  /**
   * Render the component
   */
  render() {
    if (!this.container) return;

    const today = dayjs().format('YYYY-MM-DD');

    this.container.innerHTML = `
      <div class="capacity-manager-panel">
        <h3 class="capacity-manager-title">${ICONS.settings} Set Daily Limit</h3>
        <p class="text-muted mb-md" style="font-size: var(--font-sm);">
          Override the default capacity limit for a specific date.
        </p>
        <form class="capacity-manager-form" id="form-override">
          <div class="capacity-manager-row">
            <div class="form-group">
              <label class="form-label">Date</label>
              <input type="text"
                class="form-input date-picker"
                id="override-date"
                placeholder="Select date..."
                value="${today}"
                required>
            </div>
            <div class="form-group">
              <label class="form-label">Limit (words)</label>
              <input type="number"
                class="form-input"
                id="override-limit"
                min="0"
                step="1000"
                value="${CONFIG.CAPACITY.DEFAULT_LIMIT}"
                placeholder="e.g., 12000"
                required>
            </div>
          </div>
          <button type="submit" class="btn btn-primary w-full" id="btn-save-override">
            ${ICONS.success} Save Override
          </button>
        </form>

        <div class="mt-lg">
          <h4 style="font-size: var(--font-sm); color: var(--text-muted); margin-bottom: var(--spacing-sm);">
            Current Overrides
          </h4>
          <div id="override-list">
            ${this.overrideListTemplate()}
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.initDatePicker();
  }

  /**
   * Generate override list template
   * @returns {string} - HTML template
   */
  overrideListTemplate() {
    const override = store.get('override') || {};
    const dates = Object.keys(override).sort();

    if (dates.length === 0) {
      return '<p class="text-muted" style="font-size: var(--font-xs);">No overrides set.</p>';
    }

    return `
      <div style="max-height: 150px; overflow-y: auto;">
        ${dates.map(date => `
          <div class="flex-between" style="padding: 0.25rem 0; border-bottom: 1px solid var(--border-color);">
            <span style="font-size: var(--font-sm);">
              ${formatDate(date, 'DD/MM/YYYY')}:
              <strong>${formatNumber(override[date]?.limit || 0)}</strong>
            </span>
            <button class="btn btn-sm btn-secondary remove-override" data-date="${date}" style="padding: 2px 8px;">
              ${ICONS.close}
            </button>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Initialize date picker
   */
  initDatePicker() {
    const input = this.container.querySelector('.date-picker');
    if (input && typeof flatpickr !== 'undefined') {
      flatpickr(input, {
        dateFormat: 'Y-m-d',
        defaultDate: input.value,
        minDate: 'today',
        theme: 'dark'
      });
    }
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Override form submission
    const overrideForm = document.getElementById('form-override');
    if (overrideForm) {
      overrideForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSubmit();
      });
    }

    // Remove override buttons
    this.container.querySelectorAll('.remove-override').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.date;
        await this.removeOverride(date);
      });
    });
  }

  /**
   * Handle form submission
   */
  async handleSubmit() {
    if (this.isSubmitting) return;

    const dateInput = document.getElementById('override-date');
    const limitInput = document.getElementById('override-limit');
    const submitBtn = document.getElementById('btn-save-override');

    const date = dateInput?.value;
    const limit = parseInt(limitInput?.value, 10);

    if (!date || isNaN(limit) || limit < 0) {
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Invalid Input', message: 'Please enter a valid date and limit.' }
      }));
      return;
    }

    this.isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="loading-spinner"></span> Saving...`;
    }

    try {
      const currentOverride = store.get('override') || {};
      const defaultLimit = CONFIG.CAPACITY.DEFAULT_LIMIT;
      let newOverride;

      // If limit equals default, remove override for this date
      if (limit === defaultLimit) {
        newOverride = { ...currentOverride };
        delete newOverride[date];
      } else {
        newOverride = { ...currentOverride, [date]: { limit } };
      }

      await api.setOverride(newOverride);
      store.set('override', newOverride);

      const message = limit === defaultLimit
        ? `Limit for ${formatDate(date, 'DD/MM/YYYY')} reset to default (${formatNumber(defaultLimit)})`
        : `Limit for ${formatDate(date, 'DD/MM/YYYY')} set to ${formatNumber(limit)}`;

      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'success', title: 'Override Saved', message }
      }));

      // Refresh override list
      this.updateOverrideList();
    } catch (error) {
      console.error('Failed to save override:', error);
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Error', message: 'Failed to save override.' }
      }));
    } finally {
      this.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${ICONS.success} Save Override`;
      }
    }
  }

  /**
   * Remove an override
   * @param {string} date - Date to remove override for
   */
  async removeOverride(date) {
    try {
      const override = { ...store.get('override') };
      delete override[date];

      await api.setOverride(override);
      store.set('override', override);

      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'success', title: 'Override Removed', message: `Override for ${formatDate(date, 'DD/MM/YYYY')} removed.` }
      }));

      // Refresh override list
      this.updateOverrideList();
    } catch (error) {
      console.error('Failed to remove override:', error);
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Error', message: 'Failed to remove override.' }
      }));
    }
  }

  /**
   * Update override list without full re-render
   */
  updateOverrideList() {
    const listEl = document.getElementById('override-list');
    if (listEl) {
      listEl.innerHTML = this.overrideListTemplate();
      // Rebind remove buttons
      this.container.querySelectorAll('.remove-override').forEach(btn => {
        btn.addEventListener('click', async () => {
          const date = btn.dataset.date;
          await this.removeOverride(date);
        });
      });
    }
  }

  /**
   * Mount component
   */
  mount() {
    this.render();

    // Re-render list when override changes
    store.subscribe('override', () => {
      this.updateOverrideList();
    });
  }
}

export default SetDailyLimit;
