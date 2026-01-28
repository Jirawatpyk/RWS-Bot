/**
 * Tests for WorkingHoursManager
 * Covers: default hours, holidays, weekends, OT overrides, CRUD operations
 *
 * Uses mocked loadJSON/saveJSON to avoid file I/O race conditions with parallel tests.
 * Variables prefixed with 'mock' to comply with Jest's out-of-scope variable rule.
 */

const dayjs = require('dayjs');

// Mock data stores (in-memory) - must be prefixed with 'mock' for Jest
let mockHolidayData = {};
let mockOvertimeData = {};
let mockSavedFiles = {};

// Mock fileUtils before any require
jest.mock('../../Utils/fileUtils', () => ({
  loadJSON: jest.fn((filePath, defaultValue = {}) => {
    if (filePath.includes('holidays.json')) return JSON.parse(JSON.stringify(mockHolidayData));
    if (filePath.includes('overtimeSchedule.json')) return JSON.parse(JSON.stringify(mockOvertimeData));
    return defaultValue;
  }),
  saveJSON: jest.fn((filePath, data) => {
    mockSavedFiles[filePath] = JSON.parse(JSON.stringify(data));
    if (filePath.includes('holidays.json')) {
      mockHolidayData = JSON.parse(JSON.stringify(data));
    }
    if (filePath.includes('overtimeSchedule.json')) {
      mockOvertimeData = JSON.parse(JSON.stringify(data));
    }
  })
}));

// Mock isBusinessDay to avoid file I/O
jest.mock('../../Task/isBusinessDay', () => {
  const mockFn = jest.fn((dayjsDate) => {
    if (!dayjsDate || !dayjsDate.isValid || !dayjsDate.isValid()) return false;
    const dayOfWeek = dayjsDate.day();
    const mockIsWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const mockDateStr = dayjsDate.format('YYYY-MM-DD');

    const mockExtraHolidays = mockHolidayData.extraHolidays || [];
    const mockWorkingHolidays = mockHolidayData.workingHolidays || [];

    if (mockWorkingHolidays.includes(mockDateStr)) return !mockIsWeekend;
    if (mockExtraHolidays.includes(mockDateStr)) return false;
    return !mockIsWeekend;
  });
  mockFn.clearConfigCache = jest.fn();
  return mockFn;
});

beforeEach(() => {
  // Reset mock data
  mockHolidayData = {
    extraHolidays: ['2026-01-01', '2026-04-13'],
    workingHolidays: []
  };
  mockOvertimeData = {};
  mockSavedFiles = {};

  jest.clearAllMocks();
});

function getManager() {
  // Clear module cache to get fresh instance each time
  jest.resetModules();

  // Re-apply mocks after resetModules
  jest.mock('../../Utils/fileUtils', () => ({
    loadJSON: jest.fn((filePath, defaultValue = {}) => {
      if (filePath.includes('holidays.json')) return JSON.parse(JSON.stringify(mockHolidayData));
      if (filePath.includes('overtimeSchedule.json')) return JSON.parse(JSON.stringify(mockOvertimeData));
      return defaultValue;
    }),
    saveJSON: jest.fn((filePath, data) => {
      mockSavedFiles[filePath] = JSON.parse(JSON.stringify(data));
      if (filePath.includes('holidays.json')) {
        mockHolidayData = JSON.parse(JSON.stringify(data));
      }
      if (filePath.includes('overtimeSchedule.json')) {
        mockOvertimeData = JSON.parse(JSON.stringify(data));
      }
    })
  }));

  jest.mock('../../Task/isBusinessDay', () => {
    const mockFn = jest.fn((dayjsDate) => {
      if (!dayjsDate || !dayjsDate.isValid || !dayjsDate.isValid()) return false;
      const dayOfWeek = dayjsDate.day();
      const mockIsWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const mockDateStr = dayjsDate.format('YYYY-MM-DD');

      const mockExtraHolidays = mockHolidayData.extraHolidays || [];
      const mockWorkingHolidays = mockHolidayData.workingHolidays || [];

      if (mockWorkingHolidays.includes(mockDateStr)) return !mockIsWeekend;
      if (mockExtraHolidays.includes(mockDateStr)) return false;
      return !mockIsWeekend;
    });
    mockFn.clearConfigCache = jest.fn();
    return mockFn;
  });

  const { WorkingHoursManager } = require('../../Task/workingHoursManager');
  return new WorkingHoursManager();
}

