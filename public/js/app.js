/**
 * Auto RWS Dashboard - Main Application
 * Orchestrates all components and services
 */

import { CONFIG } from './config.js';
import store from './state/store.js';
import api from './services/api.js';
import ws from './services/websocket.js';
import notification from './services/notification.js';

// Import components
import Header from './components/Header.js';
import StatusCards from './components/StatusCards.js';
import AlertBanner from './components/AlertBanner.js';
import CapacitySummary from './components/CapacitySummary.js';
import CapacityChart from './components/CapacityChart.js';
import TaskReport from './components/TaskReport.js';
import CalendarView from './components/CalendarView.js';
import SetDailyLimit from './components/SetDailyLimit.js';
import AdjustUsage from './components/AdjustUsage.js';

class App {
  constructor() {
    this.components = {};
    this.isInitialized = false;

    // Setup global error handlers
    this.setupErrorHandlers();
  }

  /**
   * Setup global error handlers to catch uncaught errors
   */
  setupErrorHandlers() {
    window.addEventListener('error', (e) => {
      console.error('[App] Uncaught error:', e.error);
      // Don't spam notifications for script loading errors
      if (e.message && !e.message.includes('Script error')) {
        notification.error('An unexpected error occurred. Please refresh if issues persist.');
      }
    });

    window.addEventListener('unhandledrejection', (e) => {
      console.error('[App] Unhandled promise rejection:', e.reason);
      // Log but don't always notify - many rejections are handled elsewhere
    });
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log(`[App] Initializing ${CONFIG.APP_NAME} v${CONFIG.APP_VERSION}`);

    try {
      // Initialize notification service first
      notification.init?.();

      // Mount components
      this.mountComponents();

      // Load initial data
      await this.loadInitialData();

      // Connect WebSocket
      await this.connectWebSocket();

      // Bind global events
      this.bindGlobalEvents();

      this.isInitialized = true;
      console.log('[App] Initialization complete');

    } catch (error) {
      console.error('[App] Initialization failed:', error);
      notification.error('Failed to initialize dashboard. Please refresh the page.');
    }
  }

  /**
   * Mount all components
   */
  mountComponents() {
    console.log('[App] Mounting components...');

    // Header
    this.components.header = new Header('#header');
    this.components.header?.mount();

    // Alert Banner
    this.components.alertBanner = new AlertBanner('#alert-banner');
    this.components.alertBanner?.mount();

    // Status Cards
    this.components.statusCards = new StatusCards('#status-cards');
    this.components.statusCards?.mount();

    // Capacity Summary
    this.components.capacitySummary = new CapacitySummary('#capacity-summary');
    this.components.capacitySummary?.mount();

    // Capacity Chart
    this.components.capacityChart = new CapacityChart('#capacity-chart');
    this.components.capacityChart?.mount();

    // Task Report
    this.components.taskReport = new TaskReport('#task-report');
    this.components.taskReport?.mount();

    // Calendar View
    this.components.calendarView = new CalendarView('#calendar-view');
    this.components.calendarView?.mount();

    // Set Daily Limit
    this.components.setDailyLimit = new SetDailyLimit('#set-daily-limit');
    this.components.setDailyLimit?.mount();

    // Adjust Usage
    this.components.adjustUsage = new AdjustUsage('#adjust-usage');
    this.components.adjustUsage?.mount();

    console.log('[App] Components mounted');
  }

  /**
   * Load initial data from API
   */
  async loadInitialData() {
    console.log('[App] Loading initial data...');

    // Show loading states
    this.setLoadingState(true);

    try {
      // Fetch all data in parallel
      const [capacityData, tasksData, overrideData] = await Promise.all([
        api.getCapacity().catch(err => {
          console.warn('[App] Failed to load capacity:', err);
          return {};
        }),
        api.getAcceptedTasks().catch(err => {
          console.warn('[App] Failed to load tasks:', err);
          return [];
        }),
        api.getOverride().catch(err => {
          console.warn('[App] Failed to load override:', err);
          return {};
        })
      ]);

      // Debug: Log loaded data
      console.log('[App] Loaded data:', {
        capacity: capacityData,
        tasks: tasksData?.length,
        override: overrideData
      });

      // Update store
      store.update({
        capacity: capacityData || {},
        tasks: Array.isArray(tasksData) ? tasksData : [],
        override: overrideData || {},
        loading: { capacity: false, tasks: false, override: false }
      });

      // Debug: Verify store was updated
      console.log('[App] Store after update:', {
        capacity: store.get('capacity'),
        tasks: store.get('tasks')?.length
      });

      // Calculate initial status from tasks
      this.updateStatusFromTasks();

      console.log('[App] Initial data loaded');

    } catch (error) {
      console.error('[App] Failed to load initial data:', error);
      notification.error('Failed to load dashboard data');
    } finally {
      this.setLoadingState(false);
    }
  }

