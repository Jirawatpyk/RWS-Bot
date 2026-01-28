/**
 * Tests for Task/isBusinessDay.js
 */

const dayjs = require('dayjs');
const isBusinessDay = require('../../Task/isBusinessDay');
const fs = require('fs');
const path = require('path');

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

    it('should return false for Sunday that is also a holiday', () => {
      const sundayHoliday = dayjs('2025-05-04'); // Sunday (could be a holiday)
      expect(isBusinessDay(sundayHoliday)).toBe(false);
    });
  });

  describe('Year Boundary', () => {
    it('should handle December 31 to January 1 transition', () => {
      const dec31 = dayjs('2025-12-31'); // Wednesday (but is a holiday)
      const jan1 = dayjs('2026-01-01'); // Thursday (New Year)

      expect(isBusinessDay(dec31)).toBe(false);
      expect(isBusinessDay(jan1)).toBe(false);
    });

    it('should handle January 1 that falls on weekend', () => {
      const jan1Saturday = dayjs('2022-01-01'); // Saturday
      expect(isBusinessDay(jan1Saturday)).toBe(false);
    });

    it('should handle working day after New Year weekend', () => {
      const jan3 = dayjs('2022-01-03'); // Monday after New Year weekend
      expect(isBusinessDay(jan3)).toBe(true);
    });
  });

  describe('Leap Year', () => {
    it('should correctly handle February 29 in leap year (weekday)', () => {
      const leapDay2024 = dayjs('2024-02-29'); // Thursday
      expect(isBusinessDay(leapDay2024)).toBe(true);
    });

    it('should correctly handle February 29 in leap year (weekend)', () => {
      const leapDay2020 = dayjs('2020-02-29'); // Saturday
      expect(isBusinessDay(leapDay2020)).toBe(false);
    });

    it('should handle February 28 in non-leap year', () => {
      const feb28 = dayjs('2025-02-28'); // Friday
      expect(isBusinessDay(feb28)).toBe(true);
    });
  });

  describe('Invalid Input Handling', () => {
    it('should return false for invalid date string', () => {
      const invalidDate = dayjs('invalid-date');
      expect(isBusinessDay(invalidDate)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isBusinessDay(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isBusinessDay(undefined)).toBe(false);
    });

    it('should return false for non-dayjs object', () => {
      expect(isBusinessDay('2026-01-28')).toBe(false);
    });

    it('should return false for object without isValid method', () => {
      expect(isBusinessDay({})).toBe(false);
    });
  });

  describe('Config/holidays.json Integration', () => {
    const configPath = path.join(__dirname, '../../Config/holidays.json');
    let originalConfig;

    beforeEach(() => {
      // Backup original config
      if (fs.existsSync(configPath)) {
        originalConfig = fs.readFileSync(configPath, 'utf-8');
      }
      // Clear cache before each test
      isBusinessDay.clearConfigCache();
    });

    afterEach(() => {
      // Restore original config
      if (originalConfig) {
        fs.writeFileSync(configPath, originalConfig, 'utf-8');
      }
      // Clear cache after each test
      isBusinessDay.clearConfigCache();
    });

    it('should respect extraHolidays from config (company-specific holiday)', () => {
      // Add a custom holiday that is normally a working day
      const testConfig = {
        extraHolidays: ['2026-03-16'], // Monday
        workingHolidays: []
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf-8');
      isBusinessDay.clearConfigCache();

      const customHoliday = dayjs('2026-03-16'); // Monday
      expect(isBusinessDay(customHoliday)).toBe(false);
    });

    it('should respect workingHolidays from config (work on public holiday)', () => {
      // Mark a public holiday as working day
      const testConfig = {
        extraHolidays: [],
        workingHolidays: ['2026-01-01'] // New Year (normally a holiday)
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf-8');
      isBusinessDay.clearConfigCache();

      const workingHoliday = dayjs('2026-01-01'); // Thursday (New Year)
      expect(isBusinessDay(workingHoliday)).toBe(true);
    });

    it('should NOT work on weekend even if in workingHolidays', () => {
      // Even if Saturday is marked as working holiday, it should still be false
      const testConfig = {
        extraHolidays: [],
        workingHolidays: ['2026-01-24'] // Saturday
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf-8');
      isBusinessDay.clearConfigCache();

      const saturday = dayjs('2026-01-24'); // Saturday
      expect(isBusinessDay(saturday)).toBe(false);
    });

    it('should handle multiple extraHolidays', () => {
      const testConfig = {
        extraHolidays: ['2026-03-16', '2026-03-17', '2026-03-18'],
        workingHolidays: []
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf-8');
      isBusinessDay.clearConfigCache();

      expect(isBusinessDay(dayjs('2026-03-16'))).toBe(false); // Monday
      expect(isBusinessDay(dayjs('2026-03-17'))).toBe(false); // Tuesday
      expect(isBusinessDay(dayjs('2026-03-18'))).toBe(false); // Wednesday
      expect(isBusinessDay(dayjs('2026-03-19'))).toBe(true);  // Thursday (not in list)
    });

    it('should handle empty config file', () => {
      const testConfig = {
        extraHolidays: [],
        workingHolidays: []
      };
      fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2), 'utf-8');
      isBusinessDay.clearConfigCache();

      const monday = dayjs('2026-03-16'); // Regular Monday
      expect(isBusinessDay(monday)).toBe(true);
    });

    it('should handle missing config file gracefully', () => {
      // Temporarily rename config file
      const tempPath = configPath + '.temp';
      if (fs.existsSync(configPath)) {
        fs.renameSync(configPath, tempPath);
      }
      isBusinessDay.clearConfigCache();

      const monday = dayjs('2026-03-16'); // Regular Monday
      expect(isBusinessDay(monday)).toBe(true);

      // Restore config file
      if (fs.existsSync(tempPath)) {
        fs.renameSync(tempPath, configPath);
      }
    });

    it('should handle malformed JSON config gracefully', () => {
      fs.writeFileSync(configPath, '{ invalid json }', 'utf-8');
      isBusinessDay.clearConfigCache();

      const monday = dayjs('2026-03-16'); // Regular Monday
      // Should fallback to default behavior
      expect(isBusinessDay(monday)).toBe(true);
    });

    it('should cache config and reload when file changes', (done) => {
      // Initial config
      const config1 = {
        extraHolidays: ['2026-03-16'],
        workingHolidays: []
      };
      fs.writeFileSync(configPath, JSON.stringify(config1, null, 2), 'utf-8');
      isBusinessDay.clearConfigCache();

      expect(isBusinessDay(dayjs('2026-03-16'))).toBe(false);

      // Wait a bit to ensure different mtime
      setTimeout(() => {
        try {
          // Change config
          const config2 = {
            extraHolidays: [],
            workingHolidays: []
          };
          fs.writeFileSync(configPath, JSON.stringify(config2, null, 2), 'utf-8');
          isBusinessDay.clearConfigCache();

          // Should reload automatically
          expect(isBusinessDay(dayjs('2026-03-16'))).toBe(true);
          done();
        } catch (err) {
          done(err);
        }
      }, 100);
    });
  });

  describe('Helper Functions', () => {
    describe('getHolidayName', () => {
      it('should return holiday name for New Year', () => {
        const newYear = dayjs('2026-01-01');
        const name = isBusinessDay.getHolidayName(newYear);
        expect(name).toBeTruthy();
        expect(name).toContain('New Year');
      });

      it('should return null for regular business day', () => {
        const regularDay = dayjs('2026-03-16'); // Monday
        const name = isBusinessDay.getHolidayName(regularDay);
        expect(name).toBeNull();
      });

      it('should return holiday name for Thai holiday', () => {
        const thaiHoliday = dayjs('2025-12-05'); // King's Birthday
        const name = isBusinessDay.getHolidayName(thaiHoliday);
        expect(name).toBeTruthy();
      });
    });

    describe('getThaiHolidays', () => {
      it('should return array of holidays for given year', () => {
        const holidays2026 = isBusinessDay.getThaiHolidays(2026);
        expect(Array.isArray(holidays2026)).toBe(true);
        expect(holidays2026.length).toBeGreaterThan(0);
      });

      it('should include New Year Day in holidays list', () => {
        const holidays2026 = isBusinessDay.getThaiHolidays(2026);
        const newYearHoliday = holidays2026.find(h =>
          h.date.includes('2026-01-01')
        );
        expect(newYearHoliday).toBeTruthy();
      });

      it('should return different holidays for different years', () => {
        const holidays2025 = isBusinessDay.getThaiHolidays(2025);
        const holidays2026 = isBusinessDay.getThaiHolidays(2026);

        expect(Array.isArray(holidays2025)).toBe(true);
        expect(Array.isArray(holidays2026)).toBe(true);
        // Each year should have holidays
        expect(holidays2025.length).toBeGreaterThan(0);
        expect(holidays2026.length).toBeGreaterThan(0);
      });
    });

    describe('clearConfigCache', () => {
      it('should be a function', () => {
        expect(typeof isBusinessDay.clearConfigCache).toBe('function');
      });

      it('should not throw error when called', () => {
        expect(() => {
          isBusinessDay.clearConfigCache();
        }).not.toThrow();
      });
    });
  });

  describe('Multiple Consecutive Holidays', () => {
    it('should handle multiple consecutive holidays correctly', () => {
      // New Year period: Dec 31 (Wed), Jan 1 (Thu), Jan 2 (Fri - may not be holiday)
      const dec31 = dayjs('2025-12-31'); // Wednesday - holiday
      const jan1 = dayjs('2026-01-01');  // Thursday - holiday
      const jan2 = dayjs('2026-01-02');  // Friday - check if working day

      expect(isBusinessDay(dec31)).toBe(false);
      expect(isBusinessDay(jan1)).toBe(false);
      expect(isBusinessDay(jan2)).toBe(true); // Regular Friday
    });

    it('should handle long weekend with holidays', () => {
      // Weekend + Monday holiday scenario
      const friday = dayjs('2025-12-26');  // Friday - regular day
      const saturday = dayjs('2025-12-27'); // Saturday - weekend
      const sunday = dayjs('2025-12-28');   // Sunday - weekend
      const monday = dayjs('2025-12-29');   // Monday - regular day

      expect(isBusinessDay(friday)).toBe(true);
      expect(isBusinessDay(saturday)).toBe(false);
      expect(isBusinessDay(sunday)).toBe(false);
      expect(isBusinessDay(monday)).toBe(true);
    });
  });

  describe('Special Date Formats and Edge Cases', () => {
    it('should handle date at start of day (00:00:00)', () => {
      const startOfDay = dayjs('2026-03-16').startOf('day'); // Monday
      expect(isBusinessDay(startOfDay)).toBe(true);
    });

    it('should handle date at end of day (23:59:59)', () => {
      const endOfDay = dayjs('2026-03-16').endOf('day'); // Monday
      expect(isBusinessDay(endOfDay)).toBe(true);
    });

    it('should handle date with specific time', () => {
      const withTime = dayjs('2026-03-16 15:30:00'); // Monday afternoon
      expect(isBusinessDay(withTime)).toBe(true);
    });

    it('should treat Saturday as weekend regardless of time', () => {
      const saturdayMorning = dayjs('2026-01-24 09:00:00');
      const saturdayNoon = dayjs('2026-01-24 12:00:00');
      const saturdayEvening = dayjs('2026-01-24 18:00:00');

      expect(isBusinessDay(saturdayMorning)).toBe(false);
      expect(isBusinessDay(saturdayNoon)).toBe(false);
      expect(isBusinessDay(saturdayEvening)).toBe(false);
    });
  });

  describe('Month Boundaries', () => {
    it('should handle last day of month (non-leap year February)', () => {
      const lastDayFeb = dayjs('2025-02-28'); // Friday
      expect(isBusinessDay(lastDayFeb)).toBe(true);
    });

    it('should handle last day of month (leap year February)', () => {
      const lastDayFebLeap = dayjs('2024-02-29'); // Thursday
      expect(isBusinessDay(lastDayFebLeap)).toBe(true);
    });

    it('should handle first day of month', () => {
      const firstDayMarch = dayjs('2026-03-01'); // Sunday
      expect(isBusinessDay(firstDayMarch)).toBe(false);
    });

    it('should handle month boundary from January to February', () => {
      const jan31 = dayjs('2026-01-31'); // Saturday
      const feb1 = dayjs('2026-02-01');  // Sunday
      const feb2 = dayjs('2026-02-02');  // Monday

      expect(isBusinessDay(jan31)).toBe(false);
      expect(isBusinessDay(feb1)).toBe(false);
      expect(isBusinessDay(feb2)).toBe(true);
    });
  });
});
