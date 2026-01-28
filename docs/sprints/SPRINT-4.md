# Sprint 4: Config & Documentation

## Sprint Overview

| Attribute | Value |
|-----------|-------|
| **Duration** | 1 week |
| **Story Points** | 11 |
| **Estimated Hours** | 14-18 hrs |
| **Focus** | Configuration management, documentation, testing foundation |
| **Priority** | Medium/Low |
| **Prerequisites** | Sprint 3 completed |

---

## Sprint Goal

ปรับปรุง configuration management โดยย้าย magic numbers ไป config file เพิ่ม documentation และวาง foundation สำหรับ unit tests

---

## Stories Summary

| ID | Story | Points | Hours | Priority | Dependencies |
|----|-------|--------|-------|----------|--------------|
| S4.1 | Extract Magic Numbers to Config | 3 | 4h | Medium | - |
| S4.2 | Add JSDoc Documentation | 5 | 6h | Low | - |
| S4.3 | Add Unit Tests (Foundation) | 3 | 4h | Low | - |

---

## S4.1: Extract Magic Numbers to Config

| Attribute | Value |
|-----------|-------|
| **Points** | 3 |
| **Hours** | 4h |
| **Priority** | Medium |
| **Status** | [ ] Not Started |

### Description
ย้าย hardcoded values ทั้งหมดไปยัง config file เพื่อให้ปรับแต่งได้ง่าย

### Acceptance Criteria
- [ ] Timeouts ทั้งหมดอยู่ใน config
- [ ] Browser viewport settings อยู่ใน config
- [ ] Capacity limits อยู่ใน config
- [ ] ไม่มี magic numbers ใน code (ยกเว้น trivial ones)

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | สำรวจ magic numbers ทั้ง codebase | 30m | [ ] |
| 2 | จัดกลุ่ม config ตาม category | 30m | [ ] |
| 3 | อัพเดท Config/configs.js | 1h | [ ] |
| 4 | อัพเดท files ที่ใช้ magic numbers | 1h | [ ] |
| 5 | สร้าง .env.example | 30m | [ ] |
| 6 | ทดสอบ configuration | 30m | [ ] |

### Files
- `Config/configs.js`
- **NEW:** `.env.example`
- `BrowserPool/browserPool.js`
- `IMAP/imapClient.js`
- `Task/CapacityTracker.js`
- `Exec/execAccept.js`

#### Code Implementation

