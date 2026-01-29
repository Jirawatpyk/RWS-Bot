/**
 * Auto RWS Dashboard - Queue Monitor Component
 * Real-time persistent task queue monitoring
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { formatNumber, escapeHtml } from '../utils/helpers.js';

class QueueMonitor {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('QueueMonitor: Container not found:', containerSelector);
      return;
    }

    this._refreshTimer = null;
    this._sortKey = 'createdAt';
    this._sortDir = 'desc';
    this._loading = false;
    this._unsubscribers = [];

    this._unsubscribers.push(store.subscribe('queueStatus', () => this.render()));
    this._unsubscribers.push(store.subscribe('queueRecent', () => this.render()));
  }

  async loadData() {
    if (this._loading) return;
    this._loading = true;
    try {
      const [status, recent] = await Promise.all([
        api.get('/api/queue/status').catch(() => null),
        api.get('/api/queue/recent').catch(() => ({ tasks: [] })),
      ]);

      store.set('queueStatus', status, true);
      store.set('queueRecent', recent, true);
      this.render();
    } catch (err) {
      console.warn('[QueueMonitor] loadData failed:', err);
    } finally {
      this._loading = false;
    }
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => this.loadData(), 15000);
  }

  stopAutoRefresh() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  render() {
    if (!this.container) return;

    const rawStatus = store.get('queueStatus') || {};
    // API may wrap in { persistent: {...} }, { inMemory: {...} }, or return flat
    const status = rawStatus.persistent || rawStatus;
    const inMem = rawStatus.inMemory || {};
    const recentData = store.get('queueRecent') || {};
    const tasks = recentData.tasks || recentData || [];
    const taskArr = Array.isArray(tasks) ? tasks : [];
    const queueEnabled = rawStatus.enabled !== false;

    const total = status.total || 0;
    const pending = status.pending || inMem.queued || 0;
    const processing = status.processing || status.inProgress || inMem.processing || 0;
    const completed = status.completed || 0;
    const failed = status.failed || 0;
    const utilization = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

    // Sort tasks
    const sorted = [...taskArr].sort((a, b) => {
      const aVal = a[this._sortKey] || '';
      const bVal = b[this._sortKey] || '';
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return this._sortDir === 'asc' ? cmp : -cmp;
    });

    this.container.innerHTML = `
      <div class="queue-monitor">
        <div class="queue-monitor-header">
          <div class="queue-monitor-title">Queue Monitor ${!queueEnabled ? '<span class="badge badge-warning">Not Ready</span>' : ''}</div>
          <div class="queue-monitor-actions">
            <button class="btn btn-sm btn-danger" id="btn-queue-cleanup" data-tooltip="Remove old completed/failed tasks">
              ${ICONS.delete} Cleanup
            </button>
            <button class="btn btn-sm btn-secondary" id="btn-queue-refresh">
              ${ICONS.refresh} Refresh
            </button>
          </div>
        </div>

        <div class="queue-status-cards">
          ${this._statusCard('Total', total, 'info')}
          ${this._statusCard('Pending', pending, 'pending')}
          ${this._statusCard('Processing', processing, 'info')}
          ${this._statusCard('Completed', completed, 'success')}
          ${this._statusCard('Failed', failed, 'error')}
        </div>

        <div class="queue-progress">
          <div class="queue-progress-bar">
            <div class="queue-progress-fill progress-bar--${utilization > 90 ? 'high' : utilization > 50 ? 'medium' : 'low'}" style="width:${utilization}%"></div>
          </div>
          <span class="queue-progress-label">${utilization}% processed</span>
        </div>

        <div class="queue-table-wrap">
          <table class="table queue-table">
            <thead>
              <tr>
                <th class="sortable" data-sort="id">ID ${this._sortIcon('id')}</th>
                <th class="sortable" data-sort="taskMeta">Task ${this._sortIcon('taskMeta')}</th>
                <th class="sortable" data-sort="status">Status ${this._sortIcon('status')}</th>
                <th class="sortable" data-sort="createdAt">Created ${this._sortIcon('createdAt')}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.length === 0
                ? '<tr><td colspan="5" class="text-center text-muted">No tasks in queue</td></tr>'
                : sorted.map(t => this._taskRow(t)).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  _statusCard(label, value, type) {
    return `
      <div class="queue-stat queue-stat--${type}">
        <span class="queue-stat-value">${formatNumber(value)}</span>
        <span class="queue-stat-label">${label}</span>
      </div>
    `;
  }

  _taskRow(task) {
    const id = task.id || task.rowid || '-';
    const meta = task.taskMeta || task.taskData || task.meta || {};
    const workflow = typeof meta === 'string' ? meta : (meta.workflowName || meta.orderId || meta.workflow || meta.taskLink || '-');
    const status = task.status || 'unknown';
    const created = task.createdAt ? dayjs(task.createdAt).format('DD/MM HH:mm') : '-';
    const error = task.error || '';
    const isFailed = status === 'failed';

    const safeWorkflow = escapeHtml(workflow);
    const safeError = escapeHtml(error);
    const safeId = escapeHtml(String(id));
    const safeStatus = escapeHtml(status);

    const badgeMap = {
      pending: 'badge-pending',
      processing: 'badge-info',
      completed: 'badge-success',
      failed: 'badge-error',
    };

    return `
      <tr class="${isFailed ? 'queue-row--failed' : ''}">
        <td class="tabular-nums">${safeId}</td>
        <td class="truncate" style="max-width:180px" data-tooltip="${safeWorkflow}">${safeWorkflow}</td>
        <td><span class="badge ${badgeMap[status] || 'badge-info'}">${safeStatus}</span></td>
        <td class="tabular-nums">${created}</td>
        <td>
          ${isFailed ? `<button class="btn btn-sm btn-ghost queue-retry-btn" data-id="${safeId}" data-tooltip="Retry task">${ICONS.refresh}</button>` : ''}
          ${safeError ? `<span class="text-error text-muted" data-tooltip="${safeError}">!</span>` : ''}
        </td>
      </tr>
    `;
  }

  _sortIcon(key) {
    if (this._sortKey !== key) return '';
    return `<span class="sort-icon">${this._sortDir === 'asc' ? ICONS.sortAsc : ICONS.sortDesc}</span>`;
  }

  bindEvents() {
    // Refresh
    document.getElementById('btn-queue-refresh')?.addEventListener('click', () => this.loadData());

    // Cleanup
    document.getElementById('btn-queue-cleanup')?.addEventListener('click', async () => {
      if (!confirm('Remove all completed and failed tasks older than 7 days?')) return;
      try {
        await api.post('/api/queue/cleanup', { olderThanDays: 7 });
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'success', message: 'Queue cleaned up' }
        }));
        await this.loadData();
      } catch (err) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'error', message: 'Cleanup failed' }
        }));
      }
    });

    // Sort
    this.container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (this._sortKey === key) {
          this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          this._sortKey = key;
          this._sortDir = 'desc';
        }
        this.render();
      });
    });

    // Retry
    this.container.querySelectorAll('.queue-retry-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        try {
          await api.post(`/api/queue/retry/${id}`);
          document.dispatchEvent(new CustomEvent('toast:show', {
            detail: { type: 'success', message: `Task ${id} requeued` }
          }));
          await this.loadData();
        } catch (err) {
          document.dispatchEvent(new CustomEvent('toast:show', {
            detail: { type: 'error', message: `Failed to retry task ${id}` }
          }));
          btn.disabled = false;
        }
      });
    });
  }

  setLoading(loading) {
    if (!this.container) return;
    if (loading) {
      this.container.innerHTML = `
        <div class="queue-monitor">
          <div class="queue-monitor-header">
            <div class="queue-monitor-title">Queue Monitor</div>
          </div>
          <div class="queue-status-cards">
            ${Array(5).fill('<div class="queue-stat loading-skeleton" style="height:60px"></div>').join('')}
          </div>
        </div>
      `;
    }
  }

  mount() {
    this.render();
    this.loadData();
    this.startAutoRefresh();
  }

  destroy() {
    this.stopAutoRefresh();
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
  }
}

export default QueueMonitor;
