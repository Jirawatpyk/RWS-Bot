# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Auto-RWS is an automated task acceptance system that monitors IMAP email for incoming tasks, evaluates acceptance criteria (capacity, deadlines, working hours), and executes browser automation to accept tasks on the Moravia platform. Results are logged to Google Sheets with real-time dashboard monitoring.

## Commands

```bash
# Install dependencies
npm install

# Run directly
node main.js

# Run with PM2 (production)
pm2 start ecosystem.config.js

# PM2 management
pm2 logs AutoRWS          # View logs
pm2 restart AutoRWS       # Restart
pm2 stop AutoRWS          # Stop

# Run tests
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
npm run test:verbose      # Verbose output

# Dashboard available at
http://localhost:3000
```

## Architecture

### Core Flow
1. **main.js** - Orchestrator that initializes login, browser pool, IMAP listener, and task queue
2. **IMAP Module** (`IMAP/`) - Listens for new emails, parses task links using `fetcher.js` and `linkParser.js`
3. **Task Acceptance** (`Task/taskAcceptance.js`) - Centralized accept/reject logic with working hours, capacity, and deadline rules
4. **Task Queue** (`Task/taskQueue.js`) - Concurrent queue with configurable concurrency (default: 4)
5. **Browser Pool** (`BrowserPool/browserPool.js`) - Puppeteer browser pool with per-slot profiles
6. **Exec Module** (`Exec/execAccept.js`) - Puppeteer automation for clicking "Accept" on Moravia platform
7. **Dashboard** (`Dashboard/server.js`) - Express + WebSocket server for real-time status and capacity management

### Key Modules

| Module | Purpose |
|--------|---------|
| `Task/CapacityTracker.js` | Daily word capacity tracking and allocation (file-locked) |
| `Task/taskScheduler.js` | Scheduled task execution timing |
| `Task/taskQueue.js` | In-memory concurrent queue (concurrency: 4) |
| `Task/persistentQueue.js` | SQLite-backed persistent queue (`data/taskQueue.db`) with priority, crash recovery |
| `Task/wordQuotaTracker.js` | Daily word quota tracking |
| `Sheets/sheetWriter.js` | Write status updates to Google Sheets (circuit breaker protected) |
| `Sheets/markStatusByOrderId.js` | Update order status by ID |
| `BrowserPool/browserPool.js` | Puppeteer browser pool with page tracking, periodic cleanup, health monitor |
| `LoginSession/initLoginSession.js` | SSO login flow with session persistence |
| `Session/sessionManager.js` | Cookie storage and reuse |
| `IMAP/IMAPHealthMonitor.js` | IMAP reconnect tracking, failure alerting, Google Chat alerts |
| `Metrics/metricsCollector.js` | Task counters, rates, processing times, subsystem status |
| `Features/postAcceptVerifier.js` | Post-acceptance verification — re-check `#entityStatus` after 30s, rollback on failure |
| `Features/moraviaStatusSync.js` | Real-time status sync polling every 5 minutes |
| `Features/capacityLearner.js` | AI capacity analysis, recommendations, suggestions |
| `Core/taskHandler.js` | Task processing orchestrator with verification scheduling |
| `Utils/fileUtils.js` | `loadJSON`, `saveJSONAtomic`, `withFileLock` (proper-lockfile) |
| `Utils/circuitBreaker.js` | Circuit breaker for Google Sheets API (CLOSED/OPEN/HALF_OPEN) |
| `Utils/retryHandler.js` | Generic retry wrapper with configurable attempts |
| `Utils/taskTimeout.js` | Promise timeout wrapper |
| `Errors/customErrors.js` | `TaskAcceptanceError`, `BrowserAutomationError`, `IMAPError`, `FileIOError` |
| `Config/constants.js` | Centralized constants (timeouts, retries, thresholds, schedules) |
| `Logs/logger.js` | Colored console logging |
| `Logs/notifier.js` | Google Chat webhook notifications |