/* ========================= Default Working Hours ========================= */
describe('Default Working Hours', () => {
  test('should return default hours for a normal business day (weekday, no holiday)', () => {
    const mgr = getManager();
    const hours = mgr.getWorkingHours('2026-01-05');
    expect(hours).not.toBeNull();
    expect(hours.start).toBe(10);
    expect(hours.end).toBe(19);
  });

  test('should report normal weekday as working day', () => {
    const mgr = getManager();
    expect(mgr.isWorkingDay('2026-01-05')).toBe(true);
  });
});

/* ========================= Weekend Detection ========================= */
describe('Weekend Detection', () => {
  test('should return null for Saturday', () => {
    const mgr = getManager();
    expect(mgr.getWorkingHours('2026-01-03')).toBeNull();
  });

  test('should return null for Sunday', () => {
    const mgr = getManager();
    expect(mgr.getWorkingHours('2026-01-04')).toBeNull();
  });

  test('should report weekends as non-working days', () => {
    const mgr = getManager();
    expect(mgr.isWorkingDay('2026-01-03')).toBe(false);
    expect(mgr.isWorkingDay('2026-01-04')).toBe(false);
  });
});

/* ========================= Holiday Detection ========================= */
describe('Holiday Detection', () => {
  test('should return null for extra holidays (company holidays)', () => {
    const mgr = getManager();
    expect(mgr.getWorkingHours('2026-01-01')).toBeNull();
  });

  test('should return null for extra holiday (Songkran)', () => {
    const mgr = getManager();
    expect(mgr.getWorkingHours('2026-04-13')).toBeNull();
  });

  test('should report holidays as non-working days', () => {
    const mgr = getManager();
    expect(mgr.isWorkingDay('2026-01-01')).toBe(false);
    expect(mgr.isWorkingDay('2026-04-13')).toBe(false);
  });
});

/* ========================= OT Override ========================= */
describe('OT Override', () => {
  test('should return OT hours when set for a date', () => {
    const mgr = getManager();
    mgr.setOvertimeSchedule('2026-01-03', { start: 9, end: 17 });
    const hours = mgr.getWorkingHours('2026-01-03');
    expect(hours).toEqual({ start: 9, end: 17 });
  });

  test('OT should override holidays', () => {
    const mgr = getManager();
    mgr.setOvertimeSchedule('2026-01-01', { start: 10, end: 15 });
    const hours = mgr.getWorkingHours('2026-01-01');
    expect(hours).toEqual({ start: 10, end: 15 });
    expect(mgr.isWorkingDay('2026-01-01')).toBe(true);
  });

  test('OT should override weekends', () => {
    const mgr = getManager();
    mgr.setOvertimeSchedule('2026-01-04', { start: 8, end: 16 });
    expect(mgr.getWorkingHours('2026-01-04')).toEqual({ start: 8, end: 16 });
    expect(mgr.isWorkingDay('2026-01-04')).toBe(true);
  });

  test('should remove OT schedule', () => {
    const mgr = getManager();
    mgr.setOvertimeSchedule('2026-01-03', { start: 9, end: 17 });
    expect(mgr.removeOvertimeSchedule('2026-01-03')).toBe(true);
    expect(mgr.getWorkingHours('2026-01-03')).toBeNull();
  });

  test('removing non-existent OT should return false', () => {
    const mgr = getManager();
    expect(mgr.removeOvertimeSchedule('2026-12-25')).toBe(false);
  });

  test('should reject invalid OT hours (start >= end)', () => {
    const mgr = getManager();
    expect(() => mgr.setOvertimeSchedule('2026-01-05', { start: 19, end: 10 }))
      .toThrow('start must be less than end');
  });

  test('should reject invalid OT hours (out of range)', () => {
    const mgr = getManager();
    expect(() => mgr.setOvertimeSchedule('2026-01-05', { start: -1, end: 25 }))
      .toThrow('must be between 0 and 24');
  });

  test('should reject missing parameters', () => {
    const mgr = getManager();
    expect(() => mgr.setOvertimeSchedule(null, { start: 9, end: 17 }))
      .toThrow('Invalid OT schedule');
  });

  test('getOvertimeSchedule should return all OT schedules', () => {
    const mgr = getManager();
    mgr.setOvertimeSchedule('2026-01-03', { start: 9, end: 17 });
    mgr.setOvertimeSchedule('2026-01-04', { start: 10, end: 14 });
    const schedule = mgr.getOvertimeSchedule();
    expect(schedule).toEqual({
      '2026-01-03': { start: 9, end: 17 },
      '2026-01-04': { start: 10, end: 14 }
    });
  });
});

