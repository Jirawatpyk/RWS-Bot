# Sprint 1: Security & Stability

## Sprint Overview

| Attribute | Value |
|-----------|-------|
| **Duration** | 1 week |
| **Story Points** | 13 |
| **Estimated Hours** | 16-20 hrs |
| **Focus** | Critical security fixes and system stability |
| **Priority** | Critical |
| **Prerequisites** | None (First sprint) |

---

## Sprint Goal

แก้ไขปัญหาความปลอดภัยที่สำคัญและเพิ่มความเสถียรของระบบ เพื่อให้ระบบทำงานได้อย่างปลอดภัยและไม่มี race conditions

---

## Stories Summary

| ID | Story | Points | Hours | Priority | Dependencies |
|----|-------|--------|-------|----------|--------------|
| S1.1 | Remove Credentials from Repository | 2 | 2h | Critical | - |
| S1.2 | Add Input Validation for Email | 3 | 4h | Critical | - |
| S1.3 | Fix Race Condition in Browser Pool | 5 | 6h | Critical | - |
| S1.4 | Add Environment Variable Validation | 1 | 1h | Medium | - |
| S1.5 | Remove Dead Code and Backup Files | 2 | 2h | Low | - |

---

## S1.1: Remove Credentials from Repository

| Attribute | Value |
|-----------|-------|
| **Points** | 2 |
| **Hours** | 2h |
| **Priority** | Critical |
| **Status** | [ ] Not Started |

### Description
ตรวจสอบและลบ credentials ที่อาจถูก commit ไปใน repository

### Acceptance Criteria
- [ ] `.gitignore` ครอบคลุม `.env`, `credentials.json`, `token.json`
- [ ] ไม่มี credentials ใน git history (หรือได้รับการ revoke แล้ว)
- [ ] README มีรายการ environment variables ที่ต้องใช้
- [ ] Google Service Account keys ถูก revoke และสร้างใหม่

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | ตรวจสอบ .gitignore ว่าครอบคลุมไฟล์ sensitive | 15m | [ ] |
| 2 | ตรวจสอบ git history สำหรับ credentials | 30m | [ ] |
| 3 | Revoke Google Service Account keys ที่ expose | 30m | [ ] |
| 4 | สร้าง keys ใหม่และอัพเดท .env | 30m | [ ] |
| 5 | เพิ่ม "Environment Variables" section ใน README | 15m | [ ] |

### Files
- `.gitignore`
- `README.md`

### Testing
```bash
git log --all --full-history -- "*.env" "credentials.json"
git status --ignored
```

### Notes
- **URGENT**: ถ้าพบ credentials ใน history ต้อง revoke ทันที
- พิจารณาใช้ `git-secrets` หรือ `trufflehog` สำหรับ scan อนาคต

---

## S1.2: Add Input Validation for Email Parsing

| Attribute | Value |
|-----------|-------|
| **Points** | 3 |
| **Hours** | 4h |
| **Priority** | Critical |
| **Status** | [ ] Not Started |

### Description
เพิ่มการ validate ข้อมูลที่ parse จาก email ก่อนส่งเข้า Task Queue

### Acceptance Criteria
- [ ] `amountWords` ต้องเป็น positive finite number
- [ ] `plannedEndDate` ต้องเป็น valid date format
- [ ] `orderId` ต้องเป็น non-empty string
- [ ] Invalid emails ถูก log และ skip gracefully

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | สร้าง `validateTaskData()` function | 1h | [ ] |
| 2 | เพิ่ม validation ใน `fetchNewEmails()` | 1h | [ ] |
| 3 | เพิ่ม logging สำหรับ invalid data | 30m | [ ] |
| 4 | ทดสอบด้วย mock invalid emails | 1h | [ ] |
| 5 | Update documentation | 30m | [ ] |

### Files
- `IMAP/fetcher.js`

### Implementation

```javascript
// IMAP/fetcher.js - เพิ่ม function นี้

function validateTaskData({ orderId, amountWords, plannedEndDate }) {
  const errors = [];

  if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
    errors.push(`Invalid orderId: ${orderId}`);
  }

  if (!Number.isFinite(amountWords) || amountWords <= 0) {
    errors.push(`Invalid amountWords: ${amountWords}`);
  }

  if (!plannedEndDate || typeof plannedEndDate !== 'string') {
    errors.push(`Invalid plannedEndDate: ${plannedEndDate}`);
  }

  return { valid: errors.length === 0, errors };
}

// Usage in fetchNewEmails:
const validation = validateTaskData({ orderId, amountWords, plannedEndDate });
if (!validation.valid) {
  logFail(`Skipping invalid email: ${validation.errors.join(', ')}`);
  continue;
}
```

### Notes
- ควร log ทุก invalid email เพื่อ debug
- พิจารณาส่ง notification ถ้ามี invalid emails มากผิดปกติ

---

## S1.3: Fix Race Condition in Browser Pool

| Attribute | Value |
|-----------|-------|
| **Points** | 5 |
| **Hours** | 6h |
| **Priority** | Critical |
| **Status** | [ ] Not Started |

### Description
แก้ไข race condition ใน Browser Pool โดยใช้ Promise-based queue แทน polling loop

### Problem
```javascript
// ปัญหาปัจจุบัน: Polling loop อาจทำให้หลาย tasks ได้ browser เดียวกัน
while (this.availableBrowsers.length === 0) {
  await new Promise(resolve => setTimeout(resolve, 100)); // Race condition!
}
const browser = this.availableBrowsers.shift(); // อาจ shift พร้อมกัน
```

