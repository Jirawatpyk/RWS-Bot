// isBusinessDay.js — ตรวจสอบว่าเป็นวันทำการหรือไม่
// ใช้ date-holidays สำหรับวันหยุดไทย + override จาก company config

const Holidays = require('date-holidays');
const path = require('path');
const fs = require('fs');

// Initialize Thai holidays
const hd = new Holidays('TH');

// Load company-specific holiday config with caching
const configPath = path.join(__dirname, '../Config/holidays.json');
let cachedConfig = null;
let configLastModified = 0;

function loadCompanyConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const stats = fs.statSync(configPath);
      // Reload only if file changed
      if (!cachedConfig || stats.mtimeMs > configLastModified) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        cachedConfig = JSON.parse(raw);
        configLastModified = stats.mtimeMs;
      }
      return cachedConfig;
    }
  } catch (err) {
    console.error('[isBusinessDay] Failed to load holidays.json:', err.message);
  }
  return { extraHolidays: [], workingHolidays: [] };
}

/**
 * Clear config cache (call after updating holidays.json via API)
 */
function clearConfigCache() {
  cachedConfig = null;
  configLastModified = 0;
}

/**
 * Check if a date is a business day
 * @param {dayjs.Dayjs} dayjsDate - dayjs date object
 * @returns {boolean} - true if business day
 */
function isBusinessDay(dayjsDate) {
  // Validate input
  if (!dayjsDate || !dayjsDate.isValid || !dayjsDate.isValid()) {
    console.error('[isBusinessDay] Invalid date provided');
    return false;
  }

  const dateStr = dayjsDate.format('YYYY-MM-DD');
  const dayOfWeek = dayjsDate.day(); // Sunday = 0, Saturday = 6
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const config = loadCompanyConfig();

  // Company override: work on this day even if it's a holiday
  if (config.workingHolidays.includes(dateStr)) {
    return !isWeekend; // Still respect weekends unless explicitly overridden
  }

  // Check Thai public holidays
  const isThaiHoliday = hd.isHoliday(dayjsDate.toDate());

  // Check company extra holidays
  const isExtraHoliday = config.extraHolidays.includes(dateStr);

  return !isWeekend && !isThaiHoliday && !isExtraHoliday;
}

/**
 * Get holiday name if date is a holiday
 * @param {dayjs.Dayjs} dayjsDate - dayjs date object
 * @returns {string|null} - holiday name or null
 */
function getHolidayName(dayjsDate) {
  const holiday = hd.isHoliday(dayjsDate.toDate());
  if (holiday && holiday.length > 0) {
    return holiday[0].name;
  }
  return null;
}

/**
 * Get all Thai holidays for a year
 * @param {number} year - year to get holidays for
 * @returns {Array} - array of holiday objects
 */
function getThaiHolidays(year) {
  return hd.getHolidays(year);
}

module.exports = isBusinessDay;
module.exports.getHolidayName = getHolidayName;
module.exports.getThaiHolidays = getThaiHolidays;
module.exports.clearConfigCache = clearConfigCache;
