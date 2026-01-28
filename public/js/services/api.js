/**
 * Auto RWS Dashboard - API Service
 * REST API client with error handling
 */

import { CONFIG } from '../config.js';

class ApiService {
  constructor() {
    this.baseUrl = CONFIG.API.BASE_URL;
    this.defaultHeaders = {
      'Content-Type': 'application/json'
    };
  }

  /**
   * Make HTTP request
   * @param {string} endpoint - API endpoint
   * @param {object} options - Fetch options
   * @returns {Promise<object>} - Response data
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;

    const config = {
      headers: { ...this.defaultHeaders, ...options.headers },
      ...options
    };

    try {
      const response = await fetch(url, config);

      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');

      if (!response.ok) {
        const errorData = contentType?.includes('application/json')
          ? await response.json()
          : { message: response.statusText };

        throw new ApiError(
          errorData.message || 'Request failed',
          response.status,
          errorData
        );
      }

      // Return parsed JSON or text
      if (contentType?.includes('application/json')) {
        return await response.json();
      }

      return await response.text();
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      // Network error
      throw new ApiError(
        'Network error: Unable to connect to server',
        0,
        { originalError: error.message }
      );
    }
  }

  /**
   * GET request
   * @param {string} endpoint - API endpoint
   * @param {object} params - Query parameters
   * @returns {Promise<object>} - Response data
   */
  async get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    return this.request(url, { method: 'GET' });
  }

  /**
   * POST request
   * @param {string} endpoint - API endpoint
   * @param {object} data - Request body
   * @returns {Promise<object>} - Response data
   */
  async post(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * PUT request
   * @param {string} endpoint - API endpoint
   * @param {object} data - Request body
   * @returns {Promise<object>} - Response data
   */
  async put(endpoint, data = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  /**
   * DELETE request
   * @param {string} endpoint - API endpoint
   * @returns {Promise<object>} - Response data
   */
  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  // ============================================
  // Specific API Methods
  // ============================================

  /**
   * Get current capacity data
   * @returns {Promise<object>} - Capacity map
   */
  async getCapacity() {
    const response = await this.get(CONFIG.API.CAPACITY);

    // Transform server format { "2026-01-05": 6 } to frontend format { "2026-01-05": { used: 6, limit: 12000 } }
    if (response && typeof response === 'object') {
      const transformed = {};
      for (const [date, value] of Object.entries(response)) {
        if (typeof value === 'number') {
          transformed[date] = { used: value, limit: CONFIG.CAPACITY.DEFAULT_LIMIT };
        } else if (typeof value === 'object') {
          transformed[date] = value;
        }
      }
      return transformed;
    }
    return response;
  }

  /**
   * Get daily override settings
   * @returns {Promise<object>} - Override settings
   */
  async getOverride() {
    return this.get(CONFIG.API.OVERRIDE);
  }

  /**
   * Update daily override settings
   * @param {object} data - Override data
   * @returns {Promise<object>} - Updated settings
   */
  async setOverride(data) {
    return this.post(CONFIG.API.OVERRIDE, data);
  }

  /**
   * Adjust capacity for a specific date
   * @param {string} date - Date string (YYYY-MM-DD)
   * @param {number} amount - Adjustment amount (positive or negative)
   * @returns {Promise<object>} - Updated capacity
   */
  async adjustCapacity(date, amount) {
    return this.post(CONFIG.API.ADJUST, { date, amount });
  }

  /**
   * Cleanup old capacity entries
   * @param {Array<string>} dates - Dates to remove
   * @returns {Promise<object>} - Cleanup result
   */
  async cleanupCapacity(dates) {
    return this.post(CONFIG.API.CLEANUP, { dates });
  }

  /**
   * Get accepted tasks list (read-only, no Sheet query)
   * @returns {Promise<Array>} - List of accepted tasks
   */
  async getAcceptedTasks() {
    const response = await this.get(CONFIG.API.ACCEPTED_TASKS);
    return this._transformTasksResponse(response);
  }

  /**
   * Refresh tasks from Google Sheets — removes completed/on-hold tasks and syncs capacity
   * @returns {Promise<object>} - { success, tasks, summary, completedCount, onHoldCount, capacity, ... }
   */
  async refreshTasks() {
    const response = await this.post('/api/tasks/refresh');
    return {
      ...response,
      tasks: this._transformTasksResponse(response)
    };
  }

  _transformTasksResponse(response) {
    let tasks = [];

    if (response && Array.isArray(response.tasks)) {
      tasks = response.tasks;
    } else if (Array.isArray(response)) {
      tasks = response;
    }

    return tasks.map(task => ({
      ...task,
      workflow: task.workflowName || task.workflow || task.orderId,
      words: task.amountWords || task.words || 0,
      deadline: task.plannedEndDate || task.deadline,
      link: task.url || task.link || '#'
    }));
  }

  /**
   * Get daily override JSON file
   * @returns {Promise<object>} - Daily override data
   */
  async getDailyOverride() {
    return this.get(CONFIG.API.DAILY_OVERRIDE);
  }
}

/**
 * Custom API Error class
 */
class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  /**
   * Check if error is network error
   * @returns {boolean}
   */
  isNetworkError() {
    return this.status === 0;
  }

  /**
   * Check if error is unauthorized
   * @returns {boolean}
   */
  isUnauthorized() {
    return this.status === 401;
  }

  /**
   * Check if error is not found
   * @returns {boolean}
   */
  isNotFound() {
    return this.status === 404;
  }

  /**
   * Check if error is server error
   * @returns {boolean}
   */
  isServerError() {
    return this.status >= 500;
  }
}

// Create singleton instance
const api = new ApiService();

export { api, ApiError };
export default api;
