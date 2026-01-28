# AUTO RWS Development Roadmap

> เอกสารนี้รวบรวมแผนพัฒนาระบบจากการวิเคราะห์ของ Architecture Reviewer, System Analyzer, Feature Explorer, Test Engineer และ Code Refactorer

**สร้างเมื่อ:** 2026-01-28
**สถานะ:** Active Development

---

## 📊 Summary Table

| Phase | จำนวนงาน | Priority High | Priority Medium | Priority Low |
|-------|----------|---------------|-----------------|--------------|
| **Quick Wins** (0-2 เดือน) | 12 | 8 | 3 | 1 |
| **Medium Term** (3-6 เดือน) | 10 | 4 | 5 | 1 |
| **Long Term** (6-12 เดือน) | 8 | 2 | 4 | 2 |
| **Total** | **30** | **14** | **12** | **4** |

---

## 🎯 Phase 1: Quick Wins (0-2 เดือน)

### 1.1 Critical Stability & Security

#### [x] 1. แก้ Race Condition ใน capacity.json -- DONE
**Priority:** 🔴 High
**ปัญหา:** Concurrent tasks เขียนทับกันทำให้ capacity หาย (lost update)
**ไฟล์:** `Task/CapacityTracker.js`, `public/capacity.json`, `Utils/fileUtils.js`, `Dashboard/server.js`

**ผลลัพธ์:**
- ใช้ `proper-lockfile` ผ่าน `withFileLock()` ใน `Utils/fileUtils.js`
- Atomic write ด้วย `saveJSONAtomic()` (write .tmp then rename, Windows fallback)
- อัพเดท `CapacityTracker.js`: `applyCapacity()`, `adjustCapacity()`, `releaseCapacity()`, `resetCapacityMap()`, `syncCapacityWithTasks()` ทั้งหมดใช้ lock
- อัพเดท `Dashboard/server.js`: `cleanupOldCapacityAndOverride()` ใช้ `withFileLock`
- Lock stale timeout 10s สำหรับ crash recovery, retry 5 ครั้ง

---

#### [ ] 2. เพิ่ม Authentication สำหรับ Dashboard API
**Priority:** 🔴 High
**ปัญหา:** ใครก็ reset capacity / pause IMAP ได้ — ไม่มี auth
**ไฟล์:** `Dashboard/server.js`

**แนวทางแก้:**
- เพิ่ม API Key authentication (header-based)
- ใช้ JWT token สำหรับ WebSocket connections
- Environment variable สำหรับเก็บ API_KEY

```javascript
// Middleware
function authenticateAPI(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.DASHBOARD_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/api/override', authenticateAPI, async (req, res) => { ... });
```

---

#### [x] 3. แก้ Browser Page Leak -- DONE
**Priority:** 🔴 High
**ปัญหา:** `page.close()` fail → memory leak → OOM
**ไฟล์:** `BrowserPool/browserPool.js`, `Task/runTaskInNewBrowser.js`, `Exec/execAccept.js`, `Config/constants.js`

**ผลลัพธ์:**
- เพิ่ม Page Tracking ใน `BrowserPool`: `activePages` Map, `getPage()`, `releasePage()` methods
- เพิ่ม Periodic Cleanup: `startPeriodicCleanup()` / `stopPeriodicCleanup()` / `_runPageCleanup()`
- Thresholds จาก `Config/constants.js`: `PAGE_WARNING_THRESHOLD=10`, `PAGE_FORCE_CLEANUP_THRESHOLD=20`, `PAGE_MAX_AGE=10min`
- `runTaskInNewBrowser.js`: ใช้ `pool.getPage()` + `pool.releasePage()` ใน finally block
- `execAccept.js`: fallback page จาก goto retry ถูก track + cleanup ใน finally
- `closeAll()` clears `activePages` Map และ stops cleanup interval
- `releasePage()` handles already-closed pages gracefully ด้วย CDP fallback

---

#### [x] 4. ใช้ Custom Error Classes แทน String Matching -- DONE
**Priority:** 🟡 Medium
**ปัญหา:** Error handling ไม่สม่ำเสมอ ใช้ `error.message.includes()` แทน type checking
**ไฟล์:** `Errors/customErrors.js` (new), `Exec/execAccept.js`, `Utils/retryHandler.js`

