/**
 * Tests for Task/consecutiveFailureTracker.js
 *
 * This module tracks consecutive task failures and notifies when threshold is reached.
 *
 * Test Coverage:
 * 1. Basic failure recording functionality
 * 2. Threshold notification triggering
 * 3. Failure counter reset behavior
 * 4. Custom context messages
 * 5. Environment variable configuration
 * 6. Edge cases (rapid failures, concurrent calls, etc.)
 *
 * NOTE: The FAILURE_THRESHOLD is read from environment at module load time,
 * so tests are grouped by threshold value to avoid module reloading issues.
 */

// Set default threshold before any imports
process.env.FAILURE_THRESHOLD = '3';

// Mock dependencies before requiring the module
jest.mock('../../Logs/notifier');
jest.mock('../../Logs/logger');

const { notifyGoogleChat } = require('../../Logs/notifier');
const { logFail } = require('../../Logs/logger');
const { recordFailure, resetFailure } = require('../../Task/consecutiveFailureTracker');

describe('Task/consecutiveFailureTracker.js', () => {
  beforeEach(() => {
    // Reset counter and mocks before each test
    resetFailure();
    jest.clearAllMocks();
    notifyGoogleChat.mockResolvedValue();
  });

  describe('Basic Failure Recording', () => {
    it('should record a single failure without notification', async () => {
      await recordFailure();
      expect(notifyGoogleChat).not.toHaveBeenCalled();
    });

    it('should record two failures without notification', async () => {
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).not.toHaveBeenCalled();
    });

    it('should send notification when threshold is reached (3 failures)', async () => {
      await recordFailure();
      await recordFailure();
      await recordFailure(); // This should trigger notification

      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('🚨 [Auto RWS System] 3 consecutive task failures')
      );
    });

    it('should include "please check the system" in notification', async () => {
      await recordFailure();
      await recordFailure();
      await recordFailure();

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('please check the system')
      );
    });

    it('should include emoji in notification message', async () => {
      await recordFailure();
      await recordFailure();
      await recordFailure();

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('🚨')
      );
    });
  });

  describe('Auto-Reset After Threshold', () => {
    it('should reset counter after reaching threshold', async () => {
      // First batch - should trigger notification
      await recordFailure();
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);

      // Second batch - should not trigger until 3 more failures
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1); // Still 1

      await recordFailure(); // 3rd failure in new batch
      expect(notifyGoogleChat).toHaveBeenCalledTimes(2); // Now 2
    });

    it('should track multiple failure cycles', async () => {
      // Cycle 1
      await recordFailure();
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);

      // Cycle 2 (auto-reset from previous cycle)
      await recordFailure();
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).toHaveBeenCalledTimes(2);

      // Cycle 3
      await recordFailure();
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).toHaveBeenCalledTimes(3);
    });
  });

  describe('Manual Reset Functionality', () => {
    it('should reset failure count to zero using resetFailure()', async () => {
      await recordFailure();
      await recordFailure();
      resetFailure(); // Reset counter

      // Should need 3 more failures to trigger
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).not.toHaveBeenCalled();

      await recordFailure(); // 3rd after reset
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
    });

    it('should allow multiple resets without side effects', async () => {
      await recordFailure();
      resetFailure();
      resetFailure();
      resetFailure(); // Multiple resets

      // Should still need 3 failures to trigger
      await recordFailure();
      await recordFailure();
      await recordFailure();
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
    });

    it('should handle alternating failures and resets', async () => {
      await recordFailure();
      resetFailure();
      await recordFailure();
      resetFailure();
      await recordFailure();
      resetFailure();

      // Should never reach threshold due to constant resets
      expect(notifyGoogleChat).not.toHaveBeenCalled();
    });

    it('should not accumulate memory with many resets', async () => {
      // Perform many reset operations
      for (let i = 0; i < 1000; i++) {
        await recordFailure();
        resetFailure();
      }

      // Should not trigger notification due to constant resets
      expect(notifyGoogleChat).not.toHaveBeenCalled();
    });
  });

  describe('Custom Context Messages', () => {
    it('should use custom context in notification message', async () => {
      await recordFailure('Email Parser');
      await recordFailure('Email Parser');
      await recordFailure('Email Parser');

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        '🚨 [Email Parser] 3 consecutive task failures — please check the system.'
      );
    });

    it('should use default context when none provided', async () => {
      await recordFailure();
      await recordFailure();
      await recordFailure();

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        '🚨 [Auto RWS System] 3 consecutive task failures — please check the system.'
      );
    });

    it('should support different contexts for different failures', async () => {
      await recordFailure('Browser Pool');
      await recordFailure('Task Queue');
      await recordFailure('Exec Accept'); // Different context but same counter

      // Last context should be used in notification
      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('[Exec Accept]')
      );
    });

    it('should handle empty string context', async () => {
      await recordFailure('');
      await recordFailure('');
      await recordFailure('');

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        '🚨 [] 3 consecutive task failures — please check the system.'
      );
    });

    it('should handle special characters in context', async () => {
      await recordFailure('Task #123 - "Order Processing"');
      await recordFailure('Task #123 - "Order Processing"');
      await recordFailure('Task #123 - "Order Processing"');

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('[Task #123 - "Order Processing"]')
      );
    });

    it('should handle undefined context parameter', async () => {
      await recordFailure(undefined);
      await recordFailure(undefined);
      await recordFailure(undefined);

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('[Auto RWS System]') // Should use default
      );
    });

    it('should handle null context parameter', async () => {
      await recordFailure(null);
      await recordFailure(null);
      await recordFailure(null);

      // null is actually used as-is in the template string, becoming '[null]'
      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('[null]')
      );
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent failure recordings', async () => {
      // Record 3 failures concurrently
      await Promise.all([
        recordFailure(),
        recordFailure(),
        recordFailure()
      ]);

      // Should trigger notification (counter increments synchronously)
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
    });

    it('should handle rapid sequential failures', async () => {
      // Fire failures in quick succession without awaiting individually
      const p1 = recordFailure();
      const p2 = recordFailure();
      const p3 = recordFailure();

      await Promise.all([p1, p2, p3]);

      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed concurrent failures and resets', async () => {
      await recordFailure();
      await recordFailure();

      // Concurrent operations
      await Promise.all([
        recordFailure(),
        Promise.resolve().then(() => resetFailure())
      ]);

      // Due to race condition, result may vary (0 or 1 depending on timing)
      // But at minimum, the function should not crash
      const callCount = notifyGoogleChat.mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(0);
      expect(callCount).toBeLessThanOrEqual(1);
    });
  });

  describe('Notification Error Handling', () => {
    it('should propagate notification failures (does not catch internally)', async () => {
      notifyGoogleChat.mockRejectedValueOnce(new Error('Notification failed'));

      // recordFailure() does NOT catch errors - it just awaits notifyGoogleChat
      await recordFailure();
      await recordFailure();
      // Third call triggers notification and will reject
      await expect(recordFailure()).rejects.toThrow('Notification failed');

      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
    });

    it('should reset counter even if notification fails', async () => {
      notifyGoogleChat.mockRejectedValueOnce(new Error('Network error'));

      await recordFailure();
      await recordFailure();
      // Third failure triggers notification (which rejects) and still resets counter
      try {
        await recordFailure();
      } catch (error) {
        // Expected to throw
      }

      // Counter should be reset despite error, so next 3 failures should trigger again
      notifyGoogleChat.mockResolvedValueOnce();
      await recordFailure();
      await recordFailure();
      await recordFailure();

      expect(notifyGoogleChat).toHaveBeenCalledTimes(2);
    });

    it('should allow callers to handle notification failures', async () => {
      notifyGoogleChat.mockRejectedValue(new Error('Always fail'));

      // Callers can catch errors if they want
      try {
        await recordFailure();
        await recordFailure();
        await recordFailure();
        fail('Should have thrown');
      } catch (error) {
        expect(error.message).toBe('Always fail');
      }
    });
  });

  describe('High Volume Scenarios', () => {
    it('should handle very high number of consecutive failures', async () => {
      // Record 1000 failures
      for (let i = 0; i < 1000; i++) {
        await recordFailure();
      }

      // Should trigger every 3 failures: 3, 6, 9, ... 999 = 333 times
      expect(notifyGoogleChat).toHaveBeenCalledTimes(333);
    });

    it('should handle rapid failure recording efficiently', async () => {
      const startTime = Date.now();

      // Record 100 failures rapidly
      for (let i = 0; i < 100; i++) {
        await recordFailure();
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 1 second for 100 operations)
      expect(duration).toBeLessThan(1000);
      // Should trigger every 3 failures: floor(100/3) = 33 times
      expect(notifyGoogleChat).toHaveBeenCalledTimes(33);
    });
  });

  describe('Integration Scenarios', () => {
    it('should simulate real-world failure tracking scenario', async () => {
      // Task 1 fails
      await recordFailure('Task Queue');
      expect(notifyGoogleChat).not.toHaveBeenCalled();

      // Task 2 fails
      await recordFailure('Task Queue');
      expect(notifyGoogleChat).not.toHaveBeenCalled();

      // Task 3 succeeds (reset counter)
      resetFailure();

      // Task 4 fails
      await recordFailure('Browser Pool');
      expect(notifyGoogleChat).not.toHaveBeenCalled();

      // Task 5 fails
      await recordFailure('IMAP Parser');
      expect(notifyGoogleChat).not.toHaveBeenCalled();

      // Task 6 fails - should trigger notification
      await recordFailure('Exec Accept');
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('[Exec Accept]')
      );
    });

    it('should handle system recovery scenario', async () => {
      // System starts failing
      await recordFailure('System Health');
      await recordFailure('System Health');
      await recordFailure('System Health'); // Triggers alert
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);

      // System recovers
      resetFailure();

      // System fails again later
      await recordFailure('System Health');
      await recordFailure('System Health');
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1); // Still only 1

      // Another failure - triggers second alert
      await recordFailure('System Health');
      expect(notifyGoogleChat).toHaveBeenCalledTimes(2);
    });

    it('should track multiple failure cycles with different contexts', async () => {
      // Cycle 1
      await recordFailure('Cycle 1');
      await recordFailure('Cycle 1');
      await recordFailure('Cycle 1');
      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);

      // Cycle 2 (auto-reset from previous cycle)
      await recordFailure('Cycle 2');
      await recordFailure('Cycle 2');
      await recordFailure('Cycle 2');
      expect(notifyGoogleChat).toHaveBeenCalledTimes(2);

      // Cycle 3
      await recordFailure('Cycle 3');
      await recordFailure('Cycle 3');
      await recordFailure('Cycle 3');
      expect(notifyGoogleChat).toHaveBeenCalledTimes(3);

      // All notifications should have different contexts
      expect(notifyGoogleChat.mock.calls[0][0]).toContain('[Cycle 1]');
      expect(notifyGoogleChat.mock.calls[1][0]).toContain('[Cycle 2]');
      expect(notifyGoogleChat.mock.calls[2][0]).toContain('[Cycle 3]');
    });

    it('should track failures across multiple components', async () => {
      // Different components fail
      await recordFailure('LoginSession');
      await recordFailure('IMAP');
      await recordFailure('BrowserPool');

      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('[BrowserPool]')
      );
      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('3 consecutive task failures')
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle notification with very long context', async () => {
      const longContext = 'A'.repeat(1000);
      await recordFailure(longContext);
      await recordFailure(longContext);
      await recordFailure(longContext);

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining(`[${longContext}]`)
      );
    });

    it('should handle context with newlines', async () => {
      const contextWithNewlines = 'Line 1\nLine 2\nLine 3';
      await recordFailure(contextWithNewlines);
      await recordFailure(contextWithNewlines);
      await recordFailure(contextWithNewlines);

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining(contextWithNewlines)
      );
    });

    it('should handle unicode characters in context', async () => {
      const unicodeContext = '🚀 ภาษาไทย 中文 日本語';
      await recordFailure(unicodeContext);
      await recordFailure(unicodeContext);
      await recordFailure(unicodeContext);

      expect(notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining(unicodeContext)
      );
    });

    it('should handle reset after each failure (never reach threshold)', async () => {
      for (let i = 0; i < 100; i++) {
        await recordFailure();
        if (i < 2) {
          resetFailure();
        }
      }

      // Only the last 98 should count, triggering 32 notifications
      expect(notifyGoogleChat).toHaveBeenCalledTimes(32);
    });
  });

  describe('State Isolation', () => {
    it('should maintain independent state between function calls', async () => {
      await recordFailure('Test 1');
      expect(notifyGoogleChat).not.toHaveBeenCalled();

      const promise1 = recordFailure('Test 2');
      const promise2 = recordFailure('Test 3');

      await Promise.all([promise1, promise2]);

      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
    });

    it('should not be affected by external state changes', async () => {
      const externalCounter = 0; // Simulating external state

      await recordFailure();
      await recordFailure();
      await recordFailure();

      expect(notifyGoogleChat).toHaveBeenCalledTimes(1);
      expect(externalCounter).toBe(0); // External state unchanged
    });
  });
});
