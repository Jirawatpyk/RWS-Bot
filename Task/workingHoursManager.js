/**
 * WorkingHoursManager — Dynamic Working Hours with Holiday & OT Support
 * Location: ./Task/workingHoursManager.js
 *
 * Singleton class that manages:
 * - Default working hours (from Config/constants.js)
 * - Thai public holidays + company extra holidays (from Config/holidays.json)
 * - Overtime schedule per date (from public/overtimeSchedule.json)
 * - Weekend detection (Saturday = 6, Sunday = 0)
 *
 * Priority order for getWorkingHours():
 *   1. OT override for that date -> return OT hours
 *   2. Holiday (extra or Thai public) -> return null (no work)
 *   3. Weekend (Sat/Sun) -> return null (no work)
 *   4. Default working hours -> return { start, end }
 *
 * Backward compatible: taskAcceptance.js can use this instead of hardcoded hours.
 */

const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const { loadJSON, saveJSON } = require('../Utils/fileUtils');
const { WORKING_HOURS } = require('../Config/constants');
const isBusinessDay = require('./isBusinessDay');
const { clearConfigCache } = require('./isBusinessDay');

/* ========================= Paths ========================= */
const HOLIDAYS_PATH = path.join(__dirname, '../Config/holidays.json');
const OVERTIME_PATH = path.join(__dirname, '../public/overtimeSchedule.json');

/* ========================= WorkingHoursManager Class ========================= */
class WorkingHoursManager {
  constructor() {
    this.defaultHours = {
      start: WORKING_HOURS.START_HOUR,
      end: WORKING_HOURS.END_HOUR
    };
    /** @type {number|null} Cached mtime of overtimeSchedule.json to avoid unnecessary disk reads */
    this._lastOTMtimeMs = null;
    /** @type {number|null} Cached mtime of holidays.json */
    this._lastHolidayMtimeMs = null;
    this._reloadHolidays();
    this._reloadOvertime();
  }

  /* -------------------- Internal Reloads -------------------- */

  /**
   * Reload holidays from Config/holidays.json (only if file changed on disk).
   * Format: { extraHolidays: string[], workingHolidays: string[] }
   */
  _reloadHolidays() {
    const stat = fs.statSync(HOLIDAYS_PATH, { throwIfNoEntry: false });
    const mtime = stat?.mtimeMs ?? null;
    if (mtime !== null && mtime === this._lastHolidayMtimeMs) return;
    this._lastHolidayMtimeMs = mtime;
    this.holidayConfig = loadJSON(HOLIDAYS_PATH, { extraHolidays: [], workingHolidays: [] });
  }

  /**
   * Reload overtime schedule from public/overtimeSchedule.json (only if file changed on disk).
   * Format: { "YYYY-MM-DD": { start: number, end: number }, ... }
   */
  _reloadOvertime() {
    const stat = fs.statSync(OVERTIME_PATH, { throwIfNoEntry: false });
    const mtime = stat?.mtimeMs ?? null;
    if (mtime !== null && mtime === this._lastOTMtimeMs) return;
    this._lastOTMtimeMs = mtime;
    this.overtimeSchedule = loadJSON(OVERTIME_PATH, {});
  }

  /* -------------------- Core Methods -------------------- */

  /**
   * Get working hours for a specific date.
   *
   * Priority:
   *   1. OT override -> return OT hours { start, end }
   *   2. Holiday -> return null
   *   3. Weekend -> return null
   *   4. Default -> return { start, end }
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {{ start: number, end: number } | null} - Working hours or null if not a working day
   */
  getWorkingHours(dateStr) {
    this._reloadOvertime();

    // 1. Check OT override first (overrides everything, even holidays/weekends)
    const otHours = this.overtimeSchedule[dateStr];
    if (otHours && typeof otHours.start === 'number' && typeof otHours.end === 'number') {
      return { start: otHours.start, end: otHours.end };
    }

    // 2. Check if it's a working day (handles holidays + weekends via isBusinessDay)
    const d = dayjs(dateStr, 'YYYY-MM-DD', true);
    if (!d.isValid()) {
      return null;
    }

    if (!isBusinessDay(d)) {
      return null;
    }

    // 3. Default working hours
    return { ...this.defaultHours };
  }

  /**
   * Check if a given date is a working day (has any working hours).
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {boolean}
   */
  isWorkingDay(dateStr) {
    return this.getWorkingHours(dateStr) !== null;
  }

  /**
   * Check if the current moment (or a given datetime) falls within working hours.
   *
   * @param {string|dayjs.Dayjs} [dateTimeInput] - ISO string or dayjs object. Defaults to now.
   * @returns {boolean}
   */
  isWithinWorkingHours(dateTimeInput) {
    const dt = dateTimeInput ? dayjs(dateTimeInput) : dayjs();
    if (!dt.isValid()) return false;

    const dateStr = dt.format('YYYY-MM-DD');
    const hours = this.getWorkingHours(dateStr);
    if (!hours) return false;

    const h = dt.hour();
    return h >= hours.start && h < hours.end;
  }

  /**
   * Get working hours for a specific dayjs deadline object.
   * Used by taskAcceptance.js for checking deadline working hours.
   *
   * @param {dayjs.Dayjs} deadline - dayjs date object
   * @returns {{ start: number, end: number } | null}
   */
  getWorkingHoursForDate(deadline) {
    if (!deadline || !deadline.isValid()) return null;
    return this.getWorkingHours(deadline.format('YYYY-MM-DD'));
  }

  /* -------------------- OT Management -------------------- */