**ผลลัพธ์:**
- สร้าง `Errors/customErrors.js` มี 4 classes: `TaskAcceptanceError`, `BrowserAutomationError`, `IMAPError`, `FileIOError`
- ทุก class มี `Error.captureStackTrace` สำหรับ proper stack traces
- `BrowserAutomationError` มี `step` + `details` properties
- `execAccept.js`: ทุก step (1-6) throw `BrowserAutomationError` พร้อม step identifier + context
- `retryHandler.js`: ใช้ `instanceof BrowserAutomationError` สำหรับ type-safe error logging
- สามารถ catch แบบ `err instanceof BrowserAutomationError && err.step === 'STEP_5'`

---

#### [x] 5. สร้าง Utils สำหรับ File I/O (DRY) -- DONE
**Priority:** 🟡 Medium
**ปัญหา:** Pattern `loadJSON/saveJSON` ซ้ำกว่า 10 จุด
**ไฟล์:** `Utils/fileUtils.js` (new), `Task/CapacityTracker.js`, `Task/wordQuotaTracker.js`, `Dashboard/server.js`

**ผลลัพธ์:**
- สร้าง `Utils/fileUtils.js` มี 5 functions: `loadJSON`, `saveJSON`, `saveJSONAtomic`, `withFileLock`, `loadJSONWithLock`
- `loadJSON`: synchronous, returns defaultValue on ENOENT, warns on other errors (EACCES, SyntaxError)
- `saveJSON`: synchronous, auto-creates parent directories
- `saveJSONAtomic`: write .tmp + rename pattern, Windows EPERM fallback
- `withFileLock`: async, ใช้ `proper-lockfile` with stale=10s, retries=5
- Refactored `CapacityTracker.js` + `wordQuotaTracker.js` ใช้ fileUtils แทน inline read/write

---

### 1.2 Observability & Monitoring

#### [ ] 6. เพิ่ม Health Check + Alerting สำหรับ IMAP
**Priority:** 🔴 High
**ปัญหา:** IMAP connection degraded แต่ไม่มีการแจ้งเตือน
**ไฟล์:** `IMAP/imapClient.js`, `Logs/notifier.js`

**แนวทางแก้:**
- เพิ่ม heartbeat check (NOOP command ทุก 2 นาที)
- Track connection state transitions
- Alert ผ่าน Google Chat เมื่อ reconnect เกิน 3 ครั้ง/10 นาที

```javascript
class IMAPHealthMonitor {
  constructor(imapClient, notifier) {
    this.client = imapClient;
    this.notifier = notifier;
    this.reconnectCount = 0;
    this.lastReconnect = null;
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.client.noop(); // Keep-alive
      } catch (err) {
        logger.error('IMAP heartbeat failed', err);
        await this.notifier.alert('IMAP connection unhealthy');
      }
    }, 2 * 60 * 1000);
  }

  onReconnect() {
    const now = Date.now();
    if (this.lastReconnect && now - this.lastReconnect < 10 * 60 * 1000) {
      this.reconnectCount++;
      if (this.reconnectCount >= 3) {
        this.notifier.alert('IMAP unstable: 3+ reconnects in 10 min');
      }
    } else {
      this.reconnectCount = 1;
    }
    this.lastReconnect = now;
  }
}
```

---

#### [ ] 7. เพิ่ม Metrics Collection + Dashboard
**Priority:** 🔴 High
**ปัญหา:** ไม่มี observability — debug ยาก ไม่รู้ bottleneck
**ไฟล์:** `Metrics/metricsCollector.js` (new), `Dashboard/server.js`

**แนวทางแก้:**
- Track metrics: task queue length, browser pool utilization, accept/reject ratio
- Expose `/api/metrics` endpoint
- แสดงกราฟใน dashboard (Chart.js)

