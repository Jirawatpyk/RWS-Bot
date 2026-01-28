/**
 * Custom Error Classes for AUTO RWS
 *
 * Provides structured error types for type-safe error handling
 * using instanceof instead of string matching on error.message.
 *
 * Usage:
 *   const { BrowserAutomationError } = require('../Errors/customErrors');
 *   throw new BrowserAutomationError('Element not found', 'STEP_1');
 *   // catch: if (err instanceof BrowserAutomationError) { ... }
 */

/**
 * Error thrown when task acceptance evaluation fails.
 * Codes: REJECT_URGENT_OUT_OF_HOURS, REJECT_CAPACITY, REJECT_INVALID_DEADLINE
 */
class TaskAcceptanceError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {string} code - Rejection code (e.g., 'REJECT_CAPACITY')
   */
  constructor(message, code) {
    super(message);
    this.name = 'TaskAcceptanceError';
    this.code = code;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TaskAcceptanceError);
    }
  }
}

/**
 * Error thrown during browser automation steps in execAccept.
 * Carries the step identifier so callers know exactly which step failed.
 */
class BrowserAutomationError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {string} step - Step identifier (e.g., 'STEP_1', 'STEP_2', 'STEP_2TO6')
   * @param {Object} [details={}] - Additional context (selector, url, etc.)
   */
  constructor(message, step, details = {}) {
    super(message);
    this.name = 'BrowserAutomationError';
    this.step = step;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BrowserAutomationError);
    }
  }
}

/**
 * Error thrown for IMAP connection or email parsing failures.
 * Codes: CONNECTION_FAILED, PARSE_ERROR, AUTH_FAILED, TIMEOUT
 */
class IMAPError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {string} code - Error code (e.g., 'CONNECTION_FAILED')
   * @param {Object} [details={}] - Additional context
   */
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'IMAPError';
    this.code = code;
    this.details = details;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IMAPError);
    }
  }
}

/**
 * Error thrown for file read/write operations (JSON persistence, config files).
 */
class FileIOError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {string} filePath - Path to the file that caused the error
   * @param {'read'|'write'} operation - The operation that failed
   */
  constructor(message, filePath, operation) {
    super(message);
    this.name = 'FileIOError';
    this.filePath = filePath;
    this.operation = operation;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileIOError);
    }
  }
}

module.exports = {
  TaskAcceptanceError,
  BrowserAutomationError,
  IMAPError,
  FileIOError
};
