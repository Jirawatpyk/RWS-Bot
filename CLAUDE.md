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
| `Task/CapacityTracker.js` | Daily word capacity tracking and allocation |
| `Task/taskScheduler.js` | Scheduled task execution timing |
| `Sheets/sheetWriter.js` | Write status updates to Google Sheets |
| `Sheets/markStatusByOrderId.js` | Update order status by ID |
| `LoginSession/initLoginSession.js` | SSO login flow with session persistence |
| `Session/sessionManager.js` | Cookie storage and reuse |
| `Logs/logger.js` | Colored console logging |
| `Logs/notifier.js` | Google Chat webhook notifications |
| `Utils/retryHandler.js` | Generic retry wrapper with configurable attempts |
| `Utils/taskTimeout.js` | Promise timeout wrapper |

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

## Configuration

- **Config/configs.js** - Sheet IDs, column mappings, concurrency settings
- **.env** - Credentials (EMAIL_USER, EMAIL_PASS, SHEET_ID_*, GOOGLE_CHAT_WEBHOOK)
- **public/dailyOverride.json** - Manual capacity overrides per date
- **public/capacity.json** - Current allocated capacity

## Dashboard API Endpoints

```
GET  /api/capacity     - Current capacity map
GET  /api/override     - Daily override settings
POST /api/override     - Update overrides
POST /api/adjust       - Adjust capacity for specific date
POST /api/cleanup      - Remove old capacity entries
```

WebSocket events: `updateStatus`, `capacityUpdated`, `logEntry`, `togglePause`

## Process Lifecycle

- Exit code `12` triggers login-expired restart (handled by PM2)
- SIGINT/SIGTERM gracefully close browser pool and IMAP connections
- Uncaught exceptions notify Google Chat before exit