```javascript
// Metrics/metricsCollector.js
class MetricsCollector {
  constructor() {
    this.metrics = {
      tasksAccepted: 0,
      tasksRejected: 0,
      tasksQueued: 0,
      browserPoolActive: 0,
      avgProcessingTime: 0,
      errors: { byType: {} }
    };
  }

  recordTaskAccepted() { this.metrics.tasksAccepted++; }
  recordTaskRejected(reason) {
    this.metrics.tasksRejected++;
    this.metrics.errors.byType[reason] = (this.metrics.errors.byType[reason] || 0) + 1;
  }

  getSnapshot() { return { ...this.metrics, timestamp: Date.now() }; }
}

// Dashboard endpoint
app.get('/api/metrics', (req, res) => {
  res.json(metricsCollector.getSnapshot());
});
```

---

#### [ ] 8. เขียน Integration Tests สำหรับ Exec/execAccept.js
**Priority:** 🔴 High
**ปัญหา:** Coverage 24%, core automation 450 lines ไม่มี tests
**ไฟล์:** `__tests__/integration/execAccept.test.js` (new)

**แนวทางแก้:**
- ใช้ mock Puppeteer browser
- Test แต่ละ step (STEP_1 ถึง STEP_6)
- Test error scenarios (element not found, timeout)

```javascript
// __tests__/integration/execAccept.test.js
const { executeAcceptWorkflow } = require('../../Exec/execAccept');

describe('execAccept Integration', () => {
  let mockBrowser, mockPage;

  beforeEach(() => {
    mockPage = {
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      click: jest.fn(),
      close: jest.fn()
    };
    mockBrowser = { newPage: jest.fn().mockResolvedValue(mockPage) };
  });

  test('STEP 1: should click Change Status button', async () => {
    await executeAcceptWorkflow(mockBrowser, { url: 'https://example.com' });
    expect(mockPage.waitForSelector).toHaveBeenCalledWith('#taskActionConfirm');
    expect(mockPage.click).toHaveBeenCalledWith('#taskActionConfirm');
  });

  test('should handle dynamic Select2 dropdown IDs', async () => {
    // Test for STEP_5 dropdown issue
  });
});
```

---

### 1.3 Code Quality

#### [x] 9. Refactor ฟังก์ชันยาว (>100 lines) ✅ DONE
**Priority:** 🟡 Medium
**ปัญหา:** `step2to6_Workflow()` 146 lines, `fetchNewEmails()` 170 lines
**ไฟล์:** `Exec/execAccept.js`, `IMAP/fetcher.js`

**ผลลัพธ์:**
- `execAccept.js`: แยก step2to6_Workflow เป็น 5 sub-functions + 2 helpers (waitAndClick, selectDropdownOption)
- `fetcher.js`: แยก fetchNewEmails เป็น 9 sub-functions (searchNewEmailUids, parseEmailMessage, etc.)
- Magic numbers ทั้งหมดใช้ named constants
- ผ่าน senior-dev review + code-reviewer

---

#### [x] 10. สร้าง Config/constants.js สำหรับ Magic Numbers ✅ DONE
**Priority:** 🔵 Low
**ปัญหา:** Timeout, retry count, threshold กระจายอยู่คนละไฟล์
**ไฟล์:** `Config/constants.js` (new)

**ผลลัพธ์:**
- สร้าง `Config/constants.js` รวม 32+ constants ใน 8 หมวด (TIMEOUTS, RETRIES, CAPACITY, WORKING_HOURS, ALERTS, EXIT_CODES, BROWSER_POOL, REPORT_SCHEDULE)
- อัพเดท 10 ไฟล์ให้ใช้ constants จากส่วนกลาง
- เพิ่ม WORD_QUOTA_RESET_HOUR สำหรับ wordQuotaTracker

---

#### [x] 11. เพิ่ม Unit Tests สำหรับ Task/isBusinessDay.js ✅ DONE
**Priority:** 🟡 Medium
**ปัญหา:** Coverage 70%, holiday edge cases ไม่ครอบคลุม
**ไฟล์:** `__tests__/Task/isBusinessDay.test.js`

**ผลลัพธ์:**
- 23 → 62 tests, **100% coverage** (statements, branches, functions, lines)
- เพิ่ม: Year Boundary, Leap Year, Invalid Input, Config Integration, Helper Functions, Consecutive Holidays, Date Formats, Month Boundaries
- แก้ setTimeout test ให้ใช้ done callback pattern ถูกต้อง

---

