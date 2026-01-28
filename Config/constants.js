/**
 * Centralized Constants - Magic Numbers
 * All hardcoded numbers extracted from codebase for better maintainability
 * Organized by category for easy navigation
 */

module.exports = {
  /* ========================= Timeouts (milliseconds) ========================= */
  TIMEOUTS: {
    // IMAP & Email
    IMAP_HEALTH_CHECK_INTERVAL: 3 * 60 * 1000,  // 3 minutes (fetcher.js)
    IMAP_HEALTH_CHECK_TIMEOUT: 15 * 1000,       // 15 seconds (fetcher.js)

    // Task execution
    TASK_EXECUTION: 60 * 1000,                  // 60 seconds (runTaskInNewBrowser.js)

    // Browser pool
    BROWSER_ACQUIRE: 30 * 1000,                 // 30 seconds (browserPool.js)
    BROWSER_CLOSE: 10 * 1000,                   // 10 seconds (browserPool.js)
    BROWSER_POLLING_INTERVAL: 100,              // 100ms (browserPool.js)
    BROWSER_RECREATE_DELAY: 5 * 1000,           // 5 seconds (browserPool.js)

    // WebSocket & HTTP
    WEBSOCKET_PING_INTERVAL: 30 * 1000,         // 30 seconds (server.js)
    HTTP_REQUEST_TIMEOUT: 10 * 1000,            // 10 seconds (server.js, taskReporter.js)

    // Scheduled tasks
    ONE_DAY: 24 * 60 * 60 * 1000,              // 24 hours (taskScheduler.js)
    ALERT_CHECK_INTERVAL: 15 * 60 * 1000,      // 15 minutes (taskScheduler.js)

    // General delays
    SHORT_DELAY: 100,                           // 100ms (wordQuotaTracker.js retry delay)
    MEDIUM_DELAY: 500,                          // 500ms (general cleanup)
  },

  /* ========================= Retry Configuration ========================= */
  RETRIES: {
    // IMAP operations
    IMAP_FETCH: 3,                              // fetcher.js
    IMAP_FETCH_DELAY: 1000,                     // 1 second (fetcher.js)

    // File operations
    FILE_WRITE: 3,                              // wordQuotaTracker.js

    // Login
    LOGIN_SESSION: 3,                           // main.js

    // General
    DEFAULT_MAX_RETRIES: 1,                     // configs.js
  },

  /* ========================= Capacity & Thresholds ========================= */
  CAPACITY: {
    // Daily limits
    MAX_DAILY_WORDS: 12000,                     // configs.js

    // Urgent task classification
    URGENT_DAYS_THRESHOLD: 3,                   // CapacityTracker.js (< 3 days = urgent)
    URGENT_HOURS_THRESHOLD: 6,                  // taskAcceptance.js (≤ 6 hours = urgent)

    // Memory management
    SEEN_UIDS_LIMIT: 1000,                      // fetcher.js

    // Word quota tracking
    WORD_QUOTA_LIMIT: 8000,                     // wordQuotaTracker.js
    WORD_QUOTA_STEP: 2000,                      // wordQuotaTracker.js (alert every 2000 words)
    WORD_QUOTA_RESET_HOUR: 18,                  // wordQuotaTracker.js (time window resets at 18:00)
  },

  /* ========================= Working Hours ========================= */
  WORKING_HOURS: {
    START_HOUR: 10,                             // taskAcceptance.js, taskReporter.js
    END_HOUR: 19,                               // taskAcceptance.js
  },

  /* ========================= Alert & Notification ========================= */
  ALERTS: {
    DUE_WITHIN_MINUTES: 15,                     // taskReporter.js (alert if due within 15 mins)
  },

  /* ========================= Process Exit Codes ========================= */
  EXIT_CODES: {
    LOGIN_EXPIRED: 12,                          // main.js (triggers PM2 restart)
    NORMAL_EXIT: 0,
    ERROR_EXIT: 1,
  },

  /* ========================= Browser Pool ========================= */
  BROWSER_POOL: {
    DEFAULT_CONCURRENCY: 4,                     // configs.js (default pool size)
  },

  /* ========================= Reporting Schedule (hours) ========================= */
  REPORT_SCHEDULE: {
    MORNING: { hour: 9, minute: 0 },           // taskScheduler.js
    AFTERNOON: { hour: 15, minute: 0 },        // taskScheduler.js
    EVENING: { hour: 18, minute: 0 },          // taskScheduler.js
  },
};
