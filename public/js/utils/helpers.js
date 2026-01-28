/**
 * Auto RWS Dashboard - Utility Helpers
 * Common utility functions used across components
 */

import { CONFIG } from '../config.js';

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * Format number with thousand separators
 * @param {number} num - Number to format
 * @returns {string} - Formatted number string
 */
export function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString('en-US');
}

/**
 * Format date using dayjs
 * @param {string|Date} date - Date to format
 * @param {string} format - Output format
 * @returns {string} - Formatted date string
 */
export function formatDate(date, format = CONFIG.DATE_FORMAT.DISPLAY) {
  if (!date) return '-';
  return dayjs(date).format(format);
}

/**
 * Format date with time
 * @param {string|Date} date - Date to format
 * @returns {string} - Formatted date/time string
 */
export function formatDateTime(date) {
  return formatDate(date, CONFIG.DATE_FORMAT.DISPLAY_TIME);
}

/**
 * Get relative time description
 * @param {string|Date} date - Target date
 * @returns {object} - { text, class, isUrgent }
 */
export function getRelativeTime(date) {
  if (!date) return { text: '-', class: '', isUrgent: false };

  const now = dayjs();
  let target = dayjs(date);

  // Apply night deadline shift: if deadline is before work start hour (10:00),
  // treat it as previous day 23:59 (same logic as taskAcceptance.js)
  const workStartHour = CONFIG.TASK.WORK_START_HOUR || 10;
  if (target.hour() < workStartHour) {
    target = target.subtract(1, 'day').hour(23).minute(59);
  }

  const diffHours = target.diff(now, 'hour');
  // Use calendar days (not hour-based)
  const diffDays = target.startOf('day').diff(now.startOf('day'), 'day');

  if (diffHours < 0) {
    return { text: 'Overdue', class: 'text-error', isUrgent: true };
  }

  if (diffHours < CONFIG.TASK.URGENT_HOURS) {
    return { text: `Due ${diffHours}h`, class: 'text-error', isUrgent: true };
  }

  if (diffHours < CONFIG.TASK.TODAY_HOURS) {
    return { text: 'Due today', class: 'text-warning', isUrgent: false };
  }

  if (diffDays === 1) {
    return { text: 'Due tomorrow', class: 'text-info', isUrgent: false };
  }

  return { text: `Due ${diffDays}d`, class: 'text-muted', isUrgent: false };
}

/**
 * Calculate capacity percentage
 * @param {number} used - Used capacity
 * @param {number} limit - Total limit
 * @returns {number} - Percentage (0-100)
 */
