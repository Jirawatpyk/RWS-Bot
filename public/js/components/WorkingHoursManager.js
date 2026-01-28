/**
 * Auto RWS Dashboard - Working Hours & Holidays Manager
 * Calendar view with overtime, holidays, and working hours management
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { escapeHtml } from '../utils/helpers.js';

/** Validate YYYY-MM-DD date format */
function isValidDateFormat(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

class WorkingHoursManager {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('WorkingHoursManager: Container not found:', containerSelector);
      return;
    }

    this.currentMonth = dayjs();
    this._tab = 'calendar'; // 'calendar' | 'holidays' | 'overtime'
    this._loading = false;
    this._unsubscribers = [];

    this._unsubscribers.push(store.subscribe('workingHours', () => this.render()));
    this._unsubscribers.push(store.subscribe('holidays', () => this.render()));
    this._unsubscribers.push(store.subscribe('overtime', () => this.render()));
  }

  async loadData() {
    if (this._loading) return;
    this._loading = true;
    try {
      const [wh, holidays, overtime] = await Promise.all([
        api.get('/api/working-hours').catch(() => null),
        api.get('/api/holidays').catch(() => ({ holidays: [] })),
        api.get('/api/working-hours/overtime').catch(() => ({ schedules: [] })),
      ]);

      store.set('workingHours', wh, true);
      store.set('holidays', holidays, true);
      store.set('overtime', overtime, true);
      this.render();
    } catch (err) {
      console.warn('[WorkingHoursManager] loadData failed:', err);
    } finally {
      this._loading = false;
    }
  }

  render() {
    if (!this.container) return;

    const wh = store.get('workingHours') || {};
    const schedule = wh.schedule || wh;
    const startTime = schedule.startTime || schedule.start || '10:00';
    const endTime = schedule.endTime || schedule.end || '19:00';
    const isWorkingDay = schedule.isWorkingDay !== false;

    this.container.innerHTML = `
      <div class="wh-manager">
        <div class="wh-manager-header">
          <div class="wh-manager-title">Working Hours</div>
          <div class="wh-today-schedule">
            <span class="status-dot status-dot--${isWorkingDay ? 'online' : 'offline'}"></span>
            <span>${isWorkingDay ? `${startTime} - ${endTime}` : 'Day Off'}</span>
          </div>
        </div>

        <div class="wh-tabs">
          <button class="wh-tab ${this._tab === 'calendar' ? 'active' : ''}" data-tab="calendar">${ICONS.calendar} Calendar</button>
          <button class="wh-tab ${this._tab === 'holidays' ? 'active' : ''}" data-tab="holidays">Holidays</button>
          <button class="wh-tab ${this._tab === 'overtime' ? 'active' : ''}" data-tab="overtime">Overtime</button>
        </div>

        <div class="wh-content">
          ${this._tab === 'calendar' ? this._calendarView() : ''}
          ${this._tab === 'holidays' ? this._holidaysView() : ''}
          ${this._tab === 'overtime' ? this._overtimeView() : ''}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  _calendarView() {
    const month = this.currentMonth;
    const daysInMonth = month.daysInMonth();
    const firstDay = month.startOf('month').day(); // 0=Sun
    const holidays = this._getHolidaysMap();
    const overtimeMap = this._getOvertimeMap();
    const today = dayjs().format('YYYY-MM-DD');

    let cells = '';
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (const wd of weekdays) {
      cells += `<div class="wh-cal-weekday">${wd}</div>`;
    }

    for (let i = 0; i < firstDay; i++) {
      cells += `<div class="wh-cal-day wh-cal-day--empty"></div>`;
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = month.date(d).format('YYYY-MM-DD');
      const dayOfWeek = month.date(d).day();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isToday = dateStr === today;
      const holiday = holidays[dateStr];
      const hasOT = overtimeMap[dateStr];

      let classes = 'wh-cal-day';
      if (isToday) classes += ' wh-cal-day--today';
      if (isWeekend) classes += ' wh-cal-day--weekend';
      if (holiday) {
        if (holiday.isWorking) {
          classes += ' wh-cal-day--working-holiday';
        } else if (holiday.type === 'company') {
          classes += ' wh-cal-day--company-holiday';
        } else {
          classes += ' wh-cal-day--public-holiday';
        }
      }
      if (hasOT) classes += ' wh-cal-day--ot';

      const indicators = [];
      if (holiday && !holiday.isWorking) indicators.push(`<span class="wh-cal-dot wh-cal-dot--holiday"></span>`);
      if (hasOT) indicators.push(`<span class="wh-cal-dot wh-cal-dot--ot"></span>`);

      const tooltipText = holiday ? escapeHtml(holiday.name || 'Holiday') : hasOT ? 'Overtime' : '';
      cells += `
        <div class="${classes}" data-date="${dateStr}" data-tooltip="${tooltipText}">
          <span class="wh-cal-num">${d}</span>
          ${indicators.length ? `<div class="wh-cal-indicators">${indicators.join('')}</div>` : ''}
        </div>
      `;
    }

    return `
      <div class="wh-calendar">
        <div class="wh-cal-nav">
          <button class="btn btn-icon-sm btn-ghost" id="wh-prev-month">${ICONS.chevronLeft}</button>
          <span class="wh-cal-month">${month.format('MMMM YYYY')}</span>
          <button class="btn btn-icon-sm btn-ghost" id="wh-next-month">${ICONS.chevronRight}</button>
          <button class="btn btn-sm btn-ghost calendar-today-btn" id="wh-today" data-tooltip="Go to today">Today</button>
        </div>
        <div class="wh-cal-grid">
          ${cells}
        </div>
        <div class="wh-cal-legend">
          <span class="wh-legend-item"><span class="wh-cal-dot wh-cal-dot--holiday"></span> Holiday</span>
          <span class="wh-legend-item"><span class="wh-cal-dot wh-cal-dot--ot"></span> Overtime</span>
          <span class="wh-legend-item"><span class="wh-cal-dot wh-cal-dot--weekend-dot"></span> Weekend</span>
        </div>
      </div>
    `;
  }

  _holidaysView() {
    const data = store.get('holidays') || {};
    const list = data.holidays || data || [];
    const holidayArr = Array.isArray(list) ? list : [];

    const rows = holidayArr.map(h => {
      const date = h.date || '';
      const name = h.name || h.description || 'Holiday';
      const type = h.type || 'public';
      const isWorking = h.isWorkingDay || h.isWorking || false;
      const badgeClass = type === 'company' ? 'badge-warning' : 'badge-error';

      const safeName = escapeHtml(name);
      const safeType = escapeHtml(type);

      return `
        <tr>
          <td>${dayjs(date).format(CONFIG.DATE_FORMAT.DISPLAY)}</td>
          <td>${safeName}</td>
          <td><span class="badge ${badgeClass}">${safeType}</span></td>
          <td>
            ${isWorking ? '<span class="badge badge-success">Working</span>' : ''}
            <button class="btn btn-icon-sm btn-ghost wh-delete-holiday" data-date="${date}" data-tooltip="Remove">${ICONS.delete}</button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="wh-holidays">
        <div class="wh-holidays-form">
          <input type="date" class="form-input form-input-sm" id="wh-holiday-date" />
          <input type="text" class="form-input form-input-sm" id="wh-holiday-name" placeholder="Holiday name" />
          <select class="form-select form-input-sm" id="wh-holiday-type">
            <option value="company">Company</option>
            <option value="public">Public</option>
          </select>
          <button class="btn btn-sm btn-primary" id="wh-add-holiday">Add</button>
        </div>
        <div class="table-container" style="max-height:260px;overflow-y:auto">
          <table class="table">
            <thead><tr><th>Date</th><th>Name</th><th>Type</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="text-center text-muted">No holidays</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  _overtimeView() {
    const data = store.get('overtime') || {};
    const list = data.schedules || data.overtime || [];
    const otArr = Array.isArray(list) ? list : Object.entries(list).map(([date, info]) => ({ date, ...info }));

    const rows = otArr.map(ot => {
      const date = ot.date || '';
      const start = ot.startTime || ot.start || '';
      const end = ot.endTime || ot.end || '';

      return `
        <tr>
          <td>${dayjs(date).format(CONFIG.DATE_FORMAT.DISPLAY)}</td>
          <td>${start} - ${end}</td>
          <td>
            <button class="btn btn-icon-sm btn-ghost wh-delete-ot" data-date="${date}" data-tooltip="Remove">${ICONS.delete}</button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="wh-overtime">
        <div class="wh-ot-form">
          <input type="date" class="form-input form-input-sm" id="wh-ot-date" />
          <input type="time" class="form-input form-input-sm" id="wh-ot-start" value="19:00" />
          <input type="time" class="form-input form-input-sm" id="wh-ot-end" value="22:00" />
          <button class="btn btn-sm btn-primary" id="wh-add-ot">Add OT</button>
        </div>
        <div class="table-container" style="max-height:220px;overflow-y:auto">
          <table class="table">
            <thead><tr><th>Date</th><th>Time</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="text-center text-muted">No overtime scheduled</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  _getHolidaysMap() {
    const data = store.get('holidays') || {};
    const list = data.holidays || data || [];
    const arr = Array.isArray(list) ? list : [];
    const map = {};
    for (const h of arr) {
      if (h.date) {
        map[h.date] = {
          name: h.name || h.description || 'Holiday',
          type: h.type || 'public',
          isWorking: h.isWorkingDay || h.isWorking || false,
        };
      }
    }
    return map;
  }

  _getOvertimeMap() {
    const data = store.get('overtime') || {};
    const list = data.schedules || data.overtime || [];
    const map = {};
    if (Array.isArray(list)) {
      for (const ot of list) {
        if (ot.date) map[ot.date] = true;
      }
    } else if (typeof list === 'object') {
      for (const date of Object.keys(list)) {
        map[date] = true;
      }
    }
    return map;
  }

  bindEvents() {
    // Tabs
    this.container.querySelectorAll('.wh-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._tab = btn.dataset.tab;
        this.render();
      });
    });

    // Calendar nav
    document.getElementById('wh-prev-month')?.addEventListener('click', () => {
      this.currentMonth = this.currentMonth.subtract(1, 'month');
      this.render();
    });
    document.getElementById('wh-next-month')?.addEventListener('click', () => {
      this.currentMonth = this.currentMonth.add(1, 'month');
      this.render();
    });
    document.getElementById('wh-today')?.addEventListener('click', () => {
      this.currentMonth = dayjs();
      this.render();
    });

    // Add holiday
    document.getElementById('wh-add-holiday')?.addEventListener('click', async () => {
      const date = document.getElementById('wh-holiday-date')?.value;
      const name = document.getElementById('wh-holiday-name')?.value;
      const type = document.getElementById('wh-holiday-type')?.value;
      if (!date || !name) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'warning', message: 'Please enter date and name' }
        }));
        return;
      }
      if (!isValidDateFormat(date)) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'error', message: 'Invalid date format' }
        }));
        return;
      }
      try {
        await api.post('/api/holidays', { date, name, type });
        const safeName = escapeHtml(name);
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'success', message: `Holiday "${safeName}" added` }
        }));
        await this.loadData();
      } catch (err) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'error', message: 'Failed to add holiday' }
        }));
      }
    });

    // Delete holiday
    this.container.querySelectorAll('.wh-delete-holiday').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.date;
        if (!isValidDateFormat(date)) return;
        if (!confirm(`Remove holiday on ${date}?`)) return;
        try {
          await api.delete(`/api/holidays/${date}`);
          document.dispatchEvent(new CustomEvent('toast:show', {
            detail: { type: 'success', message: 'Holiday removed' }
          }));
          await this.loadData();
        } catch (err) {
          document.dispatchEvent(new CustomEvent('toast:show', {
            detail: { type: 'error', message: 'Failed to remove holiday' }
          }));
        }
      });
    });

    // Add OT
    document.getElementById('wh-add-ot')?.addEventListener('click', async () => {
      const date = document.getElementById('wh-ot-date')?.value;
      const startTime = document.getElementById('wh-ot-start')?.value;
      const endTime = document.getElementById('wh-ot-end')?.value;
      if (!date) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'warning', message: 'Please select a date' }
        }));
        return;
      }
      if (!isValidDateFormat(date)) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'error', message: 'Invalid date format' }
        }));
        return;
      }
      try {
        await api.post('/api/working-hours/overtime', { date, startTime, endTime });
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'success', message: 'Overtime scheduled' }
        }));
        await this.loadData();
      } catch (err) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'error', message: 'Failed to add overtime' }
        }));
      }
    });

    // Delete OT
    this.container.querySelectorAll('.wh-delete-ot').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.date;
        if (!isValidDateFormat(date)) return;
        if (!confirm(`Remove overtime on ${date}?`)) return;
        try {
          await api.delete(`/api/working-hours/overtime/${date}`);
          document.dispatchEvent(new CustomEvent('toast:show', {
            detail: { type: 'success', message: 'Overtime removed' }
          }));
          await this.loadData();
        } catch (err) {
          document.dispatchEvent(new CustomEvent('toast:show', {
            detail: { type: 'error', message: 'Failed to remove overtime' }
          }));
        }
      });
    });
  }

  setLoading(loading) {
    if (!this.container) return;
    if (loading) {
      this.container.innerHTML = `
        <div class="wh-manager">
          <div class="wh-manager-header">
            <div class="wh-manager-title">Working Hours</div>
          </div>
          <div class="loading-skeleton" style="height:300px"></div>
        </div>
      `;
    }
  }

  mount() {
    this.render();
    this.loadData();
  }

  destroy() {
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
  }
}

export default WorkingHoursManager;
