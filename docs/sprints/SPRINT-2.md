# Sprint 2: Error Handling & Reliability

## Sprint Overview

| Attribute | Value |
|-----------|-------|
| **Duration** | 1 week |
| **Story Points** | 12 |
| **Estimated Hours** | 14-18 hrs |
| **Focus** | Error handling, graceful shutdown, retry mechanisms |
| **Priority** | High |
| **Prerequisites** | Sprint 1 completed |

---

## Sprint Goal

ปรับปรุงการจัดการ errors ทั้งระบบ เพิ่ม graceful shutdown และ retry mechanisms เพื่อให้ระบบมีความเสถียรและ recover จาก failures ได้

---

## Stories Summary

| ID | Story | Points | Hours | Priority | Dependencies |
|----|-------|--------|-------|----------|--------------|
| S2.1 | Improve Task Queue Error Handling | 2 | 2h | High | - |
| S2.2 | Add File I/O Error Handling | 3 | 4h | High | - |
| S2.3 | Improve Timeout Handling with Cleanup | 3 | 4h | High | - |
| S2.4 | Add IMAP Graceful Shutdown | 2 | 2h | High | - |
| S2.5 | Add Retry Logic for External API Calls | 2 | 2h | High | - |

---

## S2.1: Improve Task Queue Error Handling

| Attribute | Value |
|-----------|-------|
| **Points** | 2 |
| **Hours** | 2h |
| **Priority** | High |
| **Status** | [ ] Not Started |

### Description
ปรับปรุง error handling ใน Task Queue ให้ครอบคลุมทุก edge cases และไม่ให้ queue ติดค้างเมื่อเกิด error

### Acceptance Criteria
- [ ] `onSuccess`/`onError` callbacks ถูก wrap ใน try-catch
- [ ] Error ใน callbacks ถูก log อย่างถูกต้อง
- [ ] Queue state ถูกต้องเสมอหลังเกิด error
- [ ] ไม่มี unhandled promise rejections

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | Review โค้ด taskQueue.js ปัจจุบัน | 15m | [ ] |
| 2 | เพิ่ม try-catch รอบ callback calls | 45m | [ ] |
| 3 | เพิ่ม error logging สำหรับ callback failures | 30m | [ ] |
| 4 | ทดสอบ error scenarios | 30m | [ ] |

### Files
- `Task/taskQueue.js`

#### Code Implementation

```javascript
// Task/taskQueue.js - Improved version

const { pushStatusUpdate } = require("../Dashboard/server");
const { logFail } = require("../Logs/logger");

class TaskQueue {
  constructor({ concurrency = 4, onSuccess, onError, onQueueEmpty }) {
    this.queue = [];
    this.processing = new Set();
    this.concurrency = concurrency;
    this.onSuccess = onSuccess;
    this.onError = onError;
    this.onQueueEmpty = onQueueEmpty;
  }

  addTask(taskFn) {
    this.queue.push(taskFn);
    this.processQueue();
  }

  async processQueue() {
    while (this.processing.size < this.concurrency && this.queue.length > 0) {
      const taskFn = this.queue.shift();
      const task = taskFn();
      this.processing.add(task);

      pushStatusUpdate();

      try {
        const result = await task;
        this.processing.delete(task);

        // Safely call onSuccess
        if (this.onSuccess) {
          try {
            await this.onSuccess(result);
          } catch (callbackErr) {
            logFail(`TaskQueue onSuccess callback error: ${callbackErr.message}`);
          }
        }
      } catch (error) {
        this.processing.delete(task);

        // Safely call onError
        if (this.onError) {
          try {
            await this.onError(error);
          } catch (callbackErr) {
            logFail(`TaskQueue onError callback error: ${callbackErr.message}`);
          }
        }
      }

      // Check for queue empty
      if (this.queue.length === 0 && this.processing.size === 0) {
        if (this.onQueueEmpty) {
          try {
            await this.onQueueEmpty();
          } catch (callbackErr) {
            logFail(`TaskQueue onQueueEmpty callback error: ${callbackErr.message}`);
          }
        }
      }

      pushStatusUpdate();
    }
  }

  getStatus() {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      concurrency: this.concurrency
    };
  }
}

module.exports = { TaskQueue };
```

