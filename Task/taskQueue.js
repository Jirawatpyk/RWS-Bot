/**
 * Task/taskQueue.js
 * In-memory concurrent task queue with optional SQLite persistence.
 *
 * The queue executes async functions with configurable concurrency.
 * When persistence is enabled, task metadata is tracked in SQLite so
 * that after a crash we can see which tasks were mid-processing.
 *
 * Backward compatibility:
 *   - addTask(asyncFn) still works exactly as before.
 *   - addTask(asyncFn, taskMeta) adds persistence tracking.
 *   - If PersistentTaskQueue is unavailable (e.g. better-sqlite3 not installed),
 *     the queue falls back to pure in-memory mode silently.
 */

const { pushStatusUpdate } = require("../Dashboard/server");
const { logInfo, logFail } = require("../Logs/logger");

let PersistentTaskQueue;
try {
  ({ PersistentTaskQueue } = require('./persistentQueue'));
} catch {
  // better-sqlite3 not available — persistence disabled
  PersistentTaskQueue = null;
}

class TaskQueue {
  /**
   * @param {object} opts
   * @param {number}   [opts.concurrency=4]
   * @param {Function} [opts.onSuccess]    - Called with result on task success
   * @param {Function} [opts.onError]      - Called with error on task failure
   * @param {Function} [opts.onQueueEmpty] - Called when queue drains completely
   * @param {boolean}  [opts.enablePersistence=false] - Enable SQLite tracking
   * @param {object}   [opts.persistConfig] - Config passed to PersistentTaskQueue
   */
  constructor({ concurrency = 4, onSuccess, onError, onQueueEmpty, enablePersistence = false, persistConfig } = {}) {
    this.queue = [];
    this.processing = new Set();
    this.concurrency = concurrency;
    this.onSuccess = onSuccess;
    this.onError = onError;
    this.onQueueEmpty = onQueueEmpty;

    // Map: in-memory promise -> persistent queue row id
    this._persistMap = new Map();

    // Re-entrance guard to prevent multiple concurrent processQueue loops
    this._processingQueue = false;

    // Initialize persistent storage if requested and available
    this.persistent = null;
    if (enablePersistence) {
      this._initPersistence(persistConfig);
    }
  }

  /**
   * Try to initialize the persistent queue backend.
   * If it fails (e.g. native module issue), log and continue in-memory only.
   * @param {object} [config]
   */
  _initPersistence(config) {
    if (!PersistentTaskQueue) {
      logInfo('[TaskQueue] Persistence unavailable (better-sqlite3 not found). Running in-memory only.');
      return;
    }
    try {
      this.persistent = new PersistentTaskQueue(config);
      logInfo('[TaskQueue] Persistent queue initialized');
    } catch (err) {
      logFail(`[TaskQueue] Failed to initialize persistent queue: ${err.message}. Running in-memory only.`);
      this.persistent = null;
    }
  }

  /**
   * Add an async task function to the queue.
   *
   * @param {Function} taskFn - Async function to execute (no arguments, returns result)
   * @param {object}   [taskMeta] - Optional metadata to persist (orderId, url, etc.)
   *                                 If omitted, no persistence tracking for this task.
   */
  addTask(taskFn, taskMeta) {
    // Persist metadata if available
    let persistId = null;
    if (this.persistent && taskMeta) {
      try {
        const { id } = this.persistent.enqueue(taskMeta);
        persistId = id;
      } catch (err) {
        logFail(`[TaskQueue] Failed to enqueue to persistent store: ${err.message}`);
      }
    }

    // Wrap the original taskFn to carry the persistId
    const wrappedFn = () => {
      const promise = taskFn();
      if (persistId !== null) {
        this._persistMap.set(promise, persistId);
        // Mark as processing in persistent store
        try {
          // dequeue already sets to processing, but we used enqueue+manual
          // so we need to update status explicitly
          if (this.persistent) {
            this.persistent.db.prepare(
              `UPDATE tasks SET status = 'processing', updated_at = datetime('now') WHERE id = ?`
            ).run(persistId);
          }
        } catch {
          // Non-critical — continue
        }
      }
      return promise;
    };

    this.queue.push(wrappedFn);
    this.processQueue();
  }

