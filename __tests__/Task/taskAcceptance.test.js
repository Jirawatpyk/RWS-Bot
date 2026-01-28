/**
 * Tests for Task/taskAcceptance.js
 *
 * Testing Strategy:
 * 1. Test all utility functions (parseDeadline, adjustMidnight, etc.)
 * 2. Test evaluateTaskAcceptance for all acceptance scenarios
 * 3. Test evaluateTaskAcceptance for all rejection scenarios
 * 4. Test edge cases (boundary conditions, invalid inputs)
 * 5. Test policy overrides
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);

// Mock CapacityTracker before requiring taskAcceptance
jest.mock('../../Task/CapacityTracker', () => ({
  getAvailableDates: jest.fn()
}));

const {
  evaluateTaskAcceptance,
  REASONS,
  DEFAULT_POLICY,
  parseDeadline,
  adjustMidnight,
  isWithinWorkingHours,
  isNightDeadline,
  computeEffectiveDeadline,
  shouldExcludeToday,
  planCapacity
} = require('../../Task/taskAcceptance');

const { getAvailableDates } = require('../../Task/CapacityTracker');

describe('Task/taskAcceptance.js', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DEFAULT_POLICY', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_POLICY.workStartHour).toBe(10);
      expect(DEFAULT_POLICY.workEndHour).toBe(19);
      expect(DEFAULT_POLICY.urgentHoursThreshold).toBe(6);
      expect(DEFAULT_POLICY.shiftNightDeadline).toBe(true);
    });
  });

  describe('REASONS', () => {
    it('should have all required reason codes', () => {
      expect(REASONS.ACCEPTED_NORMAL).toBe('ACCEPTED_NORMAL');
      expect(REASONS.ACCEPTED_URGENT_IN_HOURS).toBe('ACCEPTED_URGENT_IN_HOURS');
      expect(REASONS.REJECT_URGENT_OUT_OF_HOURS).toBe('REJECT_URGENT_OUT_OF_HOURS');
      expect(REASONS.REJECT_CAPACITY).toBe('REJECT_CAPACITY');
      expect(REASONS.REJECT_INVALID_DEADLINE).toBe('REJECT_INVALID_DEADLINE');
    });
  });

  describe('parseDeadline()', () => {
    it('should parse YYYY-MM-DD format', () => {
      const result = parseDeadline('2026-01-25');
      expect(result).not.toBeNull();
      expect(result.isValid()).toBe(true);
      expect(result.format('YYYY-MM-DD')).toBe('2026-01-25');
    });

    it('should parse DD/MM/YYYY format', () => {
      const result = parseDeadline('25/01/2026');
      expect(result).not.toBeNull();
      expect(result.isValid()).toBe(true);
      expect(result.format('YYYY-MM-DD')).toBe('2026-01-25');
    });

    it('should parse DD-MM-YYYY format', () => {
      const result = parseDeadline('25-01-2026');
      expect(result).not.toBeNull();
      expect(result.isValid()).toBe(true);
      expect(result.format('YYYY-MM-DD')).toBe('2026-01-25');
    });

    it('should parse DD.MM.YYYY format', () => {
      const result = parseDeadline('25.01.2026');
      expect(result).not.toBeNull();
      expect(result.isValid()).toBe(true);
      expect(result.format('YYYY-MM-DD')).toBe('2026-01-25');
    });

    it('should parse YYYY-MM-DD HH:mm format', () => {
      const result = parseDeadline('2026-01-25 14:30');
      expect(result).not.toBeNull();
      expect(result.isValid()).toBe(true);
      expect(result.format('YYYY-MM-DD HH:mm')).toBe('2026-01-25 14:30');
    });

    it('should parse DD.MM.YYYY h:mm A format', () => {
      const result = parseDeadline('25.01.2026 2:30 PM');
      expect(result).not.toBeNull();
      expect(result.isValid()).toBe(true);
      expect(result.hour()).toBe(14);
      expect(result.minute()).toBe(30);
    });

    it('should return null for invalid date', () => {
      const result = parseDeadline('invalid-date');
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = parseDeadline(null);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = parseDeadline(undefined);
      expect(result).toBeNull();
    });
  });

  describe('adjustMidnight()', () => {
    it('should shift midnight (00:00) to previous day 23:59', () => {
      const midnight = dayjs('2026-01-25 00:00', 'YYYY-MM-DD HH:mm');
      const adjusted = adjustMidnight(midnight);

      expect(adjusted.format('YYYY-MM-DD HH:mm')).toBe('2026-01-24 23:59');
    });

    it('should not adjust non-midnight times', () => {
      const nonMidnight = dayjs('2026-01-25 14:30', 'YYYY-MM-DD HH:mm');
      const adjusted = adjustMidnight(nonMidnight);

      expect(adjusted.format('YYYY-MM-DD HH:mm')).toBe('2026-01-25 14:30');
    });

    it('should return null for null input', () => {
      const result = adjustMidnight(null);
      expect(result).toBeNull();
    });
  });

  describe('isWithinWorkingHours()', () => {
    const policy = { workStartHour: 10, workEndHour: 19 };

    it('should return true for 10:00 (start of working hours)', () => {
      const time = dayjs('2026-01-25 10:00', 'YYYY-MM-DD HH:mm');
      expect(isWithinWorkingHours(time, policy)).toBe(true);
    });

    it('should return true for 14:00 (middle of working hours)', () => {
      const time = dayjs('2026-01-25 14:00', 'YYYY-MM-DD HH:mm');
      expect(isWithinWorkingHours(time, policy)).toBe(true);
    });

    it('should return true for 18:59 (last minute of working hours)', () => {
      const time = dayjs('2026-01-25 18:59', 'YYYY-MM-DD HH:mm');
      expect(isWithinWorkingHours(time, policy)).toBe(true);
    });

    it('should return false for 19:00 (end of working hours - exclusive)', () => {
      const time = dayjs('2026-01-25 19:00', 'YYYY-MM-DD HH:mm');
      expect(isWithinWorkingHours(time, policy)).toBe(false);
    });

    it('should return false for 09:59 (before working hours)', () => {
      const time = dayjs('2026-01-25 09:59', 'YYYY-MM-DD HH:mm');
      expect(isWithinWorkingHours(time, policy)).toBe(false);
    });

    it('should return false for 20:00 (after working hours)', () => {
      const time = dayjs('2026-01-25 20:00', 'YYYY-MM-DD HH:mm');
      expect(isWithinWorkingHours(time, policy)).toBe(false);
    });

    it('should return false for 08:00 (early morning)', () => {
      const time = dayjs('2026-01-25 08:00', 'YYYY-MM-DD HH:mm');
      expect(isWithinWorkingHours(time, policy)).toBe(false);
    });
  });

  describe('isNightDeadline()', () => {
    const policy = { workStartHour: 10 };

    it('should return true for 00:00', () => {
      const time = dayjs('2026-01-25 00:00', 'YYYY-MM-DD HH:mm');
      expect(isNightDeadline(time, policy)).toBe(true);
    });

    it('should return true for 09:59', () => {
      const time = dayjs('2026-01-25 09:59', 'YYYY-MM-DD HH:mm');
      expect(isNightDeadline(time, policy)).toBe(true);
    });

    it('should return false for 10:00', () => {
      const time = dayjs('2026-01-25 10:00', 'YYYY-MM-DD HH:mm');
      expect(isNightDeadline(time, policy)).toBe(false);
    });

    it('should return false for 14:00', () => {
      const time = dayjs('2026-01-25 14:00', 'YYYY-MM-DD HH:mm');
      expect(isNightDeadline(time, policy)).toBe(false);
    });
  });

  describe('computeEffectiveDeadline()', () => {
    const policy = { workStartHour: 10, shiftNightDeadline: true };

    it('should shift night deadline to previous day 23:59', () => {
      const nightDeadline = dayjs('2026-01-25 08:00', 'YYYY-MM-DD HH:mm');
      const effective = computeEffectiveDeadline(nightDeadline, policy);

      expect(effective.format('YYYY-MM-DD HH:mm')).toBe('2026-01-24 23:59');
    });

    it('should not shift day deadline', () => {
      const dayDeadline = dayjs('2026-01-25 14:00', 'YYYY-MM-DD HH:mm');
      const effective = computeEffectiveDeadline(dayDeadline, policy);

      expect(effective.format('YYYY-MM-DD HH:mm')).toBe('2026-01-25 14:00');
    });

    it('should not shift if shiftNightDeadline is false', () => {
      const policyNoShift = { workStartHour: 10, shiftNightDeadline: false };
      const nightDeadline = dayjs('2026-01-25 08:00', 'YYYY-MM-DD HH:mm');
      const effective = computeEffectiveDeadline(nightDeadline, policyNoShift);

      expect(effective.format('YYYY-MM-DD HH:mm')).toBe('2026-01-25 08:00');
    });
  });

  describe('shouldExcludeToday()', () => {
    const policy = { workEndHour: 19 };

    it('should return false before cutoff time', () => {
      const beforeCutoff = dayjs('2026-01-25 18:00', 'YYYY-MM-DD HH:mm');
      expect(shouldExcludeToday(beforeCutoff, policy)).toBe(false);
    });

    it('should return false at cutoff time', () => {
      const atCutoff = dayjs('2026-01-25 19:00', 'YYYY-MM-DD HH:mm');
      expect(shouldExcludeToday(atCutoff, policy)).toBe(false);
    });

    it('should return true after cutoff time', () => {
      const afterCutoff = dayjs('2026-01-25 19:01', 'YYYY-MM-DD HH:mm');
      expect(shouldExcludeToday(afterCutoff, policy)).toBe(true);
    });

    it('should return true late in the evening', () => {
      const evening = dayjs('2026-01-25 20:00', 'YYYY-MM-DD HH:mm');
      expect(shouldExcludeToday(evening, policy)).toBe(true);
    });
  });

  describe('planCapacity()', () => {
    it('should call getAvailableDates with correct parameters', () => {
      const mockPlan = [
        { date: '2026-01-25', amount: 5000 },
        { date: '2026-01-26', amount: 3000 }
      ];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = planCapacity({
        amountWords: 8000,
        effectiveDeadline: dayjs('2026-01-26 18:00'),
        excludeToday: false
      });

      expect(getAvailableDates).toHaveBeenCalledWith(
        8000,
        expect.anything(),
        false
      );
      expect(result.allocationPlan).toEqual(mockPlan);
      expect(result.totalPlanned).toBe(8000);
    });

    it('should calculate totalPlanned correctly', () => {
      const mockPlan = [
        { date: '2026-01-25', amount: 4000 },
        { date: '2026-01-26', amount: 4000 },
        { date: '2026-01-27', amount: 2000 }
      ];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = planCapacity({
        amountWords: 10000,
        effectiveDeadline: dayjs('2026-01-27 18:00'),
        excludeToday: false
      });

      expect(result.totalPlanned).toBe(10000);
    });
  });

  describe('evaluateTaskAcceptance() - Invalid Input', () => {
    it('should reject task with invalid plannedEndDate', () => {
      const result = evaluateTaskAcceptance({
        orderId: 'TEST001',
        amountWords: 5000,
        plannedEndDate: 'invalid-date'
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe(REASONS.REJECT_INVALID_DEADLINE);
      expect(result.message).toContain('Invalid plannedEndDate');
      expect(result.urgent).toBe(false);
      expect(result.allocationPlan).toEqual([]);
    });

    it('should reject task with null plannedEndDate', () => {
      const result = evaluateTaskAcceptance({
        orderId: 'TEST002',
        amountWords: 5000,
        plannedEndDate: null
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe(REASONS.REJECT_INVALID_DEADLINE);
    });
  });

  describe('evaluateTaskAcceptance() - Urgent Tasks', () => {
    beforeEach(() => {
      // Mock current time to 2026-01-25 14:00
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-25 14:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reject urgent task outside working hours (deadline at 20:00, 6 hours away)', () => {
      const result = evaluateTaskAcceptance({
        orderId: 'URGENT001',
        amountWords: 3000,
        plannedEndDate: '2026-01-25 20:00'
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe(REASONS.REJECT_URGENT_OUT_OF_HOURS);
      expect(result.urgent).toBe(true);
      expect(result.inWorkingHours).toBe(false);
    });

    it('should reject urgent task outside working hours (deadline at 19:30, 5.5 hours away)', () => {
      // 14:00 + 5.5 hours = 19:30, which is urgent (< 6 hours) but outside working hours (>= 19:00)
      const mockPlan = [{ date: '2026-01-25', amount: 3000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'URGENT002',
        amountWords: 3000,
        plannedEndDate: '2026-01-25 19:30'
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe(REASONS.REJECT_URGENT_OUT_OF_HOURS);
      expect(result.urgent).toBe(true);
      expect(result.inWorkingHours).toBe(false);
    });

    it('should accept urgent task within working hours with capacity', () => {
      const mockPlan = [{ date: '2026-01-25', amount: 3000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'URGENT003',
        amountWords: 3000,
        plannedEndDate: '2026-01-25 18:00'
      });

      expect(result.accepted).toBe(true);
      expect(result.code).toBe(REASONS.ACCEPTED_URGENT_IN_HOURS);
      expect(result.urgent).toBe(true);
      expect(result.inWorkingHours).toBe(true);
    });
  });

  describe('evaluateTaskAcceptance() - Capacity Checks', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-25 14:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reject task when insufficient capacity', () => {
      const mockPlan = [
        { date: '2026-01-27', amount: 3000 }
      ];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'CAP001',
        amountWords: 5000,
        plannedEndDate: '2026-01-27 18:00'
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe(REASONS.REJECT_CAPACITY);
      expect(result.message).toContain('Over capacity');
      expect(result.message).toContain('required 5000');
      expect(result.message).toContain('planned 3000');
      expect(result.totalPlanned).toBe(3000);
    });

    it('should reject task when no capacity available', () => {
      getAvailableDates.mockReturnValue([]);

      const result = evaluateTaskAcceptance({
        orderId: 'CAP002',
        amountWords: 5000,
        plannedEndDate: '2026-01-27 18:00'
      });

      expect(result.accepted).toBe(false);
      expect(result.code).toBe(REASONS.REJECT_CAPACITY);
      expect(result.totalPlanned).toBe(0);
    });

    it('should accept task when exact capacity available', () => {
      const mockPlan = [
        { date: '2026-01-27', amount: 5000 }
      ];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'CAP003',
        amountWords: 5000,
        plannedEndDate: '2026-01-27 18:00'
      });

      expect(result.accepted).toBe(true);
      expect(result.code).toBe(REASONS.ACCEPTED_NORMAL);
      expect(result.totalPlanned).toBe(5000);
    });

    it('should accept task when more than enough capacity', () => {
      const mockPlan = [
        { date: '2026-01-27', amount: 3000 },
        { date: '2026-01-28', amount: 4000 }
      ];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'CAP004',
        amountWords: 5000,
        plannedEndDate: '2026-01-28 18:00'
      });

      expect(result.accepted).toBe(true);
      expect(result.totalPlanned).toBe(7000);
    });
  });

  describe('evaluateTaskAcceptance() - Normal Acceptance', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-25 14:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should accept normal task with sufficient capacity', () => {
      const mockPlan = [
        { date: '2026-01-27', amount: 4000 },
        { date: '2026-01-28', amount: 4000 }
      ];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'NORMAL001',
        amountWords: 8000,
        plannedEndDate: '2026-01-28 18:00'
      });

      expect(result.accepted).toBe(true);
      expect(result.code).toBe(REASONS.ACCEPTED_NORMAL);
      expect(result.message).toContain('Accepted: normal deadline');
      expect(result.urgent).toBe(false);
      expect(result.allocationPlan).toEqual(mockPlan);
    });
  });

  describe('evaluateTaskAcceptance() - Policy Overrides', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-25 14:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should respect custom urgentHoursThreshold', () => {
      const mockPlan = [{ date: '2026-01-25', amount: 3000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance(
        {
          orderId: 'OVERRIDE001',
          amountWords: 3000,
          plannedEndDate: '2026-01-25 22:00' // 8 hours away
        },
        { urgentHoursThreshold: 10 } // Custom threshold
      );

      expect(result.urgent).toBe(true); // Should be urgent with threshold of 10
      expect(result.accepted).toBe(false); // But rejected because deadline is outside working hours
      expect(result.code).toBe(REASONS.REJECT_URGENT_OUT_OF_HOURS);
    });

    it('should respect custom working hours', () => {
      const mockPlan = [{ date: '2026-01-25', amount: 3000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance(
        {
          orderId: 'OVERRIDE002',
          amountWords: 3000,
          plannedEndDate: '2026-01-25 20:00'
        },
        {
          workStartHour: 8,
          workEndHour: 21 // Extended working hours
        }
      );

      // With extended hours, 20:00 is within working hours
      expect(result.inWorkingHours).toBe(true);
    });
  });

  describe('evaluateTaskAcceptance() - Edge Cases', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-25 14:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should handle midnight deadline (00:00) correctly', () => {
      const mockPlan = [{ date: '2026-01-26', amount: 5000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'EDGE001',
        amountWords: 5000,
        plannedEndDate: '2026-01-27 00:00'
      });

      // Midnight should be adjusted to previous day 23:59
      expect(result.rawDeadline).toBe('2026-01-26 23:59');
    });

    it('should handle task with 0 words', () => {
      getAvailableDates.mockReturnValue([]);

      const result = evaluateTaskAcceptance({
        orderId: 'EDGE002',
        amountWords: 0,
        plannedEndDate: '2026-01-27 18:00'
      });

      expect(result.accepted).toBe(true); // 0 words requires 0 capacity
    });

    it('should handle very large word count', () => {
      const mockPlan = [
        { date: '2026-01-27', amount: 12000 },
        { date: '2026-01-28', amount: 12000 }
      ];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'EDGE003',
        amountWords: 24000,
        plannedEndDate: '2026-01-28 18:00'
      });

      expect(result.accepted).toBe(true);
      expect(result.totalPlanned).toBe(24000);
    });

    it('should include all required fields in result', () => {
      const mockPlan = [{ date: '2026-01-27', amount: 5000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'COMPLETE001',
        amountWords: 5000,
        plannedEndDate: '2026-01-27 18:00'
      });

      expect(result).toHaveProperty('accepted');
      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('rawDeadline');
      expect(result).toHaveProperty('effectiveDeadline');
      expect(result).toHaveProperty('urgent');
      expect(result).toHaveProperty('inWorkingHours');
      expect(result).toHaveProperty('allocationPlan');
      expect(result).toHaveProperty('totalPlanned');
    });
  });

  describe('evaluateTaskAcceptance() - Boundary Hours (exactly 6 hours)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-25 12:00:00'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should treat task exactly 6 hours away as urgent', () => {
      const mockPlan = [{ date: '2026-01-25', amount: 3000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'BOUNDARY001',
        amountWords: 3000,
        plannedEndDate: '2026-01-25 18:00' // Exactly 6 hours away
      });

      expect(result.urgent).toBe(true);
      expect(result.accepted).toBe(true); // Within working hours
      expect(result.code).toBe(REASONS.ACCEPTED_URGENT_IN_HOURS);
    });

    it('should treat task at 7 hours away as not urgent', () => {
      const mockPlan = [{ date: '2026-01-25', amount: 3000 }];
      getAvailableDates.mockReturnValue(mockPlan);

      const result = evaluateTaskAcceptance({
        orderId: 'BOUNDARY002',
        amountWords: 3000,
        plannedEndDate: '2026-01-25 21:00' // 7 hours away (definitely > 6)
      });

      expect(result.urgent).toBe(false);
      expect(result.code).toBe(REASONS.ACCEPTED_NORMAL);
    });
  });
});