  /**
   * Connect to WebSocket server
   */
  async connectWebSocket() {
    console.log('[App] Connecting to WebSocket...');

    try {
      await ws.connect();
      console.log('[App] WebSocket connected');
    } catch (error) {
      console.warn('[App] WebSocket connection failed, will retry:', error);
      // WebSocket service handles reconnection automatically
    }
  }

  /**
   * Bind global event listeners
   */
  bindGlobalEvents() {
    // Dashboard refresh request
    document.addEventListener('dashboard:refresh', () => {
      this.refresh();
    });

    // Toggle IMAP
    document.addEventListener('dashboard:toggleImap', (e) => {
      const { pause } = e.detail || {};
      ws.toggleImap(pause);
    });

    // Window resize
    window.addEventListener('resize', () => {
      this.components.capacityChart?.resize?.();
    });

    // Visibility change - refresh when tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isInitialized) {
        // Reconnect WebSocket if disconnected
        if (!ws.isConnected()) {
          ws.connect().catch(() => {});
        }
        // Refresh data
        this.refresh();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ignore if in input field
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Escape to clear focus
      if (e.key === 'Escape') {
        document.activeElement?.blur();
      }
    });

    // Handle online/offline events
    window.addEventListener('online', () => {
      notification.success('Connection restored');
      if (!ws.isConnected()) {
        ws.connect().catch(() => {});
      }
      this.refresh();
    });

    window.addEventListener('offline', () => {
      notification.warning('You are offline. Some features may not work.');
    });
  }

  /**
   * Refresh all data
   */
  async refresh() {
    console.log('[App] Refreshing data...');

    try {
      // Request status refresh via WebSocket
      ws.requestRefresh();

      // Call POST /api/tasks/refresh to sync with Google Sheets
      // This removes completed/on-hold tasks and recalculates capacity
      const [refreshResult, capacityData, overrideData] = await Promise.all([
        api.refreshTasks().catch((err) => {
          console.warn('[App] refreshTasks failed, falling back to getAcceptedTasks:', err.message);
          return null;
        }),
        api.getCapacity().catch(() => null),
        api.getOverride().catch(() => null)
      ]);

      // Use refreshTasks result if available, otherwise fallback to read-only
      let tasksData = refreshResult?.tasks;
      if (!tasksData) {
        tasksData = await api.getAcceptedTasks().catch(() => null);
      }

      if (capacityData) {
        store.set('capacity', capacityData);
      }

      if (tasksData && Array.isArray(tasksData)) {
        store.set('tasks', tasksData);
      }

      if (overrideData) {
        store.set('override', overrideData);
      }

      if (refreshResult?.completedCount > 0 || refreshResult?.onHoldCount > 0) {
        console.log(`[App] Removed ${refreshResult.completedCount} completed, ${refreshResult.onHoldCount} on-hold tasks`);
      }

      store.set('lastSync', new Date().toISOString());
      this.updateStatusFromTasks();

      console.log('[App] Data refreshed');

    } catch (error) {
      console.error('[App] Refresh failed:', error);
    }
  }

  /**
   * Update status counts from tasks
   */
  updateStatusFromTasks() {
    const tasks = store.get('tasks') || [];
    const currentStatus = store.get('status') || {};

    store.set('status', {
      ...currentStatus,
      pending: tasks.length
    });
  }

  /**
   * Set loading state for all components
   * @param {boolean} loading - Loading state
   */
  setLoadingState(loading) {
    store.set('loading', {
      capacity: loading,
      tasks: loading,
      override: loading
    });

    // Call component loading methods
    Object.values(this.components).forEach(component => {
      component?.setLoading?.(loading);
    });
  }

  /**
   * Get app version info
   * @returns {object} - Version info
   */
  getVersion() {
    return {
      name: CONFIG.APP_NAME,
      version: CONFIG.APP_VERSION,
      author: CONFIG.AUTHOR
    };
  }
}

// Create app instance
const app = new App();

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init());
} else {
  app.init();
}

// Export for debugging
window.__app = app;
window.__store = store;

export { app };
export default app;
