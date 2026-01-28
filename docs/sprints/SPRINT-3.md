# Sprint 3: Logging & Monitoring

## Sprint Overview

| Attribute | Value |
|-----------|-------|
| **Duration** | 1 week |
| **Story Points** | 10 |
| **Estimated Hours** | 12-16 hrs |
| **Focus** | Consistent logging, structured logs, data validation |
| **Priority** | High/Medium |
| **Prerequisites** | Sprint 2 completed |

---

## Sprint Goal

ปรับปรุงระบบ logging ให้เป็นมาตรฐานเดียวกันทั้ง codebase เพิ่ม structured logging และ data validation เพื่อให้ debug และ monitor ได้ง่ายขึ้น

---

## Stories Summary

| ID | Story | Points | Hours | Priority | Dependencies |
|----|-------|--------|-------|----------|--------------|
| S3.1 | Standardize Logging Across Codebase | 3 | 4h | High | - |
| S3.2 | Implement Structured Logging (JSON) | 4 | 5h | Medium | S3.1 |
| S3.3 | Add Sheet Data Validation | 3 | 4h | Medium | - |

---

## S3.1: Standardize Logging Across Codebase

| Attribute | Value |
|-----------|-------|
| **Points** | 3 |
| **Hours** | 4h |
| **Priority** | High |
| **Status** | [ ] Not Started |

### Description
แทนที่ `console.error/warn/log` ทั้งหมดด้วย logger functions จาก `Logs/logger.js`

### Acceptance Criteria
- [ ] ไม่มี `console.error` ใน codebase (ยกเว้น logger.js)
- [ ] ไม่มี `console.warn` ใน codebase
- [ ] ไม่มี `console.log` ใน codebase (ยกเว้น intentional)
- [ ] ทุก module import จาก `Logs/logger.js`

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | ค้นหา console.* calls ทั้งหมด | 15m | [ ] |
| 2 | แทนที่ใน Dashboard/server.js | 45m | [ ] |
| 3 | แทนที่ใน Logs/notifier.js | 30m | [ ] |
| 4 | แทนที่ใน Task/taskReporter.js | 30m | [ ] |
| 5 | ตรวจสอบและแทนที่ใน modules อื่นๆ | 1h | [ ] |
| 6 | ทดสอบว่า logs ถูกบันทึกถูกต้อง | 30m | [ ] |

### Files
- `Dashboard/server.js`
- `Logs/notifier.js`
- `Task/taskReporter.js`
- Other files as discovered

#### Search Command
```bash
# ค้นหา console.* calls ทั้งหมด
grep -r "console\." --include="*.js" --exclude-dir=node_modules
```

#### Mapping
| console.* | Logger function |
|-----------|-----------------|
| `console.error` | `logFail` |
| `console.warn` | `logInfo` (with warning prefix) |
| `console.log` | `logInfo` |

### Notes
- ใช้คำสั่ง `grep -r "console\." --include="*.js"` เพื่อค้นหา
- Mapping: `console.error` → `logFail`, `console.log` → `logInfo`

---

## S3.2: Implement Structured Logging (JSON)

| Attribute | Value |
|-----------|-------|
| **Points** | 4 |
| **Hours** | 5h |
| **Priority** | Medium |
| **Status** | [ ] Not Started |

### Description
เปลี่ยน log format เป็น JSON เพื่อให้ parse และ search ได้ง่าย พร้อม log levels

### Acceptance Criteria
- [ ] Log file เป็น JSON format (1 JSON per line - JSONL)
- [ ] มี log levels: DEBUG, INFO, WARN, ERROR
- [ ] มี context fields (timestamp, module, orderId)
- [ ] Console output ยังคง human-readable

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | ออกแบบ log schema | 30m | [ ] |
| 2 | สร้าง structured logger | 1.5h | [ ] |
| 3 | เพิ่ม log level configuration (env var) | 30m | [ ] |
| 4 | อัพเดท logger functions ให้รองรับ context | 1h | [ ] |
| 5 | ทดสอบ log output และ JSON parsing | 1h | [ ] |
| 6 | เพิ่ม logWarn, logDebug functions | 30m | [ ] |

