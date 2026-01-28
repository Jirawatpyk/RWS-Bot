# Auto-RWS Code Review & Improvement Stories

## Executive Summary

จาก Code Review พบ **20 issues** แบ่งตาม severity:
- Critical: 3 issues
- High: 6 issues
- Medium: 6 issues
- Low: 5 issues

**Total:** 16 Stories | 46 Story Points | 4 Sprints (4 weeks)

---

## Sprint Overview

| Sprint | Focus | Points | Duration | Details |
|--------|-------|--------|----------|---------|
| [Sprint 1](docs/sprints/SPRINT-1.md) | Security & Stability | 13 | 1 week | Critical fixes |
| [Sprint 2](docs/sprints/SPRINT-2.md) | Error Handling | 12 | 1 week | Reliability |
| [Sprint 3](docs/sprints/SPRINT-3.md) | Logging & Monitoring | 10 | 1 week | Observability |
| [Sprint 4](docs/sprints/SPRINT-4.md) | Config & Documentation | 11 | 1 week | Maintainability |

---

## Sprint 1: Security & Stability (Critical)

**Goal:** แก้ไขปัญหาความปลอดภัยและเสถียรภาพที่สำคัญ

| ID | Story | Points | Priority |
|----|-------|--------|----------|
| S1.1 | Remove Credentials from Repository | 2 | Critical |
| S1.2 | Add Input Validation for Email Parsing | 3 | Critical |
| S1.3 | Fix Race Condition in Browser Pool | 5 | Critical |
| S1.4 | Add Environment Variable Validation | 1 | Medium |
| S1.5 | Remove Dead Code and Backup Files | 2 | Low |

[View Sprint 1 Details](docs/sprints/SPRINT-1.md)

---

## Sprint 2: Error Handling (High)

**Goal:** ปรับปรุงการจัดการ errors และเพิ่ม graceful shutdown

| ID | Story | Points | Priority |
|----|-------|--------|----------|
| S2.1 | Improve Task Queue Error Handling | 2 | High |
| S2.2 | Add File I/O Error Handling | 3 | High |
| S2.3 | Improve Timeout Handling with Cleanup | 3 | High |
| S2.4 | Add IMAP Graceful Shutdown | 2 | High |
| S2.5 | Add Retry Logic for External API Calls | 2 | High |

[View Sprint 2 Details](docs/sprints/SPRINT-2.md)

---

## Sprint 3: Logging & Monitoring (High/Medium)

**Goal:** ปรับปรุงระบบ logging และเพิ่ม data validation

| ID | Story | Points | Priority |
|----|-------|--------|----------|
| S3.1 | Standardize Logging Across Codebase | 3 | High |
| S3.2 | Implement Structured Logging (JSON) | 4 | Medium |
| S3.3 | Add Sheet Data Validation | 3 | Medium |

[View Sprint 3 Details](docs/sprints/SPRINT-3.md)

---

## Sprint 4: Config & Documentation (Medium/Low)

**Goal:** ปรับปรุง configuration และเพิ่ม documentation

| ID | Story | Points | Priority |
|----|-------|--------|----------|
| S4.1 | Extract Magic Numbers to Config | 3 | Medium |
| S4.2 | Add JSDoc Documentation | 5 | Low |
| S4.3 | Add Unit Tests (Foundation) | 3 | Low |

[View Sprint 4 Details](docs/sprints/SPRINT-4.md)

---

## Backlog (Future Sprints)

| ID | Story | Points | Notes |
|----|-------|--------|-------|
| B1 | Full Unit Test Coverage | 8 | ต่อจาก S4.3 |
| B2 | Integration Tests | 5 | E2E testing |
| B3 | Performance Optimization | 5 | Memory profiling |
| B4 | IMAP Connection Pooling | 5 | ถ้าต้องการ scale |

---

## Velocity & Timeline

| Sprint | Points | Cumulative | Week |
|--------|--------|------------|------|
| Sprint 1 | 13 | 13 | Week 1 |
| Sprint 2 | 12 | 25 | Week 2 |
| Sprint 3 | 10 | 35 | Week 3 |
| Sprint 4 | 11 | 46 | Week 4 |

---

## Definition of Done

- [ ] Code implemented and working
- [ ] Error cases handled
- [ ] Tested manually (at minimum)
- [ ] Code reviewed (self-review OK)
- [ ] Committed to git
- [ ] No regression in existing functionality

---

## Quick Reference

### Critical Files by Sprint

**Sprint 1:**
- `BrowserPool/browserPool.js` - Race condition fix
- `IMAP/fetcher.js` - Input validation
- `.gitignore` - Credentials cleanup

**Sprint 2:**
- `Task/taskQueue.js` - Error handling
- `utils/taskTimeout.js` - Timeout cleanup
- `IMAP/imapClient.js` - Graceful shutdown

**Sprint 3:**
- `Logs/logger.js` - Structured logging
- `utils/sheetValidation.js` - New file

**Sprint 4:**
- `Config/configs.js` - Expanded config
- `jest.config.js` - New file
- `__tests__/` - New directory