```javascript
// Config/configs.js - Expanded version

require('dotenv').config();

module.exports = {
  // ============ Sheet Configuration ============
  DEFAULT_SHEET_KEY: 'MainSheet',
  jobLinks: {
    MainSheet: {
      sheetId: process.env.SHEET_ID_MAIN,
      tabName: 'AcceptLinks',
      LinksOrderColumn: 'D',
      StatusColumn: 'E',
      ReasonColumn: 'F',
      TimestampColumn: 'G'
    },
    DATASheet: {
      sheetId: process.env.SHEET_ID_DATA,
      tabName: 'NOTOUCH',
      LinksColumn: 'Q',
      ReceviedDate: 'C',
      StartRow: 7300
    },
    TrackingSheet: {
      sheetId: process.env.SHEET_ID_Tracking,
      tabName: 'PM_Tracking',
      statusColumn: 'B',
      orderIdColumn: 'F',
      pmNameColumn: 'C',
      Assignment: {
        tabName: 'Assignment',
        workflowNameColumn: 'F',
        projectStatusColumn: 'L'
      }
    }
  },

  // ============ Task Configuration ============
  task: {
    defaultConcurrency: parseInt(process.env.CONCURRENCY) || 4,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 1,
    timeoutMs: parseInt(process.env.TASK_TIMEOUT_MS) || 60000,
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS) || 3000
  },

  // ============ Browser Configuration ============
  browser: {
    poolSize: parseInt(process.env.BROWSER_POOL_SIZE) || 4,
    viewport: {
      width: parseInt(process.env.VIEWPORT_WIDTH) || 1200,
      height: parseInt(process.env.VIEWPORT_HEIGHT) || 800
    },
    timeout: {
      navigation: parseInt(process.env.NAV_TIMEOUT_MS) || 30000,
      default: parseInt(process.env.DEFAULT_TIMEOUT_MS) || 60000,
      waitForSelector: parseInt(process.env.SELECTOR_TIMEOUT_MS) || 10000
    },
    headless: process.env.HEADLESS !== 'false'
  },

  // ============ IMAP Configuration ============
  imap: {
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT) || 993,
    connectionTimeout: parseInt(process.env.IMAP_CONN_TIMEOUT) || 45000,
    idleTimeout: parseInt(process.env.IMAP_IDLE_TIMEOUT) || 600000,
    keepaliveInterval: parseInt(process.env.IMAP_KEEPALIVE) || 30000,
    maxRetries: parseInt(process.env.IMAP_MAX_RETRIES) || 5,
    initialRetryDelay: parseInt(process.env.IMAP_RETRY_DELAY) || 3000,
    maxRetryDelay: parseInt(process.env.IMAP_MAX_RETRY_DELAY) || 300000
  },

  // ============ Capacity Configuration ============
  capacity: {
    maxDailyWords: parseInt(process.env.MAX_DAILY_WORDS) || 12000,
    warningThreshold: parseFloat(process.env.CAPACITY_WARNING) || 0.8, // 80%
    planningDays: parseInt(process.env.PLANNING_DAYS) || 7
  },

  // ============ Task Acceptance Policy ============
  acceptancePolicy: {
    workStartHour: parseInt(process.env.WORK_START_HOUR) || 10,
    workEndHour: parseInt(process.env.WORK_END_HOUR) || 19,
    urgentHoursThreshold: parseInt(process.env.URGENT_THRESHOLD) || 6,
    shiftNightDeadline: process.env.SHIFT_NIGHT_DEADLINE !== 'false'
  },

  // ============ Notification Configuration ============
  notification: {
    googleChatWebhook: process.env.GOOGLE_CHAT_WEBHOOK,
    maxRetries: parseInt(process.env.NOTIFY_MAX_RETRIES) || 3,
    retryDelayMs: parseInt(process.env.NOTIFY_RETRY_DELAY) || 1000
  },

  // ============ Login Configuration ============
  login: {
    email: process.env.LOGIN_EMAIL,
    password: process.env.LOGIN_PASS,
    otpTimeoutMs: parseInt(process.env.OTP_TIMEOUT_MS) || 60000,
    forceLogin: process.env.FORCE_LOGIN === 'true'
  },

  // ============ Selectors (for Exec) ============
  selectors: {
    changeStatusButton: '#taskActionConfirm',
    attachmentsTab: 'a[href$="/attachments"]',
    fileLink: 'a[onclick^="TMS.startTranslation"]',
    licenceDropdown: '#select2-chosen-1',
    licenceOption: "//div[contains(@class, 'select2-result-label') and contains(text(), 'EQHOmoraviateam')]",
    setLicenceButton: 'button.btn.btn-primary.js_loader'
  },

  // ============ Legacy exports (for backward compatibility) ============
  defaultConcurrency: parseInt(process.env.CONCURRENCY) || 4,
  maxRetries: parseInt(process.env.MAX_RETRIES) || 1,
  forceLogin: process.env.FORCE_LOGIN === 'true',
  googleChatWebhook: process.env.GOOGLE_CHAT_WEBHOOK,
  taskConfig: {
    TASK_TIMEOUT_MS: parseInt(process.env.TASK_TIMEOUT_MS) || 60000,
    RETRY_COUNT: parseInt(process.env.RETRY_COUNT) || 2,
    RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS) || 3000
  },
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASS: process.env.EMAIL_PASS,
  IMAP_HOST: process.env.IMAP_HOST,
  MAILBOX: process.env.MAILBOX_NAME || 'INBOX',
  ALLOW_BACKFILL: process.env.ALLOW_BACKFILL === 'true'
};
```

#### Updated .env.example

```env
# ============ Login ============
LOGIN_EMAIL=your-email@example.com
LOGIN_PASS=your-password
OTP_TIMEOUT_MS=60000
FORCE_LOGIN=false

# ============ Email/IMAP ============
EMAIL_USER=your-email@example.com
EMAIL_PASS=your-app-password
IMAP_HOST=imap.gmail.com
MAILBOXES=Symfonie/Order,Symfonie/On hold
ALLOW_BACKFILL=false

# ============ Google Sheets ============
SHEET_ID_MAIN=your-sheet-id
SHEET_ID_DATA=your-sheet-id
SHEET_ID_Tracking=your-sheet-id

# ============ Notifications ============
GOOGLE_CHAT_WEBHOOK=https://chat.googleapis.com/v1/spaces/...

# ============ Task Processing ============
CONCURRENCY=4
MAX_RETRIES=1
TASK_TIMEOUT_MS=60000

# ============ Browser ============
BROWSER_POOL_SIZE=4
HEADLESS=true
VIEWPORT_WIDTH=1200
VIEWPORT_HEIGHT=800

# ============ Capacity ============
MAX_DAILY_WORDS=12000
CAPACITY_WARNING=0.8

# ============ Work Hours ============
WORK_START_HOUR=10
WORK_END_HOUR=19
URGENT_THRESHOLD=6
```

