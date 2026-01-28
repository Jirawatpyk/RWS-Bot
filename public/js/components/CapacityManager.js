/**
 * Auto RWS Dashboard - Capacity Manager Component
 * Forms for setting daily overrides and adjusting capacity
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { formatNumber, formatDate, escapeHtml } from '../utils/helpers.js';

class CapacityManager {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('CapacityManager: Container not found:', containerSelector);
      return;
    }

    this.isSubmitting = false;
  }

  /**
   * Render the capacity manager
   */
  render() {
    if (!this.container) return;

    const today = dayjs().format('YYYY-MM-DD');

    this.container.innerHTML = `
      <div class="capacity-manager">
        ${this.overrideFormTemplate(today)}
        ${this.adjustFormTemplate(today)}
      </div>
    `;

    this.bindEvents();
    this.initDatePickers();
  }

  /**
   * Generate override form template
   * @param {string} defaultDate - Default date value
   * @returns {string} - HTML template
   */
  overrideFormTemplate(defaultDate) {
    return `
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
                value="${defaultDate}"
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
   * Generate adjust form template
   * @param {string} defaultDate - Default date value
   * @returns {string} - HTML template
   */
  adjustFormTemplate(defaultDate) {
    return `
      <div class="capacity-manager-panel">
        <h3 class="capacity-manager-title">${ICONS.edit} Adjust Usage</h3>
        <p class="text-muted mb-md" style="font-size: var(--font-sm);">
          Add or subtract words from a date's usage count.
        </p>
        <form class="capacity-manager-form" id="form-adjust">
          <div class="capacity-manager-row">
            <div class="form-group">
              <label class="form-label">Date</label>
              <input type="text"
                class="form-input date-picker"
                id="adjust-date"
                placeholder="Select date..."
                value="${defaultDate}"
                required>
            </div>
            <div class="form-group">
              <label class="form-label">Amount (+ or -)</label>
              <input type="number"
                class="form-input"
                id="adjust-amount"
                step="100"
                value="0"
                placeholder="e.g., -500 or +1000"
                required>
            </div>
          </div>
          <div class="flex gap-sm">
            <button type="button" class="btn btn-secondary flex-1" id="btn-adjust-minus" data-amount="-500">
              -500
            </button>
            <button type="button" class="btn btn-secondary flex-1" id="btn-adjust-minus-1000" data-amount="-1000">
              -1000
            </button>
            <button type="button" class="btn btn-secondary flex-1" id="btn-adjust-plus" data-amount="500">
              +500
            </button>
            <button type="button" class="btn btn-secondary flex-1" id="btn-adjust-plus-1000" data-amount="1000">
              +1000
            </button>
          </div>
          <button type="submit" class="btn btn-primary w-full mt-md" id="btn-apply-adjust">
            ${ICONS.success} Apply Adjustment
          </button>
        </form>

        <div class="mt-lg">
          <h4 style="font-size: var(--font-sm); color: var(--text-muted); margin-bottom: var(--spacing-sm);">
            Quick Reference
          </h4>
          <div id="capacity-reference">
            ${this.capacityReferenceTemplate()}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Generate capacity reference template
   * @returns {string} - HTML template
   */
  capacityReferenceTemplate() {
    const capacity = store.get('capacity') || {};
    const override = store.get('override') || {};
    const today = dayjs().format('YYYY-MM-DD');
    const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');

    const todayData = capacity[today];
    const tomorrowData = capacity[tomorrow];

    const todayUsed = todayData?.used || 0;
    const todayLimit = override[today]?.limit || todayData?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;
    const tomorrowUsed = tomorrowData?.used || 0;
    const tomorrowLimit = override[tomorrow]?.limit || tomorrowData?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;

    return `
      <div style="font-size: var(--font-xs); color: var(--text-secondary);">
        <div class="flex-between" style="padding: 0.25rem 0;">
          <span>Today (${formatDate(today, 'DD/MM')}):</span>
          <span><strong>${formatNumber(todayUsed)}</strong> / ${formatNumber(todayLimit)}</span>
        </div>
        <div class="flex-between" style="padding: 0.25rem 0;">
          <span>Tomorrow (${formatDate(tomorrow, 'DD/MM')}):</span>
          <span><strong>${formatNumber(tomorrowUsed)}</strong> / ${formatNumber(tomorrowLimit)}</span>
        </div>
      </div>
    `;
  }

  /**
   * Initialize date pickers
   */
  initDatePickers() {
    const datePickers = this.container.querySelectorAll('.date-picker');

    datePickers.forEach(input => {
      if (typeof flatpickr !== 'undefined') {
        flatpickr(input, {
          dateFormat: 'Y-m-d',
          defaultDate: input.value,
          minDate: 'today',
          theme: 'dark'
        });
      }
    });
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
        this.handleOverrideSubmit();
      });
    }

    // Adjust form submission
    const adjustForm = document.getElementById('form-adjust');
    if (adjustForm) {
      adjustForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAdjustSubmit();
      });
    }

    // Quick adjust buttons
    this.container.querySelectorAll('[data-amount]').forEach(btn => {
      btn.addEventListener('click', () => {
        const amountInput = document.getElementById('adjust-amount');
        if (amountInput) {
          const current = parseInt(amountInput.value, 10) || 0;
          const delta = parseInt(btn.dataset.amount, 10);
          amountInput.value = current + delta;
        }
      });
    });

    // Remove override buttons
    this.container.querySelectorAll('.remove-override').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.date;
        await this.removeOverride(date);
      });
    });
  }

  /**
   * Handle override form submission
   */
  async handleOverrideSubmit() {
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
      const override = { ...store.get('override'), [date]: { limit } };
      await api.setOverride(override);

      store.set('override', override);

      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: {
          type: 'success',
          title: 'Override Saved',
          message: `Limit for ${formatDate(date, 'DD/MM/YYYY')} set to ${formatNumber(limit)}`
        }
      }));

      // Refresh override list
      const listEl = document.getElementById('override-list');
      if (listEl) {
        listEl.innerHTML = this.overrideListTemplate();
        this.bindEvents(); // Rebind remove buttons
      }
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
   * Handle adjust form submission
   */
  async handleAdjustSubmit() {
    if (this.isSubmitting) return;

    const dateInput = document.getElementById('adjust-date');
    const amountInput = document.getElementById('adjust-amount');
    const submitBtn = document.getElementById('btn-apply-adjust');

    const date = dateInput?.value;
    const amount = parseInt(amountInput?.value, 10);

    if (!date || isNaN(amount) || amount === 0) {
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Invalid Input', message: 'Please enter a valid date and non-zero amount.' }
      }));
      return;
    }

    this.isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="loading-spinner"></span> Applying...`;
    }

    try {
      await api.adjustCapacity(date, amount);

      // Update local capacity
      const capacity = { ...store.get('capacity') };
      if (!capacity[date]) {
        capacity[date] = { used: 0, limit: CONFIG.CAPACITY.DEFAULT_LIMIT };
      }
      capacity[date].used = Math.max(0, (capacity[date].used || 0) + amount);
      store.set('capacity', capacity);

      const action = amount > 0 ? 'Added' : 'Removed';
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: {
          type: 'success',
          title: 'Adjustment Applied',
          message: `${action} ${formatNumber(Math.abs(amount))} words for ${formatDate(date, 'DD/MM/YYYY')}`
        }
      }));

      // Reset amount input
      if (amountInput) amountInput.value = '0';

      // Refresh reference
      const refEl = document.getElementById('capacity-reference');
      if (refEl) {
        refEl.innerHTML = this.capacityReferenceTemplate();
      }
    } catch (error) {
      console.error('Failed to adjust capacity:', error);
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Error', message: 'Failed to apply adjustment.' }
      }));
    } finally {
      this.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${ICONS.success} Apply Adjustment`;
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
      const listEl = document.getElementById('override-list');
      if (listEl) {
        listEl.innerHTML = this.overrideListTemplate();
        this.bindEvents();
      }
    } catch (error) {
      console.error('Failed to remove override:', error);
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Error', message: 'Failed to remove override.' }
      }));
    }
  }

  /**
   * Mount component
   */
  mount() {
    this.render();

    // Re-render when capacity/override changes
    store.subscribe('capacity', () => {
      const refEl = document.getElementById('capacity-reference');
      if (refEl) {
        refEl.innerHTML = this.capacityReferenceTemplate();
      }
    });

    store.subscribe('override', () => {
      const listEl = document.getElementById('override-list');
      if (listEl) {
        listEl.innerHTML = this.overrideListTemplate();
        this.bindEvents();
      }
    });
  }
}

export default CapacityManager;
