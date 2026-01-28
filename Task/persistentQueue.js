/**
 * Task/persistentQueue.js
 * SQLite-backed persistent task queue for crash recovery and audit trail.
 *
 * Design rationale:
 *   The in-memory TaskQueue works with async functions that cannot be serialized.
 *   This module stores task *metadata* (orderId, url, status, timestamps, etc.)
 *   so that after a crash we know which tasks were mid-processing and can flag
 *   them for human review or automatic retry via the dashboard.
 *
 * Status flow:  pending -> processing -> completed | failed
 *               failed  -> pending   (via requeue)
 *
 * WAL mode is enabled for better concurrent read/write performance.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logInfo, logSuccess, logFail } = require('../Logs/logger');

// Default config - overridden by Config/constants.js PERSISTENT_QUEUE if available
const DEFAULT_CONFIG = {
  DB_PATH: path.join(__dirname, '..', 'data', 'taskQueue.db'),
  STALE_TIMEOUT: 10 * 60 * 1000,            // 10 minutes
  CLEANUP_AGE: 7 * 24 * 60 * 60 * 1000,     // 7 days
  RECOVERY_ON_BOOT: true,
};

class PersistentTaskQueue {
  /**
   * @param {object} [config] - Override default config
   * @param {string} [config.dbPath] - Path to SQLite database file
   * @param {number} [config.staleTimeout] - Ms before a processing task is considered stale
   * @param {number} [config.cleanupAge] - Ms before completed/failed tasks are purged
   * @param {boolean} [config.recoveryOnBoot] - Whether to recover stale tasks on construction
   */
  constructor(config = {}) {
    this.config = {
      dbPath: config.dbPath || DEFAULT_CONFIG.DB_PATH,
      staleTimeout: config.staleTimeout ?? DEFAULT_CONFIG.STALE_TIMEOUT,
      cleanupAge: config.cleanupAge ?? DEFAULT_CONFIG.CLEANUP_AGE,
      recoveryOnBoot: config.recoveryOnBoot ?? DEFAULT_CONFIG.RECOVERY_ON_BOOT,
    };

    this._ensureDirectory();
    this.db = new Database(this.config.dbPath);
    this._initialize();

    if (this.config.recoveryOnBoot) {
      const recovered = this.recoverStaleTasks(this.config.staleTimeout);
      if (recovered > 0) {
        logInfo(`[PersistentQueue] Recovered ${recovered} stale task(s) on boot`);
      }
    }
  }

  // ================================================================ Setup

  /** Ensure the parent directory for the DB file exists */
  _ensureDirectory() {
    const dir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** Create tables and enable WAL mode */
  _initialize() {
    // WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL');
    // Synchronous NORMAL is a good balance of safety and speed with WAL
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_data   TEXT    NOT NULL,
        status      TEXT    NOT NULL DEFAULT 'pending',
        priority    INTEGER NOT NULL DEFAULT 5,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error       TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status     ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority    ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at  ON tasks(created_at);
    `);

    // Prepare frequently-used statements for performance
    this._stmts = {
      enqueue: this.db.prepare(`
        INSERT INTO tasks (task_data, status, priority, created_at, updated_at)
        VALUES (@taskData, 'pending', @priority, datetime('now'), datetime('now'))
      `),

      dequeue: this.db.prepare(`
        UPDATE tasks
        SET status = 'processing', updated_at = datetime('now')
        WHERE id = (
          SELECT id FROM tasks
          WHERE status = 'pending'
          ORDER BY priority ASC, created_at ASC
          LIMIT 1
        )
        RETURNING *
      `),

      markCompleted: this.db.prepare(`
        UPDATE tasks
        SET status = 'completed', updated_at = datetime('now'), error = NULL
        WHERE id = @id
      `),

      markFailed: this.db.prepare(`
        UPDATE tasks
        SET status = 'failed',
            updated_at = datetime('now'),
            error = @error,
            retry_count = retry_count + 1
        WHERE id = @id
      `),

      requeue: this.db.prepare(`
        UPDATE tasks
        SET status = 'pending', updated_at = datetime('now')
        WHERE id = @id
      `),

      pendingCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'
      `),

      processingCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM tasks WHERE status = 'processing'
      `),

      statusSummary: this.db.prepare(`
        SELECT status, COUNT(*) as count FROM tasks GROUP BY status
      `),

      recoverStale: this.db.prepare(`
        UPDATE tasks
        SET status = 'pending', updated_at = datetime('now')
        WHERE status = 'processing'
          AND updated_at < datetime('now', @offsetSeconds || ' seconds')
      `),

      cleanup: this.db.prepare(`
        DELETE FROM tasks
        WHERE status IN ('completed', 'failed')
          AND updated_at < datetime('now', @offsetSeconds || ' seconds')
      `),

      getById: this.db.prepare(`
        SELECT * FROM tasks WHERE id = @id
      `),

      getByStatus: this.db.prepare(`
        SELECT * FROM tasks WHERE status = @status ORDER BY priority ASC, created_at ASC
      `),

      getRecent: this.db.prepare(`
        SELECT * FROM tasks ORDER BY created_at DESC LIMIT @limit
      `),
    };
  }

  // ================================================================ Core Operations

  /**
   * Add a task to the persistent queue.
   * @param {object} task - Task data (orderId, url, amountWords, etc.)
   * @param {number} [priority=5] - Lower number = higher priority (1-10)
   * @returns {{ id: number }} - The inserted row id
   */
  enqueue(task, priority = 5) {
    const taskData = JSON.stringify(task);
    const result = this._stmts.enqueue.run({ taskData, priority });
    return { id: result.lastInsertRowid };
  }

  /**
   * Atomically dequeue the highest-priority pending task.
   * Uses RETURNING clause so dequeue is a single atomic statement.
   * @returns {object|null} - The task row (with parsed task_data) or null
   */
  dequeue() {
    const row = this._stmts.dequeue.get();
    if (!row) return null;
    return this._parseRow(row);
  }

  /**
   * Mark a task as completed.
   * @param {number} id - Task row id
   * @returns {{ changes: number }}
   */
  markCompleted(id) {
    const result = this._stmts.markCompleted.run({ id });
    return { changes: result.changes };
  }

  /**
   * Mark a task as failed with error message and increment retry_count.
   * @param {number} id - Task row id
   * @param {string} error - Error description
   * @returns {{ changes: number }}
   */
  markFailed(id, error) {
    const errorStr = typeof error === 'string' ? error : String(error);
    const result = this._stmts.markFailed.run({ id, error: errorStr });
    return { changes: result.changes };
  }

  /**
   * Move a failed task back to pending for retry.
   * @param {number} id - Task row id
   * @returns {{ changes: number }}
   */
  requeue(id) {
    const result = this._stmts.requeue.run({ id });
    return { changes: result.changes };
  }

  // ================================================================ Queries

  /**
   * @returns {number} Number of pending tasks
   */
  getPendingCount() {
    return this._stmts.pendingCount.get().count;
  }

  /**
   * @returns {number} Number of processing tasks
   */
  getProcessingCount() {
    return this._stmts.processingCount.get().count;
  }

  /**
   * Get summary statistics of all task statuses.
   * @returns {object} e.g. { pending: 3, processing: 1, completed: 10, failed: 2, total: 16 }
   */
  getStatus() {
    const rows = this._stmts.statusSummary.all();
    const summary = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };
    for (const row of rows) {
      summary[row.status] = row.count;
      summary.total += row.count;
    }
    return summary;
  }

  /**
   * Get a task by ID.
   * @param {number} id
   * @returns {object|null}
   */
  getById(id) {
    const row = this._stmts.getById.get({ id });
    return row ? this._parseRow(row) : null;
  }

  /**
   * Get all tasks with a specific status.
   * @param {string} status - 'pending' | 'processing' | 'completed' | 'failed'
   * @returns {object[]}
   */
  getByStatus(status) {
    return this._stmts.getByStatus.all({ status }).map(r => this._parseRow(r));
  }

  /**
   * Get recent tasks (for dashboard display).
   * @param {number} [limit=50]
   * @returns {object[]}
   */
  getRecent(limit = 50) {
    return this._stmts.getRecent.all({ limit }).map(r => this._parseRow(r));
  }

  // ================================================================ Maintenance

  /**
   * Recover tasks stuck in 'processing' state (e.g. after a crash).
   * Tasks whose updated_at is older than timeoutMs are moved back to 'pending'.
   * @param {number} [timeoutMs] - Defaults to config.staleTimeout
   * @returns {number} Number of recovered tasks
   */
  recoverStaleTasks(timeoutMs) {
    const timeout = timeoutMs ?? this.config.staleTimeout;
    if (typeof timeout !== 'number' || isNaN(timeout) || timeout <= 0) {
      logFail('[PersistentQueue] Invalid staleTimeout value, skipping recovery');
      return 0;
    }
    // Convert ms to negative seconds offset for SQLite datetime arithmetic
    const offsetSeconds = `-${Math.floor(timeout / 1000)}`;
    const result = this._stmts.recoverStale.run({ offsetSeconds });
    return result.changes;
  }

  /**
   * Delete old completed/failed tasks.
   * @param {number} [olderThanMs] - Defaults to config.cleanupAge
   * @returns {number} Number of deleted tasks
   */
  cleanup(olderThanMs) {
    const age = olderThanMs ?? this.config.cleanupAge;
    if (typeof age !== 'number' || isNaN(age) || age <= 0) {
      logFail('[PersistentQueue] Invalid cleanupAge value, skipping cleanup');
      return 0;
    }
    const offsetSeconds = `-${Math.floor(age / 1000)}`;
    const result = this._stmts.cleanup.run({ offsetSeconds });
    if (result.changes > 0) {
      logInfo(`[PersistentQueue] Cleaned up ${result.changes} old task(s)`);
    }
    return result.changes;
  }

  /**
   * Close the database connection. Call this on shutdown.
   */
  close() {
    try {
      if (this.db && this.db.open) {
        this.db.close();
        logInfo('[PersistentQueue] Database closed');
      }
    } catch (err) {
      logFail(`[PersistentQueue] Error closing database: ${err.message}`);
    }
  }

  // ================================================================ Helpers

  /**
   * Parse a raw DB row, deserializing task_data JSON.
   * @param {object} row
   * @returns {object}
   */
  _parseRow(row) {
    let taskData = {};
    try {
      taskData = JSON.parse(row.task_data);
    } catch {
      taskData = { _raw: row.task_data };
    }
    return {
      id: row.id,
      taskData,
      status: row.status,
      priority: row.priority,
      retryCount: row.retry_count,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = { PersistentTaskQueue };