/* ========================= isWithinWorkingHours ========================= */
describe('isWithinWorkingHours', () => {
  test('should return true during default working hours on a weekday', () => {
    const mgr = getManager();
    const dt = dayjs('2026-01-05 14:00', 'YYYY-MM-DD HH:mm');
    expect(mgr.isWithinWorkingHours(dt)).toBe(true);
  });

  test('should return false before working hours', () => {
    const mgr = getManager();
    const dt = dayjs('2026-01-05 09:00', 'YYYY-MM-DD HH:mm');
    expect(mgr.isWithinWorkingHours(dt)).toBe(false);
  });

  test('should return false after working hours', () => {
    const mgr = getManager();
    const dt = dayjs('2026-01-05 19:00', 'YYYY-MM-DD HH:mm');
    expect(mgr.isWithinWorkingHours(dt)).toBe(false);
  });

  test('should return false on weekends', () => {
    const mgr = getManager();
    const dt = dayjs('2026-01-03 14:00', 'YYYY-MM-DD HH:mm');
    expect(mgr.isWithinWorkingHours(dt)).toBe(false);
  });

  test('should return false on holidays', () => {
    const mgr = getManager();
    const dt = dayjs('2026-01-01 14:00', 'YYYY-MM-DD HH:mm');
    expect(mgr.isWithinWorkingHours(dt)).toBe(false);
  });

  test('should respect OT hours on weekends', () => {
    const mgr = getManager();
    mgr.setOvertimeSchedule('2026-01-03', { start: 9, end: 17 });
    const inRange = dayjs('2026-01-03 12:00', 'YYYY-MM-DD HH:mm');
    const outRange = dayjs('2026-01-03 18:00', 'YYYY-MM-DD HH:mm');
    expect(mgr.isWithinWorkingHours(inRange)).toBe(true);
    expect(mgr.isWithinWorkingHours(outRange)).toBe(false);
  });

  test('should return false for invalid input', () => {
    const mgr = getManager();
    expect(mgr.isWithinWorkingHours('invalid-date')).toBe(false);
  });
});

/* ========================= Holiday CRUD ========================= */
describe('Holiday CRUD', () => {
  test('addHoliday should add a new holiday', () => {
    const mgr = getManager();
    expect(mgr.addHoliday('2026-12-25')).toBe(true);
    const holidays = mgr.getHolidays();
    expect(holidays.extraHolidays).toContain('2026-12-25');
  });

  test('addHoliday should return false for duplicate', () => {
    const mgr = getManager();
    expect(mgr.addHoliday('2026-01-01')).toBe(false);
  });

  test('removeHoliday should remove an existing holiday', () => {
    const mgr = getManager();
    expect(mgr.removeHoliday('2026-01-01')).toBe(true);
    const holidays = mgr.getHolidays();
    expect(holidays.extraHolidays).not.toContain('2026-01-01');
  });

  test('removeHoliday should return false for non-existent', () => {
    const mgr = getManager();
    expect(mgr.removeHoliday('2099-01-01')).toBe(false);
  });

  test('getHolidays should filter by year', () => {
    const mgr = getManager();
    const holidays2026 = mgr.getHolidays(2026);
    expect(holidays2026.extraHolidays.every(d => d.startsWith('2026'))).toBe(true);
  });

  test('getHolidays without year should return all', () => {
    const mgr = getManager();
    const all = mgr.getHolidays();
    expect(all.extraHolidays).toBeDefined();
    expect(all.workingHolidays).toBeDefined();
  });
});