### Notes
- ต้องทดสอบ edge case: callback ที่ throw error ซ้อนกัน
- ตรวจสอบว่า queue ไม่ค้างหลัง error

---

## S2.2: Add File I/O Error Handling

| Attribute | Value |
|-----------|-------|
| **Points** | 3 |
| **Hours** | 4h |
| **Priority** | High |
| **Status** | [ ] Not Started |

### Description
เพิ่ม error handling สำหรับ file operations ทั้งหมด เพื่อป้องกัน crash จากไฟล์ corrupt หรือ permission issues

### Acceptance Criteria
- [ ] ทุก `fs.readFileSync` มี try-catch
- [ ] ทุก `fs.writeFileSync` มี try-catch
- [ ] `JSON.parse` failures ถูก handle
- [ ] มี fallback values สำหรับ read failures
- [ ] Errors ถูก log อย่างเหมาะสม

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | สร้าง `utils/safeFileOps.js` | 1h | [ ] |
| 2 | อัพเดท CapacityTracker.js | 1h | [ ] |
| 3 | อัพเดท taskReporter.js | 45m | [ ] |
| 4 | อัพเดท sessionManager.js | 45m | [ ] |
| 5 | ทดสอบด้วย corrupt files | 30m | [ ] |

### Files
- **NEW:** `utils/safeFileOps.js`
- `Task/CapacityTracker.js`
- `Task/taskReporter.js`
- `Session/sessionManager.js`

#### Code Implementation

```javascript
// utils/safeFileOps.js - New utility file

const fs = require('fs');
const { logFail, logInfo } = require('../Logs/logger');

/**
 * Safely read and parse JSON file
 * @param {string} filePath - Path to JSON file
 * @param {*} defaultValue - Default value if read fails
 * @returns {*} Parsed JSON or default value
 */
function safeReadJSON(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      logInfo(`File not found, using default: ${filePath}`);
      return defaultValue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    if (!content.trim()) {
      logInfo(`Empty file, using default: ${filePath}`);
      return defaultValue;
    }

    return JSON.parse(content);
  } catch (err) {
    logFail(`Failed to read JSON file ${filePath}: ${err.message}`);
    return defaultValue;
  }
}

/**
 * Safely write JSON to file
 * @param {string} filePath - Path to JSON file
 * @param {*} data - Data to write
 * @param {Object} options - Options
 * @returns {boolean} Success status
 */
function safeWriteJSON(filePath, data, options = {}) {
  const { indent = 2, backup = false } = options;

  try {
    // Create backup if requested
    if (backup && fs.existsSync(filePath)) {
      const backupPath = `${filePath}.bak`;
      fs.copyFileSync(filePath, backupPath);
    }

    const content = JSON.stringify(data, null, indent);
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    logFail(`Failed to write JSON file ${filePath}: ${err.message}`);
    return false;
  }
}

/**
 * Safely append to file
 * @param {string} filePath - Path to file
 * @param {string} content - Content to append
 * @returns {boolean} Success status
 */
function safeAppendFile(filePath, content) {
  try {
    fs.appendFileSync(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    logFail(`Failed to append to file ${filePath}: ${err.message}`);
    return false;
  }
}

module.exports = {
  safeReadJSON,
  safeWriteJSON,
  safeAppendFile
};
```

```javascript
// Task/CapacityTracker.js - Updated version (excerpt)

const { safeReadJSON, safeWriteJSON } = require('../utils/safeFileOps');

const CAPACITY_PATH = path.join(__dirname, '../public/capacity.json');
const OVERRIDE_PATH = path.join(__dirname, '../public/dailyOverride.json');

function loadCapacityMap() {
  return safeReadJSON(CAPACITY_PATH, {});
}

function saveCapacityMap(data) {
  return safeWriteJSON(CAPACITY_PATH, data);
}

function loadDailyOverride() {
  return safeReadJSON(OVERRIDE_PATH, {});
}

function saveDailyOverride(data) {
  return safeWriteJSON(OVERRIDE_PATH, data);
}
```

