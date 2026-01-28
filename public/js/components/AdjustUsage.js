/**
 * Auto RWS Dashboard - Adjust Usage Component
 * Form for adjusting daily capacity usage
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { formatNumber, formatDate } from '../utils/helpers.js';

class AdjustUsage {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('AdjustUsage: Container not found:', containerSelector);
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
                value="${today}"
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
            <button type="button" class="btn btn-secondary flex-1 quick-adjust-btn" data-amount="-500">
              -500
            </button>
            <button type="button" class="btn btn-secondary flex-1 quick-adjust-btn" data-amount="-1000">
              -1000
            </button>
            <button type="button" class="btn btn-secondary flex-1 quick-adjust-btn" data-amount="500">
              +500
            </button>
            <button type="button" class="btn btn-secondary flex-1 quick-adjust-btn" data-amount="1000">
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

    this.bindEvents();
    this.initDatePicker();
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
    // Adjust form submission
    const adjustForm = document.getElementById('form-adjust');
    if (adjustForm) {
      adjustForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleSubmit();
      });
    }

    // Quick adjust buttons
    this.container.querySelectorAll('.quick-adjust-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const amountInput = document.getElementById('adjust-amount');
        if (amountInput) {
          const current = parseInt(amountInput.value, 10) || 0;
          const delta = parseInt(btn.dataset.amount, 10);
          amountInput.value = current + delta;
        }
      });
    });
  }

  /**
   * Handle form submission
   */
  async handleSubmit() {
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
      this.updateReference();
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
   * Update capacity reference without full re-render
   */
  updateReference() {
    const refEl = document.getElementById('capacity-reference');
    if (refEl) {
      refEl.innerHTML = this.capacityReferenceTemplate();
    }
  }

  /**
   * Mount component
   */
  mount() {
    this.render();

    // Re-render reference when capacity/override changes
    store.subscribe('capacity', () => {
      this.updateReference();
    });

    store.subscribe('override', () => {
      this.updateReference();
    });
  }
}

export default AdjustUsage;