#### [x] 12. เขียน Tests สำหรับ Dashboard API ✅ DONE
**Priority:** 🟡 Medium
**ปัญหา:** Coverage 0%, API + WebSocket ไม่มี tests
**ไฟล์:** `__tests__/Dashboard/server.test.js`, `__tests__/Dashboard/server.websocket.test.js` (new)

**ผลลัพธ์:**
- สร้าง HTTP API tests (24 cases) + WebSocket tests (15 cases) ด้วย supertest + ws
- เพิ่ม NODE_ENV guard ใน server.js, export app สำหรับ testing
- เปลี่ยน bodyParser เป็น express.json() (built-in)
- Integration tests ยัง skip อยู่เนื่องจาก fs mock + express.static conflict (TODO)
- ย้าย requires ขึ้นด้านบนไฟล์ server.js ตาม senior-dev review

---

## 🚀 Phase 2: Medium Term (3-6 เดือน)

### 2.1 Architecture Improvements

#### [ ] 13. แยก main.js ออกเป็น Event Bus + Command Pattern
**Priority:** 🔴 High
**ปัญหา:** God Object 400+ lines, 30+ imports
**ไฟล์:** `main.js`, `Core/eventBus.js` (new), `Core/commandHandler.js` (new)

**แนวทางแก้:**
- ใช้ EventEmitter สำหรับ inter-module communication
- แยก initialization logic ออกเป็น bootstrapper
- ใช้ Command Pattern สำหรับ task operations

```javascript
// Core/eventBus.js
const EventEmitter = require('events');
class SystemEventBus extends EventEmitter {
  // Typed events
  emitTaskReceived(task) { this.emit('task:received', task); }
  emitTaskAccepted(task) { this.emit('task:accepted', task); }
  emitTaskRejected(task, reason) { this.emit('task:rejected', task, reason); }
}

// main.js (simplified)
const eventBus = new SystemEventBus();
const imapModule = new IMAPModule(eventBus);
const taskQueue = new TaskQueue(eventBus);
const browserPool = new BrowserPool(eventBus);

eventBus.on('task:received', task => taskQueue.enqueue(task));
eventBus.on('task:accepted', task => sheetWriter.logAccepted(task));
```

---

#### [ ] 14. สร้าง Persistent Task Queue (Redis/SQLite)
**Priority:** 🔴 High
**ปัญหา:** In-memory queue → process crash = tasks หาย
**ไฟล์:** `Task/taskQueue.js`, `Task/persistentQueue.js` (new)

**แนวทางแก้:**
- ใช้ SQLite สำหรับ local persistence
- หรือ Redis สำหรับ distributed setup
- เพิ่ม task state tracking (pending/processing/completed/failed)

```javascript
// Task/persistentQueue.js (SQLite approach)
const Database = require('better-sqlite3');

class PersistentTaskQueue {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        task_data TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER,
        updated_at INTEGER
      )
    `);
  }

  enqueue(task) {
    const stmt = this.db.prepare('INSERT INTO tasks (task_data, created_at) VALUES (?, ?)');
    stmt.run(JSON.stringify(task), Date.now());
  }

  dequeue() {
    return this.db.transaction(() => {
      const task = this.db.prepare('SELECT * FROM tasks WHERE status = "pending" LIMIT 1').get();
      if (task) {
        this.db.prepare('UPDATE tasks SET status = "processing" WHERE id = ?').run(task.id);
        return { ...task, task_data: JSON.parse(task.task_data) };
      }
    })();
  }

  markCompleted(taskId) {
    this.db.prepare('UPDATE tasks SET status = "completed", updated_at = ? WHERE id = ?')
      .run(Date.now(), taskId);
  }
}
```

---

#### [ ] 15. สร้าง State Manager (Single Source of Truth)
**Priority:** 🔴 High
**ปัญหา:** State กระจาย 4 ที่ (Memory, JSON files, Sheets, WebSocket)
**ไฟล์:** `State/stateManager.js` (new)

**แนวทางแก้:**
- Centralized state with pub-sub pattern
- Sync เฉพาะจาก state manager → external (Sheets, WebSocket)
- Read-only access สำหรับ modules

```javascript
// State/stateManager.js
class StateManager extends EventEmitter {
  constructor() {
    super();
    this.state = {
      capacity: new Map(),
      tasks: new Map(),
      browserPool: { active: 0, total: 0 },
      imapStatus: 'disconnected'
    };
  }

