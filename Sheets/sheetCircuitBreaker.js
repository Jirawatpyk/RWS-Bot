// Sheets/sheetCircuitBreaker.js
// Singleton Circuit Breaker wrapper for Google Sheets API operations
// Protects against quota exhaustion and cascading failures

const { google } = require('googleapis');
const { auth } = require('../Google/auth');
const { CircuitBreaker } = require('../Utils/circuitBreaker');
const { logInfo, logFail } = require('../Logs/logger');

// Import constants (with fallback defaults for safety)
let CB_CONFIG;
try {
  const { CIRCUIT_BREAKER } = require('../Config/constants');
  CB_CONFIG = CIRCUIT_BREAKER;
} catch {
  CB_CONFIG = {
    FAILURE_THRESHOLD: 5,
    SUCCESS_THRESHOLD: 2,
    TIMEOUT: 10000,
    RESET_TIMEOUT: 60000,
  };
}

// ===== Raw Google Sheets API functions =====

/**
 * Raw append operation - called by circuit breaker
 */
async function _rawAppend({ spreadsheetId, range, values, valueInputOption, insertDataOption }) {
  const sheets = google.sheets({ version: 'v4', auth });
  return sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: valueInputOption || 'USER_ENTERED',
    insertDataOption: insertDataOption || 'INSERT_ROWS',
    requestBody: { values },
  });
}

/**
 * Raw update operation - called by circuit breaker
 */
async function _rawUpdate({ spreadsheetId, range, values, valueInputOption }) {
  const sheets = google.sheets({ version: 'v4', auth });
  return sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: valueInputOption || 'USER_ENTERED',
    requestBody: { values },
  });
}

/**
 * Raw get operation - called by circuit breaker
 */
async function _rawGet({ spreadsheetId, range, majorDimension }) {
  const sheets = google.sheets({ version: 'v4', auth });
  return sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: majorDimension || 'ROWS',
  });
}

// ===== Circuit Breaker Instances (Singleton) =====

const circuitBreakerOptions = {
  failureThreshold: CB_CONFIG.FAILURE_THRESHOLD,
  successThreshold: CB_CONFIG.SUCCESS_THRESHOLD,
  timeout: CB_CONFIG.TIMEOUT,
  resetTimeout: CB_CONFIG.RESET_TIMEOUT,
  onStateChange: (oldState, newState) => {
    logInfo(`[SheetCircuitBreaker] State changed: ${oldState} -> ${newState}`);
  },
};

const appendCircuitBreaker = new CircuitBreaker(_rawAppend, {
  ...circuitBreakerOptions,
  name: 'sheets-append',
});

const updateCircuitBreaker = new CircuitBreaker(_rawUpdate, {
  ...circuitBreakerOptions,
  name: 'sheets-update',
});

const getCircuitBreaker = new CircuitBreaker(_rawGet, {
  ...circuitBreakerOptions,
  name: 'sheets-get',
});

// ===== Safe Wrapped Functions =====

/**
 * Safe append to Google Sheets with circuit breaker protection.
 * @param {Object} params - { spreadsheetId, range, values, valueInputOption?, insertDataOption? }
 * @returns {Promise<Object>} Google Sheets API response
 */
async function safeAppendToSheet(params) {
  return appendCircuitBreaker.execute(params);
}

/**
 * Safe update to Google Sheets with circuit breaker protection.
 * @param {Object} params - { spreadsheetId, range, values, valueInputOption? }
 * @returns {Promise<Object>} Google Sheets API response
 */
async function safeUpdateSheet(params) {
  return updateCircuitBreaker.execute(params);
}

/**
 * Safe get from Google Sheets with circuit breaker protection.
 * @param {Object} params - { spreadsheetId, range, majorDimension? }
 * @returns {Promise<Object>} Google Sheets API response
 */
async function safeGetSheet(params) {
  return getCircuitBreaker.execute(params);
}

/**
 * Get combined status of all Sheets circuit breakers (for dashboard monitoring).
 * @returns {Object} Status of all circuit breaker instances
 */
function getSheetCircuitBreakerStatus() {
  return {
    append: appendCircuitBreaker.getStatus(),
    update: updateCircuitBreaker.getStatus(),
    get: getCircuitBreaker.getStatus(),
  };
}

module.exports = {
  safeAppendToSheet,
  safeUpdateSheet,
  safeGetSheet,
  getSheetCircuitBreakerStatus,
  // Export instances for testing
  _appendCircuitBreaker: appendCircuitBreaker,
  _updateCircuitBreaker: updateCircuitBreaker,
  _getCircuitBreaker: getCircuitBreaker,
};