  /**
   * Set overtime schedule for a specific date.
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @param {{ start: number, end: number }} hours - Working hours for OT day
   */
  setOvertimeSchedule(dateStr, hours) {
    if (!dateStr || typeof hours?.start !== 'number' || typeof hours?.end !== 'number') {
      throw new Error('Invalid OT schedule: requires dateStr and { start, end } hours');
    }
    if (hours.start >= hours.end) {
      throw new Error('Invalid OT hours: start must be less than end');
    }
    if (hours.start < 0 || hours.end > 24) {
      throw new Error('Invalid OT hours: must be between 0 and 24');
    }

    this._reloadOvertime();
    this.overtimeSchedule[dateStr] = { start: hours.start, end: hours.end };
    saveJSON(OVERTIME_PATH, this.overtimeSchedule);
    this._lastOTMtimeMs = null; // Invalidate cache after write
  }

  /**
   * Remove overtime schedule for a specific date.
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {boolean} - true if removed, false if not found
   */
  removeOvertimeSchedule(dateStr) {
    this._reloadOvertime();
    if (this.overtimeSchedule[dateStr]) {
      delete this.overtimeSchedule[dateStr];
      saveJSON(OVERTIME_PATH, this.overtimeSchedule);
      this._lastOTMtimeMs = null; // Invalidate cache after write
      return true;
    }
    return false;
  }

  /**
   * Get all overtime schedules.
   *
   * @returns {Object} - { "YYYY-MM-DD": { start, end }, ... }
   */
  getOvertimeSchedule() {
    this._reloadOvertime();
    return { ...this.overtimeSchedule };
  }

  /* -------------------- Holiday Management -------------------- */

  /**
   * Add a company extra holiday.
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {boolean} - true if added, false if already exists
   */
  addHoliday(dateStr) {
    this._reloadHolidays();
    if (!this.holidayConfig.extraHolidays) {
      this.holidayConfig.extraHolidays = [];
    }
    if (this.holidayConfig.extraHolidays.includes(dateStr)) {
      return false;
    }
    this.holidayConfig.extraHolidays.push(dateStr);
    this.holidayConfig.extraHolidays.sort();
    saveJSON(HOLIDAYS_PATH, this.holidayConfig);
    this._lastHolidayMtimeMs = null; // Invalidate cache after write
    clearConfigCache(); // Clear isBusinessDay cache so it picks up new holidays
    return true;
  }

  /**
   * Remove a company extra holiday.
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {boolean} - true if removed, false if not found
   */
  removeHoliday(dateStr) {
    this._reloadHolidays();
    if (!this.holidayConfig.extraHolidays) return false;
    const idx = this.holidayConfig.extraHolidays.indexOf(dateStr);
    if (idx === -1) return false;
    this.holidayConfig.extraHolidays.splice(idx, 1);
    saveJSON(HOLIDAYS_PATH, this.holidayConfig);
    this._lastHolidayMtimeMs = null; // Invalidate cache after write
    clearConfigCache();
    return true;
  }

  /**
   * Get all holidays for a specific year (or all if no year specified).
   *
   * @param {number} [year] - Year to filter (e.g., 2026)
   * @returns {{ extraHolidays: string[], workingHolidays: string[] }}
   */
  getHolidays(year) {
    this._reloadHolidays();
    if (!year) {
      return { ...this.holidayConfig };
    }
    const yearStr = String(year);
    return {
      extraHolidays: (this.holidayConfig.extraHolidays || []).filter(d => d.startsWith(yearStr)),
      workingHolidays: (this.holidayConfig.workingHolidays || []).filter(d => d.startsWith(yearStr))
    };
  }

  /**
   * Add a working holiday override (work on a public holiday).
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {boolean} - true if added
   */
  addWorkingHoliday(dateStr) {
    this._reloadHolidays();
    if (!this.holidayConfig.workingHolidays) {
      this.holidayConfig.workingHolidays = [];
    }
    if (this.holidayConfig.workingHolidays.includes(dateStr)) {
      return false;
    }
    this.holidayConfig.workingHolidays.push(dateStr);
    this.holidayConfig.workingHolidays.sort();
    saveJSON(HOLIDAYS_PATH, this.holidayConfig);
    this._lastHolidayMtimeMs = null; // Invalidate cache after write
    clearConfigCache();
    return true;
  }

  /**
   * Remove a working holiday override.
   *
   * @param {string} dateStr - Date in YYYY-MM-DD format
   * @returns {boolean} - true if removed
   */
  removeWorkingHoliday(dateStr) {
    this._reloadHolidays();
    if (!this.holidayConfig.workingHolidays) return false;
    const idx = this.holidayConfig.workingHolidays.indexOf(dateStr);
    if (idx === -1) return false;
    this.holidayConfig.workingHolidays.splice(idx, 1);
    saveJSON(HOLIDAYS_PATH, this.holidayConfig);
    this._lastHolidayMtimeMs = null; // Invalidate cache after write
    clearConfigCache();
    return true;
  }

  /* -------------------- Summary / Status -------------------- */

  /**
   * Get a summary of current working hours configuration.
   * Useful for dashboard display.
   *
   * @returns {Object}
   */
  getStatus() {
    this._reloadHolidays();
    this._reloadOvertime();

    const today = dayjs().format('YYYY-MM-DD');
    const todayHours = this.getWorkingHours(today);

    return {
      defaultHours: this.defaultHours,
      todayHours,
      isWorkingToday: todayHours !== null,
      overtimeSchedule: { ...this.overtimeSchedule },
      holidays: {
        extraHolidays: this.holidayConfig.extraHolidays || [],
        workingHolidays: this.holidayConfig.workingHolidays || []
      }
    };
  }
}

/* ========================= Singleton ========================= */
const workingHoursManager = new WorkingHoursManager();

module.exports = { workingHoursManager, WorkingHoursManager };