### Notes
- ทุก config ควรมี default value
- ใช้ env vars สำหรับ values ที่เปลี่ยนบ่อย

---

## S4.2: Add JSDoc Documentation

| Attribute | Value |
|-----------|-------|
| **Points** | 5 |
| **Hours** | 6h |
| **Priority** | Low |
| **Status** | [ ] Not Started |

### Description
เพิ่ม JSDoc documentation สำหรับ public functions ใน modules หลัก

### Acceptance Criteria
- [ ] ทุก public function มี JSDoc
- [ ] Parameters มี type annotations
- [ ] Return types ถูกระบุ
- [ ] มี usage examples สำหรับ complex functions

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | Document Task/taskAcceptance.js | 1h | [ ] |
| 2 | Document Task/CapacityTracker.js | 1h | [ ] |
| 3 | Document BrowserPool/browserPool.js | 1h | [ ] |
| 4 | Document Task/taskQueue.js | 45m | [ ] |
| 5 | Document IMAP/imapClient.js | 1h | [ ] |
| 6 | Document Sheets modules | 1h | [ ] |

### Files
- `Task/taskAcceptance.js`
- `Task/CapacityTracker.js`
- `BrowserPool/browserPool.js`
- `Task/taskQueue.js`
- `IMAP/imapClient.js`

#### JSDoc Examples

```javascript
/**
 * Evaluate task acceptance based on deadline, capacity, and working hours.
 *
 * @param {Object} input - Task input parameters
 * @param {string} input.orderId - Unique order identifier
 * @param {number} input.amountWords - Number of words in the task
 * @param {string} input.plannedEndDate - Deadline date/time string
 * @param {Object} [overrides={}] - Policy overrides
 * @param {number} [overrides.workStartHour] - Override work start hour
 * @param {number} [overrides.workEndHour] - Override work end hour
 *
 * @returns {Object} Evaluation result
 * @returns {boolean} result.accepted - Whether task is accepted
 * @returns {string} result.code - Reason code (ACCEPTED_NORMAL, REJECT_CAPACITY, etc.)
 * @returns {string} result.message - Human-readable message
 * @returns {string} result.rawDeadline - Original deadline (YYYY-MM-DD HH:mm)
 * @returns {string} result.effectiveDeadline - Adjusted deadline
 * @returns {boolean} result.urgent - Whether task is urgent
 * @returns {boolean} result.inWorkingHours - Whether deadline is in working hours
 * @returns {Array<{date: string, amount: number}>} result.allocationPlan - Capacity allocation
 * @returns {number} result.totalPlanned - Total words planned
 *
 * @example
 * const result = evaluateTaskAcceptance({
 *   orderId: 'ORD-12345',
 *   amountWords: 500,
 *   plannedEndDate: '2025-01-15 18:00'
 * });
 *
 * if (result.accepted) {
 *   console.log('Task accepted:', result.allocationPlan);
 * } else {
 *   console.log('Task rejected:', result.code, result.message);
 * }
 */
function evaluateTaskAcceptance({ orderId, amountWords, plannedEndDate }, overrides = {}) {
  // ...
}
```

### Notes
- Focus on public exports first
- ใช้ VSCode JSDoc extension สำหรับ auto-generate

---

## S4.3: Add Unit Tests (Foundation)

| Attribute | Value |
|-----------|-------|
| **Points** | 3 |
| **Hours** | 4h |
| **Priority** | Low |
| **Status** | [ ] Not Started |

### Description
Setup Jest testing framework และเขียน unit tests สำหรับ critical functions

### Acceptance Criteria
- [ ] Jest configured และรันได้
- [ ] `npm test` command ทำงาน
- [ ] Tests สำหรับ taskAcceptance.js
- [ ] Tests สำหรับ CapacityTracker.js (basic)

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | Install Jest (`npm i -D jest`) | 10m | [ ] |
| 2 | Create jest.config.js | 15m | [ ] |
| 3 | Create `__tests__` directory structure | 10m | [ ] |
| 4 | Write tests for parseDeadline | 45m | [ ] |
| 5 | Write tests for evaluateTaskAcceptance | 1h | [ ] |
| 6 | Write tests for CapacityTracker | 1h | [ ] |
| 7 | Add test script to package.json | 10m | [ ] |

### Files
- **NEW:** `jest.config.js`
- **NEW:** `__tests__/Task/taskAcceptance.test.js`
- **NEW:** `__tests__/Task/CapacityTracker.test.js`
- `package.json` (add scripts)

#### Setup Commands
```bash
npm install --save-dev jest
```

