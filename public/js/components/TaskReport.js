/**
 * Auto RWS Dashboard - Task Report Component
 * Task table with search, filter, sort, and pagination
 */

import { CONFIG, ICONS, TASK_COLUMNS, TASK_FILTERS } from '../config.js';
import store from '../state/store.js';
import {
  formatNumber,
  formatDateTime,
  getRelativeTime,
  escapeHtml,
  sanitizeUrl,
  sortBy,
  filterBySearch,
  paginate,
  getTaskFilter,
  debounce
} from '../utils/helpers.js';

class TaskReport {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('TaskReport: Container not found:', containerSelector);
      return;
    }

    // Track global event listener to prevent memory leak
    this.keydownHandler = null;
    this.keydownBound = false;

    // Subscribe to store updates
    store.subscribe('tasks', () => this.processAndRender());
    store.subscribe('taskFilter', () => this.processAndRender());
    store.subscribe('taskSearch', () => this.processAndRender());
    store.subscribe('taskSort', () => this.processAndRender());
    store.subscribe('taskPage', () => this.render());
    store.subscribe('taskPageSize', () => this.processAndRender());

    // Debounced search handler
    this.handleSearchInput = debounce((value) => {
      store.set('taskSearch', value);
      store.set('taskPage', 1);
    }, 300);

    // Debounced render to prevent multiple rapid renders
    this._debouncedProcessAndRender = debounce(() => {
      this._doProcessAndRender();
    }, 50);
  }

  /**
   * Debounced process and render
   */
  processAndRender() {
    this._debouncedProcessAndRender();
  }

  /**
   * Actual process and render implementation
   */
  _doProcessAndRender() {
    const tasks = store.get('tasks') || [];
    const filter = store.get('taskFilter') || 'all';
    const search = store.get('taskSearch') || '';
    const sort = store.get('taskSort') || { key: 'deadline', direction: 'asc' };

    // Apply filter
    let filtered = tasks.filter(getTaskFilter(filter));

    // Apply search
    if (search) {
      filtered = filterBySearch(filtered, search, ['workflow', 'orderId', 'name']);
    }

    // Apply sort
    filtered = sortBy(filtered, sort.key, sort.direction);

    store.set('filteredTasks', filtered, true);
    this.render();
  }

  /**
   * Render the task report
   * Uses stable DOM structure - controls are only created once
   */
  render() {
    if (!this.container) return;

    const filteredTasks = store.get('filteredTasks') || [];
    const page = store.get('taskPage') || 1;
    const pageSize = store.get('taskPageSize') || CONFIG.TASK.DEFAULT_PAGE_SIZE;
    const tasks = store.get('tasks') || [];

    // Calculate summary stats
    const stats = this.calculateStats(tasks);

    // Paginate
    const pagination = paginate(filteredTasks, page, pageSize);

    // Check if structure exists (controls should never be rebuilt)
    const existingReport = this.container.querySelector('.task-report');

    if (!existingReport) {
      // First render - create stable structure
      this.container.innerHTML = `
        <div class="task-report">
          <div class="task-report-header">
            <div class="task-report-summary-container"></div>
            ${this.controlsTemplate()}
          </div>
          <div class="task-report-body"></div>
          <div class="task-report-footer-container"></div>
        </div>
      `;
      this.bindEvents();
    }

    // Update summary (dynamic content)
    const summaryContainer = this.container.querySelector('.task-report-summary-container');
    if (summaryContainer) {
      summaryContainer.innerHTML = this.summaryTemplate(stats);
    }

    // Update body (table or empty state)
    const body = this.container.querySelector('.task-report-body');
    if (body) {
      body.innerHTML = filteredTasks.length === 0
        ? this.emptyTemplate()
        : this.tableTemplate(pagination);
      this.bindTableEvents();
    }

    // Update footer
    const footerContainer = this.container.querySelector('.task-report-footer-container');
    if (footerContainer) {
      footerContainer.innerHTML = filteredTasks.length > 0
        ? this.footerTemplate(pagination)
        : '';
      if (filteredTasks.length > 0) {
        this.bindPaginationEvents();
      }
    }
  }

  /**
   * Calculate summary statistics
   * @param {Array} tasks - All tasks
   * @returns {object} - Stats object
   */
  calculateStats(tasks) {
    const now = dayjs();
    let inProgress = 0;
    let today = 0;
    let tomorrow = 0;
    let later = 0;
    let urgent = 0;

    tasks.forEach(task => {
      const deadline = dayjs(task.deadline);
      const diffHours = deadline.diff(now, 'hour');

      if (diffHours < CONFIG.TASK.URGENT_HOURS && diffHours >= 0) {
        urgent++;
      }

      if (deadline.isSame(now, 'day')) {
        today++;
      } else if (deadline.isSame(now.add(1, 'day'), 'day')) {
        tomorrow++;
      } else if (deadline.isAfter(now.add(1, 'day'), 'day')) {
        later++;
      }

      inProgress++;
    });

    return { inProgress, today, tomorrow, later, urgent };
  }

  /**
   * Generate summary template
   * @param {object} stats - Statistics
   * @returns {string} - HTML template
   */
  summaryTemplate(stats) {
    return `
      <div class="task-report-summary">
        <div class="task-report-stat">
          <span class="task-report-stat-label">In Progress:</span>
          <span class="task-report-stat-value">${stats.inProgress}</span>
        </div>
        ${stats.urgent > 0 ? `
          <div class="task-report-stat" style="background: var(--status-error-bg);">
            <span class="task-report-stat-label text-error">Urgent:</span>
            <span class="task-report-stat-value text-error">${stats.urgent}</span>
          </div>
        ` : ''}
        <div class="task-report-stat">
          <span class="task-report-stat-label">Today:</span>
          <span class="task-report-stat-value">${stats.today}</span>
        </div>
        <div class="task-report-stat">
          <span class="task-report-stat-label">Tomorrow:</span>
          <span class="task-report-stat-value">${stats.tomorrow}</span>
        </div>
        <div class="task-report-stat">
          <span class="task-report-stat-label">Later:</span>
          <span class="task-report-stat-value">${stats.later}</span>
        </div>
      </div>
    `;
  }

  /**
   * Generate controls template
   * @returns {string} - HTML template
   */
  controlsTemplate() {
    const currentFilter = store.get('taskFilter') || 'all';
    const currentSearch = store.get('taskSearch') || '';

    return `
      <div class="task-report-controls">
        <div class="task-report-search">
          <span class="task-report-search-icon">${ICONS.search}</span>
          <input type="text"
            class="task-report-search-input"
            id="task-search"
            placeholder="Search workflow or order ID..."
            value="${escapeHtml(currentSearch)}">
        </div>

        <div class="task-report-filters">
          <select class="form-select" id="task-filter" style="width: auto;">
            ${TASK_FILTERS.map(f => `
              <option value="${f.value}" ${f.value === currentFilter ? 'selected' : ''}>
                ${f.label}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="task-report-actions">
          <button class="btn btn-sm btn-secondary" id="btn-refresh-tasks">
            ${ICONS.refresh} Refresh
          </button>
          <button class="btn btn-sm btn-secondary" id="btn-export-tasks">
            ${ICONS.download} CSV
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Generate table template
   * @param {object} pagination - Pagination data
   * @returns {string} - HTML template
   */
  tableTemplate(pagination) {
    const sort = store.get('taskSort') || { key: 'deadline', direction: 'asc' };

    return `
      <div class="table-container">
        <table class="table task-table">
          <thead>
            <tr>
              ${TASK_COLUMNS.map(col => `
                <th
                  class="${col.sortable ? 'sortable' : ''} ${sort.key === col.key ? 'sorted' : ''}"
                  ${col.sortable ? `data-sort="${col.key}"` : ''}
                  style="${col.width ? `width: ${col.width};` : ''} ${col.align ? `text-align: ${col.align};` : ''}">
                  ${col.label}
                  ${col.sortable ? `
                    <span class="sort-icon">
                      ${sort.key === col.key ? (sort.direction === 'asc' ? ICONS.sortAsc : ICONS.sortDesc) : ICONS.sortAsc}
                    </span>
                  ` : ''}
                </th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${pagination.items.map((task, index) => this.rowTemplate(task, pagination.startIndex + index - 1)).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Generate table row template
   * @param {object} task - Task data
   * @param {number} index - Row index
   * @returns {string} - HTML template
   */
  rowTemplate(task, index) {
    const relativeTime = getRelativeTime(task.deadline);
    const workflowId = task.workflow || task.orderId || '-';
    const link = sanitizeUrl(task.link);

    // Determine row class based on urgency
    let rowClass = '';
    if (relativeTime.isUrgent) {
      rowClass = 'task-table-row--urgent';
    } else if (dayjs(task.deadline).isSame(dayjs(), 'day')) {
      rowClass = 'task-table-row--today';
    }

    return `
      <tr class="${rowClass}" data-task-id="${escapeHtml(task.orderId || String(index))}">
        <td>${index + 1}</td>
        <td>
          <a href="${escapeHtml(link)}" target="_blank" class="task-workflow" title="Open in Moravia">
            ${escapeHtml(workflowId)}
          </a>
        </td>
        <td class="task-words" style="text-align: right;">
          ${formatNumber(task.words || task.wordCount || 0)}
        </td>
        <td class="task-deadline">
          ${escapeHtml(formatDateTime(task.deadline))}
        </td>
        <td>
          <span class="task-status badge badge-${relativeTime.isUrgent ? 'error' : 'info'}">
            ${escapeHtml(relativeTime.text)}
          </span>
        </td>
        <td>
          <a href="${escapeHtml(link)}" target="_blank" class="btn btn-sm btn-secondary">
            ${ICONS.link}
          </a>
        </td>
      </tr>
    `;
  }

  /**
   * Generate empty state template
   * @returns {string} - HTML template
   */
  emptyTemplate() {
    const filter = store.get('taskFilter');
    const search = store.get('taskSearch');

    let message = 'No tasks are currently in progress.';
    if (search) {
      message = `No tasks found matching "${escapeHtml(search)}"`;
    } else if (filter !== 'all') {
      message = `No ${filter} tasks found.`;
    }

    return `
      <div class="empty-state">
        <div class="empty-state-icon">${ICONS.calendar}</div>
        <div class="empty-state-title">No Tasks</div>
        <div class="empty-state-text">${message}</div>
      </div>
    `;
  }

  /**
   * Generate footer template with pagination
   * @param {object} pagination - Pagination data
   * @returns {string} - HTML template
   */
  footerTemplate(pagination) {
    const { currentPage, totalPages, startIndex, endIndex, totalItems, hasNext, hasPrev } = pagination;
    const pageSize = store.get('taskPageSize') || CONFIG.TASK.DEFAULT_PAGE_SIZE;

    // Generate page buttons
    const pageButtons = [];
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pageButtons.push(`
        <button class="task-pagination-btn ${i === currentPage ? 'active' : ''}"
          data-page="${i}">${i}</button>
      `);
    }

    return `
      <div class="task-report-footer">
        <div class="flex gap-md" style="align-items: center;">
          <span>Showing ${startIndex}-${endIndex} of ${totalItems}</span>
          <select class="form-select" id="page-size" style="width: auto;">
            ${CONFIG.TASK.PAGE_SIZES.map(size => `
              <option value="${size}" ${size === pageSize ? 'selected' : ''}>${size} per page</option>
            `).join('')}
          </select>
        </div>

        <div class="task-pagination">
          <button class="task-pagination-btn" data-page="prev" ${!hasPrev ? 'disabled' : ''}>
            ${ICONS.chevronLeft}
          </button>
          ${pageButtons.join('')}
          <button class="task-pagination-btn" data-page="next" ${!hasNext ? 'disabled' : ''}>
            ${ICONS.chevronRight}
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Search input
    const searchInput = document.getElementById('task-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.handleSearchInput(e.target.value);
      });

      // Focus search on / (bind only once to prevent memory leak)
      if (!this.keydownBound) {
        this.keydownHandler = (e) => {
          if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            const searchEl = document.getElementById('task-search');
            if (searchEl) searchEl.focus();
          }
        };
        document.addEventListener('keydown', this.keydownHandler);
        this.keydownBound = true;
      }
    }

    // Filter select
    const filterSelect = document.getElementById('task-filter');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        store.set('taskFilter', e.target.value);
        store.set('taskPage', 1);
      });
    }

    // Sortable headers
    this.container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const currentSort = store.get('taskSort') || { key: 'deadline', direction: 'asc' };

        const direction = currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc';
        store.set('taskSort', { key, direction });
      });
    });

    // Pagination buttons
    this.container.querySelectorAll('.task-pagination-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        const currentPage = store.get('taskPage') || 1;

        if (page === 'prev') {
          store.set('taskPage', Math.max(1, currentPage - 1));
        } else if (page === 'next') {
          const totalPages = Math.ceil((store.get('filteredTasks') || []).length / (store.get('taskPageSize') || CONFIG.TASK.DEFAULT_PAGE_SIZE));
          store.set('taskPage', Math.min(totalPages, currentPage + 1));
        } else {
          store.set('taskPage', parseInt(page, 10));
        }
      });
    });

    // Page size select
    const pageSizeSelect = document.getElementById('page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        store.set('taskPageSize', parseInt(e.target.value, 10));
        store.set('taskPage', 1);
      });
    }

    // Refresh button
    const refreshBtn = document.getElementById('btn-refresh-tasks');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('dashboard:refresh'));
      });
    }

    // Export button
    const exportBtn = document.getElementById('btn-export-tasks');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.handleExport());
    }
  }

  /**
   * Bind table-specific events (sortable headers)
   */
  bindTableEvents() {
    this.container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const currentSort = store.get('taskSort') || { key: 'deadline', direction: 'asc' };
        const direction = currentSort.key === key && currentSort.direction === 'asc' ? 'desc' : 'asc';
        store.set('taskSort', { key, direction });
      });
    });
  }

  /**
   * Bind pagination events
   */
  bindPaginationEvents() {
    this.container.querySelectorAll('.task-pagination-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        const currentPage = store.get('taskPage') || 1;

        if (page === 'prev') {
          store.set('taskPage', Math.max(1, currentPage - 1));
        } else if (page === 'next') {
          const totalPages = Math.ceil((store.get('filteredTasks') || []).length / (store.get('taskPageSize') || CONFIG.TASK.DEFAULT_PAGE_SIZE));
          store.set('taskPage', Math.min(totalPages, currentPage + 1));
        } else {
          store.set('taskPage', parseInt(page, 10));
        }
      });
    });

    const pageSizeSelect = document.getElementById('page-size');
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (e) => {
        store.set('taskPageSize', parseInt(e.target.value, 10));
        store.set('taskPage', 1);
      });
    }
  }

  /**
   * Handle export to CSV
   */
  handleExport() {
    const tasks = store.get('filteredTasks') || [];

    const csvRows = [
      ['#', 'Workflow', 'Words', 'Deadline', 'Status', 'Link'].join(',')
    ];

    tasks.forEach((task, index) => {
      const relativeTime = getRelativeTime(task.deadline);
      csvRows.push([
        index + 1,
        task.workflow || task.orderId || '',
        task.words || task.wordCount || 0,
        formatDateTime(task.deadline),
        relativeTime.text,
        task.link || ''
      ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `tasks_${dayjs().format('YYYY-MM-DD_HHmm')}.csv`;
    link.click();

    document.dispatchEvent(new CustomEvent('toast:show', {
      detail: { type: 'success', title: 'Export Complete', message: `Exported ${tasks.length} tasks to CSV` }
    }));
  }

  /**
   * Set loading state
   * Only updates body content, preserves header/controls structure
   * @param {boolean} loading - Loading state
   */
  setLoading(loading) {
    if (!this.container) return;

    if (loading) {
      // Check if structure exists
      const existingReport = this.container.querySelector('.task-report');

      if (!existingReport) {
        // No structure yet - create skeleton with stable structure
        this.container.innerHTML = `
          <div class="task-report">
            <div class="task-report-header">
              <div class="task-report-summary-container">
                <div class="loading-skeleton" style="height: 24px; width: 200px;"></div>
              </div>
              ${this.controlsTemplate()}
            </div>
            <div class="task-report-body">
              <div style="padding: 1rem;">
                <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
                <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
                <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
              </div>
            </div>
            <div class="task-report-footer-container"></div>
          </div>
        `;
        this.bindEvents();
      } else {
        // Structure exists - only update body with skeleton
        const body = this.container.querySelector('.task-report-body');
        if (body) {
          body.innerHTML = `
            <div style="padding: 1rem;">
              <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
              <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
              <div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>
            </div>
          `;
        }
      }
    }
  }

  /**
   * Mount component
   */
  mount() {
    this.processAndRender();
  }
}

export default TaskReport;
