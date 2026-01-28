/**
 * Auto RWS Dashboard - Calendar View Component
 * Calendar heatmap showing task distribution
 */

import { ICONS } from '../config.js';
import store from '../state/store.js';
import { groupTasksByDate, escapeHtml } from '../utils/helpers.js';

class CalendarView {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('CalendarView: Container not found:', containerSelector);
      return;
    }

    // Check if dayjs is loaded
    if (typeof dayjs === 'undefined') {
      console.error('[CalendarView] dayjs not loaded');
      return;
    }

    this.currentMonth = dayjs();
    this.selectedDate = null;

    // Subscribe to store updates
    store.subscribe('tasks', (data) => {
      console.log('[CalendarView] Tasks updated:', data?.length, 'tasks');
      this.updateCalendar();
    });

    // Click outside handler to close details
    this.handleClickOutside = this.handleClickOutside.bind(this);
    document.addEventListener('click', this.handleClickOutside);
  }

  /**
   * Handle click outside to close calendar details
   * @param {Event} e - Click event
   */
  handleClickOutside(e) {
    if (!this.container) return;
    if (!this.selectedDate) return;

    // Check if click is outside the calendar container
    if (!this.container.contains(e.target)) {
      this.closeDetails();
    }
  }

  /**
   * Close calendar details
   */
  closeDetails() {
    this.selectedDate = null;
    this.container.querySelectorAll('.calendar-day--selected').forEach(el => {
      el.classList.remove('calendar-day--selected');
    });
    const detailsContainer = document.getElementById('calendar-details');
    if (detailsContainer) detailsContainer.innerHTML = '';
  }

  /**
   * Render the calendar view
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="calendar-view">
        <div class="calendar-header">
          <h3 class="calendar-title">${ICONS.calendar} Task Calendar</h3>
          <div class="calendar-nav">
            <button class="calendar-nav-btn" id="btn-prev-month">
              ${ICONS.chevronLeft}
            </button>
            <span class="calendar-month" id="calendar-month-label">
              ${this.currentMonth.format('MMMM YYYY')}
            </span>
            <button class="calendar-nav-btn" id="btn-next-month">
              ${ICONS.chevronRight}
            </button>
            <button type="button" class="calendar-nav-btn calendar-today-btn" id="btn-today">
              Today
            </button>
          </div>
        </div>
        <div class="calendar-grid" id="calendar-grid">
          ${this.renderCalendarGrid()}
        </div>
        <div id="calendar-details" class="mt-md"></div>
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Render calendar grid
   * @returns {string} - HTML template
   */
  renderCalendarGrid() {
    const tasks = store.get('tasks') || [];
    const tasksByDate = groupTasksByDate(tasks);

    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const startOfMonth = this.currentMonth.startOf('month');
    const endOfMonth = this.currentMonth.endOf('month');
    const startDay = startOfMonth.day() || 7; // Convert Sunday (0) to 7
    const daysInMonth = endOfMonth.date();
    const today = dayjs().format('YYYY-MM-DD');

    let html = '';

    // Weekday headers
    html += weekdays.map(day => `
      <div class="calendar-weekday">${day}</div>
    `).join('');

    // Empty cells before first day
    for (let i = 1; i < startDay; i++) {
      html += '<div class="calendar-day calendar-day--empty"></div>';
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = this.currentMonth.date(day).format('YYYY-MM-DD');
      const isToday = date === today;
      const isSelected = date === this.selectedDate;
      const tasksOnDay = tasksByDate[date] || [];
      const hasUrgent = tasksOnDay.some(task => {
        const diff = dayjs(task.deadline).diff(dayjs(), 'hour');
        return diff < 6 && diff >= 0;
      });

      let dayClass = 'calendar-day';
      if (isToday) dayClass += ' calendar-day--today';
      if (isSelected) dayClass += ' calendar-day--selected';

      html += `
        <div class="${dayClass}" data-date="${date}">
          <span class="calendar-day-number">${day}</span>
          ${tasksOnDay.length > 0 ? `
            <div class="calendar-day-indicator">
              ${tasksOnDay.slice(0, 3).map((_, i) => `
                <span class="calendar-day-dot ${hasUrgent && i === 0 ? 'calendar-day-dot--urgent' : ''}"></span>
              `).join('')}
              ${tasksOnDay.length > 3 ? '<span style="font-size: 8px;">+</span>' : ''}
            </div>
          ` : ''}
        </div>
      `;
    }

    // Empty cells after last day to complete the grid
    const totalCells = startDay - 1 + daysInMonth;
    const remainingCells = 7 - (totalCells % 7);
    if (remainingCells < 7) {
      for (let i = 0; i < remainingCells; i++) {
        html += '<div class="calendar-day calendar-day--empty"></div>';
      }
    }

    return html;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Navigation buttons
    const prevBtn = document.getElementById('btn-prev-month');
    const nextBtn = document.getElementById('btn-next-month');
    const todayBtn = document.getElementById('btn-today');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        this.currentMonth = this.currentMonth.subtract(1, 'month');
        this.updateCalendar();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        this.currentMonth = this.currentMonth.add(1, 'month');
        this.updateCalendar();
      });
    }

    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        this.goToToday();
      });
    }

    // Day clicks - use event delegation on grid only
    const grid = document.getElementById('calendar-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const day = e.target.closest('.calendar-day:not(.calendar-day--empty)');
        if (day) {
          this.selectDate(day.dataset.date);
        }
      });
    }
  }

  /**
   * Update calendar display
   */
  updateCalendar() {
    const grid = document.getElementById('calendar-grid');
    const monthLabel = document.getElementById('calendar-month-label');

    // If grid doesn't exist, re-render the whole component
    if (!grid) {
      console.log('[CalendarView] Grid not found, calling render()');
      this.render();
      return;
    }

    grid.innerHTML = this.renderCalendarGrid();

    if (monthLabel) {
      monthLabel.textContent = this.currentMonth.format('MMMM YYYY');
    }
  }

  /**
   * Select a date
   * @param {string} date - Date string
   */
  selectDate(date) {
    // Toggle selection - click again to deselect
    if (this.selectedDate === date) {
      this.closeDetails();
      return;
    }

    // Remove previous selection
    this.container.querySelectorAll('.calendar-day--selected').forEach(el => {
      el.classList.remove('calendar-day--selected');
    });

    // Add new selection
    const dayEl = this.container.querySelector(`[data-date="${date}"]`);
    if (dayEl) {
      dayEl.classList.add('calendar-day--selected');
    }

    this.selectedDate = date;
    this.showDateDetails(date);
  }

  /**
   * Show details for selected date
   * @param {string} date - Date string
   */
  showDateDetails(date) {
    const detailsContainer = document.getElementById('calendar-details');
    if (!detailsContainer) return;

    const tasks = store.get('tasks') || [];
    const tasksByDate = groupTasksByDate(tasks);
    const tasksOnDay = tasksByDate[date] || [];

    if (tasksOnDay.length === 0) {
      detailsContainer.innerHTML = `
        <div class="card" style="padding: var(--spacing-md);">
          <p class="text-muted text-center" style="margin: 0;">
            No tasks due on ${dayjs(date).format('dddd, MMMM D')}
          </p>
        </div>
      `;
      return;
    }

    detailsContainer.innerHTML = `
      <div class="card" style="padding: var(--spacing-md);">
        <h4 style="margin-bottom: var(--spacing-sm);">
          ${dayjs(date).format('dddd, MMMM D')} - ${tasksOnDay.length} task${tasksOnDay.length > 1 ? 's' : ''}
        </h4>
        <div style="max-height: 200px; overflow-y: auto;">
          ${tasksOnDay.map(task => {
            const time = dayjs(task.deadline).format('HH:mm');
            const words = task.words || task.wordCount || 0;
            return `
              <div class="flex-between" style="padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color);">
                <div>
                  <a href="${escapeHtml(task.link || '#')}" target="_blank" class="task-workflow">
                    ${escapeHtml(task.workflow || task.orderId || 'Unknown')}
                  </a>
                  <span class="text-muted" style="font-size: var(--font-xs);">
                    - ${words.toLocaleString()} words
                  </span>
                </div>
                <span class="badge badge-info">${escapeHtml(time)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Go to current month
   */
  goToToday() {
    this.currentMonth = dayjs();
    this.updateCalendar();
  }

  /**
   * Set loading state
   * @param {boolean} loading - Loading state
   */
  setLoading(loading) {
    if (!this.container) return;

    if (loading) {
      this.container.innerHTML = `
        <div class="calendar-view">
          <div class="calendar-header">
            <div class="loading-skeleton" style="width: 150px; height: 24px;"></div>
            <div class="loading-skeleton" style="width: 200px; height: 32px;"></div>
          </div>
          <div class="loading-skeleton" style="height: 300px; margin-top: 1rem;"></div>
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

export default CalendarView;
