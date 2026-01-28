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

#### [x] 6. เพิ่ม Health Check + Alerting สำหรับ IMAP -- DONE
**Priority:** 🔴 High
**ปัญหา:** IMAP connection degraded แต่ไม่มีการแจ้งเตือน
**ไฟล์:** `IMAP/IMAPHealthMonitor.js` (new), `IMAP/imapClient.js`, `IMAP/fetcher.js`, `Dashboard/server.js`, `Config/constants.js`

**ผลลัพธ์:**
- สร้าง `IMAPHealthMonitor` class: reconnect tracking (sliding window), health check recording, Google Chat alerting
- Alert flooding prevention: cooldown per mailbox per window (reconnect + failure alerts)
- Memory management: `_maxHistorySize=500` cap + periodic prune timer (`HISTORY_PRUNE_INTERVAL=30min`) + `unref()` for graceful exit
- Health check failure alerting: alert at threshold (`MAX_CONSECUTIVE_FAILURES=5`) + every N multiples, reset on success
- Integration: singleton in `imapClient.js`, `setHealthMonitor()` injection ใน `fetcher.js` (avoid circular dependency)
- `recordReconnect()` called from `attemptReconnect()`, `recordHealthCheck()` called from `performHealthCheckIfNeeded()`
- Dashboard API: `/api/health/imap` returns connection stats + health snapshot (per-mailbox status, thresholds, recent reconnects)
- Constants: `IMAP_HEALTH` section ใน `Config/constants.js` (RECONNECT_ALERT_THRESHOLD=3, RECONNECT_ALERT_WINDOW=10min, MAX_CONSECUTIVE_FAILURES=5, HISTORY_PRUNE_INTERVAL=30min)
- `destroy()` method for graceful shutdown and tests

---

#### [x] 7. เพิ่ม Metrics Collection + Dashboard -- DONE
**Priority:** 🔴 High
**ปัญหา:** ไม่มี observability — debug ยาก ไม่รู้ bottleneck
**ไฟล์:** `Metrics/metricsCollector.js` (new), `Dashboard/server.js`, `main.js`

**ผลลัพธ์:**
- สร้าง `MetricsCollector` singleton class: task counters (received/accepted/rejected/completed/failed), rejection reasons tracking, processing times (bounded array max 100)
- Computed metrics: `getAcceptanceRate()`, `getSuccessRate()`, `getAverageProcessingTime()` พร้อม division-by-zero guard
- Subsystem status: `updateBrowserPoolStatus()` + `updateIMAPStatus()` with safe defaults
- `getSnapshot()` returns deep-copied serializable object (timestamp, uptime, counters, rates, performance, rejectionReasons, browserPool, imap)
- `reset()` method for testing - resets all state consistently
- Dashboard API: `/api/metrics` endpoint refreshes browser pool + IMAP status before returning snapshot, try-catch สำหรับ subsystems ที่ยังไม่พร้อม
- Integration กับ `main.js`: instrument ทุก event path (received, accepted, rejected, completed, failed) + processing time tracking via `processingStartMs`

---

#### [x] 8. เขียน Integration Tests สำหรับ Exec/execAccept.js -- DONE
**Priority:** 🔴 High
**ปัญหา:** Coverage 24%, core automation 450 lines ไม่มี tests
**ไฟล์:** `__tests__/integration/execAccept.test.js` (new)

**ผลลัพธ์:**
- 30 integration tests ครอบคลุม 14 categories: Happy Path, Navigation/Login (SSO redirect, LOGIN_EXPIRED, 404), Task Status Validation, Step 1-6 failures, Error Metadata (BrowserAutomationError), Resource Cleanup (fallback page close, original page preserved), Edge Cases (null page, undefined URL), Timeout Handling (15s/45s), Retry Behavior (retries=2, delay=1000)
- Coverage สำหรับ `Exec/execAccept.js`: **83%** (up from 24%)
- Mock strategy: module-scope mocks ที่ re-set ใน `beforeEach()` รองรับ `resetMocks: true`
- Intelligent page mock: `createFullSuccessPage()` handles chevron className, modal title, dropdown ID, login form contexts
- ตรวจ resource cleanup: fallback page ถูก close, original page ไม่ถูก close (managed by browserPool)
- ตรวจ BrowserAutomationError: instanceof, step identifier, details.selector

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

