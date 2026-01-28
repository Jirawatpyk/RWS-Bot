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

  /* ========================= IMAP Health Monitor ========================= */
  IMAP_HEALTH: {
    RECONNECT_ALERT_THRESHOLD: 3,           // alert if reconnects >= 3 within window
    RECONNECT_ALERT_WINDOW: 10 * 60 * 1000, // 10 minutes sliding window
    MAX_CONSECUTIVE_FAILURES: 5,            // alert after 5 consecutive health check failures
    HISTORY_PRUNE_INTERVAL: 30 * 60 * 1000, // prune reconnect history older than 30 minutes
  },

  /* ========================= Circuit Breaker (Google Sheets API) ========================= */
  CIRCUIT_BREAKER: {
    FAILURE_THRESHOLD: 5,       // consecutive failures before tripping to OPEN
    SUCCESS_THRESHOLD: 2,       // consecutive successes in HALF_OPEN to reset to CLOSED
    TIMEOUT: 10000,             // execution timeout per call (10 seconds)
    RESET_TIMEOUT: 60000,       // time in OPEN before attempting HALF_OPEN (60 seconds)
  },

  /* ========================= Status Sync (Moravia Polling) ========================= */
  STATUS_SYNC: {
    POLLING_INTERVAL: 5 * 60 * 1000,   // 5 minutes - poll Google Sheet for status changes
    ENABLED: true,                       // enable/disable auto-polling on boot
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
    PAGE_CLEANUP_INTERVAL: 5 * 60 * 1000,       // 5 minutes - periodic orphaned page scan
    PAGE_WARNING_THRESHOLD: 10,                 // warn when browser has > 10 pages
    PAGE_FORCE_CLEANUP_THRESHOLD: 20,           // force close old pages when > 20
    PAGE_MAX_AGE: 10 * 60 * 1000,               // 10 minutes - max page age for force cleanup
  },

  /* ========================= Browser Health Monitor ========================= */
  BROWSER_HEALTH: {
    CHECK_INTERVAL: 5 * 60 * 1000,             // 5 minutes - health check interval
    MEMORY_WARN_MB: 300,                        // warn when JSHeap > 300 MB
    MEMORY_RECYCLE_MB: 500,                     // auto-recycle browser when JSHeap > 500 MB
    MAX_PAGES_PER_BROWSER: 20,                  // recycle if pages exceed this threshold
    HEALTH_HISTORY_SIZE: 50,                    // keep last 50 health check snapshots
  },

  /* ========================= Reporting Schedule (hours) ========================= */
  REPORT_SCHEDULE: {
    MORNING: { hour: 9, minute: 0 },           // taskScheduler.js
    AFTERNOON: { hour: 15, minute: 0 },        // taskScheduler.js
    EVENING: { hour: 18, minute: 0 },          // taskScheduler.js
  },

  /* ========================= Post-Accept Verification ========================= */
  VERIFICATION: {
    DELAY_MS: 30 * 1000,                       // 30 seconds - wait before verifying (postAcceptVerifier.js)
    PAGE_TIMEOUT: 30 * 1000,                   // 30 seconds - page navigation timeout
    MAX_RESULTS: 100,                          // keep last 100 verification results in memory
  },

  /* ========================= Persistent Task Queue (SQLite) ========================= */
  PERSISTENT_QUEUE: {
    DB_PATH: 'data/taskQueue.db',              // Relative to project root
    STALE_TIMEOUT: 10 * 60 * 1000,            // 10 minutes - requeue processing tasks older than this
    CLEANUP_AGE: 7 * 24 * 60 * 60 * 1000,     // 7 days - delete completed/failed tasks older than this
    RECOVERY_ON_BOOT: true,                    // Automatically recover stale tasks on startup
  },
};