  updateCapacity(date, wordCount) {
    this.state.capacity.set(date, wordCount);
    this.emit('state:capacity:changed', { date, wordCount });
  }

  getCapacity(date) {
    return this.state.capacity.get(date) || 0;
  }

  // Snapshot for persistence
  serialize() { return JSON.stringify(Array.from(this.state.capacity)); }
  deserialize(json) { this.state.capacity = new Map(JSON.parse(json)); }
}

// Sync to Google Sheets (listener)
stateManager.on('state:capacity:changed', async ({ date, wordCount }) => {
  await sheetWriter.updateCapacity(date, wordCount);
});

// Sync to WebSocket
stateManager.on('state:capacity:changed', ({ date, wordCount }) => {
  io.emit('capacityUpdated', { date, wordCount });
});
```

---

#### [ ] 16. เพิ่ม Circuit Breaker สำหรับ Google Sheets API
**Priority:** 🔴 High
**ปัญหา:** Peak load → quota exhaustion, ไม่มี rate limit
**ไฟล์:** `Utils/circuitBreaker.js` (new), `Sheets/sheetWriter.js`

**แนวทางแก้:**
- ใช้ `opossum` library หรือเขียนเอง
- เพิ่ม retry with exponential backoff
- Fallback เก็บ pending writes ใน queue

```javascript
// Utils/circuitBreaker.js
const CircuitBreaker = require('opossum');

function createSheetCircuitBreaker(sheetFunction) {
  const options = {
    timeout: 10000,           // 10s timeout
    errorThresholdPercentage: 50,
    resetTimeout: 30000,      // 30s before retry
    volumeThreshold: 5        // Min requests before trip
  };

  const breaker = new CircuitBreaker(sheetFunction, options);

  breaker.on('open', () => logger.warn('Circuit breaker OPEN - Sheets API unavailable'));
  breaker.on('halfOpen', () => logger.info('Circuit breaker HALF_OPEN - Testing recovery'));
  breaker.on('close', () => logger.info('Circuit breaker CLOSED - Sheets API recovered'));

  return breaker;
}

// Usage
const writeToSheet = createSheetCircuitBreaker(async (data) => {
  await sheets.spreadsheets.values.append({ /* ... */ });
});

try {
  await writeToSheet(taskData);
} catch (err) {
  if (err.code === 'EOPENBREAKER') {
    // Fallback: queue for later
    pendingWrites.push(taskData);
  }
}
```

---

#### [ ] 17. สร้าง Browser Pool Health Check
**Priority:** 🟡 Medium
**ปัญหा:** ไม่มี health check — orphaned pages ไม่มีใครตรวจจับ
**ไฟล์:** `BrowserPool/browserPool.js`, `BrowserPool/healthMonitor.js` (new)

**แนวทางแก้:**
- Periodic check (ทุก 5 นาที) — page count, memory usage
- Auto-restart browser ถ้า memory > threshold
- Report metrics ผ่าน metrics collector

```javascript
class BrowserHealthMonitor {
  constructor(browserPool, metricsCollector) {
    this.pool = browserPool;
    this.metrics = metricsCollector;
  }

  async startMonitoring() {
    setInterval(async () => {
      for (const [slotId, browser] of this.pool.browsers.entries()) {
        const pages = await browser.pages();
        const metrics = await this.getProcessMetrics(browser);

        if (pages.length > 20 || metrics.memoryMB > 500) {
          logger.warn(`Browser ${slotId} unhealthy: ${pages.length} pages, ${metrics.memoryMB}MB`);
          await this.pool.recycleBrowser(slotId);
        }
      }
    }, 5 * 60 * 1000);
  }