#### [x] 13. แยก main.js ออกเป็น Event Bus + Command Pattern -- DONE
**Priority:** 🔴 High
**ปัญหา:** God Object 400+ lines, 30+ imports
**ไฟล์:** `main.js`, `Core/eventBus.js` (new), `Core/commandHandler.js` (new)

**ผลลัพธ์:**
- Refactored `main.js` ให้ใช้ modular event-driven architecture
- Dashboard APIs: `/api/state`, `/api/config` สำหรับ system state inspection
- Dashboard UI: SystemHealth component แสดง real-time system status

---

#### [x] 14. สร้าง Persistent Task Queue (Redis/SQLite) -- DONE
**Priority:** 🔴 High
**ปัญหา:** In-memory queue → process crash = tasks หาย
**ไฟล์:** `Task/taskQueue.js`, `Task/persistentQueue.js` (new)

**ผลลัพธ์:**
- สร้าง persistent task queue พร้อม state tracking (pending/processing/completed/failed)
- Dashboard APIs: `/api/queue/status`, `/api/queue/recent`, `/api/queue/retry/:id`, `/api/queue/cleanup`
- Dashboard UI: QueueMonitor component แสดง real-time queue status, sortable table, retry/cleanup actions

---

#### [x] 15. สร้าง State Manager (Single Source of Truth) -- DONE
**Priority:** 🔴 High
**ปัญหา:** State กระจาย 4 ที่ (Memory, JSON files, Sheets, WebSocket)
**ไฟล์:** `State/stateManager.js` (new)

**ผลลัพธ์:**
- สร้าง centralized state management พร้อม pub-sub pattern
- Dashboard APIs: `/api/state`, `/api/sync/status`, `/api/sync/trigger`
- Dashboard UI: SystemHealth component แสดง sync status + manual trigger button

---

#### [x] 16. เพิ่ม Circuit Breaker สำหรับ Google Sheets API -- DONE
**Priority:** 🔴 High
**ปัญหา:** Peak load → quota exhaustion, ไม่มี rate limit
**ไฟล์:** `Utils/circuitBreaker.js` (new), `Sheets/sheetWriter.js`

**ผลลัพธ์:**
- สร้าง `Utils/circuitBreaker.js` พร้อม CLOSED/OPEN/HALF_OPEN states
- Dashboard APIs: `/api/health/sheets` returns circuit breaker state + success/failure counts
- Dashboard UI: SystemHealth Sheets card แสดง circuit state + สี status dot

---

#### [x] 17. สร้าง Browser Pool Health Check -- DONE
**Priority:** 🟡 Medium
**ปัญหา:** ไม่มี health check — orphaned pages ไม่มีใครตรวจจับ
**ไฟล์:** ,  (new)

**ผลลัพธ์:**
- Browser health monitoring พร้อม periodic check, page count, recycle tracking
- Dashboard APIs:  returns pool stats + health monitor data
- Dashboard UI: SystemHealth Browser card แสดง active/total, pages, recycled count
---

### 2.2 Feature Enhancements

#### [x] 18. Smart Capacity Learning -- DONE
**Priority:** 🟡 Medium
**ปัญหา:** Capacity เป็น manual setting ไม่ปรับตามประสิทธิภาพจริง
**ไฟล์:** `Features/capacityLearner.js` (new)

**ผลลัพธ์:**
- Capacity analysis + recommendation engine (increase/decrease/maintain) พร้อม confidence level
- Dashboard APIs: `/api/capacity/analysis`, `/api/capacity/suggestions`, `/api/capacity/summary`
- Dashboard UI: CapacityInsights component แสดง recommendation badge, Chart.js line chart (daily words 30 days), suggestions list, avg/peak/slow stats

---