  processQueue() {
    // Re-entrance guard: prevent multiple concurrent invocations from
    // launching more tasks than the concurrency limit allows.
    if (this._processingQueue) return;
    this._processingQueue = true;

    while (this.processing.size < this.concurrency && this.queue.length > 0) {
      const taskFn = this.queue.shift();
      const task = taskFn();
      this.processing.add(task);

      pushStatusUpdate();

      // Handle completion asynchronously without blocking the loop,
      // so multiple tasks can be launched concurrently within the while loop.
      task.then(
        (result) => {
          this.processing.delete(task);
          this._markPersistCompleted(task);
          if (this.onSuccess) this.onSuccess(result);
        },
        (error) => {
          this.processing.delete(task);
          this._markPersistFailed(task, error);
          if (this.onError) this.onError(error);
        }
      ).finally(() => {
        // Check if queue is fully drained
        if (this.queue.length === 0 && this.processing.size === 0) {
          if (this.onQueueEmpty) this.onQueueEmpty();
        }
        pushStatusUpdate();

        // After a task finishes, release the guard and try to process more
        this._processingQueue = false;
        this.processQueue();
      });
    }

    this._processingQueue = false;
  }

  // ================================================================ Persistence helpers

  /**
   * Mark a completed task in the persistent store.
   * @param {Promise} task - The in-memory promise reference
   */
  _markPersistCompleted(task) {
    const persistId = this._persistMap.get(task);
    if (persistId == null || !this.persistent) return;
    try {
      this.persistent.markCompleted(persistId);
    } catch (err) {
      logFail(`[TaskQueue] Failed to mark task ${persistId} completed: ${err.message}`);
    }
    this._persistMap.delete(task);
  }

  /**
   * Mark a failed task in the persistent store.
   * @param {Promise} task - The in-memory promise reference
   * @param {Error} error
   */
  _markPersistFailed(task, error) {
    const persistId = this._persistMap.get(task);
    if (persistId == null || !this.persistent) return;
    try {
      this.persistent.markFailed(persistId, error?.message || String(error));
    } catch (err) {
      logFail(`[TaskQueue] Failed to mark task ${persistId} failed: ${err.message}`);
    }
    this._persistMap.delete(task);
  }

  // ================================================================ Public persistent API

  /**
   * Get persistent queue status (for dashboard).
   * Returns null if persistence is not enabled.
   * @returns {object|null}
   */
  getPersistentStatus() {
    if (!this.persistent) return null;
    try {
      return this.persistent.getStatus();
    } catch {
      return null;
    }
  }

  /**
   * Get recent tasks from persistent store (for dashboard).
   * @param {number} [limit=50]
   * @returns {object[]|null}
   */
  getRecentTasks(limit = 50) {
    if (!this.persistent) return null;
    try {
      return this.persistent.getRecent(limit);
    } catch {
      return null;
    }
  }

  /**
   * Requeue a failed task by persistent ID (for dashboard retry button).
   * Note: This only changes the persistent status back to pending.
   * Actual re-execution requires the caller to re-submit the task function.
   * @param {number} id - Persistent task row id
   * @returns {{ success: boolean, message?: string }}
   */
  requeueTask(id) {
    if (!this.persistent) return { success: false, message: 'Persistence not enabled' };
    try {
      const task = this.persistent.getById(id);
      if (!task) return { success: false, message: 'Task not found' };
      if (task.status !== 'failed') return { success: false, message: `Cannot requeue task with status: ${task.status}` };
      this.persistent.requeue(id);
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Run cleanup on old completed/failed tasks.
   * @param {number} [olderThanMs]
   * @returns {number} Number of deleted tasks
   */
  cleanupOldTasks(olderThanMs) {
    if (!this.persistent) return 0;
    try {
      return this.persistent.cleanup(olderThanMs);
    } catch {
      return 0;
    }
  }

  /**
   * Close persistent storage. Call on process shutdown.
   */
  closePersistence() {
    if (this.persistent) {
      this.persistent.close();
      this.persistent = null;
    }
  }
}

module.exports = {
  TaskQueue
};