### Files
- `Logs/logger.js`
- **NEW:** `Logs/system.jsonl` (output file)

#### Code Implementation

```javascript
// Logs/logger.js - Structured logging version

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const dayjs = require('dayjs');

// Configuration
const LOG_DIR = path.join(__dirname, '../Logs');
const SYSTEM_LOG = path.join(LOG_DIR, 'system.log');
const JSON_LOG = path.join(LOG_DIR, 'system.jsonl'); // JSON Lines format

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Format timestamp
 */
function timestamp() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Write structured log entry
 */
function writeStructuredLog(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  };

  const jsonLine = JSON.stringify(entry) + '\n';

  try {
    fs.appendFileSync(JSON_LOG, jsonLine);
  } catch (err) {
    // Fallback to console if file write fails
    console.error('Failed to write log:', err.message);
  }
}

/**
 * Write human-readable log
 */
function writeHumanLog(message) {
  const line = `[${timestamp()}] ${message}\n`;

  try {
    fs.appendFileSync(SYSTEM_LOG, line);
  } catch (err) {
    // Ignore file write errors
  }
}

/**
 * Core logging function
 */
function log(level, message, context = {}) {
  if (LOG_LEVELS[level] < CURRENT_LOG_LEVEL) {
    return; // Skip logs below current level
  }

  // Write to structured log
  writeStructuredLog(level, message, context);

  // Write to human-readable log
  writeHumanLog(message);
}

// Public API
function logSuccess(msg, notify = false, context = {}) {
  console.log(chalk.green(`[${timestamp()}] ${msg}`));
  log('INFO', msg, { ...context, status: 'success' });
}

function logFail(msg, notify = false, context = {}) {
  console.log(chalk.red(`[${timestamp()}] ${msg}`));
  log('ERROR', msg, { ...context, status: 'error' });
}

function logInfo(msg, context = {}) {
  console.log(chalk.cyan(`[${timestamp()}] ${msg}`));
  log('INFO', msg, context);
}

function logProgress(msg, context = {}) {
  console.log(chalk.yellow(`[${timestamp()}] ${msg}`));
  log('INFO', msg, { ...context, type: 'progress' });
}

function logDebug(msg, context = {}) {
  if (CURRENT_LOG_LEVEL <= LOG_LEVELS.DEBUG) {
    console.log(chalk.gray(`[${timestamp()}] [DEBUG] ${msg}`));
  }
  log('DEBUG', msg, context);
}

function logWarn(msg, context = {}) {
  console.log(chalk.yellow(`[${timestamp()}] [WARN] ${msg}`));
  log('WARN', msg, context);
}

function logBanner() {
  const banner = `
╔═══════════════════════════════════════════╗
║     AUTO-RWS TASK AUTOMATION SYSTEM       ║
║           Version 1.0.0                   ║
╚═══════════════════════════════════════════╝
  `;
  console.log(chalk.cyan(banner));
}

module.exports = {
  logSuccess,
  logFail,
  logInfo,
  logProgress,
  logDebug,
  logWarn,
  logBanner,
  timestamp
};
```

#### Log Schema

```json
{
  "timestamp": "2025-01-11T10:30:00.000Z",
  "level": "INFO",
  "message": "Task completed successfully",
  "orderId": "ORD-12345",
  "module": "TaskQueue",
  "duration": 1234,
  "status": "success"
}
```

### Notes
- JSONL format ช่วยให้ grep/jq ได้ง่าย
- ต้องรองรับ LOG_LEVEL env var

---

## S3.3: Add Sheet Data Validation

| Attribute | Value |
|-----------|-------|
| **Points** | 3 |
| **Hours** | 4h |
| **Priority** | Medium |
| **Status** | [ ] Not Started |

### Description
เพิ่ม validation สำหรับข้อมูลที่อ่านจาก Google Sheets เพื่อป้องกัน undefined errors

