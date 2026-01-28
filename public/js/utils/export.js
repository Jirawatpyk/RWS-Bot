/**
 * Auto RWS Dashboard - Export Utilities
 * CSV and JSON export functionality
 */

import store from '../state/store.js';
import { formatDateTime, formatNumber, getCapacityPercent, getRelativeTime, escapeHtml } from './helpers.js';
import { CONFIG } from '../config.js';

/**
 * Escape HTML for string interpolation in templates
 * (Uses the shared escapeHtml from helpers.js)
 * @param {*} value - Value to escape
 * @returns {string} - Escaped string
 */
function safeHtml(value) {
  return escapeHtml(value);
}

/**
 * Convert array of objects to CSV string
 * @param {Array} data - Array of objects
 * @param {Array} columns - Column definitions [{key, label}]
 * @returns {string} - CSV string
 */
export function arrayToCSV(data, columns) {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  // Header row
  const header = columns.map(col => escapeCSVValue(col.label)).join(',');

  // Data rows
  const rows = data.map(item => {
    return columns.map(col => {
      const value = typeof col.formatter === 'function'
        ? col.formatter(item[col.key], item)
        : item[col.key];
      return escapeCSVValue(value);
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

/**
 * Escape a value for CSV
 * @param {*} value - Value to escape
 * @returns {string} - Escaped value
 */
export function escapeCSVValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // If contains comma, newline, or quote, wrap in quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Download content as file
 * @param {string} content - File content
 * @param {string} filename - File name
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const link = document.createElement('a');

  if (navigator.msSaveBlob) {
    // IE10+
    navigator.msSaveBlob(blob, filename);
  } else {
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }
}

/**
 * Export tasks to CSV
 * @param {Array} tasks - Tasks array (optional, uses store if not provided)
 * @returns {void}
 */
export function exportTasksToCSV(tasks = null) {
  const data = tasks || store.get('filteredTasks') || store.get('tasks') || [];

  const columns = [
    { key: 'index', label: '#', formatter: (_, item) => data.indexOf(item) + 1 },
    { key: 'workflow', label: 'Workflow', formatter: (v, item) => v || item.orderId || '' },
    { key: 'words', label: 'Words', formatter: (v, item) => v || item.wordCount || 0 },
    { key: 'deadline', label: 'Deadline', formatter: v => formatDateTime(v) },
    { key: 'status', label: 'Status', formatter: (_, item) => getRelativeTime(item.deadline).text },
    { key: 'link', label: 'Link', formatter: v => v || '' }
  ];

  const csv = arrayToCSV(data, columns);
  const filename = `tasks_${dayjs().format('YYYY-MM-DD_HHmm')}.csv`;

  downloadFile(csv, filename, 'text/csv');

  document.dispatchEvent(new CustomEvent('toast:show', {
    detail: { type: 'success', title: 'Export Complete', message: `Exported ${data.length} tasks to ${filename}` }
  }));
}

/**
 * Export capacity data to CSV
 * @returns {void}
 */
export function exportCapacityToCSV() {
  const capacity = store.get('capacity') || {};
  const override = store.get('override') || {};
  const dates = Object.keys(capacity).sort();

  const data = dates.map(date => {
    const used = capacity[date]?.used || 0;
    const limit = override[date]?.limit || capacity[date]?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;
    const percent = getCapacityPercent(used, limit);

    return { date, used, limit, percent };
  });

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'used', label: 'Used', formatter: v => formatNumber(v) },
    { key: 'limit', label: 'Limit', formatter: v => formatNumber(v) },
    { key: 'percent', label: 'Percentage', formatter: v => `${v}%` }
  ];

  const csv = arrayToCSV(data, columns);
  const filename = `capacity_${dayjs().format('YYYY-MM-DD')}.csv`;

  downloadFile(csv, filename, 'text/csv');

  document.dispatchEvent(new CustomEvent('toast:show', {
    detail: { type: 'success', title: 'Export Complete', message: `Exported capacity data to ${filename}` }
  }));
}

/**
 * Export data to JSON
 * @param {*} data - Data to export
 * @param {string} filename - File name (without extension)
 * @returns {void}
 */
export function exportToJSON(data, filename = 'export') {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, `${filename}.json`, 'application/json');

  document.dispatchEvent(new CustomEvent('toast:show', {
    detail: { type: 'success', title: 'Export Complete', message: `Exported to ${filename}.json` }
  }));
}

/**
 * Export full dashboard state to JSON
 * @returns {void}
 */
export function exportDashboardState() {
  const state = {
    exportedAt: new Date().toISOString(),
    capacity: store.get('capacity'),
    override: store.get('override'),
    tasks: store.get('tasks'),
    status: store.get('status')
  };

  exportToJSON(state, `dashboard_backup_${dayjs().format('YYYY-MM-DD_HHmm')}`);
}

/**
 * Generate printable report
 * @returns {string} - HTML content
 */
export function generatePrintableReport() {
  const tasks = store.get('tasks') || [];
  const capacity = store.get('capacity') || {};
  const override = store.get('override') || {};
  const status = store.get('status') || {};

  const dates = Object.keys(capacity).sort();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Auto RWS Dashboard Report - ${dayjs().format('DD/MM/YYYY')}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { color: #1f2937; }
        h2 { color: #374151; margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
        th { background: #f3f4f6; }
        .summary { display: flex; gap: 20px; margin: 20px 0; }
        .summary-card { background: #f9fafb; padding: 15px; border-radius: 8px; flex: 1; }
        .summary-card h3 { margin: 0; font-size: 14px; color: #6b7280; }
        .summary-card p { margin: 5px 0 0; font-size: 24px; font-weight: bold; }
        @media print { .no-print { display: none; } }
      </style>
    </head>
    <body>
      <h1>Auto RWS Dashboard Report</h1>
      <p>Generated: ${dayjs().format('DD/MM/YYYY HH:mm:ss')}</p>

      <div class="summary">
        <div class="summary-card">
          <h3>In Progress</h3>
          <p>${tasks.length}</p>
        </div>
        <div class="summary-card">
          <h3>Pending</h3>
          <p>${status.pending || 0}</p>
        </div>
        <div class="summary-card">
          <h3>Accepted</h3>
          <p>${status.success || 0}</p>
        </div>
        <div class="summary-card">
          <h3>Failed</h3>
          <p>${status.error || 0}</p>
        </div>
      </div>

      <h2>Capacity Overview</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Used</th>
            <th>Limit</th>
            <th>Percentage</th>
          </tr>
        </thead>
        <tbody>
          ${dates.map(date => {
            const used = capacity[date]?.used || 0;
            const limit = override[date]?.limit || capacity[date]?.limit || CONFIG.CAPACITY.DEFAULT_LIMIT;
            const percent = getCapacityPercent(used, limit);
            return `
              <tr>
                <td>${safeHtml(date)}</td>
                <td>${formatNumber(used)}</td>
                <td>${formatNumber(limit)}</td>
                <td>${percent}%</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <h2>Tasks In Progress</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Workflow</th>
            <th>Words</th>
            <th>Deadline</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${tasks.map((task, i) => {
            const relativeTime = getRelativeTime(task.deadline);
            return `
              <tr>
                <td>${i + 1}</td>
                <td>${safeHtml(task.workflow || task.orderId || '-')}</td>
                <td>${formatNumber(task.words || task.wordCount || 0)}</td>
                <td>${safeHtml(formatDateTime(task.deadline))}</td>
                <td>${safeHtml(relativeTime.text)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>

      <button class="no-print" onclick="window.print()">Print Report</button>
    </body>
    </html>
  `;
}

/**
 * Open printable report in new window
 * @returns {void}
 */
export function openPrintableReport() {
  const html = generatePrintableReport();
  const printWindow = window.open('', '_blank');
  printWindow.document.write(html);
  printWindow.document.close();
}

export default {
  arrayToCSV,
  escapeCSVValue,
  downloadFile,
  exportTasksToCSV,
  exportCapacityToCSV,
  exportToJSON,
  exportDashboardState,
  generatePrintableReport,
  openPrintableReport
};
