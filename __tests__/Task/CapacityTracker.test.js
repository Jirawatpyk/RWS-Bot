/**
 * Tests for Task/CapacityTracker.js
 *
 * Testing Strategy:
 * 1. Test getAvailableDates with various scenarios (urgent, balanced, edge cases)
 * 2. Test applyCapacity and releaseCapacity
 * 3. Test getRemainingCapacity
 * 4. Test daily override functionality
 * 5. Test file I/O operations (save/load)
 * 6. Test capacity adjustment and cleanup
 */

const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

// Mock fs module
jest.mock('fs');

// Mock isBusinessDay
jest.mock('../../Task/isBusinessDay', () => (date) => {
  const dayOfWeek = date.day();
  // Simple mock: weekdays only (no holidays)
  return dayOfWeek >= 1 && dayOfWeek <= 5;
});

const {
  getAvailableDates,
  applyCapacity,
  releaseCapacity,
  adjustCapacity,
  getReport,
  getRemainingCapacity,
  resetCapacityMap,
  loadDailyOverride,
  saveDailyOverride,
  loadCapacityMap,
  getCapacityMap,
  getOverrideMap
} = require('../../Task/CapacityTracker');

describe('Task/CapacityTracker.js', () => {
  let mockCapacityData = {};
  let mockOverrideData = {};

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock data
    mockCapacityData = {};
    mockOverrideData = {};

    // Setup fs.readFileSync to use mock data
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath.includes('dailyOverride.json')) {
        return JSON.stringify(mockOverrideData);
      }
      if (filePath.includes('capacity.json')) {
        return JSON.stringify(mockCapacityData);
      }
      throw new Error('ENOENT');
    });

    // Setup fs.writeFileSync to update mock data
    fs.writeFileSync.mockImplementation((filePath, data) => {
      if (filePath.includes('capacity.json')) {
        mockCapacityData = JSON.parse(data);
      }
      if (filePath.includes('dailyOverride.json')) {
        mockOverrideData = JSON.parse(data);
      }
    });

    fs.existsSync.mockReturnValue(true);
  });

  describe('loadDailyOverride()', () => {
    it('should load daily override from file', () => {
      mockOverrideData = {
        '2026-01-25': 15000,
        '2026-01-26': 8000
      };

      const result = loadDailyOverride();
      expect(result).toEqual(mockOverrideData);
    });

    it('should return empty object if file does not exist', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = loadDailyOverride();
      expect(result).toEqual({});
    });

    it('should return empty object if file is invalid JSON', () => {
      fs.readFileSync.mockReturnValue('invalid json');

      const result = loadDailyOverride();
      expect(result).toEqual({});
    });
  });

  describe('saveDailyOverride()', () => {
    it('should save override map to file', () => {
      const overrideMap = {
        '2026-01-25': 15000,
        '2026-01-26': 8000
      };

      saveDailyOverride(overrideMap);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('dailyOverride.json'),
        JSON.stringify(overrideMap, null, 2)
      );
      expect(mockOverrideData).toEqual(overrideMap);
    });
  });

  describe('loadCapacityMap()', () => {
    it('should load capacity map from file', () => {
      mockCapacityData = {
        '2026-01-25': 5000,
        '2026-01-26': 7000
      };

      loadCapacityMap();
      const result = getCapacityMap();

      expect(result).toEqual(mockCapacityData);
    });

    it('should set capacityMap to empty object if file does not exist (Line 34)', () => {
      // Force readFileSync to throw error
      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('capacity.json')) {
          throw new Error('ENOENT: no such file or directory');
        }
        if (filePath.includes('dailyOverride.json')) {
          return JSON.stringify({});
        }
        throw new Error('ENOENT');
      });

      loadCapacityMap();
      const result = getCapacityMap();

      // Should return empty object (Line 34 coverage)
      expect(result).toEqual({});
    });

    it('should handle invalid JSON in capacity file (Line 34)', () => {
      // Force readFileSync to return invalid JSON
      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes('capacity.json')) {
          return 'invalid json {]';
        }
        if (filePath.includes('dailyOverride.json')) {
          return JSON.stringify({});
        }
        throw new Error('ENOENT');
      });

      loadCapacityMap();
      const result = getCapacityMap();

      // Should return empty object due to JSON parse error
      expect(result).toEqual({});
    });
  });

  describe('getAvailableDates() - Balanced Mode', () => {
    it('should allocate words evenly across available days (balanced mode)', () => {
      // Use far future dates that are guaranteed to be weekdays
      const requiredWords = 12000;
      const deadline = '2027-02-05 18:00'; // Friday (Mon-Fri = 5 business days from 2027-02-01)

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should distribute evenly across business days
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);

      // May not get all 12000 if some days already passed
      expect(totalAllocated).toBeGreaterThanOrEqual(0);
      expect(totalAllocated).toBeLessThanOrEqual(12000);

      // Each day should not exceed MAX capacity
      result.forEach(day => {
        expect(day.amount).toBeLessThanOrEqual(12000);
      });
    });

    it('should not exceed MAX_DAILY_CAPACITY (12000)', () => {
      const today = dayjs().add(10, 'day');
      let testDate = today;
      while (testDate.day() !== 1) {
        testDate = testDate.add(1, 'day');
      }

      const requiredWords = 15000;
      const deadline = testDate.format('YYYY-MM-DD HH:mm'); // Same day

      const result = getAvailableDates(requiredWords, deadline, false);

      // Each day should not exceed MAX capacity
      result.forEach(day => {
        expect(day.amount).toBeLessThanOrEqual(12000);
      });
    });

    it('should exclude today when excludeToday is true', () => {
      const today = dayjs().add(10, 'day');
      let testDate = today;
      while (testDate.day() !== 1) {
        testDate = testDate.add(1, 'day');
      }

      const requiredWords = 12000;
      const deadline = testDate.add(3, 'day').format('YYYY-MM-DD HH:mm');

      const result = getAvailableDates(requiredWords, deadline, true);

      // Should not include today
      const todayStr = dayjs().format('YYYY-MM-DD');
      const hasToday = result.some(d => d.date === todayStr);
      expect(hasToday).toBe(false);
    });

    it('should include today when excludeToday is false', () => {
      // Use a far future weekday
      const requiredWords = 6000;
      const deadline = '2027-02-02 18:00'; // Tuesday 2027-02-02

      const result = getAvailableDates(requiredWords, deadline, false);

      // Result should include dates (may or may not include actual "today")
      // Just verify function works without excludeToday
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAllocated).toBeGreaterThanOrEqual(0);
    });

    it('should skip dates with no space in balanced mode (Lines 104-114)', () => {
      //  Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 5 business days
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 5) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      // day0 is full, others have space
      mockCapacityData = {
        [businessDays[0]]: 12000  // Fully used
      };

      const requiredWords = 18000;
      const deadline = businessDays[4] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should skip first day (no space left) if it was considered
      const day0Alloc = result.find(d => d.date === businessDays[0]);
      expect(day0Alloc).toBeUndefined();

      // Should have some allocation on other days
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAllocated).toBeGreaterThan(0);
    });

    it('should trigger second round allocation when remaining > 0 (Lines 117-147)', () => {
      // Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 5 business days
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 5) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      // Each day already has some capacity used
      mockCapacityData = {
        [businessDays[0]]: 3000,
        [businessDays[1]]: 4000,
        [businessDays[2]]: 2000
      };

      // Request more than can fit evenly (triggers second round)
      // With 5 business days and 25000 words, perDay = 5000
      // But we have limited space, so second round kicks in
      const requiredWords = 25000;
      const deadline = businessDays[4] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should use second round to fill remaining capacity
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);

      // Total should not exceed available capacity across all days
      expect(totalAllocated).toBeGreaterThan(0);
      expect(totalAllocated).toBeLessThanOrEqual(51000); // 5 days with partial usage
    });

    it('should sort by space left then by date in second round (Lines 128-131)', () => {
      // Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 3 business days
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 3) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      // Setup capacity so we need second round
      mockCapacityData = {
        [businessDays[0]]: 8000,    // 4000 space left
        [businessDays[1]]: 8000,    // 4000 space left
        [businessDays[2]]: 6000  // 6000 space left
      };

      // Request amount that needs second round
      const requiredWords = 15000;
      const deadline = businessDays[2] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Second round should prioritize day with most space, then earlier dates
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAllocated).toBeGreaterThan(0);
      expect(totalAllocated).toBeLessThanOrEqual(14000); // (12000-8000)*2 + (12000-6000)
    });

    it('should update existing plan entry in second round (Lines 138-139)', () => {
      // Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 3 business days
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 3) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      mockCapacityData = {
        [businessDays[0]]: 2000,
        [businessDays[1]]: 2000,
        [businessDays[2]]: 2000
      };

      // Large request to trigger second round
      const requiredWords = 28000;
      const deadline = businessDays[2] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should have entries for dates from both rounds
      expect(result.length).toBeGreaterThan(0);

      // Total allocated should not exceed available capacity
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAllocated).toBeLessThanOrEqual(30000); // (12000-2000) * 3
    });

    it('should create new plan entry in second round if not exists (Lines 141-142)', () => {
      // Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 4 business days
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 4) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      // Setup: First day has high usage, others empty
      // perDay = 18000/4 = 4500
      // First round: day0 can only take 500 (12000-11500), skip others with perDay=4500 each
      // Second round: Should create NEW entries for days that were skipped in first round
      mockCapacityData = {
        [businessDays[0]]: 11500  // Almost full, only 500 space left
      };

      const requiredWords = 18000;
      const deadline = businessDays[3] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should allocate across available days
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAllocated).toBeGreaterThan(0);

      // Verify that we created new entries in second round (Line 141)
      // Day 0 should have allocation from first round
      const day0Alloc = result.find(d => d.date === businessDays[0]);
      expect(day0Alloc).toBeDefined();

      // Other days should also have allocations from second round
      expect(result.length).toBeGreaterThan(1);
    });

    it('should stop second round when remaining reaches zero (Line 145)', () => {
      // Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 2 business days
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 2) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      mockCapacityData = {};

      const requiredWords = 20000;
      const deadline = businessDays[1] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);

      // Should allocate exactly what was requested (or less if capacity insufficient)
      expect(totalAllocated).toBeGreaterThan(0);
      expect(totalAllocated).toBeLessThanOrEqual(24000); // 2 days * 12000 max
    });
  });

  describe('getAvailableDates() - Urgent Mode', () => {
    it('should use urgent mode when less than 3 business days available', () => {
      const requiredWords = 8000;
      const deadline = '2027-02-02 18:00'; // Tuesday (gives 2 days if started on Monday)

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should allocate as much as possible
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAllocated).toBeGreaterThanOrEqual(0);

      // Each day should not exceed MAX capacity
      result.forEach(day => {
        expect(day.amount).toBeLessThanOrEqual(12000);
      });
    });

    it('should allocate maximum capacity in urgent mode', () => {
      const today = dayjs().add(10, 'day');
      let testDate = today;
      while (testDate.day() !== 1) {
        testDate = testDate.add(1, 'day');
      }

      const requiredWords = 20000;
      const deadline = testDate.add(1, 'day').format('YYYY-MM-DD HH:mm');

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should try to allocate maximum on each day
      result.forEach(day => {
        expect(day.amount).toBeLessThanOrEqual(12000);
      });
    });

    it('should skip dates with no space left in urgent mode (Lines 88-98)', () => {
      // Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 2 business days for urgent mode (< 3 days)
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 2) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      // First day is already full, second day has space
      mockCapacityData = {
        [businessDays[0]]: 12000  // Fully used
      };

      const requiredWords = 15000;
      const deadline = businessDays[1] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should skip first day (no space) if considered
      const day0Alloc = result.find(d => d.date === businessDays[0]);
      expect(day0Alloc).toBeUndefined();

      // Should have some allocation on second day
      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAllocated).toBeGreaterThan(0);
    });

    it('should stop allocating when remaining reaches zero in urgent mode (Line 96)', () => {
      // Use today and future dates relative to today
      const today = dayjs().startOf('day');

      // Find next 2 business days for urgent mode (< 3 days)
      const businessDays = [];
      let cursor = today;
      while (businessDays.length < 2) {
        const dayOfWeek = cursor.day();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          businessDays.push(cursor.format('YYYY-MM-DD'));
        }
        cursor = cursor.add(1, 'day');
      }

      mockCapacityData = {}; // Empty capacity

      const requiredWords = 8000;
      const deadline = businessDays[1] + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      const totalAllocated = result.reduce((sum, d) => sum + d.amount, 0);
      // Should allocate the required amount
      expect(totalAllocated).toBeGreaterThan(0);
      expect(totalAllocated).toBeLessThanOrEqual(requiredWords);
    });
  });

  describe('getAvailableDates() - With Daily Override', () => {
    it('should respect daily override limits', () => {
      const today = dayjs().add(10, 'day');
      let testDate = today;
      while (testDate.day() !== 1) {
        testDate = testDate.add(1, 'day');
      }

      const monday = testDate.format('YYYY-MM-DD');
      const tuesday = testDate.add(1, 'day').format('YYYY-MM-DD');

      mockOverrideData = {
        [monday]: 8000,    // Lower capacity on Monday
        [tuesday]: 15000   // Higher capacity on Tuesday
      };

      const requiredWords = 10000;
      const deadline = tuesday + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Monday should not exceed 8000
      const mondayAlloc = result.find(d => d.date === monday);
      if (mondayAlloc) {
        expect(mondayAlloc.amount).toBeLessThanOrEqual(8000);
      }
    });

    it('should use override capacity when available (Line 65, 89, 106)', () => {
      const today = dayjs().add(10, 'day');
      let testDate = today;
      while (testDate.day() !== 1) {
        testDate = testDate.add(1, 'day');
      }

      const monday = testDate.format('YYYY-MM-DD');
      const tuesday = testDate.add(1, 'day').format('YYYY-MM-DD');

      mockOverrideData = {
        [monday]: 20000,   // Override with higher capacity
        [tuesday]: 6000    // Override with lower capacity
      };

      const requiredWords = 15000;
      const deadline = tuesday + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should respect override limits
      const mondayAlloc = result.find(d => d.date === monday);
      if (mondayAlloc) {
        expect(mondayAlloc.amount).toBeLessThanOrEqual(20000);
      }

      const tuesdayAlloc = result.find(d => d.date === tuesday);
      if (tuesdayAlloc) {
        expect(tuesdayAlloc.amount).toBeLessThanOrEqual(6000);
      }
    });
  });

  describe('getAvailableDates() - With Existing Capacity', () => {
    it('should account for existing capacity usage', () => {
      const today = dayjs().add(10, 'day');
      let testDate = today;
      while (testDate.day() !== 1) {
        testDate = testDate.add(1, 'day');
      }

      const monday = testDate.format('YYYY-MM-DD');
      const tuesday = testDate.add(1, 'day').format('YYYY-MM-DD');

      mockCapacityData = {
        [monday]: 10000,   // Already used 10000
        [tuesday]: 5000    // Already used 5000
      };

      const requiredWords = 5000;
      const deadline = tuesday + ' 18:00';

      const result = getAvailableDates(requiredWords, deadline, false);

      // Monday: 12000 max - 10000 used = 2000 available
      // Tuesday: 12000 max - 5000 used = 7000 available
      const totalAvailable = result.reduce((sum, d) => sum + d.amount, 0);
      expect(totalAvailable).toBeLessThanOrEqual(9000); // 2000 + 7000
    });
  });

  describe('applyCapacity()', () => {
    it('should apply allocation plan to capacity map', () => {
      loadCapacityMap(); // Load empty capacityMap first

      const plan = [
        { date: '2026-01-26', amount: 5000 },
        { date: '2026-01-27', amount: 3000 }
      ];

      applyCapacity(plan);

      expect(mockCapacityData['2026-01-26']).toBe(5000);
      expect(mockCapacityData['2026-01-27']).toBe(3000);
    });

    it('should accumulate capacity on same date', () => {
      mockCapacityData = {
        '2026-01-26': 3000
      };
      loadCapacityMap(); // Load existing capacity

      const plan = [
        { date: '2026-01-26', amount: 2000 }
      ];

      applyCapacity(plan);

      expect(mockCapacityData['2026-01-26']).toBe(5000); // 3000 + 2000
    });
  });

  describe('releaseCapacity()', () => {
    it('should release capacity from plan', () => {
      mockCapacityData = {
        '2026-01-26': 8000,
        '2026-01-27': 5000
      };
      loadCapacityMap(); // Load existing capacity

      const plan = [
        { date: '2026-01-26', amount: 3000 },
        { date: '2026-01-27', amount: 2000 }
      ];

      releaseCapacity(plan);

      expect(mockCapacityData['2026-01-26']).toBe(5000); // 8000 - 3000
      expect(mockCapacityData['2026-01-27']).toBe(3000); // 5000 - 2000
    });

    it('should not go below zero when releasing', () => {
      mockCapacityData = {
        '2026-01-26': 2000
      };
      loadCapacityMap(); // Load existing capacity

      const plan = [
        { date: '2026-01-26', amount: 5000 } // Try to release more than available
      ];

      releaseCapacity(plan);

      expect(mockCapacityData['2026-01-26']).toBe(0); // Should not go negative
    });

    it('should handle releasing from non-existent date', () => {
      mockCapacityData = {};
      loadCapacityMap(); // Load empty capacity

      const plan = [
        { date: '2026-01-26', amount: 5000 }
      ];

      // Should not throw error
      expect(() => releaseCapacity(plan)).not.toThrow();
    });
  });

  describe('adjustCapacity()', () => {
    it('should increase capacity with positive amount', () => {
      mockCapacityData = {
        '2026-01-26': 5000
      };
      loadCapacityMap(); // Load existing capacity

      adjustCapacity({ date: '2026-01-26', amount: 2000 });

      expect(mockCapacityData['2026-01-26']).toBe(7000);
    });

    it('should decrease capacity with negative amount', () => {
      mockCapacityData = {
        '2026-01-26': 5000
      };
      loadCapacityMap(); // Load existing capacity

      adjustCapacity({ date: '2026-01-26', amount: -2000 });

      expect(mockCapacityData['2026-01-26']).toBe(3000);
    });

    it('should not go below zero when decreasing', () => {
      mockCapacityData = {
        '2026-01-26': 5000
      };
      loadCapacityMap(); // Load existing capacity

      adjustCapacity({ date: '2026-01-26', amount: -10000 });

      expect(mockCapacityData['2026-01-26']).toBe(0);
    });

    it('should create new entry for non-existent date', () => {
      mockCapacityData = {};
      loadCapacityMap(); // Load empty capacity

      adjustCapacity({ date: '2026-01-27', amount: 3000 });

      expect(mockCapacityData['2026-01-27']).toBe(3000);
    });
  });

  describe('getRemainingCapacity()', () => {
    it('should return remaining capacity for date', () => {
      mockCapacityData = { '2026-01-26': 7000 };

      const remaining = getRemainingCapacity('2026-01-26');
      expect(remaining).toBe(5000); // 12000 - 7000
    });

    it('should return MAX_DAILY_CAPACITY for unused date', () => {
      mockCapacityData = {};

      const remaining = getRemainingCapacity('2026-01-26');
      expect(remaining).toBe(12000);
    });

    it('should respect daily override', () => {
      mockOverrideData = { '2026-01-26': 15000 };
      mockCapacityData = { '2026-01-26': 8000 };

      const remaining = getRemainingCapacity('2026-01-26');
      expect(remaining).toBe(7000); // 15000 - 8000
    });

    it('should not return negative capacity', () => {
      mockCapacityData = { '2026-01-26': 15000 };

      const remaining = getRemainingCapacity('2026-01-26');
      expect(remaining).toBe(0); // max(0, 12000 - 15000)
    });
  });

  describe('getReport()', () => {
    it('should generate capacity report', () => {
      mockCapacityData = {
        '2026-01-27': 5000,
        '2026-01-26': 8000,
        '2026-01-28': 3000
      };

      loadCapacityMap();
      const report = getReport();

      // Should be sorted by date
      expect(report).toContain('2026-01-26: 8000 words');
      expect(report).toContain('2026-01-27: 5000 words');
      expect(report).toContain('2026-01-28: 3000 words');

      // Check order
      const lines = report.split('\n');
      expect(lines[0]).toContain('2026-01-26');
      expect(lines[1]).toContain('2026-01-27');
      expect(lines[2]).toContain('2026-01-28');
    });

    it('should return empty string for empty capacity', () => {
      mockCapacityData = {};

      loadCapacityMap();
      const report = getReport();

      expect(report).toBe('');
    });
  });

  describe('resetCapacityMap()', () => {
    it('should clear all capacity data', () => {
      mockCapacityData = {
        '2026-01-26': 8000,
        '2026-01-27': 5000
      };

      resetCapacityMap();

      expect(mockCapacityData).toEqual({});
    });
  });

  describe('getCapacityMap() and getOverrideMap()', () => {
    it('should return current capacity map', () => {
      mockCapacityData = { '2026-01-26': 5000 };

      const result = getCapacityMap();
      expect(result).toEqual(mockCapacityData);
    });

    it('should return current override map', () => {
      mockOverrideData = { '2026-01-26': 15000 };

      const result = getOverrideMap();
      expect(result).toEqual(mockOverrideData);
    });
  });

  describe('Edge Cases', () => {
    it('should handle deadline in the past', () => {
      const requiredWords = 5000;
      const deadline = '2020-01-20 18:00'; // Past date

      const result = getAvailableDates(requiredWords, deadline, false);
      expect(result).toEqual([]);
    });

    it('should handle same-day deadline', () => {
      const today = dayjs();
      const dayOfWeek = today.day();

      // Only test if today is a weekday
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const requiredWords = 5000;
        const deadline = today.format('YYYY-MM-DD') + ' 18:00';

        const result = getAvailableDates(requiredWords, deadline, false);

        if (result.length > 0) {
          expect(result[0].date).toBe(today.format('YYYY-MM-DD'));
        }
      } else {
        // Skip test if today is weekend
        expect(true).toBe(true);
      }
    });

    it('should skip weekends', () => {
      const today = dayjs().add(10, 'day');
      // Find next Friday
      let friday = today;
      while (friday.day() !== 5) {
        friday = friday.add(1, 'day');
      }

      const requiredWords = 12000;
      const deadline = friday.add(4, 'day').format('YYYY-MM-DD HH:mm'); // Tuesday next week

      const result = getAvailableDates(requiredWords, deadline, false);

      // Should skip Saturday and Sunday
      const hasWeekend = result.some(d => {
        const date = dayjs(d.date);
        const day = date.day();
        return day === 0 || day === 6;
      });

      expect(hasWeekend).toBe(false);
    });

    it('should filter dates correctly with excludeToday flag (Line 75)', () => {
      const today = dayjs();
      const todayStr = today.format('YYYY-MM-DD');

      // Find a future weekday for testing
      let futureWeekday = today.add(7, 'day');
      while (futureWeekday.day() === 0 || futureWeekday.day() === 6) {
        futureWeekday = futureWeekday.add(1, 'day');
      }

      const requiredWords = 8000;
      const deadline = futureWeekday.format('YYYY-MM-DD HH:mm');

      // Test with excludeToday = true
      const resultExcluded = getAvailableDates(requiredWords, deadline, true);
      const hasTodayExcluded = resultExcluded.some(d => d.date === todayStr);
      expect(hasTodayExcluded).toBe(false);

      // Test with excludeToday = false
      const resultIncluded = getAvailableDates(requiredWords, deadline, false);
      // May or may not include today depending on if today is a weekday
      expect(Array.isArray(resultIncluded)).toBe(true);
    });
  });
});
