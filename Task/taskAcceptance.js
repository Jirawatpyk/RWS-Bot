/**
 * Task Acceptance — Best Practice Module
 * Location: ./Task/taskAcceptance.js
 *
 * Goals
 * - Keep main.js as an orchestrator only (no business rules inside)
 * - Encapsulate all accept/reject logic here with small, testable functions
 * - Provide a single, deterministic evaluateTaskAcceptance() entrypoint
 * - Support working-hours rules, urgent cutoff, night-deadline shift, and capacity check
 * - Return structured reasons + context for logging & dashboards
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');

// IMPORTANT: this module depends on CapacityTracker for allocation
// getAvailableDates(amountWords, effectiveDeadline, excludeToday)
const { getAvailableDates } = require('./CapacityTracker');
const { WORKING_HOURS, CAPACITY } = require('../Config/constants');

// Register plugins locally (keeps this module self-contained)
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);

/* ========================= Config ========================= */
// Centralized policy knobs. Keep them simple & overridable from caller if needed.
const DEFAULT_POLICY = Object.freeze({
  workStartHour: WORKING_HOURS.START_HOUR,
  workEndHour: WORKING_HOURS.END_HOUR,
  urgentHoursThreshold: CAPACITY.URGENT_HOURS_THRESHOLD,
  shiftNightDeadline: true // if deadline hour < workStartHour → finish by previous day 23:59
});

/* ========================= Reasons ========================= */
// Canonical, stable reason codes for analytics & UI.
const REASONS = Object.freeze({
  ACCEPTED_NORMAL: 'ACCEPTED_NORMAL',
  ACCEPTED_URGENT_IN_HOURS: 'ACCEPTED_URGENT_IN_HOURS',

  REJECT_URGENT_OUT_OF_HOURS: 'REJECT_URGENT_OUT_OF_HOURS',
  REJECT_CAPACITY: 'REJECT_CAPACITY',
  REJECT_INVALID_DEADLINE: 'REJECT_INVALID_DEADLINE'
});

/* ========================= Utilities ========================= */
/**
 * Parse and normalize the incoming plannedEndDate to Dayjs.
 * Accepts common formats; strict parsing to avoid silent mistakes.
 */
function parseDeadline(plannedEndDate) {
  const deadline = dayjs(
    plannedEndDate,
    [
      'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY',
      'YYYY-MM-DD HH:mm', 'DD.MM.YYYY h:mm A', 'DD/MM/YYYY h:mm A', 'DD-MM-YYYY h:mm A'
    ],
    true
  );
  return deadline.isValid() ? deadline : null;
}

/**
 * If deadline is exactly 00:00 → treat as 23:59 previous day (common PM practice).
 */
function adjustMidnight(deadline) {
  if (!deadline) return null;
  if (deadline.hour() === 0 && deadline.minute() === 0) {
    return deadline.subtract(1, 'day').set('hour', 23).set('minute', 59);
  }
  return deadline;
}

/**
 * Determine whether a given time is within working hours.
 */
function isWithinWorkingHours(d, { workStartHour, workEndHour }) {
  const h = d.hour();
  return h >= workStartHour && h < workEndHour;
}

/**
 * Night deadline classification (prior to workStartHour counts as night).
 */
function isNightDeadline(d, { workStartHour }) {
  return d.hour() < workStartHour;
}

/**
 * Compute the effective deadline used for allocation: if deadline is a night deadline and
 * policy.shiftNightDeadline is true, shift to previous day 23:59.
 */
function computeEffectiveDeadline(deadline, policy) {
  if (policy.shiftNightDeadline && isNightDeadline(deadline, policy)) {
    return deadline.subtract(1, 'day').endOf('day');
  }
  return deadline;
}

/**
 * Decide whether we exclude “today” from allocation (after cutoff → push to next business day).
 * Here we use workEndHour as the cutoff; customize if you want a separate cutoff.
 */
function shouldExcludeToday(now, policy) {
  const cutoff = now.set('hour', policy.workEndHour).set('minute', 0).set('second', 0);
  return now.isAfter(cutoff);
}

/**
 * Given amountWords and an effective deadline, try to allocate capacity.
 * Returns { allocationPlan, totalPlanned }
 */
function planCapacity({ amountWords, effectiveDeadline, excludeToday }) {
  const allocationPlan = getAvailableDates(amountWords, effectiveDeadline, excludeToday);
  const totalPlanned = allocationPlan.reduce((sum, d) => sum + d.amount, 0);
  return { allocationPlan, totalPlanned };
}