### Acceptance Criteria
- [ ] Required columns ถูกตรวจสอบ
- [ ] Undefined/null values ถูก handle
- [ ] Validation errors ถูก log
- [ ] Invalid rows ถูก skip gracefully

### Tasks
| # | Task | Est. | Status |
|---|------|------|--------|
| 1 | สร้าง `utils/sheetValidation.js` | 1h | [ ] |
| 2 | อัพเดท taskReporter.js | 1h | [ ] |
| 3 | อัพเดท sheetReader.js | 1h | [ ] |
| 4 | ทดสอบด้วย incomplete data | 1h | [ ] |

### Files
- **NEW:** `utils/sheetValidation.js`
- `Task/taskReporter.js`
- `Sheets/sheetReader.js`

#### Code Implementation

```javascript
// utils/sheetValidation.js - New file

const { logWarn } = require('../Logs/logger');

/**
 * Validate sheet row data
 * @param {Object} row - Row data
 * @param {Array} requiredFields - Required field names
 * @param {Object} options - Options
 * @returns {Object} { valid: boolean, data: Object, errors: Array }
 */
function validateSheetRow(row, requiredFields, options = {}) {
  const { skipEmpty = true, defaultValues = {} } = options;
  const errors = [];
  const data = {};

  if (!row || !row._rawData) {
    return {
      valid: false,
      data: {},
      errors: ['Invalid row structure']
    };
  }

  for (const field of requiredFields) {
    const value = row._rawData[field.index];

    if (value === undefined || value === null || value === '') {
      if (field.required) {
        errors.push(`Missing required field: ${field.name}`);
      } else {
        data[field.name] = defaultValues[field.name] ?? null;
      }
    } else {
      // Type coercion if needed
      if (field.type === 'number') {
        const num = parseFloat(value);
        if (isNaN(num)) {
          errors.push(`Invalid number for ${field.name}: ${value}`);
        } else {
          data[field.name] = num;
        }
      } else {
        data[field.name] = String(value).trim();
      }
    }
  }

  return {
    valid: errors.length === 0,
    data,
    errors
  };
}

/**
 * Log validation errors
 */
function logValidationErrors(context, errors) {
  if (errors.length > 0) {
    logWarn(`Validation errors for ${context}: ${errors.join(', ')}`);
  }
}

module.exports = {
  validateSheetRow,
  logValidationErrors
};
```

```javascript
// Task/taskReporter.js - Usage example

const { validateSheetRow, logValidationErrors } = require('../utils/sheetValidation');

const REQUIRED_FIELDS = [
  { name: 'orderId', index: COL.orderId, required: true, type: 'string' },
  { name: 'workflowName', index: COL.workflowName, required: true, type: 'string' },
  { name: 'amountWords', index: COL.amountWords, required: false, type: 'number' },
  { name: 'status', index: COL.status, required: false, type: 'string' }
];

// In processing loop
for (const row of rows) {
  const validation = validateSheetRow(row, REQUIRED_FIELDS, {
    defaultValues: { amountWords: 0, status: 'pending' }
  });

  if (!validation.valid) {
    logValidationErrors(`row ${row.rowNumber}`, validation.errors);
    continue; // Skip invalid row
  }

  const { orderId, workflowName, amountWords, status } = validation.data;
  // Process valid data...
}
```

---

## Sprint Metrics

### Burndown Target

| Day | Remaining Points |
|-----|------------------|
| Day 1 | 10 |
| Day 2 | 8 |
| Day 3 | 5 |
| Day 4 | 3 |
| Day 5 | 0 |

### New Files Created

| File | Description |
|------|-------------|
| `utils/sheetValidation.js` | Sheet data validation helpers |
| `Logs/system.jsonl` | JSON Lines log file |

---

## Sprint Review Checklist

- [ ] All console.* replaced with logger
- [ ] JSON logs working correctly
- [ ] Sheet validation working
- [ ] Log files created and readable
- [ ] No regression in existing functionality
- [ ] Committed and pushed to repository
