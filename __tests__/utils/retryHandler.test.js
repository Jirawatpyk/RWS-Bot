/**
 * Tests for utils/retryHandler.js
 */

jest.mock('../../Logs/logger');

const retry = require('../../utils/retryHandler');
const { logInfo, logFail } = require('../../Logs/logger');

describe('utils/retryHandler.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Execution', () => {
    it('should succeed on first attempt', async () => {
      const taskFn = jest.fn().mockResolvedValue({ success: true, data: 'test' });

      const result = await retry(taskFn, 3, 10);

      expect(result).toEqual({ success: true, data: 'test' });
      expect(taskFn).toHaveBeenCalledTimes(1);
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('First attempt'));
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Success on attempt 1/4'));
    });

    it('should succeed on second attempt', async () => {
      const taskFn = jest.fn()
        .mockResolvedValueOnce({ success: false, reason: 'Temporary failure' })
        .mockResolvedValueOnce({ success: true, data: 'success' });

      const result = await retry(taskFn, 3, 10);

      expect(result).toEqual({ success: true, data: 'success' });
      expect(taskFn).toHaveBeenCalledTimes(2);
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('Retry failed (1/4)'));
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Success on attempt 2/4'));
    });

    it('should succeed on last attempt', async () => {
      const taskFn = jest.fn()
        .mockResolvedValueOnce({ success: false, reason: 'Fail 1' })
        .mockResolvedValueOnce({ success: false, reason: 'Fail 2' })
        .mockResolvedValueOnce({ success: false, reason: 'Fail 3' })
        .mockResolvedValueOnce({ success: true, data: 'finally' });

      const result = await retry(taskFn, 3, 10);

      expect(result).toEqual({ success: true, data: 'finally' });
      expect(taskFn).toHaveBeenCalledTimes(4);
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Success on attempt 4/4'));
    });
  });

  describe('Failed Execution', () => {
    it('should return last result when all attempts fail with result', async () => {
      const taskFn = jest.fn()
        .mockResolvedValue({ success: false, reason: 'Always fails' });

      const result = await retry(taskFn, 2, 10);

      expect(result).toEqual({ success: false, reason: 'Always fails' });
      expect(taskFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      expect(logFail).toHaveBeenCalledTimes(3);
    });

    it('should throw error when all attempts throw exceptions', async () => {
      const taskFn = jest.fn().mockRejectedValue(new Error('Task error'));

      await expect(retry(taskFn, 2, 10)).rejects.toThrow('All 3 attempts failed');
      expect(taskFn).toHaveBeenCalledTimes(3);
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('Retry exception'));
    });

    it('should return last valid result when mixed exceptions and failures', async () => {
      const taskFn = jest.fn()
        .mockRejectedValueOnce(new Error('Exception 1'))
        .mockResolvedValueOnce({ success: false, reason: 'Failure 2' })
        .mockRejectedValueOnce(new Error('Exception 3'));

      const result = await retry(taskFn, 2, 10);

      // Should return the last non-exception result
      expect(result).toEqual({ success: false, reason: 'Failure 2' });
      expect(taskFn).toHaveBeenCalledTimes(3);
    });
  });

  describe('Retry Configuration', () => {
    it('should use default retries (3) if not specified', async () => {
      const taskFn = jest.fn().mockResolvedValue({ success: false });

      await retry(taskFn);

      expect(taskFn).toHaveBeenCalledTimes(4); // 1 + 3 retries
    }, 15000);

    it('should respect custom retry count', async () => {
      const taskFn = jest.fn().mockResolvedValue({ success: false });

      await retry(taskFn, 5, 10);

      expect(taskFn).toHaveBeenCalledTimes(6); // 1 + 5 retries
    });

    it('should handle 0 retries (single attempt only)', async () => {
      const taskFn = jest.fn().mockResolvedValue({ success: false });

      const result = await retry(taskFn, 0, 10);

      expect(taskFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: false });
    });
  });

  describe('Function Naming', () => {
    it('should log named function correctly', async () => {
      async function myNamedTask() {
        return { success: true };
      }

      await retry(myNamedTask, 1, 10);

      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('myNamedTask'));
    });

    it('should handle anonymous function', async () => {
      await retry(async () => ({ success: true }), 1, 10);

      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('anonymous'));
    });
  });

  describe('Result Propagation', () => {
    it('should return full result object with additional properties', async () => {
      const taskFn = jest.fn().mockResolvedValue({
        success: true,
        data: { id: 123, name: 'Test' },
        metadata: { timestamp: '2026-01-23' }
      });

      const result = await retry(taskFn, 2, 10);

      expect(result).toEqual({
        success: true,
        data: { id: 123, name: 'Test' },
        metadata: { timestamp: '2026-01-23' }
      });
    });

    it('should return result even if success is undefined', async () => {
      const taskFn = jest.fn().mockResolvedValue({ data: 'test' });

      const result = await retry(taskFn, 2, 10);

      expect(result).toEqual({ data: 'test' });
      expect(taskFn).toHaveBeenCalledTimes(3); // Retries because success !== true
    });
  });

  describe('Edge Cases', () => {
    it('should throw when all attempts return null', async () => {
      const taskFn = jest.fn().mockResolvedValue(null);

      await expect(retry(taskFn, 1, 10)).rejects.toThrow('All 2 attempts failed');
    });

    it('should throw when all attempts return undefined', async () => {
      const taskFn = jest.fn().mockResolvedValue(undefined);

      await expect(retry(taskFn, 1, 10)).rejects.toThrow('All 2 attempts failed');
    });
  });
});