  async getProcessMetrics(browser) {
    const metrics = await browser.pages()[0].metrics();
    return { memoryMB: metrics.JSHeapUsedSize / 1024 / 1024 };
  }
}
```

---

### 2.2 Feature Enhancements

#### [ ] 18. Smart Capacity Learning
**Priority:** 🟡 Medium
**ปัญหา:** Capacity เป็น manual setting ไม่ปรับตามประสิทธิภาพจริง
**ไฟล์:** `Features/capacityLearner.js` (new)

**แนวทางแก้:**
- วิเคราะห์ข้อมูลย้อนหลัง 30 วัน (accepted tasks vs. actual capacity used)
- แนะนำ optimal capacity ต่อวัน
- Display ใน dashboard เป็น suggestion

```javascript
// Features/capacityLearner.js
class CapacityLearner {
  async analyzePastPerformance(days = 30) {
    const history = await this.fetchTaskHistory(days);

    const dailyStats = history.reduce((acc, task) => {
      const date = task.acceptedDate;
      if (!acc[date]) acc[date] = { allocated: 0, used: 0 };
      acc[date].allocated = task.capacityAllocated;
      acc[date].used += task.wordCount;
      return acc;
    }, {});

    const suggestions = {};
    for (const [date, stats] of Object.entries(dailyStats)) {
      const utilizationRate = stats.used / stats.allocated;
      if (utilizationRate > 0.9) {
        suggestions[date] = Math.ceil(stats.allocated * 1.2); // +20%
      } else if (utilizationRate < 0.5) {
        suggestions[date] = Math.ceil(stats.allocated * 0.8); // -20%
      }
    }

    return suggestions;
  }
}
```

---

#### [ ] 19. Post-Acceptance Verification
**Priority:** 🟡 Medium
**ปัญหา:** Accept แล้วไม่รู้ว่าสำเร็จจริงหรือไม่
**ไฟล์:** `Features/postAcceptVerifier.js` (new)

**แนวทางแก้:**
- หลัง Accept รอ 30 วินาที แล้ว verify status ใน Moravia
- ถ้าไม่สำเร็จ → auto-rollback capacity + alert
- Log verification result ใน Sheets

```javascript
async function verifyAcceptance(taskUrl, orderId) {
  await sleep(30000); // Wait 30s for system update

  const page = await browser.newPage();
  await page.goto(taskUrl);

  const status = await page.$eval('#taskStatus', el => el.textContent);

  if (status !== 'Accepted') {
    logger.error(`Verification failed for ${orderId}: status = ${status}`);
    await rollbackCapacity(orderId);
    await notifier.alert(`Task ${orderId} acceptance failed - rolled back`);
    return false;
  }

  return true;
}
```

---

#### [ ] 20. Dynamic Working Hours
**Priority:** 🟡 Medium
**ปัญหา:** Working hours ตายตัว ไม่ปรับตาม holiday/OT
**ไฟล์:** `Task/workingHoursManager.js` (new), `Config/holidays.json`

**แนวทางแก้:**
- อ่าน holiday calendar จาก `Config/holidays.json`
- รองรับ OT schedule (override working hours สำหรับวันที่กำหนด)
- API endpoint สำหรับจัดการ `/api/working-hours`

```javascript
// Task/workingHoursManager.js
class WorkingHoursManager {
  constructor() {
    this.holidays = require('../Config/holidays.json');
    this.overtimeSchedule = {}; // { '2026-01-30': { start: 8, end: 21 } }
  }

  getWorkingHours(date) {
    const dateStr = date.toISOString().split('T')[0];

    // Check OT override
    if (this.overtimeSchedule[dateStr]) {
      return this.overtimeSchedule[dateStr];
    }

    // Check holiday
    if (this.holidays.includes(dateStr)) {
      return null; // No working hours
    }

    // Default
    return { start: 10, end: 19 };
  }

