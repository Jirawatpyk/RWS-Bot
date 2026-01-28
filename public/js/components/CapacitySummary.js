/**
 * Auto RWS Dashboard - Capacity Summary Component
 * Table view of capacity with progress bars and inline editing
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { formatNumber, formatDate, getCapacityPercent, getCapacityColor, escapeHtml } from '../utils/helpers.js';

class CapacitySummary {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('CapacitySummary: Container not found:', containerSelector);
      return;
    }

    this.editingDate = null;

    // Subscribe to store updates
    store.subscribe('capacity', () => this.render());
    store.subscribe('override', () => this.render());
    store.subscribe('selectedDates', () => this.updateCheckboxes());
  }

  /**
   * Render the capacity summary
   */
  render() {
    if (!this.container) return;

    const capacity = store.get('capacity') || {};
    const override = store.get('override') || {};
    const selectedDates = store.get('selectedDates') || [];

    // Sort dates chronologically
    const dates = Object.keys(capacity).sort();

    this.container.innerHTML = `
      <div class="capacity-summary">
        <div class="capacity-summary-header">
          <h3 class="capacity-summary-title">${ICONS.calendar} Capacity Overview</h3>
          <div class="capacity-summary-actions">
            <button class="btn btn-sm btn-secondary" id="btn-cleanup" ${selectedDates.length === 0 ? 'disabled' : ''}>
              ${ICONS.delete} Cleanup
            </button>
            <button class="btn btn-sm btn-secondary" id="btn-export-capacity">
              ${ICONS.download} Export
            </button>
          </div>
        </div>

        ${dates.length === 0 ? this.emptyTemplate() : this.tableTemplate(dates, capacity, override, selectedDates)}
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Generate table template
   * @param {Array} dates - Sorted date array
   * @param {object} capacity - Capacity data
   * @param {object} override - Override data
   * @param {Array} selectedDates - Selected dates for cleanup
   * @returns {string} - HTML template
   */
  tableTemplate(dates, capacity, override, selectedDates) {
    return `
      <div class="table-container">
        <table class="table capacity-table">
          <colgroup>
            <col style="width: 5%;">
            <col style="width: 25%;">
            <col style="width: 30%;">
            <col style="width: 20%;">
            <col style="width: 12%;">
            <col style="width: 8%;">
          </colgroup>
          <thead>
            <tr>
              <th>
                <input type="checkbox" class="capacity-checkbox" id="select-all-dates"
                  ${selectedDates.length === dates.length && dates.length > 0 ? 'checked' : ''}>
              </th>
              <th>Date</th>
              <th>Progress</th>
              <th style="text-align: right;">Usage</th>
              <th style="text-align: right;">%</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${dates.map(date => this.rowTemplate(date, capacity[date], override[date], selectedDates.includes(date))).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Generate row template
   * @param {string} date - Date string
   * @param {object} data - Capacity data for date
   * @param {object} overrideData - Override data for date
   * @param {boolean} isSelected - Whether date is selected
   * @returns {string} - HTML template
   */
  rowTemplate(date, data, overrideData, isSelected) {
    const used = data?.used || 0;
    const limit = overrideData?.limit || data?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;
    const percent = getCapacityPercent(used, limit);
    const colorClass = getCapacityColor(percent);

    const isToday = dayjs(date).isSame(dayjs(), 'day');
    const isTomorrow = dayjs(date).isSame(dayjs().add(1, 'day'), 'day');
    const dayLabel = isToday ? '(Today)' : (isTomorrow ? '(Tomorrow)' : '');

    const isEditing = this.editingDate === date;

    return `
      <tr class="capacity-row" data-date="${date}">
        <td>
          <input type="checkbox" class="capacity-checkbox date-checkbox"
            data-date="${date}" ${isSelected ? 'checked' : ''}>
        </td>
        <td>
          <span class="capacity-date">${formatDate(date, 'DD/MM/YYYY')}</span>
          ${dayLabel ? `<span class="capacity-date-label">${dayLabel}</span>` : ''}
        </td>
        <td class="capacity-progress">
          <div class="capacity-progress-bar">
            <div class="capacity-progress-fill progress-bar--${colorClass}"
              style="width: ${percent}%;"></div>
          </div>
        </td>
        <td class="capacity-values" style="text-align: right;">
          <span class="capacity-used">${formatNumber(used)}</span>
          <span class="capacity-limit">/ ${isEditing ? this.editInputTemplate(date, limit) : formatNumber(limit)}</span>
        </td>
        <td class="capacity-percent text-${colorClass === 'high' ? 'error' : (colorClass === 'medium' ? 'warning' : 'success')}" style="text-align: right;">
          ${percent}%
        </td>
        <td>
          ${isEditing ?
            `<button class="btn btn-sm btn-success save-limit-btn" data-date="${date}">${ICONS.success}</button>` :
            `<button class="capacity-edit edit-limit-btn" data-date="${date}">${ICONS.edit}</button>`
          }
        </td>
      </tr>
    `;
  }

  /**
   * Generate edit input template
   * @param {string} date - Date string
   * @param {number} limit - Current limit
   * @returns {string} - HTML template
   */
  editInputTemplate(date, limit) {
    return `
      <input type="number" class="form-input form-input-sm limit-input"
        data-date="${date}"
        value="${limit}"
        min="0"
        step="1000"
        style="width: 70px; display: inline-block; padding: 2px 6px; background: var(--bg-tertiary); border: 1px solid var(--accent-cyan); color: var(--text-primary);">
    `;
  }

  /**
   * Generate empty state template
   * @returns {string} - HTML template
   */
  emptyTemplate() {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.calendar}</div>
        <div class="empty-state-title">No Capacity Data</div>
        <div class="empty-state-text">
          Capacity data will appear here when tasks are processed.
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Select all checkbox
    const selectAllCheckbox = document.getElementById('select-all-dates');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (e) => {
        const capacity = store.get('capacity') || {};
        const dates = Object.keys(capacity);

        if (e.target.checked) {
          store.set('selectedDates', dates);
        } else {
          store.set('selectedDates', []);
        }
      });
    }

    // Individual date checkboxes
    this.container.querySelectorAll('.date-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const date = e.target.dataset.date;
        const selectedDates = store.get('selectedDates') || [];

        if (e.target.checked) {
          store.set('selectedDates', [...selectedDates, date]);
        } else {
          store.set('selectedDates', selectedDates.filter(d => d !== date));
        }
      });
    });

    // Edit limit buttons
    this.container.querySelectorAll('.edit-limit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const date = e.target.closest('[data-date]').dataset.date;
        this.editingDate = date;
        this.render();

        // Focus input after render
        setTimeout(() => {
          const input = this.container.querySelector(`.limit-input[data-date="${date}"]`);
          if (input) {
            input.focus();
            input.select();
          }
        }, 50);
      });
    });

    // Save limit buttons
    this.container.querySelectorAll('.save-limit-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const date = e.target.closest('[data-date]').dataset.date;
        const input = this.container.querySelector(`.limit-input[data-date="${date}"]`);
        if (input) {
          await this.saveLimit(date, parseInt(input.value, 10));
        }
      });
    });

    // Handle Enter key in limit input
    this.container.querySelectorAll('.limit-input').forEach(input => {
      input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          const date = e.target.dataset.date;
          await this.saveLimit(date, parseInt(e.target.value, 10));
        } else if (e.key === 'Escape') {
          this.editingDate = null;
          this.render();
        }
      });
    });

    // Cleanup button
    const cleanupBtn = document.getElementById('btn-cleanup');
    if (cleanupBtn) {
      cleanupBtn.addEventListener('click', () => this.handleCleanup());
    }

    // Export button
    const exportBtn = document.getElementById('btn-export-capacity');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.handleExport());
    }
  }

  /**
   * Save limit override
   * @param {string} date - Date string
   * @param {number} limit - New limit
   */
  async saveLimit(date, limit) {
    try {
      const currentOverride = store.get('override') || {};
      const defaultLimit = CONFIG.CAPACITY.DEFAULT_LIMIT;
      let newOverride;

      // If limit equals default, remove override for this date
      if (limit === defaultLimit) {
        newOverride = { ...currentOverride };
        delete newOverride[date];
      } else {
        newOverride = { ...currentOverride, [date]: { ...currentOverride[date], limit } };
      }

      await api.setOverride(newOverride);

      store.set('override', newOverride);
      this.editingDate = null;
      this.render();

      const message = limit === defaultLimit
        ? `Capacity limit for ${date} reset to default (${formatNumber(defaultLimit)})`
        : `Capacity limit for ${date} set to ${formatNumber(limit)}`;

      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'success', title: 'Limit Updated', message }
      }));
    } catch (error) {
      console.error('Failed to save limit:', error);
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Error', message: 'Failed to update capacity limit' }
      }));
    }
  }

  /**
   * Handle cleanup action
   */
  async handleCleanup() {
    const selectedDates = store.get('selectedDates') || [];
    if (selectedDates.length === 0) return;

    if (!confirm(`Remove ${selectedDates.length} date(s) from capacity tracking?`)) {
      return;
    }

    try {
      await api.cleanupCapacity(selectedDates);

      // Update local state
      const capacity = { ...store.get('capacity') };
      selectedDates.forEach(date => delete capacity[date]);

      store.set('capacity', capacity);
      store.set('selectedDates', []);

      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'success', title: 'Cleanup Complete', message: `Removed ${selectedDates.length} date(s)` }
      }));
    } catch (error) {
      console.error('Cleanup failed:', error);
      document.dispatchEvent(new CustomEvent('toast:show', {
        detail: { type: 'error', title: 'Error', message: 'Failed to cleanup capacity data' }
      }));
    }
  }

  /**
   * Handle export action
   */
  handleExport() {
    const capacity = store.get('capacity') || {};
    const override = store.get('override') || {};
    const dates = Object.keys(capacity).sort();

    const csvRows = [
      ['Date', 'Used', 'Limit', 'Percentage'].join(',')
    ];

    dates.forEach(date => {
      const used = capacity[date]?.used || 0;
      const limit = override[date]?.limit || capacity[date]?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;
      const percent = getCapacityPercent(used, limit);

      csvRows.push([date, used, limit, `${percent}%`].join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `capacity_${dayjs().format('YYYY-MM-DD')}.csv`;
    link.click();

    document.dispatchEvent(new CustomEvent('toast:show', {
      detail: { type: 'success', title: 'Export Complete', message: 'Capacity data exported to CSV' }
    }));
  }

  /**
   * Update checkbox states without full re-render
   */
  updateCheckboxes() {
    const selectedDates = store.get('selectedDates') || [];

    this.container.querySelectorAll('.date-checkbox').forEach(checkbox => {
      checkbox.checked = selectedDates.includes(checkbox.dataset.date);
    });

    // Update cleanup button state
    const cleanupBtn = document.getElementById('btn-cleanup');
    if (cleanupBtn) {
      cleanupBtn.disabled = selectedDates.length === 0;
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
        <div class="capacity-summary">
          <div class="capacity-summary-header">
            <div class="loading-skeleton" style="width: 200px; height: 24px;"></div>
          </div>
          <div style="padding: 1rem;">
            <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
            <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
            <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
          </div>
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

export default CapacitySummary;
