/**
 * Tests for utils/taskTimeout.js
 */

const withTimeout = require('../../utils/taskTimeout');

describe('utils/taskTimeout.js', () => {
  describe('Successful Completion', () => {
    it('should resolve when task completes before timeout', async () => {
      const taskFn = () => Promise.resolve('success');

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBe('success');
    });

    it('should resolve with object result', async () => {
      const taskFn = () => Promise.resolve({ success: true, data: 'test' });

      const result = await withTimeout(taskFn, 5000);

      expect(result).toEqual({ success: true, data: 'test' });
    });

    it('should handle synchronous task', async () => {
      const taskFn = () => 'sync result';

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBe('sync result');
    });

    it('should handle async function', async () => {
      const taskFn = async () => {
        return 'async result';
      };

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBe('async result');
    });
  });

  describe('Timeout Behavior', () => {
    it('should reject when timeout is reached', async () => {
      // Use short real delays instead of fake timers for reliability
      const taskFn = () => new Promise(resolve => {
        setTimeout(() => resolve('too late'), 100);
      });

      await expect(withTimeout(taskFn, 10)).rejects.toThrow('⏰ Task timeout after 10 ms');
    }, 10000);

    it('should reject with correct timeout message', async () => {
      const taskFn = () => new Promise(resolve => {
        setTimeout(() => resolve('result'), 100);
      });

      await expect(withTimeout(taskFn, 10)).rejects.toThrow('⏰ Task timeout after 10 ms');
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should propagate task errors before timeout', async () => {
      const taskFn = () => Promise.reject(new Error('Task failed'));

      await expect(withTimeout(taskFn, 5000)).rejects.toThrow('Task failed');
    });

    it('should handle task that throws synchronously', async () => {
      const taskFn = () => {
        throw new Error('Sync error');
      };

      // When a function throws synchronously inside Promise.race,
      // it throws before being wrapped, so we need to catch it differently
      try {
        await withTimeout(taskFn, 5000);
        // If we get here, the test should fail
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toBe('Sync error');
      }
    });
  });

  describe('Return Value Types', () => {
    it('should handle function that returns undefined', async () => {
      const taskFn = () => Promise.resolve(undefined);

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBeUndefined();
    });

    it('should handle function that returns null', async () => {
      const taskFn = () => Promise.resolve(null);

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBeNull();
    });

    it('should handle function that returns array', async () => {
      const taskFn = () => Promise.resolve([1, 2, 3]);

      const result = await withTimeout(taskFn, 5000);

      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle function that returns number', async () => {
      const taskFn = () => Promise.resolve(42);

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBe(42);
    });

    it('should handle function that returns zero', async () => {
      const taskFn = () => Promise.resolve(0);

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBe(0);
    });

    it('should handle function that returns false', async () => {
      const taskFn = () => Promise.resolve(false);

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBe(false);
    });

    it('should handle function that returns empty string', async () => {
      const taskFn = () => Promise.resolve('');

      const result = await withTimeout(taskFn, 5000);

      expect(result).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large timeout', async () => {
      const taskFn = () => Promise.resolve('quick');

      const result = await withTimeout(taskFn, 999999999);

      expect(result).toBe('quick');
    });
  });
});
