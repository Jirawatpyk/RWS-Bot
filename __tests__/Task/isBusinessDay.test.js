/**
 * Tests for Task/isBusinessDay.js
 */

const dayjs = require('dayjs');
const isBusinessDay = require('../../Task/isBusinessDay');

describe('Task/isBusinessDay.js', () => {
  describe('Weekdays', () => {
    it('should return true for Monday', () => {
      const monday = dayjs('2026-01-26'); // Monday
      expect(isBusinessDay(monday)).toBe(true);
    });

    it('should return true for Tuesday', () => {
      const tuesday = dayjs('2026-01-27'); // Tuesday
      expect(isBusinessDay(tuesday)).toBe(true);
    });

    it('should return true for Wednesday', () => {
      const wednesday = dayjs('2026-01-28'); // Wednesday
      expect(isBusinessDay(wednesday)).toBe(true);
    });

    it('should return true for Thursday', () => {
      const thursday = dayjs('2026-01-29'); // Thursday
      expect(isBusinessDay(thursday)).toBe(true);
    });

    it('should return true for Friday', () => {
      const friday = dayjs('2026-01-30'); // Friday
      expect(isBusinessDay(friday)).toBe(true);
    });
  });

  describe('Weekends', () => {
    it('should return false for Saturday', () => {
      const saturday = dayjs('2026-01-24'); // Saturday
      expect(isBusinessDay(saturday)).toBe(false);
    });

    it('should return false for Sunday', () => {
      const sunday = dayjs('2026-01-25'); // Sunday
      expect(isBusinessDay(sunday)).toBe(false);
    });
  });

  describe('Holidays', () => {
    it('should return false for New Year Day 2026', () => {
      const newYear = dayjs('2026-01-01');
      expect(isBusinessDay(newYear)).toBe(false);
    });

    it('should return true for January 2nd 2026 (not a Thai public holiday)', () => {
      // January 2nd 2026 is a Friday - not a public holiday in Thailand
      const jan2 = dayjs('2026-01-02');
      expect(isBusinessDay(jan2)).toBe(true);
    });

    it('should return false for July 28 holiday', () => {
      const holiday = dayjs('2025-07-28');
      expect(isBusinessDay(holiday)).toBe(false);
    });

    it('should return false for August 12 holiday', () => {
      const holiday = dayjs('2025-08-12');
      expect(isBusinessDay(holiday)).toBe(false);
    });

    it('should return false for October 13 holiday', () => {
      const holiday = dayjs('2025-10-13');
      expect(isBusinessDay(holiday)).toBe(false);
    });

    it('should return false for October 23 holiday', () => {
      const holiday = dayjs('2025-10-23');
      expect(isBusinessDay(holiday)).toBe(false);
    });

    it('should return false for December 5 holiday', () => {
      const holiday = dayjs('2025-12-05');
      expect(isBusinessDay(holiday)).toBe(false);
    });

    it('should return false for December 10 holiday', () => {
      const holiday = dayjs('2025-12-10');
      expect(isBusinessDay(holiday)).toBe(false);
    });

    it('should return false for New Year Eve', () => {
      const holiday = dayjs('2025-12-31');
      expect(isBusinessDay(holiday)).toBe(false);
    });
  });

  describe('Non-Holiday Weekdays', () => {
    it('should return true for regular business day', () => {
      const regularDay = dayjs('2026-03-16'); // Monday (not Sunday!)
      expect(isBusinessDay(regularDay)).toBe(true);
    });

    it('should return true for day before holiday', () => {
      const dayBefore = dayjs('2025-12-04'); // Thursday before Dec 5 holiday
      expect(isBusinessDay(dayBefore)).toBe(true);
    });

    it('should return true for day after holiday', () => {
      const dayAfter = dayjs('2026-01-05'); // Monday after Jan 1-2
      expect(isBusinessDay(dayAfter)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle leap year dates', () => {
      const leapDay = dayjs('2024-02-29'); // Thursday in leap year
      expect(isBusinessDay(leapDay)).toBe(true);
    });

    it('should handle end of month', () => {
      const endOfMonth = dayjs('2026-01-30'); // Friday
      expect(isBusinessDay(endOfMonth)).toBe(true);
    });

    it('should handle beginning of year', () => {
      const beginYear = dayjs('2026-01-05'); // Monday
      expect(isBusinessDay(beginYear)).toBe(true);
    });

    it('should handle end of year (non-holiday)', () => {
      const endYear = dayjs('2025-12-30'); // Tuesday (not a holiday)
      expect(isBusinessDay(endYear)).toBe(true);
    });
  });

  describe('Holiday on Weekend', () => {
    it('should still return false when checking a weekend that is also a holiday', () => {
      const saturdayHoliday = dayjs('2026-01-03'); // Saturday
      expect(isBusinessDay(saturdayHoliday)).toBe(false);
    });
  });
});
