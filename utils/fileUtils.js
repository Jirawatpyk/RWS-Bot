// Utils/fileUtils.js — DRY utility for JSON file I/O
// Provides both synchronous (loadJSON/saveJSON) for non-critical files
// and locked/atomic variants for concurrent-safe writes (capacity.json, etc.)

const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');

/* ========================= Synchronous (non-critical) ========================= */

/**
 * Read and parse a JSON file synchronously.
 * Returns defaultValue if the file does not exist (ENOENT) or cannot be parsed.
 *
 * @param {string} filePath - Absolute or relative path to the JSON file
 * @param {*} [defaultValue={}] - Value to return when the file is missing or invalid
 * @returns {*} Parsed JSON data or defaultValue
 */
function loadJSON(filePath, defaultValue = {}) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    // ENOENT (file not found) is expected and silent.
    // SyntaxError (invalid JSON) returns defaultValue with a warning.
    // Other errors (EACCES, EISDIR) also warn to prevent silent failures.
    if (err.code !== 'ENOENT') {
      console.warn(`[fileUtils] loadJSON warning for ${filePath}: ${err.message}`);
    }
    return defaultValue;
  }
}

/**
 * Write data to a JSON file synchronously.
 * Creates parent directories if they do not exist.
 *
 * @param {string} filePath - Absolute or relative path to the JSON file
 * @param {*} data - Data to serialize as JSON
 * @param {object} [options] - Write options
 * @param {number} [options.spaces=2] - Number of spaces for JSON indentation
 */
function saveJSON(filePath, data, options = {}) {
  const { spaces = 2 } = options;
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, spaces));
}

/* ========================= Atomic & Locked (critical) ========================= */

/**
 * Write JSON data atomically: write to .tmp first, then rename.
 * Prevents partial/corrupt writes if the process crashes mid-write.
 *
 * @param {string} filePath - Target JSON file path
 * @param {*} data - Data to serialize
 * @param {object} [options]
 * @param {number} [options.spaces=2] - JSON indentation spaces
 */
function saveJSONAtomic(filePath, data, options = {}) {
  const { spaces = 2 } = options;
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(data, null, spaces);
  const tmpPath = filePath + '.tmp';

  try {
    fs.writeFileSync(tmpPath, content);
    fs.renameSync(tmpPath, filePath);
  } catch (renameErr) {
    // On Windows, renameSync can fail with EPERM if the target is being read.
    // Fallback: write directly to the target file (less atomic but still safe under lock).
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore cleanup errors */ }
    fs.writeFileSync(filePath, content);
  }
}

/**
 * Execute a function while holding an advisory file lock.
 * Ensures only one process/task can modify the file at a time.
 *
 * Usage:
 *   await withFileLock(CAPACITY_PATH, async () => {
 *     const data = loadJSON(CAPACITY_PATH);
 *     data.foo = 'bar';
 *     saveJSONAtomic(CAPACITY_PATH, data);
 *   });
 *
 * @param {string} filePath - File to lock (must exist or will be created)
 * @param {Function} fn - Async function to execute while lock is held
 * @returns {Promise<*>} Return value of fn
 */
async function withFileLock(filePath, fn) {
  // Ensure the file exists so proper-lockfile can lock it
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
  }

  const release = await lockfile.lock(filePath, {
    retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
    stale: 10000 // consider lock stale after 10s (crash recovery)
  });

  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Load JSON while holding a file lock.
 * Useful when you need a consistent read before a locked write.
 *
 * @param {string} filePath - JSON file path
 * @param {*} [defaultValue={}] - Fallback value
 * @returns {Promise<*>} Parsed data
 */
async function loadJSONWithLock(filePath, defaultValue = {}) {
  return withFileLock(filePath, () => {
    return loadJSON(filePath, defaultValue);
  });
}

module.exports = {
  loadJSON,
  saveJSON,
  saveJSONAtomic,
  withFileLock,
  loadJSONWithLock
};