### Task Acceptance Rules (`Task/taskAcceptance.js`)

The system uses `evaluateTaskAcceptance()` which checks:
- **Working hours**: 10:00-19:00 (configurable via `DEFAULT_POLICY`)
- **Urgent threshold**: Tasks due within 6 hours
- **Night deadline shift**: Deadlines before work start shift to previous day EOD
- **Capacity check**: Via `getAvailableDates()` from CapacityTracker

Rejection codes: `REJECT_URGENT_OUT_OF_HOURS`, `REJECT_CAPACITY`, `REJECT_INVALID_DEADLINE`

### Browser Pool Pattern

Each browser instance uses a dedicated Chrome profile (`Session/chrome-profiles/profile_N`). The pool auto-recreates disconnected browsers with the same slot index.

### Exec Workflow (`Exec/execAccept.js`)

Steps for accepting a task on Moravia platform:
1. **STEP 1**: Click "Change Status" button (`#taskActionConfirm`)
2. **STEP 2**: Open Attachments tab
3. **STEP 3**: Expand Source section (chevron icon)
4. **STEP 4**: Click file link to trigger licence modal
5. **STEP 5**: Select licence from dropdown → choose "EQHOmoraviateam"
6. **STEP 6**: Click "Set licence" button

**Known Issue**: Select2 dropdown IDs are dynamic (e.g., `#select2-chosen-1` may become `#select2-chosen-16`). Use class selectors (`.select2-chosen`) or text content matching instead of hardcoded IDs.

### Post-Acceptance Verification (`Features/postAcceptVerifier.js`)

After browser automation accepts a task:
1. Wait 30 seconds for Moravia to update
2. Navigate back to task URL
3. Read `#entityStatus` element text
4. If `"accepted"` or `"in progress"` → verified ✅
5. Otherwise → rollback capacity + alert Google Chat ❌

### Persistent Task Queue (`Task/persistentQueue.js`)

SQLite-backed queue (`better-sqlite3`) at `data/taskQueue.db`:
- WAL mode for concurrent read/write
- Priority-based dequeue (lower number = higher priority)
- Crash recovery: `processing` tasks stale > 10min → back to `pending`
- Auto-cleanup: completed/failed > 7 days → deleted

## Configuration

- **Config/configs.js** - Sheet IDs, column mappings, concurrency settings
- **Config/constants.js** - Centralized constants (32+ values in 8 categories: TIMEOUTS, RETRIES, CAPACITY, WORKING_HOURS, ALERTS, EXIT_CODES, BROWSER_POOL, REPORT_SCHEDULE, IMAP_HEALTH, VERIFICATION, STATUS_SYNC)
- **.env** - Credentials (EMAIL_USER, EMAIL_PASS, SHEET_ID_*, GOOGLE_CHAT_WEBHOOK)
- **public/dailyOverride.json** - Manual capacity overrides per date
- **public/capacity.json** - Current allocated capacity

## Dashboard API Endpoints

### Capacity & Override (Phase 1)
```
GET  /api/capacity          - Current capacity map
GET  /api/override          - Daily override settings
POST /api/override          - Update overrides
POST /api/adjust            - Adjust capacity for specific date
POST /api/cleanup           - Remove old capacity entries
```

### System Health & Metrics (Phase 2)
```
GET  /api/health/browser    - Browser pool status (active/total, pages, recycled)
GET  /api/health/imap       - IMAP connection status (connected, mailboxes, reconnects)
GET  /api/health/sheets     - Google Sheets circuit breaker state (CLOSED/OPEN/HALF_OPEN)
GET  /api/metrics           - Task counters, rates, processing times
GET  /api/state             - Full system state snapshot
GET  /api/config            - Current configuration
```

### Sync & Verification (Phase 2)
```
GET  /api/sync/status       - Last sync time, running status
POST /api/sync/trigger      - Manually trigger status sync
GET  /api/verification/status  - Pending verifications count
GET  /api/verification/results - Recent verification results (pass/fail)
```

