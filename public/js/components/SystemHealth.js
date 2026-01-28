/**
 * Auto RWS Dashboard - System Health Component
 * Browser Pool, IMAP, Sheets health + Metrics + Sync + Verification
 */

import { ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { formatNumber } from '../utils/helpers.js';

class SystemHealth {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('SystemHealth: Container not found:', containerSelector);
      return;
    }

    this._refreshTimer = null;
    this._loading = false;
    this._unsubscribers = [];

    this._unsubscribers.push(store.subscribe('systemHealth', () => this.render()));
    this._unsubscribers.push(store.subscribe('metrics', () => this.render()));
    this._unsubscribers.push(store.subscribe('syncStatus', () => this._updateSyncSection()));
    this._unsubscribers.push(store.subscribe('verificationStatus', () => this._updateVerificationSection()));
  }

  async loadData() {
    if (this._loading) return;
    this._loading = true;
    try {
      const [browser, imap, sheets, metrics, sync, verification] = await Promise.all([
        api.get('/api/health/browser').catch(() => null),
        api.get('/api/health/imap').catch(() => null),
        api.get('/api/health/sheets').catch(() => null),
        api.get('/api/metrics').catch(() => null),
        api.get('/api/sync/status').catch(() => null),
        api.get('/api/verification/status').catch(() => null),
      ]);

      store.set('systemHealth', { browser, imap, sheets }, true);
      store.set('metrics', metrics, true);
      store.set('syncStatus', sync, true);
      store.set('verificationStatus', verification, true);
      this.render();
    } catch (err) {
      console.warn('[SystemHealth] loadData failed:', err);
    } finally {
      this._loading = false;
    }
  }

  startAutoRefresh() {
    this.stopAutoRefresh();
    this._refreshTimer = setInterval(() => this.loadData(), 30000);
  }

  stopAutoRefresh() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  render() {
    if (!this.container) return;
    const health = store.get('systemHealth') || {};
    const metrics = store.get('metrics') || {};
    const sync = store.get('syncStatus') || {};
    const verification = store.get('verificationStatus') || {};

    this.container.innerHTML = `
      <div class="system-health">
        <div class="system-health-header">
          <div class="system-health-title">System Health</div>
          <button class="btn btn-sm btn-secondary" id="btn-health-refresh" data-tooltip="Refresh health data">
            ${ICONS.refresh} Refresh
          </button>
        </div>

        <div class="system-health-grid">
          ${this._browserCard(health.browser)}
          ${this._imapCard(health.imap)}
          ${this._sheetsCard(health.sheets)}
        </div>

        ${this._metricsSection(metrics)}

        <div class="system-health-split">
          ${this._syncSection(sync)}
          ${this._verificationSection(verification)}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  _browserCard(data) {
    const d = data || {};
    const pool = d.pool || {};
    const healthMonitor = d.healthMonitor || d.health || {};
    const active = pool.busyBrowsers || pool.active || 0;
    const total = pool.totalBrowsers || pool.total || 0;
    const pages = pool.activePages || 0;
    const recycled = healthMonitor.totalRecycles || healthMonitor.recycleCount || 0;
    const isHealthy = total > 0;
    const statusClass = isHealthy ? 'online' : 'offline';

    return `
      <div class="health-card health-card--browser">
        <div class="health-card-header">
          <span class="status-dot status-dot--${statusClass}"></span>
          <span class="health-card-label">Browser Pool</span>
        </div>
        <div class="health-card-body">
          <div class="health-stat">
            <span class="health-stat-value">${active}/${total}</span>
            <span class="health-stat-label">Active / Total</span>
          </div>
          <div class="health-stat">
            <span class="health-stat-value">${pages}</span>
            <span class="health-stat-label">Pages</span>
          </div>
          <div class="health-stat">
            <span class="health-stat-value">${recycled}</span>
            <span class="health-stat-label">Recycled</span>
          </div>
        </div>
      </div>
    `;
  }

  _imapCard(data) {
    const d = data || {};
    const conn = d.connection || d;
    const health = d.health || {};
    const connected = conn.connected || conn.totalConnections > 0 || false;
    const mailboxes = conn.mailboxes || conn.mailboxCount || 0;
    const reconnects = conn.totalReconnects || health.totalReconnectsTracked || 0;
    const paused = conn.isPaused || false;
    const statusClass = paused ? 'connecting' : (connected ? 'online' : 'offline');

    return `
      <div class="health-card health-card--imap">
        <div class="health-card-header">
          <span class="status-dot status-dot--${statusClass}"></span>
          <span class="health-card-label">IMAP</span>
          ${paused ? '<span class="badge badge-warning">PAUSED</span>' : ''}
        </div>
        <div class="health-card-body">
          <div class="health-stat">
            <span class="health-stat-value">${connected ? 'UP' : 'DOWN'}</span>
            <span class="health-stat-label">Status</span>
          </div>
          <div class="health-stat">
            <span class="health-stat-value">${mailboxes}</span>
            <span class="health-stat-label">Mailboxes</span>
          </div>
          <div class="health-stat">
            <span class="health-stat-value">${reconnects}</span>
            <span class="health-stat-label">Reconnects</span>
          </div>
        </div>
      </div>
    `;
  }

  _sheetsCard(data) {
    const d = data || {};
    const breakers = d.breakers || d;
    const states = [];
    for (const [name, info] of Object.entries(breakers)) {
      if (info && typeof info === 'object' && info.state) {
        states.push({ name, ...info });
      }
    }
    const allClosed = states.length === 0 || states.every(s => s.state === 'CLOSED');
    const anyOpen = states.some(s => s.state === 'OPEN');
    const statusClass = anyOpen ? 'offline' : (allClosed ? 'online' : 'connecting');
    const stateLabel = anyOpen ? 'OPEN' : (allClosed ? 'CLOSED' : 'HALF_OPEN');

    const totalSuccess = states.reduce((s, b) => s + (b.successCount || 0), 0);
    const totalFail = states.reduce((s, b) => s + (b.failureCount || 0), 0);

    return `
      <div class="health-card health-card--sheets">
        <div class="health-card-header">
          <span class="status-dot status-dot--${statusClass}"></span>
          <span class="health-card-label">Google Sheets</span>
        </div>
        <div class="health-card-body">
          <div class="health-stat">
            <span class="health-stat-value health-stat-value--${statusClass}">${stateLabel}</span>
            <span class="health-stat-label">Circuit</span>
          </div>
          <div class="health-stat">
            <span class="health-stat-value text-success">${totalSuccess}</span>
            <span class="health-stat-label">Success</span>
          </div>
          <div class="health-stat">
            <span class="health-stat-value text-error">${totalFail}</span>
            <span class="health-stat-label">Failures</span>
          </div>
        </div>
      </div>
    `;
  }

  _metricsSection(data) {
    const d = data || {};
    const counters = d.counters || {};
    const rates = d.rates || {};
    const perf = d.performance || {};

    return `
      <div class="system-health-metrics">
        <div class="system-health-section-title">Metrics</div>
        <div class="metrics-grid">
          <div class="metric-item">
            <span class="metric-value">${formatNumber(counters.tasksReceived || 0)}</span>
            <span class="metric-label">Received</span>
          </div>
          <div class="metric-item">
            <span class="metric-value text-success">${formatNumber(counters.tasksAccepted || 0)}</span>
            <span class="metric-label">Accepted</span>
          </div>
          <div class="metric-item">
            <span class="metric-value text-error">${formatNumber(counters.tasksRejected || 0)}</span>
            <span class="metric-label">Rejected</span>
          </div>
          <div class="metric-item">
            <span class="metric-value text-success">${formatNumber(counters.tasksCompleted || 0)}</span>
            <span class="metric-label">Completed</span>
          </div>
          <div class="metric-item">
            <span class="metric-value text-error">${formatNumber(counters.tasksFailed || 0)}</span>
            <span class="metric-label">Failed</span>
          </div>
          <div class="metric-item">
            <span class="metric-value text-accent">${rates.acceptanceRate || 0}%</span>
            <span class="metric-label">Accept Rate</span>
          </div>
          <div class="metric-item">
            <span class="metric-value text-info">${rates.successRate || 0}%</span>
            <span class="metric-label">Success Rate</span>
          </div>
          <div class="metric-item">
            <span class="metric-value">${formatNumber(perf.avgProcessingTimeMs || 0)}ms</span>
            <span class="metric-label">Avg Time</span>
          </div>
        </div>
      </div>
    `;
  }

  _syncSection(data) {
    const d = data || {};
    const lastSync = d.lastSyncTime || d.lastSync;
    const isRunning = d.isRunning || d.isSyncing || false;
    const lastSyncText = lastSync ? dayjs(lastSync).format('HH:mm:ss') : '--:--:--';

    return `
      <div class="health-sub-panel" id="sync-section">
        <div class="health-sub-title">Status Sync</div>
        <div class="health-sub-row">
          <span class="text-muted">Last sync</span>
          <span id="sync-last-time">${lastSyncText}</span>
        </div>
        <div class="health-sub-row">
          <span class="text-muted">Status</span>
          <span class="badge ${isRunning ? 'badge-info' : 'badge-success'}" id="sync-status-badge">
            ${isRunning ? 'Running' : 'Idle'}
          </span>
        </div>
        <button class="btn btn-sm btn-secondary w-full mt-sm" id="btn-trigger-sync" ${isRunning ? 'disabled' : ''}>
          ${ICONS.refresh} Trigger Sync
        </button>
      </div>
    `;
  }

  _verificationSection(data) {
    const d = data || {};
    const pending = d.pendingCount || d.queueLength || 0;
    const results = d.recentResults || d.results || [];
    const passCount = results.filter(r => r.verified === true || r.status === 'passed').length;
    const failCount = results.filter(r => r.verified === false || r.status === 'failed').length;

    return `
      <div class="health-sub-panel" id="verification-section">
        <div class="health-sub-title">Verification</div>
        <div class="health-sub-row">
          <span class="text-muted">Pending</span>
          <span class="badge badge-pending">${pending}</span>
        </div>
        <div class="health-sub-row">
          <span class="text-muted">Passed</span>
          <span class="text-success">${passCount}</span>
        </div>
        <div class="health-sub-row">
          <span class="text-muted">Failed</span>
          <span class="text-error">${failCount}</span>
        </div>
      </div>
    `;
  }

  _updateSyncSection() {
    const el = document.getElementById('sync-section');
    if (!el) return;
    const sync = store.get('syncStatus') || {};
    const lastSync = sync.lastSyncTime || sync.lastSync;
    const isRunning = sync.isRunning || sync.isSyncing || false;
    const timeEl = document.getElementById('sync-last-time');
    if (timeEl && lastSync) timeEl.textContent = dayjs(lastSync).format('HH:mm:ss');
    const badge = document.getElementById('sync-status-badge');
    if (badge) {
      badge.className = `badge ${isRunning ? 'badge-info' : 'badge-success'}`;
      badge.textContent = isRunning ? 'Running' : 'Idle';
    }
    const btn = document.getElementById('btn-trigger-sync');
    if (btn) btn.disabled = isRunning;
  }

  _updateVerificationSection() {
    const el = document.getElementById('verification-section');
    if (!el) return;
    const data = store.get('verificationStatus') || {};
    const pending = data.pendingCount || data.queueLength || 0;
    const results = data.recentResults || data.results || [];
    const passCount = results.filter(r => r.verified === true || r.status === 'passed').length;
    const failCount = results.filter(r => r.verified === false || r.status === 'failed').length;

    const pendingBadge = el.querySelector('.health-sub-row:nth-child(2) .badge');
    if (pendingBadge) pendingBadge.textContent = pending;
    const passedEl = el.querySelector('.health-sub-row:nth-child(3) .text-success');
    if (passedEl) passedEl.textContent = passCount;
    const failedEl = el.querySelector('.health-sub-row:nth-child(4) .text-error');
    if (failedEl) failedEl.textContent = failCount;
  }

  bindEvents() {
    document.getElementById('btn-health-refresh')?.addEventListener('click', () => {
      this.loadData();
    });

    document.getElementById('btn-trigger-sync')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-trigger-sync');
      if (btn) btn.disabled = true;
      try {
        await api.post('/api/sync/trigger');
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'success', message: 'Sync triggered successfully' }
        }));
        setTimeout(() => this.loadData(), 2000);
      } catch (err) {
        document.dispatchEvent(new CustomEvent('toast:show', {
          detail: { type: 'error', message: 'Failed to trigger sync' }
        }));
        if (btn) btn.disabled = false;
      }
    });
  }

  setLoading(loading) {
    if (!this.container) return;
    if (loading) {
      this.container.innerHTML = `
        <div class="system-health">
          <div class="system-health-header">
            <div class="system-health-title">System Health</div>
          </div>
          <div class="system-health-grid">
            <div class="health-card loading-skeleton" style="height:120px"></div>
            <div class="health-card loading-skeleton" style="height:120px"></div>
            <div class="health-card loading-skeleton" style="height:120px"></div>
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

export default SystemHealth;
