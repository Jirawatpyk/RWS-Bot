/**
 * Auto RWS Dashboard - Capacity Chart Component
 * Bar chart visualization of capacity usage
 */

import { CONFIG, ICONS } from '../config.js';
import store from '../state/store.js';
import { formatNumber, formatDate, getCapacityPercent, getCapacityColor } from '../utils/helpers.js';

class CapacityChart {
  constructor(containerSelector) {
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.error('CapacityChart: Container not found:', containerSelector);
      return;
    }

    this.chart = null;
    this.viewMode = 'daily'; // 'daily' or 'weekly'

    // Subscribe to store updates
    store.subscribe('capacity', (data) => {
      console.log('[CapacityChart] Capacity updated:', data);
      this.updateChart();
    });
    store.subscribe('override', () => this.updateChart());
  }

  /**
   * Render the chart container
   */
  render() {
    if (!this.container) {
      console.error('[CapacityChart] Container not found');
      return;
    }
    console.log('[CapacityChart] Rendering...');

    this.container.innerHTML = `
      <div class="capacity-chart">
        <div class="capacity-chart-header">
          <h3 class="capacity-chart-title">${ICONS.chart} Capacity Trend</h3>
          <div class="capacity-chart-toggle">
            <button class="capacity-chart-toggle-btn ${this.viewMode === 'daily' ? 'active' : ''}"
              data-mode="daily">Daily</button>
            <button class="capacity-chart-toggle-btn ${this.viewMode === 'weekly' ? 'active' : ''}"
              data-mode="weekly">Weekly</button>
          </div>
        </div>
        <div class="capacity-chart-canvas">
          <canvas id="capacity-chart-canvas" style="width:100%;height:250px;"></canvas>
        </div>
      </div>
    `;

    this.bindEvents();
    this.initChart();
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    this.container.querySelectorAll('.capacity-chart-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.viewMode = e.target.dataset.mode;

        // Update button states
        this.container.querySelectorAll('.capacity-chart-toggle-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === this.viewMode);
        });

        this.updateChart();
      });
    });
  }

  /**
   * Initialize Chart.js chart
   */
  initChart() {
    const canvas = document.getElementById('capacity-chart-canvas');
    if (!canvas) {
      console.warn('[CapacityChart] Canvas not found');
      return;
    }

    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
      console.error('[CapacityChart] Chart.js not loaded');
      this.container.querySelector('.capacity-chart-canvas').innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:250px;color:#9ca3af;">Chart.js not loaded</div>';
      return;
    }

    const ctx = canvas.getContext('2d');

    // Prepare data
    const chartData = this.prepareChartData();

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'Used',
            data: chartData.used,
            backgroundColor: chartData.colors,
            borderColor: chartData.colors.map(c => c.replace('0.8', '1')),
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.6
          },
          {
            label: 'Remaining',
            data: chartData.remaining,
            backgroundColor: 'rgba(55, 65, 81, 0.5)',
            borderColor: 'rgba(75, 85, 99, 0.5)',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: '#9ca3af',
              font: { size: 11 },
              boxWidth: 12,
              padding: 15
            }
          },
          tooltip: {
            backgroundColor: 'rgba(31, 41, 55, 0.95)',
            titleColor: '#ffffff',
            bodyColor: '#9ca3af',
            borderColor: 'rgba(55, 65, 81, 1)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: (items) => {
                const idx = items[0].dataIndex;
                return chartData.fullLabels[idx];
              },
              label: (context) => {
                if (context.datasetIndex === 0) {
                  const used = context.raw;
                  const limit = chartData.limits[context.dataIndex];
                  const percent = Math.round((used / limit) * 100);
                  return [
                    `Used: ${formatNumber(used)} words`,
                    `Limit: ${formatNumber(limit)} words`,
                    `${percent}% capacity`
                  ];
                }
                return null;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: {
              display: false
            },
            ticks: {
              color: '#9ca3af',
              font: { size: 11 }
            }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: {
              color: 'rgba(55, 65, 81, 0.5)',
              drawBorder: false
            },
            ticks: {
              color: '#9ca3af',
              font: { size: 11 },
              callback: (value) => {
                if (value >= 1000) {
                  return (value / 1000) + 'k';
                }
                return value;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Prepare chart data from store
   * @returns {object} - Chart data
   */
  prepareChartData() {
    const capacity = store.get('capacity') || {};
    const override = store.get('override') || {};

    console.log('[CapacityChart] prepareChartData - capacity:', capacity);

    let dates = Object.keys(capacity).sort();
    console.log('[CapacityChart] prepareChartData - dates:', dates);

    // Limit to last 14 days for daily, aggregate for weekly
    if (this.viewMode === 'daily') {
      dates = dates.slice(-14);
    }

    const labels = [];
    const fullLabels = [];
    const used = [];
    const remaining = [];
    const limits = [];
    const colors = [];

    if (this.viewMode === 'weekly') {
      // Aggregate by week
      const weeklyData = {};

      dates.forEach(date => {
        const weekStart = dayjs(date).startOf('week').format('YYYY-MM-DD');
        if (!weeklyData[weekStart]) {
          weeklyData[weekStart] = { used: 0, limit: 0 };
        }
        const limit = override[date]?.limit || capacity[date]?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;
        weeklyData[weekStart].used += capacity[date]?.used || 0;
        weeklyData[weekStart].limit += limit;
      });

      Object.keys(weeklyData).sort().slice(-8).forEach(weekStart => {
        const data = weeklyData[weekStart];
        const percent = getCapacityPercent(data.used, data.limit);
        const colorClass = getCapacityColor(percent);

        labels.push(dayjs(weekStart).format('MM/DD'));
        fullLabels.push(`Week of ${dayjs(weekStart).format('MMM D, YYYY')}`);
        used.push(data.used);
        limits.push(data.limit);
        remaining.push(Math.max(0, data.limit - data.used));
        colors.push(this.getColorValue(colorClass));
      });
    } else {
      dates.forEach(date => {
        const usedValue = capacity[date]?.used || 0;
        const limit = override[date]?.limit || capacity[date]?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;
        const percent = getCapacityPercent(usedValue, limit);
        const colorClass = getCapacityColor(percent);

        labels.push(dayjs(date).format('DD/MM'));
        fullLabels.push(dayjs(date).format('dddd, MMMM D, YYYY'));
        used.push(usedValue);
        limits.push(limit);
        remaining.push(Math.max(0, limit - usedValue));
        colors.push(this.getColorValue(colorClass));
      });
    }

    return { labels, fullLabels, used, remaining, limits, colors };
  }

  /**
   * Get color value for capacity level
   * @param {string} colorClass - Color class ('low', 'medium', 'high')
   * @returns {string} - RGBA color value
   */
  getColorValue(colorClass) {
    const colors = {
      low: 'rgba(34, 197, 94, 0.8)',    // Green
      medium: 'rgba(234, 179, 8, 0.8)',  // Yellow
      high: 'rgba(239, 68, 68, 0.8)'     // Red
    };
    return colors[colorClass] || colors.low;
  }

  /**
   * Update chart with new data
   */
  updateChart() {
    console.log('[CapacityChart] updateChart called');

    // Destroy existing chart
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    // Re-render and init chart
    this.render();
  }

  /**
   * Resize chart
   */
  resize() {
    if (this.chart) {
      this.chart.resize();
    }
  }

  /**
   * Set loading state
   * @param {boolean} loading - Loading state
   */
  setLoading(loading) {
    if (!this.container) return;

    const canvasContainer = this.container.querySelector('.capacity-chart-canvas');
    if (canvasContainer) {
      if (loading) {
        canvasContainer.innerHTML = `
          <div class="loading-skeleton" style="height: 250px;"></div>
        `;
      }
    }
  }

  /**
   * Destroy chart instance
   */
  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  /**
   * Mount component
   */
  mount() {
    this.render();
  }
}

export default CapacityChart;