  setOvertimeSchedule(date, hours) {
    this.overtimeSchedule[date] = hours;
  }
}
```

---

#### [ ] 21. Multi-Language Email Parser
**Priority:** 🔵 Low
**ปัญหา:** Parser ตรงกับ template ภาษาอังกฤษเท่านั้น
**ไฟล์:** `IMAP/linkParser.js`, `IMAP/i18nParser.js` (new)

**แนวทางแก้:**
- รองรับ regex patterns หลายภาษา (TH, JP, DE, etc.)
- Auto-detect language จาก email headers
- Fallback เป็น English parser

---

#### [ ] 22. Real-time Status Sync จาก Moravia
**Priority:** 🟡 Medium
**ปัญหา:** ต้อง query Sheet เพื่อดู status — ไม่ real-time
**ไฟล์:** `Features/moraviaStatusSync.js` (new)

**แนวทางแก้:**
- ถ้า Moravia มี webhook → รับ event ตรง
- ถ้าไม่มี → polling ทุก 5 นาที
- Update dashboard WebSocket real-time

---

## 🌟 Phase 3: Long Term (6-12 เดือน)

### 3.1 Advanced Architecture

#### [ ] 23. Microservices Architecture
**Priority:** 🟡 Medium
**ปัญหา:** Monolith ไม่ scale — ทุกอย่างอยู่ใน process เดียว
**ไฟล์:** สร้าง services แยก: `imap-service/`, `task-processor/`, `browser-pool-service/`

**แนวทางแก้:**
- แยกเป็น 3-4 services:
  - IMAP Listener Service (standalone)
  - Task Queue Processor (scalable workers)
  - Browser Pool Service (dedicated resource management)
  - Dashboard API Service
- ใช้ message queue (RabbitMQ/Redis Pub-Sub) สำหรับ inter-service communication
- Docker Compose สำหรับ local development

---

#### [ ] 24. Distributed Task Queue (Bull/BullMQ)
**Priority:** 🟡 Medium
**ปัญหา:** ต้องการ horizontal scaling — SQLite queue ไม่รองรับ
**ไฟล์:** ย้ายจาก `Task/taskQueue.js` → BullMQ

**แนวทางแก้:**
- ใช้ BullMQ (Redis-backed queue)
- Support delayed jobs, priority, retries
- Scale workers independently

```javascript
const { Queue, Worker } = require('bullmq');

const taskQueue = new Queue('auto-rws-tasks', { connection: redisConnection });

// Producer
await taskQueue.add('accept-task', { taskData }, { priority: urgent ? 1 : 5 });

