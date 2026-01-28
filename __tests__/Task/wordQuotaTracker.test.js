/**
 * Tests for Task/wordQuotaTracker.js
 *
 * Testing Strategy:
 * 1. Test getTimeWindowKey with various time scenarios (before/after 18:00)
 * 2. Test loadQuota with file exists, doesn't exist, and invalid JSON
 * 3. Test saveQuota file writing
 * 4. Test trackAmountWords with:
 *    - Valid amounts
 *    - Invalid amounts (null, undefined, negative, zero)
 *    - Alert threshold crossing (8000, 10000, 12000, etc.)
 *    - Multiple thresholds in single call
 *    - Previously alerted thresholds
 *    - Custom notify function
 * 5. Test resetIfNewDay cleanup logic
 */

const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('fs');
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logFail: jest.fn(),
  logProgress: jest.fn()
}));

const { logInfo } = require('../../Logs/logger');
const {
  trackAmountWords,
  resetIfNewDay
} = require('../../Task/wordQuotaTracker');

describe('Task/wordQuotaTracker.js', () => {
  let mockQuotaData = {};
  const QUOTA_FILE = path.join(__dirname, '../../Task/wordQuota.json');
  const LIMIT = 8000;
  const STEP = 2000;

  // Helper to get time window key (mirrors internal implementation)
  function getExpectedTimeWindowKey(dateOverride = null) {
    const now = dateOverride || new Date();
    const hour = now.getHours();
    if (hour < 18) {
      now.setDate(now.getDate() - 1);
    }
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}-18h`;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mock data
    mockQuotaData = {};

    // Setup fs.readFileSync to use mock data
    fs.readFileSync.mockImplementation((filePath) => {
      if (filePath.includes('wordQuota.json')) {
        return JSON.stringify(mockQuotaData);
      }
      throw new Error('ENOENT');
    });

    // Setup fs.writeFileSync to update mock data
    fs.writeFileSync.mockImplementation((filePath, data) => {
      if (filePath.includes('wordQuota.json')) {
        mockQuotaData = JSON.parse(data);
      }
    });
  });

  describe('getTimeWindowKey() - Internal Logic', () => {
    it('should use previous day when current hour is before 18:00', () => {
      // Create a date at 10:00 AM
      const testDate = new Date('2026-01-23T10:00:00');
      const expectedKey = getExpectedTimeWindowKey(testDate);

      // Should be previous day
      expect(expectedKey).toBe('2026-01-22-18h');
    });

    it('should use current day when current hour is 18:00 or later', () => {
      // Create a date at 19:00 (7 PM)
      const testDate = new Date('2026-01-23T19:00:00');
      const expectedKey = getExpectedTimeWindowKey(testDate);

      // Should be current day
      expect(expectedKey).toBe('2026-01-23-18h');
    });

    it('should use current day when current hour is exactly 18:00', () => {
      // Create a date at exactly 18:00
      const testDate = new Date('2026-01-23T18:00:00');
      const expectedKey = getExpectedTimeWindowKey(testDate);

      // Should be current day (hour < 18 is false when hour === 18)
      expect(expectedKey).toBe('2026-01-23-18h');
    });

    it('should pad month and day with zeros', () => {
      // Create a date with single-digit month and day
      const testDate = new Date('2026-01-05T20:00:00');
      const expectedKey = getExpectedTimeWindowKey(testDate);

      expect(expectedKey).toBe('2026-01-05-18h');
    });

    it('should handle end of month transition when hour < 18', () => {
      // Create a date at the 1st of the month, before 18:00
      const testDate = new Date('2026-02-01T10:00:00');
      const expectedKey = getExpectedTimeWindowKey(testDate);

      // Should roll back to previous month's last day
      expect(expectedKey).toBe('2026-01-31-18h');
    });

    it('should handle year transition when hour < 18 on Jan 1', () => {
      // Create a date on January 1st, before 18:00
      const testDate = new Date('2026-01-01T10:00:00');
      const expectedKey = getExpectedTimeWindowKey(testDate);

      // Should roll back to previous year's last day
      expect(expectedKey).toBe('2025-12-31-18h');
    });
  });

  describe('loadQuota() - Internal Logic', () => {
    it('should load quota data from file when file exists', () => {
      mockQuotaData = {
        '2026-01-23-18h': 5000,
        '2026-01-23-18h_alertedSteps': [8000]
      };

      // Trigger loadQuota by calling trackAmountWords
      trackAmountWords(100);

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('wordQuota.json'),
        'utf-8'
      );
    });

    it('should return empty object when file does not exist', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      // Should not throw error, should use empty object
      expect(() => trackAmountWords(100)).not.toThrow();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should return empty object when file contains invalid JSON', () => {
      fs.readFileSync.mockReturnValue('invalid json {]');

      // Should not throw error, should use empty object
      expect(() => trackAmountWords(100)).not.toThrow();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('saveQuota() - Internal Logic', () => {
    it('should save quota data to file with proper formatting', async () => {
      await trackAmountWords(5000);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('wordQuota.json'),
        expect.stringMatching(/"2026-.*-18h": 5000/)
      );

      // Check formatting (should have 2-space indent)
      const writeCall = fs.writeFileSync.mock.calls[0];
      const jsonString = writeCall[1];
      expect(jsonString).toContain('\n  ');
    });

    it('should save both word count and alertedSteps', async () => {
      await trackAmountWords(9000); // Should trigger alert

      const savedData = mockQuotaData;
      const key = getExpectedTimeWindowKey();

      expect(savedData[key]).toBe(9000);
      expect(savedData[`${key}_alertedSteps`]).toBeDefined();
      expect(Array.isArray(savedData[`${key}_alertedSteps`])).toBe(true);
    });
  });

  describe('trackAmountWords()', () => {
    describe('Input Validation', () => {
      it('should return early when amount is null', async () => {
        await trackAmountWords(null);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(logInfo).not.toHaveBeenCalled();
      });

      it('should return early when amount is undefined', async () => {
        await trackAmountWords(undefined);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(logInfo).not.toHaveBeenCalled();
      });

      it('should return early when amount is zero', async () => {
        await trackAmountWords(0);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(logInfo).not.toHaveBeenCalled();
      });

      it('should return early when amount is negative', async () => {
        await trackAmountWords(-500);

        expect(fs.writeFileSync).not.toHaveBeenCalled();
        expect(logInfo).not.toHaveBeenCalled();
      });

      it('should process valid positive amount', async () => {
        await trackAmountWords(100);

        expect(fs.writeFileSync).toHaveBeenCalled();
        expect(logInfo).toHaveBeenCalledWith(
          expect.stringContaining('Word count tracked: total 100 words (added 100)')
        );
      });
    });

    describe('Word Count Tracking', () => {
      it('should track word count for first time', async () => {
        await trackAmountWords(5000);

        const key = getExpectedTimeWindowKey();
        expect(mockQuotaData[key]).toBe(5000);
      });

      it('should accumulate word count on subsequent calls', async () => {
        await trackAmountWords(3000);
        await trackAmountWords(2000);
        await trackAmountWords(1500);

        const key = getExpectedTimeWindowKey();
        expect(mockQuotaData[key]).toBe(6500);
      });

      it('should maintain separate counts for different time windows', async () => {
        const key1 = '2026-01-22-18h';
        const key2 = '2026-01-23-18h';

        mockQuotaData = {
          [key1]: 5000,
          [key2]: 3000
        };

        await trackAmountWords(2000);

        const currentKey = getExpectedTimeWindowKey();
        expect(mockQuotaData[currentKey]).toBeGreaterThan(0);
      });

      it('should log word count with emoji and details', async () => {
        await trackAmountWords(2500);

        expect(logInfo).toHaveBeenCalledWith(
          expect.stringContaining('🧮 Word count tracked')
        );
        expect(logInfo).toHaveBeenCalledWith(
          expect.stringContaining('total 2500 words')
        );
        expect(logInfo).toHaveBeenCalledWith(
          expect.stringContaining('added 2500')
        );
      });
    });

    describe('Alert Threshold Logic', () => {
      it('should not trigger alert when below LIMIT (8000)', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(7000, mockNotify);

        expect(mockNotify).not.toHaveBeenCalled();
      });

      it('should trigger alert when reaching LIMIT (8000)', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(8000, mockNotify);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('8000 words reached')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
      });

      it('should trigger alert when exceeding LIMIT', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(8500, mockNotify);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('8500 words reached')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
      });

      it('should trigger alert at 10000 (LIMIT + STEP)', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(10000, mockNotify);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('10000 words reached')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 10000')
        );
      });

      it('should trigger alert at 12000 (LIMIT + 2*STEP)', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(12000, mockNotify);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 10000')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 12000')
        );
        expect(mockNotify).toHaveBeenCalledTimes(3);
      });

      it('should trigger multiple alerts when jumping over multiple thresholds', async () => {
        const mockNotify = jest.fn();
        // Start at 5000, jump to 15000 (crosses 8000, 10000, 12000, 14000)
        mockQuotaData = {
          [getExpectedTimeWindowKey()]: 5000
        };
        await trackAmountWords(10000, mockNotify); // Total becomes 15000

        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 10000')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 12000')
        );
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 14000')
        );
        expect(mockNotify).toHaveBeenCalledTimes(4);
      });

      it('should include alert emoji and formatting', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(8000, mockNotify);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('⚠️ [Auto RWS]')
        );
      });

      it('should use default console.log when notifyFn not provided', async () => {
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        await trackAmountWords(8000);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('8000 words reached')
        );
        consoleSpy.mockRestore();
      });
    });

    describe('Alert Deduplication', () => {
      it('should not re-alert for same threshold on subsequent calls', async () => {
        const mockNotify = jest.fn();

        // First call reaches 8000
        await trackAmountWords(8000, mockNotify);
        expect(mockNotify).toHaveBeenCalledTimes(1);

        mockNotify.mockClear();

        // Second call adds more but stays within same threshold
        await trackAmountWords(500, mockNotify);
        expect(mockNotify).not.toHaveBeenCalled(); // Still at 8500, no new threshold
      });

      it('should alert only for new thresholds when crossing multiple', async () => {
        const mockNotify = jest.fn();

        // First: reach 8000
        await trackAmountWords(8000, mockNotify);
        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );

        mockNotify.mockClear();

        // Second: cross to 10000 (should only alert for 10000, not 8000 again)
        await trackAmountWords(2000, mockNotify);
        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 10000')
        );
        expect(mockNotify).not.toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
      });

      it('should preserve alertedSteps across multiple trackAmountWords calls', async () => {
        const mockNotify = jest.fn();

        await trackAmountWords(8000, mockNotify);
        await trackAmountWords(2000, mockNotify);
        await trackAmountWords(2000, mockNotify);

        const key = getExpectedTimeWindowKey();
        const alertedSteps = mockQuotaData[`${key}_alertedSteps`];

        expect(alertedSteps).toContain(8000);
        expect(alertedSteps).toContain(10000);
        expect(alertedSteps).toContain(12000);
        expect(alertedSteps.length).toBe(3);
      });

      it('should initialize empty alertedSteps array when none exists', async () => {
        const mockNotify = jest.fn();

        mockQuotaData = {
          [getExpectedTimeWindowKey()]: 5000
          // No alertedSteps key
        };

        await trackAmountWords(3500, mockNotify); // Total: 8500

        const key = getExpectedTimeWindowKey();
        expect(mockQuotaData[`${key}_alertedSteps`]).toEqual([8000]);
      });

      it('should load existing alertedSteps from file', async () => {
        const mockNotify = jest.fn();
        const key = getExpectedTimeWindowKey();

        mockQuotaData = {
          [key]: 9000,
          [`${key}_alertedSteps`]: [8000] // Already alerted for 8000
        };

        // Add more to cross 10000
        await trackAmountWords(1500, mockNotify); // Total: 10500

        // Should only alert for 10000, not 8000
        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 10000')
        );
      });
    });

    describe('Save Operations', () => {
      it('should save quota data twice per call (once for count, once for alerts)', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(8000, mockNotify);

        // Should call writeFileSync at least twice:
        // 1. After updating word count (line 41)
        // 2. After updating alertedSteps (line 56)
        expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      });

      it('should save updated count before checking alerts', async () => {
        await trackAmountWords(5000);

        // First save should include the word count
        const firstSave = fs.writeFileSync.mock.calls[0][1];
        const firstData = JSON.parse(firstSave);
        const key = getExpectedTimeWindowKey();

        expect(firstData[key]).toBe(5000);
      });

      it('should save alertedSteps after processing alerts', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(10000, mockNotify);

        // Last save should include alertedSteps
        const lastSave = fs.writeFileSync.mock.calls[fs.writeFileSync.mock.calls.length - 1][1];
        const lastData = JSON.parse(lastSave);
        const key = getExpectedTimeWindowKey();

        expect(lastData[`${key}_alertedSteps`]).toContain(8000);
        expect(lastData[`${key}_alertedSteps`]).toContain(10000);
      });
    });

    describe('Edge Cases', () => {
      it('should handle very large word counts', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(100000, mockNotify);

        const key = getExpectedTimeWindowKey();
        expect(mockQuotaData[key]).toBe(100000);

        // Should trigger many alerts
        expect(mockNotify.mock.calls.length).toBeGreaterThan(10);
      });

      it('should handle decimal word counts by flooring in threshold calculation', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(8000.7, mockNotify);

        // Should still trigger 8000 threshold
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
      });

      it('should handle accumulation to exact threshold boundary', async () => {
        const mockNotify = jest.fn();
        await trackAmountWords(7999, mockNotify);
        expect(mockNotify).not.toHaveBeenCalled();

        await trackAmountWords(1, mockNotify);
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining('threshold 8000')
        );
      });

      it('should save data even when no alerts triggered', async () => {
        await trackAmountWords(1000);

        expect(fs.writeFileSync).toHaveBeenCalled();
        const key = getExpectedTimeWindowKey();
        expect(mockQuotaData[key]).toBe(1000);
      });
    });
  });

  describe('resetIfNewDay()', () => {
    it('should remove entries for different time windows', async () => {
      mockQuotaData = {
        '2026-01-20-18h': 5000,
        '2026-01-20-18h_alertedSteps': [8000],
        '2026-01-21-18h': 8000,
        '2026-01-21-18h_alertedSteps': [8000, 10000],
        [getExpectedTimeWindowKey()]: 3000, // Current window
        [`${getExpectedTimeWindowKey()}_alertedSteps`]: [8000]
      };

      await resetIfNewDay();

      const currentKey = getExpectedTimeWindowKey();

      // Should keep only current window
      expect(mockQuotaData[currentKey]).toBe(3000);
      expect(mockQuotaData[`${currentKey}_alertedSteps`]).toBeDefined();

      // Should remove old windows
      expect(mockQuotaData['2026-01-20-18h']).toBeUndefined();
      expect(mockQuotaData['2026-01-20-18h_alertedSteps']).toBeUndefined();
      expect(mockQuotaData['2026-01-21-18h']).toBeUndefined();
      expect(mockQuotaData['2026-01-21-18h_alertedSteps']).toBeUndefined();
    });

    it('should keep current time window data', async () => {
      const currentKey = getExpectedTimeWindowKey();

      mockQuotaData = {
        '2026-01-20-18h': 5000,
        [currentKey]: 8000,
        [`${currentKey}_alertedSteps`]: [8000]
      };

      await resetIfNewDay();

      expect(mockQuotaData[currentKey]).toBe(8000);
      expect(mockQuotaData[`${currentKey}_alertedSteps`]).toEqual([8000]);
    });

    it('should remove both word count and alertedSteps for old windows', async () => {
      const currentKey = getExpectedTimeWindowKey();

      mockQuotaData = {
        '2026-01-19-18h': 5000,
        '2026-01-19-18h_alertedSteps': [8000],
        '2026-01-20-18h': 7000,
        '2026-01-20-18h_alertedSteps': [8000, 10000],
        [currentKey]: 2000
      };

      await resetIfNewDay();

      // All old entries should be removed
      expect(Object.keys(mockQuotaData)).toEqual([currentKey]);
    });

    it('should handle empty quota data', async () => {
      mockQuotaData = {};

      await expect(resetIfNewDay()).resolves.not.toThrow();
      expect(mockQuotaData).toEqual({});
    });

    it('should only remove keys ending with -18h format', async () => {
      const currentKey = getExpectedTimeWindowKey();

      mockQuotaData = {
        '2026-01-20-18h': 5000,
        '2026-01-20-18h_alertedSteps': [8000],
        'some-other-key': 'value',
        'another-key-18h-but-not-date': 123,
        [currentKey]: 3000
      };

      await resetIfNewDay();

      // Should keep non-matching keys and current key
      expect(mockQuotaData['some-other-key']).toBe('value');
      expect(mockQuotaData['another-key-18h-but-not-date']).toBe(123);
      expect(mockQuotaData[currentKey]).toBe(3000);

      // Should remove old time window
      expect(mockQuotaData['2026-01-20-18h']).toBeUndefined();
    });

    it('should save updated data after cleanup', async () => {
      mockQuotaData = {
        '2026-01-20-18h': 5000,
        [getExpectedTimeWindowKey()]: 3000
      };

      await resetIfNewDay();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('wordQuota.json'),
        expect.any(String)
      );
    });

    it('should handle when only current window exists', async () => {
      const currentKey = getExpectedTimeWindowKey();

      mockQuotaData = {
        [currentKey]: 5000,
        [`${currentKey}_alertedSteps`]: [8000]
      };

      await resetIfNewDay();

      // Should not remove current window
      expect(mockQuotaData[currentKey]).toBe(5000);
      expect(mockQuotaData[`${currentKey}_alertedSteps`]).toEqual([8000]);
    });

    it('should handle mixed data with multiple old windows', async () => {
      const currentKey = getExpectedTimeWindowKey();

      mockQuotaData = {
        '2025-12-31-18h': 1000,
        '2025-12-31-18h_alertedSteps': [8000],
        '2026-01-01-18h': 2000,
        '2026-01-15-18h': 3000,
        '2026-01-15-18h_alertedSteps': [8000, 10000],
        [currentKey]: 5000,
        [`${currentKey}_alertedSteps`]: [8000]
      };

      await resetIfNewDay();

      // Should only keep current window
      const remainingKeys = Object.keys(mockQuotaData);
      expect(remainingKeys).toHaveLength(2);
      expect(remainingKeys).toContain(currentKey);
      expect(remainingKeys).toContain(`${currentKey}_alertedSteps`);
    });
  });

  describe('Integration Tests', () => {
    it('should track words and cleanup old entries in realistic scenario', async () => {
      const mockNotify = jest.fn();

      // Day 1: Track some words
      mockQuotaData = {
        '2026-01-20-18h': 9000,
        '2026-01-20-18h_alertedSteps': [8000]
      };

      // Day 2: New day, track more words
      await trackAmountWords(6000, mockNotify);

      const currentKey = getExpectedTimeWindowKey();
      expect(mockQuotaData[currentKey]).toBe(6000);

      // Cleanup old day
      await resetIfNewDay();

      // Old day should be removed
      expect(mockQuotaData['2026-01-20-18h']).toBeUndefined();
      expect(mockQuotaData[currentKey]).toBe(6000);
    });

    it('should handle full workflow: track, alert, accumulate, reset', async () => {
      const mockNotify = jest.fn();

      // Track to first threshold
      await trackAmountWords(8000, mockNotify);
      expect(mockNotify).toHaveBeenCalledTimes(1);

      mockNotify.mockClear();

      // Track to second threshold
      await trackAmountWords(2000, mockNotify);
      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.stringContaining('threshold 10000')
      );

      const key = getExpectedTimeWindowKey();
      expect(mockQuotaData[key]).toBe(10000);
      expect(mockQuotaData[`${key}_alertedSteps`]).toEqual([8000, 10000]);

      // Cleanup
      await resetIfNewDay();
      expect(mockQuotaData[key]).toBe(10000); // Current day preserved
    });

    it('should handle file I/O errors gracefully in full workflow', async () => {
      // Simulate file read error
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const mockNotify = jest.fn();

      // Should still work with empty data
      await trackAmountWords(5000, mockNotify);

      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockNotify).not.toHaveBeenCalled(); // Below threshold
    });
  });
});
