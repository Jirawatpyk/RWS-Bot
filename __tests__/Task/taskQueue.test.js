/**
 * Tests for Task/taskQueue.js
 *
 * Testing Strategy:
 * 1. Test queue initialization with different configurations
 * 2. Test adding tasks to queue
 * 3. Test concurrent processing with different concurrency levels
 * 4. Test success and error callbacks
 * 5. Test queue empty callback
 * 6. Test that processing respects concurrency limits
 */

// Mock Dashboard/server before requiring taskQueue
jest.mock('../../Dashboard/server', () => ({
  pushStatusUpdate: jest.fn(),
  broadcastToClients: jest.fn(),
}));

// Mock logger to suppress output during tests
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logSuccess: jest.fn(),
  logFail: jest.fn(),
}));

const { TaskQueue } = require('../../Task/taskQueue');
const { pushStatusUpdate } = require('../../Dashboard/server');

describe('Task/taskQueue.js', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('TaskQueue Constructor', () => {
    it('should initialize with default concurrency of 4', () => {
      const queue = new TaskQueue({});

      expect(queue.concurrency).toBe(4);
      expect(queue.queue).toEqual([]);
      expect(queue.processing).toBeInstanceOf(Set);
      expect(queue.processing.size).toBe(0);
    });

    it('should initialize with custom concurrency', () => {
      const queue = new TaskQueue({ concurrency: 2 });

      expect(queue.concurrency).toBe(2);
    });

    it('should store callbacks', () => {
      const onSuccess = jest.fn();
      const onError = jest.fn();
      const onQueueEmpty = jest.fn();

      const queue = new TaskQueue({
        onSuccess,
        onError,
        onQueueEmpty
      });

      expect(queue.onSuccess).toBe(onSuccess);
      expect(queue.onError).toBe(onError);
      expect(queue.onQueueEmpty).toBe(onQueueEmpty);
    });
  });

  describe('addTask()', () => {
    it('should add task to queue', () => {
      const queue = new TaskQueue({ concurrency: 1 });
      const taskFn = jest.fn(() => Promise.resolve('result'));

      queue.addTask(taskFn);

      // Task should be processing immediately since concurrency = 1 and no other tasks
      expect(taskFn).toHaveBeenCalled();
    });

    it('should trigger processQueue', async () => {
      const queue = new TaskQueue({ concurrency: 1 });
      const taskFn = jest.fn(() => Promise.resolve('result'));

      queue.addTask(taskFn);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(taskFn).toHaveBeenCalled();
    });

    it('should call pushStatusUpdate when task is added', () => {
      const queue = new TaskQueue({ concurrency: 1 });
      const taskFn = jest.fn(() => Promise.resolve('result'));

      queue.addTask(taskFn);

      expect(pushStatusUpdate).toHaveBeenCalled();
    });
  });

  describe('processQueue() - Concurrency Control', () => {
    it('should respect concurrency limit', async () => {
      const queue = new TaskQueue({ concurrency: 2 });

      let runningTasks = 0;
      let maxConcurrent = 0;

      const createTask = () => {
        return () => new Promise((resolve) => {
          runningTasks++;
          maxConcurrent = Math.max(maxConcurrent, runningTasks);

          setTimeout(() => {
            runningTasks--;
            resolve('done');
          }, 50);
        });
      };

      // Add 5 tasks
      for (let i = 0; i < 5; i++) {
        queue.addTask(createTask());
      }

      // Wait for all tasks to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      // Max concurrent should never exceed concurrency limit
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should process tasks sequentially with concurrency 1', async () => {
      const queue = new TaskQueue({ concurrency: 1 });
      const executionOrder = [];

      const createTask = (id) => {
        return () => new Promise((resolve) => {
          executionOrder.push(id);
          resolve(id);
        });
      };

      queue.addTask(createTask(1));
      queue.addTask(createTask(2));
      queue.addTask(createTask(3));

      // Wait to ensure all tasks complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify all tasks completed
      expect(executionOrder).toHaveLength(3);
    });

    it('should process multiple tasks concurrently', async () => {
      const queue = new TaskQueue({ concurrency: 3 });
      const startTimes = [];

      const createTask = (id) => {
        return () => new Promise((resolve) => {
          startTimes.push({ id, time: Date.now() });
          setTimeout(() => resolve(id), 50);
        });
      };

      // Add 3 tasks
      queue.addTask(createTask(1));
      queue.addTask(createTask(2));
      queue.addTask(createTask(3));

      await new Promise(resolve => setTimeout(resolve, 100));

      // All 3 tasks should start roughly at the same time
      const timeDiff1 = Math.abs(startTimes[1].time - startTimes[0].time);
      const timeDiff2 = Math.abs(startTimes[2].time - startTimes[0].time);

      expect(timeDiff1).toBeLessThan(20); // Started within 20ms
      expect(timeDiff2).toBeLessThan(20);
    });
  });

  describe('processQueue() - Success Handling', () => {
    it('should call onSuccess callback when task succeeds', async () => {
      const onSuccess = jest.fn();
      const queue = new TaskQueue({ concurrency: 1, onSuccess });

      const taskFn = () => Promise.resolve('success result');

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onSuccess).toHaveBeenCalledWith('success result');
    });

    it('should call pushStatusUpdate after task completes', async () => {
      const queue = new TaskQueue({ concurrency: 1 });
      const taskFn = () => Promise.resolve('done');

      pushStatusUpdate.mockClear();

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should be called at least twice: once when added, once when completed
      expect(pushStatusUpdate).toHaveBeenCalledTimes(2);
    });

    it('should remove task from processing set after completion', async () => {
      const queue = new TaskQueue({ concurrency: 1 });

      let resolveTask;
      const taskFn = () => new Promise((resolve) => {
        resolveTask = resolve;
      });

      queue.addTask(taskFn);

      // Give time for task to start processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // Task should now be in processing
      expect(queue.processing.size).toBeGreaterThan(0);

      // Complete the task
      if (resolveTask) {
        resolveTask('done');
      }

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(queue.processing.size).toBe(0);
    });
  });

  describe('processQueue() - Error Handling', () => {
    it('should call onError callback when task fails', async () => {
      const onError = jest.fn();
      const queue = new TaskQueue({ concurrency: 1, onError });

      const error = new Error('Task failed');
      const taskFn = () => Promise.reject(error);

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should remove failed task from processing set', async () => {
      const queue = new TaskQueue({ concurrency: 1 });
      const taskFn = () => Promise.reject(new Error('Failed'));

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(queue.processing.size).toBe(0);
    });

    it('should continue processing other tasks after one fails', async () => {
      const onSuccess = jest.fn();
      const onError = jest.fn();
      const queue = new TaskQueue({ concurrency: 1, onSuccess, onError });

      const failingTask = () => Promise.reject(new Error('Failed'));
      const successTask = () => Promise.resolve('Success');

      queue.addTask(failingTask);
      queue.addTask(successTask);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('Success');
    });
  });

  describe('onQueueEmpty Callback', () => {
    it('should call onQueueEmpty when queue and processing are empty', async () => {
      const onQueueEmpty = jest.fn();
      const queue = new TaskQueue({ concurrency: 1, onQueueEmpty });

      const taskFn = () => Promise.resolve('done');

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onQueueEmpty).toHaveBeenCalled();
    });

    it('should not call onQueueEmpty if more tasks are queued', async () => {
      const onQueueEmpty = jest.fn();
      const queue = new TaskQueue({ concurrency: 1, onQueueEmpty });

      const slowTask = () => new Promise(resolve => setTimeout(() => resolve('done'), 100));
      const fastTask = () => Promise.resolve('done');

      queue.addTask(slowTask);
      queue.addTask(fastTask);

      // Wait for first task to start
      await new Promise(resolve => setTimeout(resolve, 50));

      // onQueueEmpty should not have been called yet
      expect(onQueueEmpty).not.toHaveBeenCalled();

      // Wait for all tasks to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      // Now it should be called
      expect(onQueueEmpty).toHaveBeenCalled();
    });

    it('should not call onQueueEmpty if tasks are still processing', async () => {
      const onQueueEmpty = jest.fn();
      const queue = new TaskQueue({ concurrency: 2, onQueueEmpty });

      const slowTask = () => new Promise(resolve => setTimeout(() => resolve('done'), 100));

      queue.addTask(slowTask);

      // Wait a bit but not enough for task to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onQueueEmpty).not.toHaveBeenCalled();
    });
  });

  describe('Queue State Management', () => {
    it('should maintain correct queue length', async () => {
      const queue = new TaskQueue({ concurrency: 1 });

      expect(queue.queue.length).toBe(0);

      const slowTask = () => new Promise(resolve => setTimeout(() => resolve('done'), 50));

      queue.addTask(slowTask);
      queue.addTask(slowTask);
      queue.addTask(slowTask);

      // After adding, first task should be processing, 2 should be queued
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(queue.queue.length).toBe(2);
      expect(queue.processing.size).toBe(1);
    });

    it('should clear queue as tasks are processed', async () => {
      const queue = new TaskQueue({ concurrency: 1 });

      const task = () => Promise.resolve('done');

      queue.addTask(task);
      queue.addTask(task);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(queue.queue.length).toBe(0);
      expect(queue.processing.size).toBe(0);
    });
  });

  describe('Mixed Success and Error Tasks', () => {
    it('should handle mix of successful and failed tasks', async () => {
      const onSuccess = jest.fn();
      const onError = jest.fn();
      const queue = new TaskQueue({ concurrency: 2, onSuccess, onError });

      const successTask = () => Promise.resolve('ok');
      const errorTask = () => Promise.reject(new Error('fail'));

      queue.addTask(successTask);
      queue.addTask(errorTask);
      queue.addTask(successTask);
      queue.addTask(errorTask);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onSuccess).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledTimes(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty queue', async () => {
      const queue = new TaskQueue({ concurrency: 1 });

      expect(queue.queue.length).toBe(0);
      expect(queue.processing.size).toBe(0);

      // Should not throw error
      queue.processQueue();
    });

    it('should handle task that returns undefined', async () => {
      const onSuccess = jest.fn();
      const queue = new TaskQueue({ concurrency: 1, onSuccess });

      const taskFn = () => Promise.resolve(undefined);

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onSuccess).toHaveBeenCalledWith(undefined);
    });

    it('should handle task that returns null', async () => {
      const onSuccess = jest.fn();
      const queue = new TaskQueue({ concurrency: 1, onSuccess });

      const taskFn = () => Promise.resolve(null);

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onSuccess).toHaveBeenCalledWith(null);
    });

    it('should handle high concurrency', async () => {
      const queue = new TaskQueue({ concurrency: 10 });
      const completedTasks = [];

      const createTask = (id) => {
        return () => new Promise((resolve) => {
          setTimeout(() => {
            completedTasks.push(id);
            resolve(id);
          }, 20);
        });
      };

      // Add 10 tasks
      for (let i = 0; i < 10; i++) {
        queue.addTask(createTask(i));
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(completedTasks.length).toBe(10);
    });

    it('should handle very fast tasks', async () => {
      const onSuccess = jest.fn();
      const queue = new TaskQueue({ concurrency: 2, onSuccess });

      const fastTask = () => Promise.resolve('fast');

      for (let i = 0; i < 5; i++) {
        queue.addTask(fastTask);
      }

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onSuccess).toHaveBeenCalledTimes(5);
    });
  });

  describe('No Callbacks Provided', () => {
    it('should work without onSuccess callback', async () => {
      const queue = new TaskQueue({ concurrency: 1 });

      const taskFn = () => Promise.resolve('done');

      // Should not throw error
      expect(() => queue.addTask(taskFn)).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should work without onError callback', async () => {
      const queue = new TaskQueue({ concurrency: 1 });

      const taskFn = () => Promise.reject(new Error('fail'));

      // Should not throw error
      expect(() => queue.addTask(taskFn)).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 50));
    });

    it('should work without onQueueEmpty callback', async () => {
      const queue = new TaskQueue({ concurrency: 1 });

      const taskFn = () => Promise.resolve('done');

      queue.addTask(taskFn);

      await new Promise(resolve => setTimeout(resolve, 50));

      // Should complete without error
      expect(queue.queue.length).toBe(0);
    });
  });

  // ================================================================ Persistence Integration Tests

  describe('Persistence Integration', () => {
    const path = require('path');
    const fs = require('fs');
    const os = require('os');

    function tempDbPath() {
      const dir = path.join(os.tmpdir(), 'tq-persist-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, 'test.db');
    }

    describe('getPersistentStatus()', () => {
      it('should return null when persistence is not enabled', () => {
        const queue = new TaskQueue({ concurrency: 1 });
        expect(queue.getPersistentStatus()).toBeNull();
      });

      it('should return stats when persistence is enabled', () => {
        const dbPath = tempDbPath();
        const queue = new TaskQueue({
          concurrency: 1,
          enablePersistence: true,
          persistConfig: { dbPath, recoveryOnBoot: false },
        });

        const status = queue.getPersistentStatus();
        expect(status).not.toBeNull();
        expect(status).toHaveProperty('pending');
        expect(status).toHaveProperty('processing');
        expect(status).toHaveProperty('completed');
        expect(status).toHaveProperty('failed');
        expect(status).toHaveProperty('total');

        queue.closePersistence();
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      });
    });

    describe('getRecentTasks()', () => {
      it('should return null when persistence is not enabled', () => {
        const queue = new TaskQueue({ concurrency: 1 });
        expect(queue.getRecentTasks()).toBeNull();
      });
    });

    describe('requeueTask()', () => {
      it('should return error when persistence is not enabled', () => {
        const queue = new TaskQueue({ concurrency: 1 });
        const result = queue.requeueTask(1);
        expect(result.success).toBe(false);
        expect(result.message).toContain('not enabled');
      });

      it('should requeue a failed task from persistent store', () => {
        const dbPath = tempDbPath();
        const queue = new TaskQueue({
          concurrency: 1,
          enablePersistence: true,
          persistConfig: { dbPath, recoveryOnBoot: false },
        });

        // Directly add and fail a task via persistent queue
        const { id } = queue.persistent.enqueue({ orderId: 'RQ-1' });
        queue.persistent.dequeue();
        queue.persistent.markFailed(id, 'test error');

        const result = queue.requeueTask(id);
        expect(result.success).toBe(true);

        const task = queue.persistent.getById(id);
        expect(task.status).toBe('pending');

        queue.closePersistence();
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      });

      it('should reject requeue for non-failed tasks', () => {
        const dbPath = tempDbPath();
        const queue = new TaskQueue({
          concurrency: 1,
          enablePersistence: true,
          persistConfig: { dbPath, recoveryOnBoot: false },
        });

        const { id } = queue.persistent.enqueue({ orderId: 'RQ-2' });

        const result = queue.requeueTask(id);
        expect(result.success).toBe(false);
        expect(result.message).toContain('pending');

        queue.closePersistence();
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      });
    });

    describe('Task lifecycle with persistence', () => {
      it('should track successful task in persistent store', async () => {
        const dbPath = tempDbPath();
        const results = [];
        const queue = new TaskQueue({
          concurrency: 1,
          enablePersistence: true,
          persistConfig: { dbPath, recoveryOnBoot: false },
          onSuccess: (r) => results.push(r),
        });

        queue.addTask(
          async () => ({ orderId: 'P-1', success: true }),
          { orderId: 'P-1', url: 'http://test.com' }
        );

        await new Promise(r => setTimeout(r, 200));

        expect(results).toHaveLength(1);

        const status = queue.getPersistentStatus();
        expect(status.completed).toBe(1);

        queue.closePersistence();
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      });

      it('should track failed task in persistent store', async () => {
        const dbPath = tempDbPath();
        const errors = [];
        const queue = new TaskQueue({
          concurrency: 1,
          enablePersistence: true,
          persistConfig: { dbPath, recoveryOnBoot: false },
          onError: (e) => errors.push(e.message),
        });

        queue.addTask(
          async () => { throw new Error('Task failed!'); },
          { orderId: 'F-1' }
        );

        await new Promise(r => setTimeout(r, 200));

        expect(errors).toEqual(['Task failed!']);
        const status = queue.getPersistentStatus();
        expect(status.failed).toBe(1);

        queue.closePersistence();
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      });

      it('should work without taskMeta when persistence is enabled', async () => {
        const dbPath = tempDbPath();
        const results = [];
        const queue = new TaskQueue({
          concurrency: 1,
          enablePersistence: true,
          persistConfig: { dbPath, recoveryOnBoot: false },
          onSuccess: (r) => results.push(r),
        });

        // No taskMeta
        queue.addTask(async () => 'no-meta');

        await new Promise(r => setTimeout(r, 100));

        expect(results).toEqual(['no-meta']);
        expect(queue.getPersistentStatus().total).toBe(0);

        queue.closePersistence();
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      });
    });

    describe('closePersistence()', () => {
      it('should close and nullify persistent reference', () => {
        const dbPath = tempDbPath();
        const queue = new TaskQueue({
          concurrency: 1,
          enablePersistence: true,
          persistConfig: { dbPath, recoveryOnBoot: false },
        });

        expect(queue.persistent).not.toBeNull();
        queue.closePersistence();
        expect(queue.persistent).toBeNull();

        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      });

      it('should be safe to call multiple times', () => {
        const queue = new TaskQueue({ concurrency: 1 });
        expect(() => {
          queue.closePersistence();
          queue.closePersistence();
        }).not.toThrow();
      });
    });

    describe('cleanupOldTasks()', () => {
      it('should return 0 when persistence is not enabled', () => {
        const queue = new TaskQueue({ concurrency: 1 });
        expect(queue.cleanupOldTasks()).toBe(0);
      });
    });
  });
});