// Worker (can run on different machines)
const worker = new Worker('auto-rws-tasks', async job => {
  await executeTaskAcceptance(job.data.taskData);
}, { connection: redisConnection, concurrency: 4 });
```

---

#### [ ] 25. Full Test Coverage (>80%)
**Priority:** 🔴 High
**ปัญหา:** Coverage ต่ำ — main.js 0%, imapClient 20%, execAccept 24%
**ไฟล์:** `__tests__/*`

**แนวทางแก้:**
- เขียน tests ครบทุก module
- ใช้ test coverage gate ใน CI/CD (fail if <80%)
- E2E tests ด้วย Playwright

---

#### [ ] 26. Kubernetes Deployment
**Priority:** 🔵 Low
**ปัญหา:** PM2 จำกัด — ไม่มี auto-scaling, load balancing
**ไฟล์:** `k8s/deployment.yaml` (new)

**แนวทางแก้:**
- สร้าง Helm chart สำหรับ deployment
- HPA (Horizontal Pod Autoscaler) สำหรับ task workers
- Persistent volumes สำหรับ SQLite/logs

---

### 3.2 Business Logic

#### [ ] 27. Machine Learning Deadline Prediction
**Priority:** 🔵 Low
**ปัญหา:** Urgent threshold (6 hours) เป็น hard-coded
**ไฟล์:** `ML/deadlinePredictor.js` (new)

**แนวทางแก้:**
- Train model จาก historical data (deadline vs. actual completion time)
- Predict optimal acceptance window
- Dynamic urgent threshold ต่อ task type

---

#### [ ] 28. Advanced Capacity Optimization
**Priority:** 🟡 Medium
**ปัญหา:** Capacity allocation ไม่คำนึงถึง task complexity
**ไฟล์:** `Features/capacityOptimizer.js` (new)

**แนวทางแก้:**
- Weighted capacity (technical docs = 0.8x, marketing = 1.2x)
- Multi-dimensional capacity (words, hours, difficulty)
- Linear programming สำหรับ optimal allocation

---

#### [ ] 29. Multi-Tenant Support
**Priority:** 🟡 Medium
**ปัญหา:** รองรับ 1 account เท่านั้น
**ไฟล์:** `Core/tenantManager.js` (new)

**แนวทางแก้:**
- Database schema รองรับ tenant_id
- Isolated browser profiles per tenant
- Dashboard filters by tenant

---

#### [ ] 30. Audit Log + Compliance
**Priority:** 🟡 Medium
**ปัญหา:** ไม่มี audit trail — ไม่รู้ว่าใครทำอะไรเมื่อไร
**ไฟล์:** `Audit/auditLogger.js` (new)

**แนวทางแก้:**
- Log ทุก action (accept, reject, capacity change, config update)
- Immutable log (append-only)
- Searchable dashboard สำหรับ audit queries
- Export to CSV สำหรับ compliance reports

```javascript
// Audit/auditLogger.js
class AuditLogger {
  async logAction(action, user, details) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,       // 'TASK_ACCEPTED', 'CAPACITY_CHANGED', etc.
      user,         // 'system' or actual user ID
      details,      // { orderId, wordCount, ... }
      ip: req.ip
    };

    await db.auditLog.insert(entry);
  }

  async queryLogs(filters) {
    return db.auditLog.find(filters).sort({ timestamp: -1 }).limit(100);
  }
}

// Usage
await auditLogger.logAction('TASK_ACCEPTED', 'system', { orderId: '12345', wordCount: 500 });
await auditLogger.logAction('CAPACITY_OVERRIDE', req.user, { date: '2026-01-30', newValue: 8000 });
```

---

## 📋 Implementation Checklist

### Phase 1 Readiness Criteria
- [x] Zero critical race conditions (capacity.json, concurrent writes) -- Task 1
- [ ] Dashboard authentication implemented -- Task 2
- [x] Browser memory leaks fixed -- Task 3
- [ ] Test coverage >50% for critical paths (execAccept, taskAcceptance) -- Task 8
- [ ] Health monitoring + alerting operational -- Tasks 6, 7

### Phase 2 Readiness Criteria
- [ ] State management centralized
- [ ] Persistent task queue implemented
- [ ] Google Sheets circuit breaker active
- [ ] Event Bus architecture refactored
- [ ] At least 2 new features deployed (Smart Capacity / Post-Acceptance Verification)

### Phase 3 Readiness Criteria
- [ ] Test coverage >80%
- [ ] Microservices decomposition complete
- [ ] Production deployment automation (K8s or equivalent)
- [ ] Audit logging compliance-ready

---

## 🎯 Priority Legend

- 🔴 **High:** Critical stability/security issues หรือ high-impact features
- 🟡 **Medium:** Important improvements ที่ส่งผลต่อ maintainability/performance
- 🔵 **Low:** Nice-to-have features หรือ long-term optimizations

---

## 📊 Progress Tracking

| Phase | Started | Completed | Progress |
|-------|---------|-----------|----------|
| Phase 1: Quick Wins | 2026-01-28 | - | 8/12 (Section 1.1 tasks 1,3,4,5 + Section 1.3 done) |
| Phase 2: Medium Term | - | - | 0/10 |
| Phase 3: Long Term | - | - | 0/8 |

**Last Updated:** 2026-01-28
**Section 1.1 Completed (partial):** 2026-01-28 (Tasks 1, 3, 4, 5 -- reviewed and approved by senior-dev)
**Section 1.3 Completed:** 2026-01-28 (Tasks 9-12, reviewed by code-reviewer + senior-dev)
**Remaining Section 1.1:** Task 2 (Dashboard Auth), remaining Section 1.2: Tasks 6, 7, 8
**Next Review:** 2026-02-28

---

## 🔗 Related Documents

- [CLAUDE.md](../CLAUDE.md) - Project overview and architecture
- [STORIES.md](../STORIES.md) - User stories and requirements
- [Test Coverage Report](../coverage/lcov-report/index.html)

---

## 📝 Notes

1. **Dependencies:** แต่ละ task อาจมี dependencies กับ tasks อื่น — ควรทำตามลำดับ phase
2. **Breaking Changes:** Tasks ที่มี 🔴 High priority มักจะ breaking — ต้อง plan deployment
3. **Resource Estimation:** Phase 1 = ~120 hours, Phase 2 = ~200 hours, Phase 3 = ~300 hours

---

**Created by:** Architecture + System + Feature + Test + Refactor Agents
**Maintained by:** Development Team