/* ========================= Working Holiday Override ========================= */
describe('Working Holiday Override', () => {
  test('addWorkingHoliday should mark a holiday as working', () => {
    const mgr = getManager();
    expect(mgr.addWorkingHoliday('2026-04-13')).toBe(true);
    const holidays = mgr.getHolidays();
    expect(holidays.workingHolidays).toContain('2026-04-13');
  });

  test('addWorkingHoliday should return false for duplicate', () => {
    const mgr = getManager();
    mgr.addWorkingHoliday('2026-04-13');
    expect(mgr.addWorkingHoliday('2026-04-13')).toBe(false);
  });

  test('removeWorkingHoliday should remove override', () => {
    const mgr = getManager();
    mgr.addWorkingHoliday('2026-04-13');
    expect(mgr.removeWorkingHoliday('2026-04-13')).toBe(true);
    const holidays = mgr.getHolidays();
    expect(holidays.workingHolidays).not.toContain('2026-04-13');
  });
});

/* ========================= getStatus ========================= */
describe('getStatus', () => {
  test('should return comprehensive status object', () => {
    const mgr = getManager();
    const status = mgr.getStatus();
    expect(status).toHaveProperty('defaultHours');
    expect(status).toHaveProperty('todayHours');
    expect(status).toHaveProperty('isWorkingToday');
    expect(status).toHaveProperty('overtimeSchedule');
    expect(status).toHaveProperty('holidays');
    expect(status.defaultHours).toEqual({ start: 10, end: 19 });
  });
});

/* ========================= Edge Cases ========================= */
describe('Edge Cases', () => {
  test('should return null for invalid date format', () => {
    const mgr = getManager();
    expect(mgr.getWorkingHours('invalid')).toBeNull();
    expect(mgr.getWorkingHours('')).toBeNull();
  });

  test('getWorkingHoursForDate should work with dayjs objects', () => {
    const mgr = getManager();
    const monday = dayjs('2026-01-05');
    const hours = mgr.getWorkingHoursForDate(monday);
    expect(hours).toEqual({ start: 10, end: 19 });
  });

  test('getWorkingHoursForDate should return null for invalid dayjs', () => {
    const mgr = getManager();
    expect(mgr.getWorkingHoursForDate(null)).toBeNull();
    expect(mgr.getWorkingHoursForDate(dayjs('invalid'))).toBeNull();
  });

  test('saveJSON should be called when setting OT schedule', () => {
    const mgr = getManager();
    const { saveJSON } = require('../../Utils/fileUtils');
    mgr.setOvertimeSchedule('2026-02-01', { start: 8, end: 20 });
    expect(saveJSON).toHaveBeenCalled();
    expect(mockOvertimeData['2026-02-01']).toEqual({ start: 8, end: 20 });
  });

  test('saveJSON should be called when adding holidays', () => {
    const mgr = getManager();
    const { saveJSON } = require('../../Utils/fileUtils');
    mgr.addHoliday('2026-06-15');
    expect(saveJSON).toHaveBeenCalled();
    expect(mockHolidayData.extraHolidays).toContain('2026-06-15');
  });

  test('clearConfigCache should be called when modifying holidays', () => {
    const mgr = getManager();
    const mockIsBusinessDay = require('../../Task/isBusinessDay');
    mgr.addHoliday('2026-06-15');
    expect(mockIsBusinessDay.clearConfigCache).toHaveBeenCalled();
  });
});