#### package.json Update
```json
{
  "scripts": {
    "start": "node main.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

#### jest.config.js
```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'Task/**/*.js',
    'IMAP/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
```

#### Test Examples

```javascript
// __tests__/Task/taskAcceptance.test.js

const {
  evaluateTaskAcceptance,
  parseDeadline,
  adjustMidnight,
  isWithinWorkingHours,
  REASONS
} = require('../../Task/taskAcceptance');

describe('taskAcceptance', () => {
  describe('parseDeadline', () => {
    test('parses YYYY-MM-DD format', () => {
      const result = parseDeadline('2025-01-15');
      expect(result).not.toBeNull();
      expect(result.format('YYYY-MM-DD')).toBe('2025-01-15');
    });

    test('parses DD/MM/YYYY format', () => {
      const result = parseDeadline('15/01/2025');
      expect(result).not.toBeNull();
      expect(result.format('YYYY-MM-DD')).toBe('2025-01-15');
    });

    test('returns null for invalid date', () => {
      const result = parseDeadline('invalid-date');
      expect(result).toBeNull();
    });

    test('returns null for empty string', () => {
      const result = parseDeadline('');
      expect(result).toBeNull();
    });
  });

  describe('adjustMidnight', () => {
    test('shifts 00:00 to previous day 23:59', () => {
      const midnight = parseDeadline('2025-01-15');
      const adjusted = adjustMidnight(midnight.startOf('day'));
      expect(adjusted.format('YYYY-MM-DD HH:mm')).toBe('2025-01-14 23:59');
    });

    test('does not change non-midnight times', () => {
      const noon = parseDeadline('2025-01-15').hour(12);
      const adjusted = adjustMidnight(noon);
      expect(adjusted.hour()).toBe(12);
    });
  });

  describe('isWithinWorkingHours', () => {
    const policy = { workStartHour: 10, workEndHour: 19 };

    test('returns true for 10:00', () => {
      const d = parseDeadline('2025-01-15').hour(10);
      expect(isWithinWorkingHours(d, policy)).toBe(true);
    });

    test('returns true for 18:59', () => {
      const d = parseDeadline('2025-01-15').hour(18).minute(59);
      expect(isWithinWorkingHours(d, policy)).toBe(true);
    });

    test('returns false for 19:00', () => {
      const d = parseDeadline('2025-01-15').hour(19);
      expect(isWithinWorkingHours(d, policy)).toBe(false);
    });

    test('returns false for 09:00', () => {
      const d = parseDeadline('2025-01-15').hour(9);
      expect(isWithinWorkingHours(d, policy)).toBe(false);
    });
  });

  describe('evaluateTaskAcceptance', () => {
    test('rejects invalid deadline', () => {
      const result = evaluateTaskAcceptance({
        orderId: 'ORD-001',
        amountWords: 100,
        plannedEndDate: 'invalid'
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe(REASONS.REJECT_INVALID_DEADLINE);
    });

    test('accepts normal task within capacity', () => {
      // This test needs mock for getAvailableDates
      // See mocking section below
    });
  });
});
```

#### Mocking Example

```javascript
// __tests__/Task/taskAcceptance.test.js

// Mock CapacityTracker
jest.mock('../../Task/CapacityTracker', () => ({
  getAvailableDates: jest.fn((words, deadline, excludeToday) => {
    // Return mock allocation
    return [{ date: '2025-01-15', amount: words }];
  })
}));

describe('evaluateTaskAcceptance with mocks', () => {
  test('accepts task when capacity available', () => {
    const result = evaluateTaskAcceptance({
      orderId: 'ORD-001',
      amountWords: 100,
      plannedEndDate: '2025-01-20 15:00'
    });

    expect(result.accepted).toBe(true);
    expect(result.code).toBe(REASONS.ACCEPTED_NORMAL);
    expect(result.allocationPlan).toHaveLength(1);
  });
});
```

---

## Sprint Metrics

### Burndown Target

| Day | Remaining Points |
|-----|------------------|
| Day 1 | 11 |
| Day 2 | 9 |
| Day 3 | 6 |
| Day 4 | 3 |
| Day 5 | 0 |

### New Files Created

| File | Description |
|------|-------------|
| `jest.config.js` | Jest configuration |
| `__tests__/Task/taskAcceptance.test.js` | Task acceptance tests |
| `__tests__/Task/CapacityTracker.test.js` | Capacity tracker tests |
| `.env.example` | Environment variables template |

---

## Sprint Review Checklist

- [ ] All config values extracted
- [ ] JSDoc added to key functions
- [ ] Jest tests passing
- [ ] `npm test` runs successfully
- [ ] Documentation complete
- [ ] No regression in existing functionality
- [ ] Committed and pushed to repository