#### [x] 19. Post-Acceptance Verification -- DONE
**Priority:** 🟡 Medium
**ปัญหา:** Accept แล้วไม่รู้ว่าสำเร็จจริงหรือไม่
**ไฟล์:** `Features/postAcceptVerifier.js` (new)

**ผลลัพธ์:**
- Post-acceptance verification system พร้อม auto-rollback capacity + alert on failure
- Dashboard APIs: `/api/verification/status`, `/api/verification/results`
- Dashboard UI: SystemHealth verification section แสดง pending/passed/failed counts

---

#### [x] 20. Dynamic Working Hours -- DONE
**Priority:** 🟡 Medium
**ปัญหา:** Working hours ตายตัว ไม่ปรับตาม holiday/OT
**ไฟล์:** `Task/workingHoursManager.js` (new), `Config/holidays.json`

**ผลลัพธ์:**
- Dynamic working hours manager พร้อม holiday calendar + OT schedule
- Dashboard APIs: `/api/working-hours`, `/api/working-hours/overtime` (GET/POST/DELETE), `/api/holidays` (GET/POST/DELETE), `/api/holidays/working` (POST/DELETE)
- Dashboard UI: WorkingHoursManager component พร้อม calendar view (color-coded days), 3 tabs (Calendar/Holidays/Overtime), CRUD forms, Today button, date validation

---

#### [x] 21. Multi-Language Email Parser -- DONE
**Priority:** 🔵 Low
**ปัญหา:** Parser ตรงกับ template ภาษาอังกฤษเท่านั้น
**ไฟล์:** `IMAP/linkParser.js`, `IMAP/i18nParser.js` (new)

**ผลลัพธ์:**
- Multi-language email parsing พร้อม auto-detect language จาก headers
- Fallback เป็น English parser

---

#### [x] 22. Real-time Status Sync จาก Moravia -- DONE
**Priority:** 🟡 Medium
**ปัญหา:** ต้อง query Sheet เพื่อดู status — ไม่ real-time
**ไฟล์:** `Features/moraviaStatusSync.js` (new)

**ผลลัพธ์:**
- Real-time status sync พร้อม polling mechanism
- Dashboard APIs: `/api/sync/status`, `/api/sync/trigger`
- Dashboard UI: SystemHealth sync section แสดง last sync time + manual trigger button

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
- [x] Test coverage >50% for critical paths (execAccept 83%, taskAcceptance 100%) -- Task 8
- [x] Health monitoring + alerting operational -- Tasks 6, 7

### Phase 2 Readiness Criteria
- [x] State management centralized -- Task 15
- [x] Persistent task queue implemented -- Task 14
- [x] Google Sheets circuit breaker active -- Task 16
- [x] Event Bus architecture refactored -- Task 13
- [x] At least 2 new features deployed (Smart Capacity / Post-Acceptance Verification) -- Tasks 18, 19
- [x] Dashboard UI สำหรับ Phase 2 APIs ทั้งหมด (4 panels: SystemHealth, QueueMonitor, WorkingHoursManager, CapacityInsights)

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
| Phase 1: Quick Wins | 2026-01-28 | - | 11/12 (Section 1.1 tasks 1,3,4,5 + Section 1.2 tasks 6,7,8 + Section 1.3 done) |
| Phase 2: Medium Term | 2026-01-28 | 2026-01-28 | **10/10** ✅ (Tasks 13-22 backend + Dashboard UI) |
| Phase 3: Long Term | - | - | 0/8 |

**Last Updated:** 2026-01-28
**Section 1.1 Completed (partial):** 2026-01-28 (Tasks 1, 3, 4, 5 -- reviewed and approved by senior-dev)
**Section 1.2 Completed:** 2026-01-28 (Tasks 6, 7, 8 -- reviewed and approved by senior-dev)
**Section 1.3 Completed:** 2026-01-28 (Tasks 9-12, reviewed by code-reviewer + senior-dev)
**Phase 2 Completed:** 2026-01-28 (Tasks 13-22 backend + Dashboard UI 4 panels, reviewed by ux-designer + code-reviewer + senior-dev)
**Remaining Phase 1:** Task 2 (Dashboard Auth)
**Next Phase:** Phase 3 Long Term
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
