/**
 * Auto RWS Dashboard - Configuration
 * Constants, API endpoints, thresholds
 */

export const CONFIG = {
  // App Info
  APP_NAME: 'Auto RWS Dashboard',
  APP_VERSION: '2.0.0',
  AUTHOR: 'Jirawat Piyakit',

  // API Endpoints
  API: {
    BASE_URL: '',
    CAPACITY: '/api/capacity',
    OVERRIDE: '/api/override',
    ADJUST: '/api/adjust',
    CLEANUP: '/api/cleanup',
    ACCEPTED_TASKS: '/api/tasks',
    // Phase 2 APIs
    HEALTH_BROWSER: '/api/health/browser',
    HEALTH_IMAP: '/api/health/imap',
    HEALTH_SHEETS: '/api/health/sheets',
    METRICS: '/api/metrics',
    STATE: '/api/state',
    SYNC_STATUS: '/api/sync/status',
    SYNC_TRIGGER: '/api/sync/trigger',
    VERIFICATION_STATUS: '/api/verification/status',
    VERIFICATION_RESULTS: '/api/verification/results',
    WORKING_HOURS: '/api/working-hours',
    OVERTIME: '/api/working-hours/overtime',
    HOLIDAYS: '/api/holidays',
    QUEUE_STATUS: '/api/queue/status',
    QUEUE_RECENT: '/api/queue/recent',
    CAPACITY_INSIGHTS: '/api/capacity/insights'
  },

  // WebSocket
  WS: {
    RECONNECT_DELAY: 3000,
    MAX_RECONNECT_ATTEMPTS: 10,
    PING_INTERVAL: 30000
  },

  // Capacity Thresholds
  CAPACITY: {
    LOW_THRESHOLD: 70,      // < 70% = green
    HIGH_THRESHOLD: 90,     // > 90% = red
    DEFAULT_LIMIT: 12000,   // Default daily word limit
    CLEANUP_DAYS: 7         // Days to keep old capacity data
  },

  // Task Report
  TASK: {
    PAGE_SIZES: [10, 25, 50],
    DEFAULT_PAGE_SIZE: 10,
    URGENT_HOURS: 6,        // Tasks due within 6 hours = urgent
    TODAY_HOURS: 24,        // Tasks due within 24 hours = today
    WORK_START_HOUR: 10     // Deadlines before this hour count as previous day
  },

  // Toast Notifications
  TOAST: {
    DURATION: 5000,         // Auto-dismiss after 5s
    MAX_VISIBLE: 3,         // Max toasts visible at once
    POSITION: 'bottom-right'
  },

  // Date/Time Format
  DATE_FORMAT: {
    DISPLAY: 'DD/MM/YYYY',
    DISPLAY_TIME: 'DD/MM HH:mm',
    INPUT: 'YYYY-MM-DD',
    ISO: 'YYYY-MM-DDTHH:mm:ss'
  },

  // Keyboard Shortcuts
  SHORTCUTS: {
    REFRESH: 'r',
    PAUSE: 'p',
    SEARCH: '/',
    ESCAPE: 'Escape'
  },

  // Animations
  ANIMATION: {
    FAST: 150,
    NORMAL: 300,
    SLOW: 500
  },

  // Task Status Colors
  STATUS_COLORS: {
    pending: 'pending',
    accepted: 'success',
    rejected: 'error',
    'in-progress': 'info',
    completed: 'success',
    failed: 'error'
  }
};

// Status Icons (using emoji as fallback, could use icon library)
export const ICONS = {
  pending: '⏳',
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
  search: '🔍',
  refresh: '↻',
  download: '↓',
  calendar: '📅',
  chart: '📊',
  settings: '⚙',
  close: '×',
  chevronLeft: '‹',
  chevronRight: '›',
  chevronUp: '▲',
  chevronDown: '▼',
  sortAsc: '↑',
  sortDesc: '↓',
  edit: '✎',
  delete: '🗑',
  pause: '⏸',
  play: '▶',
  connection: '●',
  link: '🔗'
};

// Column definitions for task table
export const TASK_COLUMNS = [
  { key: 'index', label: '#', sortable: false, width: '50px' },
  { key: 'workflow', label: 'Workflow', sortable: true },
  { key: 'words', label: 'Words', sortable: true, align: 'right' },
  { key: 'deadline', label: 'Deadline', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'actions', label: '', sortable: false, width: '80px' }
];

// Filter options for task table
export const TASK_FILTERS = [
  { value: 'all', label: 'All Tasks' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'today', label: 'Due Today' },
  { value: 'tomorrow', label: 'Due Tomorrow' },
  { value: 'later', label: 'Due Later' }
];

// Sort options
export const SORT_OPTIONS = [
  { value: 'deadline-asc', label: 'Deadline (Earliest)' },
  { value: 'deadline-desc', label: 'Deadline (Latest)' },
  { value: 'words-asc', label: 'Words (Lowest)' },
  { value: 'words-desc', label: 'Words (Highest)' },
  { value: 'workflow-asc', label: 'Workflow (A-Z)' },
  { value: 'workflow-desc', label: 'Workflow (Z-A)' }
];

export default CONFIG;