/* ========================= Main Entry ========================= */
/**
 * Evaluate accept/reject with structured output.
 *
 * @param {Object} input
 * @param {string} input.orderId
 * @param {number} input.amountWords
 * @param {string|Date} input.plannedEndDate
 * @param {Object} [overrides] - optional policy overrides (e.g., weekend mode, holiday rules)
 * @returns {Object} result
 * {
 *   accepted: boolean,
 *   code: REASONS.*,
 *   message: string,
 *   rawDeadline: 'YYYY-MM-DD HH:mm',
 *   effectiveDeadline: 'YYYY-MM-DD HH:mm',
 *   urgent: boolean,
 *   inWorkingHours: boolean,
 *   allocationPlan: Array<{ date: string, amount: number }>,
 *   totalPlanned: number
 * }
 */
function evaluateTaskAcceptance({ orderId, amountWords, plannedEndDate }, overrides = {}) {
  const policy = { ...DEFAULT_POLICY, ...overrides };

  const now = dayjs();
  const parsed = parseDeadline(plannedEndDate);
  if (!parsed) {
    return {
      accepted: false,
      code: REASONS.REJECT_INVALID_DEADLINE,
      message: `Invalid plannedEndDate for order ${orderId}`,
      rawDeadline: String(plannedEndDate) || '',
      effectiveDeadline: '',
      urgent: false,
      inWorkingHours: false,
      allocationPlan: [],
      totalPlanned: 0
    };
  }

  const rawDeadline = adjustMidnight(parsed);
  const hoursToDeadline = rawDeadline.diff(now, 'hour');
  const urgent = hoursToDeadline <= policy.urgentHoursThreshold;
  // Check if deadline falls within working hours (intentionally checks deadline, not now).
  // Business rule: reject urgent tasks whose deadlines are outside working hours
  // because the team won't be available to complete them in time.
  const inWorkingHours = isWithinWorkingHours(rawDeadline, policy);

  // Hard rule: urgent + outside working hours ⇒ reject
  if (urgent && !inWorkingHours) {
    return {
      accepted: false,
      code: REASONS.REJECT_URGENT_OUT_OF_HOURS,
      message: `Urgent deadline outside working hours for order ${orderId}`,
      rawDeadline: rawDeadline.format('YYYY-MM-DD HH:mm'),
      effectiveDeadline: '',
      urgent,
      inWorkingHours,
      allocationPlan: [],
      totalPlanned: 0
    };
  }

  // Compute effective deadline for allocation (night deadline shifts to previous day EOD)
  const effectiveDeadline = computeEffectiveDeadline(rawDeadline, policy);

  // Exclude today if after cutoff
  const excludeToday = shouldExcludeToday(now, policy);

  // Try to allocate capacity
  const { allocationPlan, totalPlanned } = planCapacity({
    amountWords,
    effectiveDeadline,
    excludeToday
  });

  if (totalPlanned < amountWords) {
    return {
      accepted: false,
      code: REASONS.REJECT_CAPACITY,
      message: `Over capacity — required ${amountWords}, planned ${totalPlanned}`,
      rawDeadline: rawDeadline.format('YYYY-MM-DD HH:mm'),
      effectiveDeadline: effectiveDeadline.format('YYYY-MM-DD HH:mm'),
      urgent,
      inWorkingHours,
      allocationPlan,
      totalPlanned
    };
  }

  return {
    accepted: true,
    code: urgent ? REASONS.ACCEPTED_URGENT_IN_HOURS : REASONS.ACCEPTED_NORMAL,
    message: urgent ? 'Accepted: urgent within working hours' : 'Accepted: normal deadline',
    rawDeadline: rawDeadline.format('YYYY-MM-DD HH:mm'),
    effectiveDeadline: effectiveDeadline.format('YYYY-MM-DD HH:mm'),
    urgent,
    inWorkingHours,
    allocationPlan,
    totalPlanned
  };
}

/* ========================= Public API ========================= */
module.exports = {
  evaluateTaskAcceptance,
  REASONS,
  DEFAULT_POLICY,
  // expose utilities for unit tests / advanced rules
  parseDeadline,
  adjustMidnight,
  isWithinWorkingHours,
  isNightDeadline,
  computeEffectiveDeadline,
  shouldExcludeToday,
  planCapacity
};