### Working Hours, Holidays & Overtime (Phase 2)
```
GET  /api/working-hours              - Current working hours config
GET  /api/working-hours/overtime     - List overtime schedules
POST /api/working-hours/overtime     - Add overtime (date, start, end)
DELETE /api/working-hours/overtime/:date - Remove overtime for date
GET  /api/holidays                   - List holidays
POST /api/holidays                   - Add holiday (date, name)
DELETE /api/holidays/:date           - Remove holiday
POST /api/holidays/working           - Mark holiday as working day
DELETE /api/holidays/working/:date   - Remove working holiday override
```

### Task Queue (Phase 2)
```
GET  /api/queue/status      - Queue counts (total, pending, processing, completed, failed)
GET  /api/queue/recent      - Recent tasks with metadata
POST /api/queue/retry/:id   - Retry a failed task
POST /api/queue/cleanup     - Remove old completed/failed tasks (>7 days)
```

### Capacity Analysis (Phase 2)
```
GET  /api/capacity/analysis    - Daily breakdown, trend, peak/slow days
GET  /api/capacity/suggestions - Actionable suggestions with priority
GET  /api/capacity/summary     - Recommendation (increase/decrease/maintain) + confidence %
```

### WebSocket Events
`updateStatus`, `capacityUpdated`, `logEntry`, `togglePause`

## Dashboard Frontend (`public/`)

Vanilla JS ES Modules with dark cyberpunk theme. No framework.

### Architecture
- **Store:** `public/js/state/store.js` — pub/sub state management (`get`, `set`, `subscribe`)
- **API Service:** `public/js/services/api.js` — singleton with 26+ methods
- **Config:** `public/js/config.js` — API endpoint constants + ICONS (emoji-based)
- **Helpers:** `public/js/utils/helpers.js` — `formatNumber`, `escapeHtml`, `formatDate`
- **App:** `public/js/app.js` — mounts all components, handles WebSocket

### Components (class-based, lifecycle: constructor → mount → render → bindEvents → destroy)

| Component | Container | Store Keys | Features |
|-----------|-----------|------------|----------|
| `StatusCards.js` | `#status-cards` | tasks, capacity | Phase 1 status overview |
| `Header.js` | `#header` | connectionStatus | Nav + connection indicator |
| `SystemHealth.js` | `#system-health` | systemHealth, metrics, syncStatus, verificationStatus | 3 health cards, metrics grid, sync trigger, verification stats, auto-refresh 30s |
| `QueueMonitor.js` | `#queue-monitor` | queueStatus, queueRecent | Status cards, progress bar, sortable table, retry/cleanup, auto-refresh 15s |
| `WorkingHoursManager.js` | `#working-hours` | workingHours, holidays, overtime | Calendar (color-coded), 3 tabs, CRUD forms, date validation |
| `CapacityInsights.js` | `#capacity-insights` | capacityAnalysis, capacitySuggestions, capacitySummary | Chart.js line chart, recommendation badge, suggestions list |

### Component Patterns
- XSS prevention: all API data passed through `escapeHtml()` before innerHTML
- Store subscriptions stored in `_unsubscribers[]`, cleaned in `destroy()`
- Loading guard: `_loading` flag prevents concurrent `loadData()` calls
- Notifications: `document.dispatchEvent(new CustomEvent('toast:show', { detail: { type, message } }))`
- Date validation: `isValidDateFormat()` before API URL path params

### CSS Theme (`public/css/main.css`, `public/css/components.css`)
- CSS custom properties: `--bg-card`, `--accent-cyan`, `--border-color`, `--status-success`, etc.
- Dark cyberpunk industrial aesthetic
- Responsive: 2-column desktop, 1-column mobile (breakpoints: 1024px, 768px, 480px)

## Process Lifecycle

- Exit code `12` triggers login-expired restart (handled by PM2)
- SIGINT/SIGTERM gracefully close browser pool and IMAP connections
- Uncaught exceptions notify Google Chat before exit
