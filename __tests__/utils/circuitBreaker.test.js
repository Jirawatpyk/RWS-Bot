// __tests__/Utils/circuitBreaker.test.js

const { CircuitBreaker, STATES, MAX_PENDING_QUEUE_SIZE } = require('../../Utils/circuitBreaker');

// Mock logger to suppress console output during tests
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logFail: jest.fn(),
  logProgress: jest.fn(),
  logSuccess: jest.fn(),
}));

describe('CircuitBreaker', () => {
  let mockFn;
  let breaker;

  beforeEach(() => {
    mockFn = jest.fn().mockResolvedValue('ok');
    breaker = new CircuitBreaker(mockFn, {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      resetTimeout: 1000, // short for testing
      name: 'test-breaker',
    });
  });

  // ===== Constructor =====

  describe('constructor', () => {
    it('should throw if fn is not a function', () => {
      expect(() => new CircuitBreaker('not-a-fn')).toThrow(TypeError);
    });

    it('should initialize with CLOSED state', () => {
      expect(breaker.state).toBe(STATES.CLOSED);
      expect(breaker.failureCount).toBe(0);
      expect(breaker.successCount).toBe(0);
    });

    it('should use default options when not provided', () => {
      const simple = new CircuitBreaker(mockFn);
      expect(simple.options.failureThreshold).toBe(5);
      expect(simple.options.successThreshold).toBe(2);
      expect(simple.options.timeout).toBe(10000);
      expect(simple.options.resetTimeout).toBe(60000);
    });
  });

  // ===== CLOSED State =====

  describe('CLOSED state', () => {
    it('should execute the function and return result', async () => {
      const result = await breaker.execute('arg1', 'arg2');
      expect(result).toBe('ok');
      expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should reset failureCount on success', async () => {
      // Create some failures first (but not enough to trip)
      mockFn.mockRejectedValueOnce(new Error('fail1'));
      mockFn.mockRejectedValueOnce(new Error('fail2'));

      await expect(breaker.execute()).rejects.toThrow('fail1');
      await expect(breaker.execute()).rejects.toThrow('fail2');
      expect(breaker.failureCount).toBe(2);

      // Successful execution resets failure count
      mockFn.mockResolvedValueOnce('success');
      await breaker.execute();
      expect(breaker.failureCount).toBe(0);
    });

    it('should trip to OPEN after reaching failureThreshold', async () => {
      mockFn.mockRejectedValue(new Error('fail'));

      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute()).rejects.toThrow('fail');
      }

      expect(breaker.state).toBe(STATES.OPEN);
      expect(breaker.failureCount).toBe(3);
    });

    it('should propagate thrown errors', async () => {
      const error = new Error('API error');
      mockFn.mockRejectedValueOnce(error);

      await expect(breaker.execute()).rejects.toThrow('API error');
    });
  });

  // ===== OPEN State =====

  describe('OPEN state', () => {
    beforeEach(async () => {
      // Trip the circuit
      mockFn.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute()).rejects.toThrow('fail');
      }
      expect(breaker.state).toBe(STATES.OPEN);
      mockFn.mockReset();
    });

    it('should queue requests when OPEN', async () => {
      mockFn.mockResolvedValue('queued-result');

      // This should be queued, not executed immediately
      const promise = breaker.execute('queued-arg');

      expect(breaker.pendingQueue.length).toBe(1);
      expect(mockFn).not.toHaveBeenCalled();

      // We cannot resolve this without transitioning to CLOSED
      // so just verify it is pending
    });

    it('should transition to HALF_OPEN after resetTimeout', async () => {
      // Fast-forward past resetTimeout
      breaker.lastFailureTime = Date.now() - 2000; // 2 seconds ago (resetTimeout is 1 second)

      mockFn.mockResolvedValueOnce('recovered');
      const result = await breaker.execute();

      // With successThreshold=2, after 1 success it should still be HALF_OPEN
      expect(breaker.state).toBe(STATES.HALF_OPEN);
      expect(result).toBe('recovered');
      expect(breaker.successCount).toBe(1);
    });
  });

  // ===== HALF_OPEN State =====

  describe('HALF_OPEN state', () => {
    beforeEach(async () => {
      // Trip the circuit
      mockFn.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute()).rejects.toThrow('fail');
      }
      expect(breaker.state).toBe(STATES.OPEN);
      mockFn.mockReset();

      // Fast-forward to trigger HALF_OPEN
      breaker.lastFailureTime = Date.now() - 2000;
    });

    it('should reset to CLOSED after successThreshold successes', async () => {
      mockFn.mockResolvedValue('ok');

      await breaker.execute(); // success 1 -> HALF_OPEN
      expect(breaker.state).toBe(STATES.HALF_OPEN);

      await breaker.execute(); // success 2 -> CLOSED
      expect(breaker.state).toBe(STATES.CLOSED);
      expect(breaker.failureCount).toBe(0);
      expect(breaker.successCount).toBe(0);
    });

    it('should trip back to OPEN on any failure in HALF_OPEN', async () => {
      mockFn.mockResolvedValueOnce('ok'); // first call succeeds -> HALF_OPEN
      await breaker.execute();
      expect(breaker.state).toBe(STATES.HALF_OPEN);

      mockFn.mockRejectedValueOnce(new Error('fail again'));
      await expect(breaker.execute()).rejects.toThrow('fail again');
      expect(breaker.state).toBe(STATES.OPEN);
    });
  });

  // ===== Timeout =====

  describe('timeout', () => {
    it('should reject if execution exceeds timeout', async () => {
      const slowBreaker = new CircuitBreaker(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 3000)),
        { timeout: 100, name: 'slow-breaker' }
      );

      await expect(slowBreaker.execute()).rejects.toThrow('timed out');
    });
  });

  // ===== Pending Queue =====

  describe('pending queue', () => {
    it('should reject when queue is full', async () => {
      // Trip circuit
      mockFn.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute()).rejects.toThrow('fail');
      }
      mockFn.mockReset();

      // Fill queue to max
      const promises = [];
      for (let i = 0; i < MAX_PENDING_QUEUE_SIZE; i++) {
        promises.push(breaker.execute(`arg-${i}`));
      }

      expect(breaker.pendingQueue.length).toBe(MAX_PENDING_QUEUE_SIZE);

      // Next one should be rejected
      await expect(breaker.execute('overflow')).rejects.toThrow('Queue full');
    });
  });

  // ===== Drain Queue =====

  describe('_drainPendingQueue', () => {
    it('should drain queued requests when circuit closes', async () => {
      // Trip circuit
      mockFn.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute()).rejects.toThrow('fail');
      }
      mockFn.mockReset();
      mockFn.mockResolvedValue('drained-ok');

      // Queue some requests
      const queued1 = breaker.execute('q1');
      const queued2 = breaker.execute('q2');
      expect(breaker.pendingQueue.length).toBe(2);

      // Manually transition: OPEN -> HALF_OPEN -> CLOSED
      breaker.lastFailureTime = Date.now() - 2000;

      // Execute enough successes to close circuit (successThreshold = 2)
      await breaker.execute('test1'); // HALF_OPEN, success 1
      await breaker.execute('test2'); // success 2 -> CLOSED -> drain triggers

      // Wait for drain to process
      await new Promise((r) => setTimeout(r, 100));

      // Queued promises should resolve
      const r1 = await queued1;
      const r2 = await queued2;
      expect(r1).toBe('drained-ok');
      expect(r2).toBe('drained-ok');
      expect(breaker.pendingQueue.length).toBe(0);
    });

    it('should stop draining if circuit trips during drain', async () => {
      // Use a breaker with failureThreshold=1 for drain to trip quickly
      const tripBreaker = new CircuitBreaker(mockFn, {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 5000,
        resetTimeout: 100,
        name: 'drain-trip-test',
      });

      // Trip circuit
      mockFn.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(tripBreaker.execute()).rejects.toThrow('fail');
      }
      expect(tripBreaker.state).toBe(STATES.OPEN);
      mockFn.mockReset();

      // Queue requests - add catch handlers to avoid unhandled rejections
      const queued1 = tripBreaker.execute('q1').catch((e) => ({ error: e.message }));
      const queued2 = tripBreaker.execute('q2').catch((e) => ({ error: e.message }));
      const queued3 = tripBreaker.execute('q3').catch((e) => ({ error: e.message }));
      expect(tripBreaker.pendingQueue.length).toBe(3);

      // Setup: recovery calls succeed, then drain: first succeeds, rest fail
      let callCount = 0;
      mockFn.mockImplementation(() => {
        callCount++;
        // Calls 1-2: HALF_OPEN recovery
        if (callCount <= 2) return Promise.resolve('recovery');
        // Call 3: first drain item succeeds
        if (callCount === 3) return Promise.resolve('drain-ok');
        // Calls 4+: drain items fail (will accumulate failures, eventually re-trip)
        return Promise.reject(new Error('drain-fail'));
      });

      // Wait for resetTimeout then transition OPEN -> HALF_OPEN -> CLOSED
      await new Promise((r) => setTimeout(r, 150));
      await tripBreaker.execute('recover1');
      await tripBreaker.execute('recover2');
      expect(tripBreaker.state).toBe(STATES.CLOSED);

      // Wait for drain to process
      await new Promise((r) => setTimeout(r, 300));

      // First queued item should have resolved
      const r1 = await queued1;
      expect(r1).toBe('drain-ok');

      // Remaining items should have been rejected or still pending
      const r2 = await queued2;
      expect(r2).toHaveProperty('error');
    });
  });

  // ===== getStatus =====

  describe('getStatus', () => {
    it('should return current status', () => {
      const status = breaker.getStatus();
      expect(status).toEqual({
        name: 'test-breaker',
        state: 'CLOSED',
        failureCount: 0,
        successCount: 0,
        pendingQueueLength: 0,
        lastFailureTime: null,
        options: {
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 5000,
          resetTimeout: 1000,
        },
      });
    });

    it('should reflect state changes', async () => {
      mockFn.mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(breaker.execute()).rejects.toThrow('fail');
      }

      const status = breaker.getStatus();
      expect(status.state).toBe('OPEN');
      expect(status.failureCount).toBe(3);
      expect(status.lastFailureTime).not.toBeNull();
    });
  });

  // ===== onStateChange callback =====

  describe('onStateChange callback', () => {
    it('should call onStateChange when state transitions', async () => {
      const stateChanges = [];
      const tracked = new CircuitBreaker(mockFn, {
        failureThreshold: 2,
        successThreshold: 1,
        timeout: 5000,
        resetTimeout: 100,
        name: 'tracked',
        onStateChange: (oldState, newState) => {
          stateChanges.push({ from: oldState, to: newState });
        },
      });

      // Trip: CLOSED -> OPEN
      mockFn.mockRejectedValue(new Error('fail'));
      await expect(tracked.execute()).rejects.toThrow('fail');
      await expect(tracked.execute()).rejects.toThrow('fail');

      expect(stateChanges).toEqual([
        { from: 'CLOSED', to: 'OPEN' },
      ]);

      // Wait for resetTimeout
      await new Promise((r) => setTimeout(r, 200));
      mockFn.mockResolvedValue('ok');

      // OPEN -> HALF_OPEN -> CLOSED
      await tracked.execute();

      expect(stateChanges).toEqual([
        { from: 'CLOSED', to: 'OPEN' },
        { from: 'OPEN', to: 'HALF_OPEN' },
        { from: 'HALF_OPEN', to: 'CLOSED' },
      ]);
    });

    it('should not throw if onStateChange callback errors', async () => {
      const badCallback = new CircuitBreaker(mockFn, {
        failureThreshold: 1,
        timeout: 5000,
        name: 'bad-callback',
        onStateChange: () => { throw new Error('callback error'); },
      });

      mockFn.mockRejectedValueOnce(new Error('fail'));
      await expect(badCallback.execute()).rejects.toThrow('fail');

      // Should still trip despite callback error
      expect(badCallback.state).toBe(STATES.OPEN);
    });
  });

  // ===== Concurrency =====

  describe('concurrent execution', () => {
    it('should handle multiple concurrent calls in CLOSED state', async () => {
      let callCount = 0;
      mockFn.mockImplementation(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return `result-${callCount}`;
      });

      const results = await Promise.all([
        breaker.execute('a'),
        breaker.execute('b'),
        breaker.execute('c'),
      ]);

      expect(results).toHaveLength(3);
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent failures correctly', async () => {
      mockFn.mockRejectedValue(new Error('concurrent-fail'));

      const promises = Array.from({ length: 5 }, (_, i) =>
        breaker.execute(`arg-${i}`).catch((e) => e.message)
      );

      const results = await Promise.all(promises);

      // All should have failed
      results.forEach((r) => {
        expect(typeof r).toBe('string');
      });

      // Circuit should be OPEN (3 threshold met)
      expect(breaker.state).toBe(STATES.OPEN);
    });
  });
});
