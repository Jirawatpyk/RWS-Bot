/**
 * Tests for Task/persistentQueue.js
 * PersistentTaskQueue — SQLite-backed task queue for crash recovery
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock logger to suppress output during tests
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logSuccess: jest.fn(),
  logFail: jest.fn(),
}));

const { PersistentTaskQueue } = require('../../Task/persistentQueue');

// Helper: create a temp DB path for each test
function tempDbPath() {
  const dir = path.join(os.tmpdir(), 'persistentQueue-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'test.db');
}

describe('PersistentTaskQueue', () => {
  let queue;
  let dbPath;

  beforeEach(() => {
    dbPath = tempDbPath();
    queue = new PersistentTaskQueue({
      dbPath,
      recoveryOnBoot: false, // Disable auto-recovery in most tests
    });
  });

  afterEach(() => {
    if (queue) {
      queue.close();
    }
    // Clean up temp files
    try {
      const dir = path.dirname(dbPath);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ================================================================ Constructor / Setup

  describe('constructor', () => {
    test('should create database file and tables', () => {
      expect(fs.existsSync(dbPath)).toBe(true);
      expect(queue.db.open).toBe(true);
    });

    test('should enable WAL mode', () => {
      const result = queue.db.pragma('journal_mode');
      expect(result[0].journal_mode).toBe('wal');
    });

    test('should create data directory if it does not exist', () => {
      queue.close();
      const nestedDir = path.join(os.tmpdir(), 'pq-nested-' + Date.now(), 'sub', 'dir');
      const nestedPath = path.join(nestedDir, 'test.db');
      const q = new PersistentTaskQueue({ dbPath: nestedPath, recoveryOnBoot: false });
      expect(fs.existsSync(nestedPath)).toBe(true);
      q.close();
      fs.rmSync(path.join(os.tmpdir(), 'pq-nested-' + Date.now().toString().slice(0, -3)), { recursive: true, force: true });
    });

    test('should recover stale tasks on boot when recoveryOnBoot is true', () => {
      // Insert a task and set it to processing with an old timestamp
      queue.enqueue({ orderId: 'STALE-1' });
      const row = queue.dequeue();
      expect(row).not.toBeNull();

      // Manually set updated_at to 20 minutes ago
      queue.db.prepare(
        `UPDATE tasks SET updated_at = datetime('now', '-20 minutes') WHERE id = ?`
      ).run(row.id);

      queue.close();

      // Create new queue with recovery enabled and 10 min stale timeout
      const q2 = new PersistentTaskQueue({
        dbPath,
        recoveryOnBoot: true,
        staleTimeout: 10 * 60 * 1000,
      });
      // The stale task should have been recovered to pending
      const status = q2.getStatus();
      expect(status.pending).toBe(1);
      expect(status.processing).toBe(0);
      q2.close();
    });
  });

  // ================================================================ enqueue

  describe('enqueue', () => {
    test('should insert a task with default priority', () => {
      const result = queue.enqueue({ orderId: 'T-001', url: 'http://example.com' });
      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('number');

      const task = queue.getById(result.id);
      expect(task.status).toBe('pending');
      expect(task.priority).toBe(5);
      expect(task.taskData.orderId).toBe('T-001');
      expect(task.retryCount).toBe(0);
    });

    test('should insert a task with custom priority', () => {
      const result = queue.enqueue({ orderId: 'T-002' }, 1);
      const task = queue.getById(result.id);
      expect(task.priority).toBe(1);
    });

    test('should auto-increment IDs', () => {
      const r1 = queue.enqueue({ orderId: 'A' });
      const r2 = queue.enqueue({ orderId: 'B' });
      expect(r2.id).toBeGreaterThan(r1.id);
    });
  });

  // ================================================================ dequeue

  describe('dequeue', () => {
    test('should return null when queue is empty', () => {
      const result = queue.dequeue();
      expect(result).toBeNull();
    });

    test('should dequeue the oldest pending task (FIFO)', () => {
      queue.enqueue({ orderId: 'FIRST' });
      queue.enqueue({ orderId: 'SECOND' });

      const task = queue.dequeue();
      expect(task.taskData.orderId).toBe('FIRST');
      expect(task.status).toBe('processing');
    });

    test('should dequeue higher priority tasks first', () => {
      queue.enqueue({ orderId: 'LOW' }, 10);
      queue.enqueue({ orderId: 'HIGH' }, 1);
      queue.enqueue({ orderId: 'MED' }, 5);

      const task = queue.dequeue();
      expect(task.taskData.orderId).toBe('HIGH');
    });

    test('should atomically mark task as processing', () => {
      queue.enqueue({ orderId: 'ATOMIC-1' });

      const task = queue.dequeue();
      expect(task.status).toBe('processing');

      // Dequeue again should return null (no more pending)
      const task2 = queue.dequeue();
      expect(task2).toBeNull();
    });
  });

  // ================================================================ markCompleted

  describe('markCompleted', () => {
    test('should set status to completed', () => {
      const { id } = queue.enqueue({ orderId: 'C-1' });
      queue.dequeue(); // move to processing
      const result = queue.markCompleted(id);
      expect(result.changes).toBe(1);

      const task = queue.getById(id);
      expect(task.status).toBe('completed');
      expect(task.error).toBeNull();
    });
  });

  // ================================================================ markFailed

  describe('markFailed', () => {
    test('should set status to failed and record error', () => {
      const { id } = queue.enqueue({ orderId: 'F-1' });
      queue.dequeue();
      queue.markFailed(id, 'Network timeout');

      const task = queue.getById(id);
      expect(task.status).toBe('failed');
      expect(task.error).toBe('Network timeout');
      expect(task.retryCount).toBe(1);
    });

    test('should increment retry_count on each failure', () => {
      const { id } = queue.enqueue({ orderId: 'F-2' });
      queue.dequeue();
      queue.markFailed(id, 'Error 1');
      queue.requeue(id);
      // Simulate re-processing
      queue.db.prepare(`UPDATE tasks SET status = 'processing' WHERE id = ?`).run(id);
      queue.markFailed(id, 'Error 2');

      const task = queue.getById(id);
      expect(task.retryCount).toBe(2);
      expect(task.error).toBe('Error 2');
    });
  });

  // ================================================================ requeue

  describe('requeue', () => {
    test('should move a failed task back to pending', () => {
      const { id } = queue.enqueue({ orderId: 'R-1' });
      queue.dequeue();
      queue.markFailed(id, 'Some error');

      const result = queue.requeue(id);
      expect(result.changes).toBe(1);

      const task = queue.getById(id);
      expect(task.status).toBe('pending');
    });
  });

  // ================================================================ Queries

  describe('getPendingCount / getProcessingCount', () => {
    test('should return correct counts', () => {
      queue.enqueue({ orderId: 'Q-1' });
      queue.enqueue({ orderId: 'Q-2' });
      queue.enqueue({ orderId: 'Q-3' });

      expect(queue.getPendingCount()).toBe(3);
      expect(queue.getProcessingCount()).toBe(0);

      queue.dequeue();
      expect(queue.getPendingCount()).toBe(2);
      expect(queue.getProcessingCount()).toBe(1);
    });
  });

  describe('getStatus', () => {
    test('should return summary stats', () => {
      queue.enqueue({ orderId: 'S-1' });
      queue.enqueue({ orderId: 'S-2' });
      const { id } = queue.enqueue({ orderId: 'S-3' });
      queue.dequeue(); // S-1 -> processing
      queue.dequeue(); // S-2 -> processing
      queue.markCompleted(queue.getByStatus('processing')[0].id);

      const status = queue.getStatus();
      expect(status.pending).toBe(1);
      expect(status.processing).toBe(1);
      expect(status.completed).toBe(1);
      expect(status.total).toBe(3);
    });
  });

  describe('getByStatus', () => {
    test('should return tasks filtered by status', () => {
      queue.enqueue({ orderId: 'BS-1' });
      queue.enqueue({ orderId: 'BS-2' });
      queue.dequeue();

      const pending = queue.getByStatus('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].taskData.orderId).toBe('BS-2');

      const processing = queue.getByStatus('processing');
      expect(processing).toHaveLength(1);
      expect(processing[0].taskData.orderId).toBe('BS-1');
    });
  });

  describe('getRecent', () => {
    test('should return most recent tasks', () => {
      queue.enqueue({ orderId: 'R-1' });
      queue.enqueue({ orderId: 'R-2' });
      queue.enqueue({ orderId: 'R-3' });

      const recent = queue.getRecent(2);
      expect(recent).toHaveLength(2);
      // Most recent first
      expect(recent[0].taskData.orderId).toBe('R-3');
      expect(recent[1].taskData.orderId).toBe('R-2');
    });
  });

  // ================================================================ Maintenance

  describe('recoverStaleTasks', () => {
    test('should requeue tasks stuck in processing longer than timeout', () => {
      queue.enqueue({ orderId: 'STALE-1' });
      const task = queue.dequeue();

      // Manually set old timestamp
      queue.db.prepare(
        `UPDATE tasks SET updated_at = datetime('now', '-15 minutes') WHERE id = ?`
      ).run(task.id);

      const recovered = queue.recoverStaleTasks(10 * 60 * 1000); // 10 min
      expect(recovered).toBe(1);

      const updatedTask = queue.getById(task.id);
      expect(updatedTask.status).toBe('pending');
    });

    test('should not touch recently processing tasks', () => {
      queue.enqueue({ orderId: 'FRESH-1' });
      queue.dequeue();

      const recovered = queue.recoverStaleTasks(10 * 60 * 1000);
      expect(recovered).toBe(0);
    });
  });

  describe('cleanup', () => {
    test('should delete old completed/failed tasks', () => {
      const { id: id1 } = queue.enqueue({ orderId: 'OLD-1' });
      const { id: id2 } = queue.enqueue({ orderId: 'OLD-2' });
      queue.dequeue();
      queue.dequeue();
      queue.markCompleted(id1);
      queue.markFailed(id2, 'error');

      // Set old timestamps
      queue.db.prepare(
        `UPDATE tasks SET updated_at = datetime('now', '-8 days') WHERE id IN (?, ?)`
      ).run(id1, id2);

      const deleted = queue.cleanup(7 * 24 * 60 * 60 * 1000); // 7 days
      expect(deleted).toBe(2);
      expect(queue.getStatus().total).toBe(0);
    });

    test('should not delete recent completed/failed tasks', () => {
      const { id } = queue.enqueue({ orderId: 'RECENT-1' });
      queue.dequeue();
      queue.markCompleted(id);

      const deleted = queue.cleanup(7 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(0);
      expect(queue.getStatus().total).toBe(1);
    });

    test('should not delete pending or processing tasks', () => {
      queue.enqueue({ orderId: 'PENDING-1' });
      queue.enqueue({ orderId: 'PROC-1' });
      queue.dequeue(); // PENDING-1 -> processing

      // Set old timestamps on all tasks
      queue.db.prepare(
        `UPDATE tasks SET updated_at = datetime('now', '-30 days')`
      ).run();

      const deleted = queue.cleanup(1); // 1 ms threshold
      expect(deleted).toBe(0); // pending and processing should not be deleted
    });
  });

  // ================================================================ close

  describe('close', () => {
    test('should close database connection', () => {
      queue.close();
      expect(queue.db.open).toBe(false);
      queue = null; // Prevent afterEach from double-closing
    });

    test('should handle double close gracefully', () => {
      queue.close();
      expect(() => queue.close()).not.toThrow();
      queue = null;
    });
  });

  // ================================================================ Edge cases

  describe('edge cases', () => {
    test('should handle non-JSON task_data gracefully', () => {
      // Manually insert a row with invalid JSON
      queue.db.prepare(
        `INSERT INTO tasks (task_data, status, priority, created_at, updated_at)
         VALUES ('not-json', 'pending', 5, datetime('now'), datetime('now'))`
      ).run();

      const task = queue.dequeue();
      expect(task).not.toBeNull();
      expect(task.taskData).toEqual({ _raw: 'not-json' });
    });

    test('should handle empty task data', () => {
      const { id } = queue.enqueue({});
      const task = queue.getById(id);
      expect(task.taskData).toEqual({});
    });

    test('should handle large task data', () => {
      const largeData = {
        orderId: 'LARGE-1',
        description: 'x'.repeat(10000),
        nested: { a: { b: { c: 'deep' } } },
      };
      const { id } = queue.enqueue(largeData);
      const task = queue.getById(id);
      expect(task.taskData.orderId).toBe('LARGE-1');
      expect(task.taskData.description.length).toBe(10000);
    });
  });
});