### Notes
- ใช้ pattern นี้ทุกที่ที่อ่าน/เขียน JSON file
- ไฟล์ใหม่ `utils/safeFileOps.js` เป็น reusable module

---

## S2.3: Improve Timeout Handling with Cleanup

| Attribute | Value |
|-----------|-------|
| **Points** | 3 |
| **Hours** | 4h |
| **Priority** | High |
| **Status** | [ ] Not Started |

### Description
ปรับปรุง timeout handling ให้ cleanup resources อย่างถูกต้องเมื่อ timeout เกิดขึ้น

### Acceptance Criteria
- [ ] Timeout cancels pending operations
- [ ] Resources ถูก cleanup เมื่อ timeout
- [ ] รองรับ AbortController pattern
- [ ] ไม่มี memory leaks

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | เพิ่ม AbortController support | 1h | [ ] |
| 2 | อัพเดท withTimeout function | 1h | [ ] |
| 3 | อัพเดท callers ให้ handle abort signal | 1h | [ ] |
| 4 | ทดสอบ timeout scenarios | 1h | [ ] |

### Files
- `utils/taskTimeout.js`

#### Code Implementation

```javascript
// utils/taskTimeout.js - Improved version

const { logInfo } = require('../Logs/logger');

/**
 * Execute function with timeout and proper cleanup
 * @param {Function} fn - Function to execute (receives abort signal)
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {Object} options - Options
 * @returns {Promise<*>} Result of function
 */
async function withTimeout(fn, timeoutMs, options = {}) {
  const { onTimeout, name = 'Operation' } = options;

  const controller = new AbortController();
  const { signal } = controller;

  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();

      if (onTimeout) {
        try {
          onTimeout();
        } catch (e) {
          // Ignore cleanup errors
        }
      }

      reject(new Error(`${name} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    // Pass signal to function for cooperative cancellation
    const result = await Promise.race([
      fn({ signal }),
      timeoutPromise
    ]);

    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Create a cancellable delay
 * @param {number} ms - Delay in milliseconds
 * @param {AbortSignal} signal - Abort signal
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(new Error('Aborted'));
    });
  });
}

module.exports = withTimeout;
module.exports.delay = delay;
```

### Notes
- สำคัญสำหรับ Puppeteer operations ที่อาจค้าง
- `onTimeout` callback ช่วยให้ close browser/page ได้

---

## S2.4: Add IMAP Graceful Shutdown

| Attribute | Value |
|-----------|-------|
| **Points** | 2 |
| **Hours** | 2h |
| **Priority** | High |
| **Status** | [ ] Not Started |

### Description
เพิ่ม graceful shutdown สำหรับ IMAP connections เพื่อไม่ให้ทิ้ง connections ค้าง

### Acceptance Criteria
- [ ] มี `closeAllClients()` function
- [ ] SIGINT/SIGTERM ปิด IMAP connections
- [ ] Logout จากทุก mailboxes อย่างถูกต้อง
- [ ] ไม่มี hanging connections

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | เพิ่ม closeAllClients() ใน imapClient.js | 30m | [ ] |
| 2 | Export function | 15m | [ ] |
| 3 | เรียกใช้ใน main.js shutdown handlers | 30m | [ ] |
| 4 | ทดสอบ graceful shutdown | 45m | [ ] |

### Files
- `IMAP/imapClient.js`
- `main.js`

#### Code Implementation

```javascript
// IMAP/imapClient.js - เพิ่ม function

/**
 * Gracefully close all IMAP clients
 */
async function closeAllClients() {
  logInfo('Closing all IMAP connections...');

  const closePromises = [];

  for (const [mailboxName, client] of clients.entries()) {
    if (client && !client.destroyed) {
      closePromises.push(
        (async () => {
          try {
            await client.logout();
            logInfo(`Closed IMAP connection for ${mailboxName}`);
          } catch (err) {
            logFail(`Failed to close ${mailboxName}: ${err.message}`);
          }
        })()
      );
    }
  }

  await Promise.allSettled(closePromises);
  clients.clear();
  logSuccess('All IMAP connections closed');
}