### Acceptance Criteria
- [ ] ใช้ Promise-based request queue
- [ ] มี locking mechanism (`isProcessingQueue`)
- [ ] รองรับ concurrent requests ถูกต้อง
- [ ] Timeout handling ทำงานถูกต้อง
- [ ] `releaseBrowser()` trigger queue processing

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | ศึกษาโค้ด `getBrowser()` ปัจจุบัน | 30m | [ ] |
| 2 | เพิ่ม `requestQueue` และ `isProcessingQueue` | 30m | [ ] |
| 3 | Refactor `getBrowser()` เป็น Promise-based | 2h | [ ] |
| 4 | Implement `processQueue()` with lock | 1h | [ ] |
| 5 | Update `releaseBrowser()` | 30m | [ ] |
| 6 | ทดสอบ concurrent requests | 1h | [ ] |
| 7 | ทดสอบ timeout scenarios | 30m | [ ] |

### Files
- `BrowserPool/browserPool.js`

### Key Changes

```javascript
class BrowserPool {
  constructor() {
    // ... existing code ...
    this.requestQueue = [];        // NEW: Queue for pending requests
    this.isProcessingQueue = false; // NEW: Lock flag
  }

  async getBrowser(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.requestQueue.findIndex(r => r.resolve === resolve);
        if (idx !== -1) this.requestQueue.splice(idx, 1);
        reject(new Error('Timeout waiting for browser'));
      }, timeout);

      this.requestQueue.push({ resolve, reject, timeoutId });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessingQueue) return; // Lock
    this.isProcessingQueue = true;

    try {
      while (this.requestQueue.length > 0 && this.availableBrowsers.length > 0) {
        const request = this.requestQueue.shift();
        const browser = this.availableBrowsers.shift();
        clearTimeout(request.timeoutId);
        this.busyBrowsers.add(browser);
        request.resolve(browser);
      }
    } finally {
      this.isProcessingQueue = false; // Unlock
    }
  }

  async releaseBrowser(browser) {
    // ... existing logic ...
    this.processQueue(); // Trigger queue after release
  }
}
```

### Testing
```javascript
// ทดสอบ concurrent access
const requests = [
  pool.getBrowser(5000),
  pool.getBrowser(5000),
  pool.getBrowser(5000),
  pool.getBrowser(5000)
];
const results = await Promise.allSettled(requests);
// First N should succeed, rest should timeout/wait
```

### Notes
- **สำคัญ**: ต้อง test ให้ละเอียดก่อน deploy
- Rollback plan: เก็บ backup ของ browserPool.js เดิม
- Monitor memory usage หลัง deploy

---

## S1.4: Add Environment Variable Validation

| Attribute | Value |
|-----------|-------|
| **Points** | 1 |
| **Hours** | 1h |
| **Priority** | Medium |
| **Status** | [ ] Not Started |

### Description
ตรวจสอบ environment variables ตอน startup

### Acceptance Criteria
- [ ] ตรวจสอบ required env vars ก่อน initialization
- [ ] แสดง error message ที่ชัดเจน
- [ ] Exit code 1 ถ้า config ไม่ครบ

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | สร้าง required env vars list | 15m | [ ] |
| 2 | เพิ่ม `validateEnvVars()` function | 30m | [ ] |
| 3 | เรียกใช้ใน main.js | 15m | [ ] |

### Files
- `main.js`

### Implementation

```javascript
// main.js - หลัง require('dotenv').config()

const requiredEnvVars = [
  'LOGIN_EMAIL', 'LOGIN_PASS',
  'EMAIL_USER', 'EMAIL_PASS',
  'SHEET_ID_MAIN', 'GOOGLE_CHAT_WEBHOOK'
];

const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error('ERROR: Missing environment variables:', missing.join(', '));
  process.exit(1);
}
```

---

## S1.5: Remove Dead Code and Backup Files

| Attribute | Value |
|-----------|-------|
| **Points** | 2 |
| **Hours** | 2h |
| **Priority** | Low |
| **Status** | [ ] Not Started |

### Description
ลบไฟล์ backup และ dead code ที่ไม่ได้ใช้งาน

### Acceptance Criteria
- [ ] ลบ `IMAP/Backup/` directory
- [ ] ลบ `Exec/execAccept-Backup.js`, `execAccept_.js`, `execAccept_Allow.js`
- [ ] อัพเดท `.gitignore`

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | ตรวจสอบว่าไฟล์ไม่ได้ถูกใช้งาน | 30m | [ ] |
| 2 | ลบไฟล์ backup | 15m | [ ] |
| 3 | เพิ่ม patterns ใน .gitignore | 15m | [ ] |
| 4 | Commit การเปลี่ยนแปลง | 15m | [ ] |

### Files to Delete
```
IMAP/Backup/
Exec/execAccept-Backup.js
Exec/execAccept_.js
Exec/execAccept_Allow.js
```

### .gitignore Additions
```gitignore
*-Backup*
*-backup*
*_.js
*.bak
```

---

## Sprint Metrics

### Burndown

| Day | Target Points | Hours |
|-----|---------------|-------|
| Day 1 | 13 → 10 | 4h |
| Day 2 | 10 → 7 | 4h |
| Day 3 | 7 → 4 | 4h |
| Day 4 | 4 → 2 | 4h |
| Day 5 | 2 → 0 | 4h |

### Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Browser Pool refactor breaks code | High | Backup + extensive testing |
| Credentials already leaked | Critical | Revoke keys immediately |
| Validation too strict | Medium | Add bypass config |

---

## Definition of Done

- [ ] Code implemented
- [ ] Manual testing passed
- [ ] No regression
- [ ] Committed to git
- [ ] Documentation updated

---

## Sprint Review Checklist

- [ ] S1.1: Credentials removed/revoked
- [ ] S1.2: Email validation working
- [ ] S1.3: Browser pool race condition fixed
- [ ] S1.4: Env validation on startup
- [ ] S1.5: Backup files removed
