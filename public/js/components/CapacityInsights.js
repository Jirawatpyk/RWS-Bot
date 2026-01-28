/**
 * Auto RWS Dashboard - Capacity Insights Component
 * AI-powered capacity analysis and suggestions with Chart.js
 */

import { ICONS } from '../config.js';
import store from '../state/store.js';
import api from '../services/api.js';
import { formatNumber, escapeHtml } from '../utils/helpers.js';

class CapacityInsights {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('CapacityInsights: Container not found:', containerSelector);
      return;
    }

    this.chart = null;
    this._loading = false;
    this._unsubscribers = [];

    this._unsubscribers.push(store.subscribe('capacityAnalysis', () => this.render()));
    this._unsubscribers.push(store.subscribe('capacitySuggestions', () => this.render()));
    this._unsubscribers.push(store.subscribe('capacitySummary', () => this.render()));
  }

  async loadData() {
    if (this._loading) return;
    this._loading = true;
    try {
      const [analysis, suggestions, summary] = await Promise.all([
        api.get('/api/capacity/analysis').catch(() => null),
        api.get('/api/capacity/suggestions').catch(() => null),
        api.get('/api/capacity/summary').catch(() => null),
      ]);

      store.set('capacityAnalysis', analysis, true);
      store.set('capacitySuggestions', suggestions, true);
      store.set('capacitySummary', summary, true);
      this.render();
    } catch (err) {
      console.warn('[CapacityInsights] loadData failed:', err);
    } finally {
      this._loading = false;
    }
  }

  render() {
    if (!this.container) return;

    const summary = store.get('capacitySummary') || {};
    const analysis = store.get('capacityAnalysis') || {};
    const suggestions = store.get('capacitySuggestions') || {};

    const recommendation = summary.recommendation || analysis.recommendation || 'No data';
    const confidence = summary.confidence || analysis.confidence || 0;
    // API returns avgDailyWords (not avgWordsPerDay)
    const avgWords = analysis.avgWordsPerDay || analysis.avgDailyWords || analysis.averageDaily || 0;
    const trend = analysis.trend || analysis.trendDirection || 'stable';
    // peakDay may be an object { date, allocated, count, utilization } or a string
    const peakDayRaw = analysis.peakDay || '-';
    const peakDay = (peakDayRaw && typeof peakDayRaw === 'object') ? (peakDayRaw.date || '-') : peakDayRaw;
    const slowDayRaw = analysis.slowDay || '-';
    const slowDay = (slowDayRaw && typeof slowDayRaw === 'object') ? (slowDayRaw.date || '-') : slowDayRaw;

    // suggestions may be object { "date": { current, suggested, reason } } or array
    const rawSuggestions = suggestions.suggestions || suggestions.items || {};
    let suggArr = [];
    if (Array.isArray(rawSuggestions)) {
      suggArr = rawSuggestions;
    } else if (typeof rawSuggestions === 'object') {
      suggArr = Object.entries(rawSuggestions).map(([date, info]) => ({
        message: `${date}: ${info.current}→${info.suggested} words (${info.reason || ''})`,
        priority: info.utilization > 90 ? 'high' : info.utilization < 50 ? 'low' : 'medium',
      }));
    }

    const trendIcon = trend === 'up' ? '&#9650;' : trend === 'down' ? '&#9660;' : '&#8594;';
    const trendClass = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-error' : 'text-muted';

    const safeRecommendation = escapeHtml(recommendation);
    const recLower = recommendation.toLowerCase();
    const recClass = recLower.includes('increase') ? 'badge-warning' :
      recLower.includes('maintain') ? 'badge-success' :
      recLower.includes('decrease') ? 'badge-info' : 'badge-info';

    this.container.innerHTML = `
      <div class="capacity-insights">
        <div class="capacity-insights-header">
          <div class="capacity-insights-title">${ICONS.chart} Capacity Insights</div>
          <button class="btn btn-sm btn-secondary" id="btn-insights-refresh">${ICONS.refresh} Analyze</button>
        </div>

        <div class="insights-summary">
          <div class="insights-rec">
            <span class="insights-rec-label">Recommendation</span>
            <span class="badge ${recClass} insights-rec-badge">${safeRecommendation}</span>
            <span class="insights-confidence">Confidence: ${confidence}%</span>
          </div>
        </div>

        <div class="insights-stats">
          <div class="insights-stat">
            <span class="insights-stat-value">${formatNumber(Math.round(avgWords))}</span>
            <span class="insights-stat-label">Avg Words/Day</span>
          </div>
          <div class="insights-stat">
            <span class="insights-stat-value ${trendClass}">${trendIcon} ${escapeHtml(trend)}</span>
            <span class="insights-stat-label">Trend</span>
          </div>
          <div class="insights-stat">
            <span class="insights-stat-value">${escapeHtml(peakDay)}</span>
            <span class="insights-stat-label">Peak Day</span>
          </div>
          <div class="insights-stat">
            <span class="insights-stat-value">${escapeHtml(slowDay)}</span>
            <span class="insights-stat-label">Slow Day</span>
          </div>
        </div>

        <div class="insights-chart-wrap">
          <canvas id="insights-chart" height="180"></canvas>
        </div>

        ${suggArr.length > 0 ? `
          <div class="insights-suggestions">
            <div class="insights-suggestions-title">Suggestions</div>
            <ul class="insights-list">
              ${suggArr.map(s => {
                const priority = s.priority || 'low';
                const prClass = priority === 'high' ? 'badge-error' : priority === 'medium' ? 'badge-warning' : 'badge-info';
                return `
                  <li class="insights-list-item">
                    <span class="badge ${prClass} insights-priority">${priority}</span>
                    <span>${escapeHtml(s.message || s.text || s)}</span>
                  </li>
                `;
              }).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;

    this._initChart(analysis);
    this.bindEvents();
  }

  _initChart(analysis) {
    const canvas = this.container.querySelector('.insights-chart-wrap canvas');
    if (!canvas) return;

    // Destroy old chart
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    const dailyData = analysis.dailyBreakdown || analysis.daily || [];
    if (!Array.isArray(dailyData) || dailyData.length === 0) return;

    const labels = dailyData.map(d => {
      const date = d.date || d.day;
      return date ? dayjs(date).format('DD/MM') : '';
    });
    const values = dailyData.map(d => d.words || d.total || d.completed || 0);

    const ctx = canvas.getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Words Completed',
          data: values,
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0, 212, 255, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          pointBackgroundColor: '#00d4ff',
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#5f6368', font: { size: 10 } },
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#5f6368', font: { size: 10 } },
            beginAtZero: true,
          },
        },
      },
    });
  }

  bindEvents() {
    document.getElementById('btn-insights-refresh')?.addEventListener('click', () => {
      this.loadData();
    });
  }

  setLoading(loading) {
    if (!this.container) return;
    if (loading) {
      this.container.innerHTML = `
        <div class="capacity-insights">
          <div class="capacity-insights-header">
            <div class="capacity-insights-title">${ICONS.chart} Capacity Insights</div>
          </div>
          <div class="loading-skeleton" style="height:100px"></div>
          <div class="loading-skeleton mt-md" style="height:180px"></div>
        </div>
      `;
    }
  }

  mount() {
    this.render();
    this.loadData();
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    this._unsubscribers.forEach(unsub => unsub());
    this._unsubscribers = [];
  }
}

export default CapacityInsights;