module.exports = {
  startListeningEmails: connectToImap,
  closeAllClients, // NEW
  pauseImap,
  resumeImap,
  isImapPaused,
  checkConnection,
  getConnectionStats,
};
```

```javascript
// main.js - อัพเดท shutdown handlers

const { closeAllClients } = require('./IMAP/imapClient');

process.on('SIGINT', async () => {
  logProgress('Received SIGINT, shutting down gracefully...');
  await notifyGoogleChat('System shutdown initiated (SIGINT)');

  try {
    await closeAllClients(); // NEW
    await closeBrowserPool();
    await cleanupFetcher();
    logSuccess('Graceful shutdown completed');
    process.exit(0);
  } catch (err) {
    logFail(`Error during shutdown: ${err.message}`);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logProgress('Received SIGTERM, shutting down gracefully...');

  try {
    await closeAllClients(); // NEW
    await closeBrowserPool();
    logSuccess('Graceful shutdown completed');
    process.exit(0);
  } catch (err) {
    logFail(`Error during shutdown: ${err.message}`);
    process.exit(1);
  }
});
```

### Notes
- ทดสอบด้วย Ctrl+C ขณะมี active IMAP connections
- ใช้ `Promise.allSettled` เพื่อรอ close ทั้งหมด

---

## S2.5: Add Retry Logic for External API Calls

| Attribute | Value |
|-----------|-------|
| **Points** | 2 |
| **Hours** | 2h |
| **Priority** | High |
| **Status** | [ ] Not Started |

### Description
เพิ่ม retry logic สำหรับ Google Chat webhook calls เพื่อรองรับ transient network failures

### Acceptance Criteria
- [ ] Google Chat notifications มี retry
- [ ] Exponential backoff (1s, 2s, 4s)
- [ ] Maximum 3 retries
- [ ] Errors ถูก log อย่างเหมาะสม

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | อัพเดท notifyGoogleChat function | 45m | [ ] |
| 2 | เพิ่ม exponential backoff logic | 30m | [ ] |
| 3 | เพิ่ม error logging | 15m | [ ] |
| 4 | ทดสอบ retry behavior | 30m | [ ] |

### Files
- `Logs/notifier.js`

#### Code Implementation

```javascript
// Logs/notifier.js - Improved version

const axios = require('axios');
const { logFail, logInfo } = require('./logger');

const WEBHOOK_URL = process.env.GOOGLE_CHAT_WEBHOOK;
const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;

/**
 * Notify Google Chat with retry logic
 * @param {string} message - Message to send
 * @returns {Promise<boolean>} Success status
 */
async function notifyGoogleChat(message) {
  if (!WEBHOOK_URL) {
    logInfo('Google Chat webhook not configured, skipping notification');
    return false;
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.post(WEBHOOK_URL, {
        text: message
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return true;
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === MAX_RETRIES;
      const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);

      if (!isLastAttempt) {
        logInfo(`Google Chat notification failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  logFail(`Google Chat notification failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
  return false;
}

module.exports = { notifyGoogleChat };
```

---

## Sprint Metrics

### Burndown Target

| Day | Remaining Points |
|-----|------------------|
| Day 1 | 12 |
| Day 2 | 10 |
| Day 3 | 7 |
| Day 4 | 4 |
| Day 5 | 0 |

### Dependencies

| Story | Depends On |
|-------|------------|
| S2.2 | Creates utils/safeFileOps.js |
| S2.4 | Updates main.js shutdown |

---

## Sprint Review Checklist

- [ ] All stories completed
- [ ] Error scenarios tested
- [ ] Graceful shutdown tested (Ctrl+C)
- [ ] Network failure simulation tested
- [ ] No regression in existing functionality
- [ ] Committed and pushed to repository