export function getCapacityPercent(used, limit) {
  if (!limit || limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/**
 * Get capacity color class based on percentage
 * @param {number} percent - Capacity percentage
 * @returns {string} - CSS class name
 */
export function getCapacityColor(percent) {
  if (percent >= CONFIG.CAPACITY.HIGH_THRESHOLD) {
    return 'high';
  }
  if (percent >= CONFIG.CAPACITY.LOW_THRESHOLD) {
    return 'medium';
  }
  return 'low';
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} - Throttled function
 */
export function throttle(func, limit = 300) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} - Cloned object
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if object is empty
 * @param {object} obj - Object to check
 * @returns {boolean} - True if empty
 */
export function isEmpty(obj) {
  if (!obj) return true;
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  return false;
}

/**
 * Generate unique ID
 * @param {string} prefix - Optional prefix
 * @returns {string} - Unique ID
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sort array of objects by key
 * @param {Array} arr - Array to sort
 * @param {string} key - Key to sort by
 * @param {string} direction - 'asc' or 'desc'
 * @returns {Array} - Sorted array
 */
export function sortBy(arr, key, direction = 'asc') {
  if (!Array.isArray(arr)) return arr;

  return [...arr].sort((a, b) => {
    let valA = a[key];
    let valB = b[key];

    // Handle dates
    if (key === 'deadline' || key === 'date') {
      valA = valA ? new Date(valA).getTime() : 0;
      valB = valB ? new Date(valB).getTime() : 0;
    }

    // Handle numbers
    if (typeof valA === 'number' && typeof valB === 'number') {
      return direction === 'asc' ? valA - valB : valB - valA;
    }

    // Handle strings
    valA = String(valA || '').toLowerCase();
    valB = String(valB || '').toLowerCase();

    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

/**
 * Filter array by search term
 * @param {Array} arr - Array to filter
 * @param {string} searchTerm - Search term
 * @param {Array} keys - Keys to search in
 * @returns {Array} - Filtered array
 */
export function filterBySearch(arr, searchTerm, keys = []) {
  if (!searchTerm || !Array.isArray(arr)) return arr;

  const term = searchTerm.toLowerCase().trim();

  return arr.filter(item => {
    return keys.some(key => {
      const value = item[key];
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(term);
    });
  });
}

/**
 * Paginate array
 * @param {Array} arr - Array to paginate
 * @param {number} page - Current page (1-indexed)
 * @param {number} pageSize - Items per page
 * @returns {object} - { items, totalPages, startIndex, endIndex }
 */
export function paginate(arr, page = 1, pageSize = 10) {
  if (!Array.isArray(arr)) return { items: [], totalPages: 0, startIndex: 0, endIndex: 0 };

  const totalItems = arr.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages || 1));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const items = arr.slice(startIndex, endIndex);

  return {
    items,
    totalPages,
    currentPage,
    totalItems,
    startIndex: startIndex + 1,
    endIndex,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1
  };
}

/**
 * Parse query string to object
 * @param {string} queryString - Query string
 * @returns {object} - Parsed object
 */
export function parseQueryString(queryString) {
  const params = new URLSearchParams(queryString);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

/**
 * Convert object to query string
 * @param {object} obj - Object to convert
 * @returns {string} - Query string
 */
export function toQueryString(obj) {
  return new URLSearchParams(obj).toString();
}

/**
 * Parse workflow ID from link
 * @param {string} link - Task link
 * @returns {string} - Workflow ID
 */
export function parseWorkflowId(link) {
  if (!link) return '';
  const match = link.match(/workflowId=(\d+)/);
  return match ? match[1] : '';
}

/**
 * Get task filter function based on filter type
 * @param {string} filterType - Filter type
 * @returns {Function} - Filter function
 */
export function getTaskFilter(filterType) {
  const now = dayjs();

  switch (filterType) {
    case 'urgent':
      return task => {
        const deadline = dayjs(task.deadline);
        return deadline.diff(now, 'hour') < CONFIG.TASK.URGENT_HOURS && deadline.diff(now, 'hour') >= 0;
      };
    case 'today':
      return task => {
        const deadline = dayjs(task.deadline);
        return deadline.isSame(now, 'day');
      };
    case 'tomorrow':
      return task => {
        const deadline = dayjs(task.deadline);
        return deadline.isSame(now.add(1, 'day'), 'day');
      };
    case 'later':
      return task => {
        const deadline = dayjs(task.deadline);
        return deadline.isAfter(now.add(1, 'day'), 'day');
      };
    default:
      return () => true;
  }
}

/**
 * Group tasks by date
 * @param {Array} tasks - Array of tasks
 * @returns {object} - Tasks grouped by date
 */
export function groupTasksByDate(tasks) {
  if (!Array.isArray(tasks)) return {};

  return tasks.reduce((groups, task) => {
    const date = dayjs(task.deadline).format('YYYY-MM-DD');
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(task);
    return groups;
  }, {});
}

/**
 * Create loading skeleton HTML
 * @param {number} count - Number of skeletons
 * @param {string} type - Type of skeleton ('row', 'card', 'text')
 * @returns {string} - HTML string
 */
export function createSkeletons(count = 3, type = 'row') {
  const skeletons = {
    row: '<div class="loading-skeleton" style="height: 48px; margin-bottom: 8px;"></div>',
    card: '<div class="loading-skeleton" style="height: 120px; border-radius: 1rem;"></div>',
    text: '<div class="loading-skeleton" style="height: 16px; width: 80%; margin-bottom: 8px;"></div>'
  };

  return Array(count).fill(skeletons[type] || skeletons.row).join('');
}

/**
 * Check if element is in viewport
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} - True if in viewport
 */
export function isInViewport(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} - Success status
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  }
}

/**
 * Sanitize URL to prevent javascript: protocol attacks
 * @param {string} url - URL to sanitize
 * @returns {string} - Safe URL or '#'
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '#';

  const trimmed = url.trim();

  // Check for dangerous protocols
  const lowerUrl = trimmed.toLowerCase();
  if (lowerUrl.startsWith('javascript:') ||
      lowerUrl.startsWith('data:') ||
      lowerUrl.startsWith('vbscript:')) {
    return '#';
  }

  // Allow http, https, and relative URLs
  if (lowerUrl.startsWith('http://') ||
      lowerUrl.startsWith('https://') ||
      lowerUrl.startsWith('/') ||
      lowerUrl.startsWith('#') ||
      lowerUrl.startsWith('./') ||
      lowerUrl.startsWith('../')) {
    return trimmed;
  }

  // For other URLs, prepend https://
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    return 'https://' + trimmed;
  }

  return '#';
}

export default {
  escapeHtml,
  formatNumber,
  formatDate,
  formatDateTime,
  getRelativeTime,
  getCapacityPercent,
  getCapacityColor,
  debounce,
  throttle,
  deepClone,
  isEmpty,
  generateId,
  sortBy,
  filterBySearch,
  paginate,
  parseQueryString,
  toQueryString,
  parseWorkflowId,
  getTaskFilter,
  groupTasksByDate,
  createSkeletons,
  isInViewport,
  copyToClipboard,
  sanitizeUrl
};
