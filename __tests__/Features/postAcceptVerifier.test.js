/**
 * Tests for Features/postAcceptVerifier.js
 *
 * Covers:
 * - Constructor validation
 * - scheduleVerification (valid + invalid input)
 * - Successful verification (status = "accepted" / "in progress")
 * - Failed verification with capacity rollback
 * - Error handling during verification
 * - Results bounded to MAX_RESULTS
 * - getStatus() and getResults()
 * - stop() clears queue
 */

// Mock logger to suppress output during tests
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logFail: jest.fn(),
  logSuccess: jest.fn(),
  logProgress: jest.fn(),
}));

// Mock constants
jest.mock('../../Config/constants', () => ({
  VERIFICATION: {
    DELAY_MS: 50,        // Short delay for fast tests
    PAGE_TIMEOUT: 5000,
    MAX_RESULTS: 5,      // Small limit to test bounding
  },
}));

const { PostAcceptVerifier } = require('../../Features/postAcceptVerifier');
const { logFail, logSuccess, logInfo } = require('../../Logs/logger');

// ========================= Helpers =========================

/**
 * Create a mock BrowserPool with configurable page behavior.
 */
function createMockBrowserPool(pageOptions = {}) {
  const mockPage = {
    goto: pageOptions.goto || jest.fn().mockResolvedValue(),
    $eval: pageOptions.$eval || jest.fn().mockResolvedValue('accepted'),
    isClosed: jest.fn().mockReturnValue(false),
    close: jest.fn().mockResolvedValue(),
  };

  const mockBrowser = {
    _slotIndex: 1,
    isConnected: jest.fn().mockReturnValue(true),
  };

  return {
    pool: {
      getBrowser: jest.fn().mockResolvedValue(mockBrowser),
      getPage: jest.fn().mockResolvedValue(mockPage),
      releasePage: jest.fn().mockResolvedValue(),
      releaseBrowser: jest.fn().mockResolvedValue(),
    },
    browser: mockBrowser,
    page: mockPage,
  };
}

function createMockCapacityTracker() {
  return {
    releaseCapacity: jest.fn().mockResolvedValue(),
  };
}

function createMockNotifier() {
  return jest.fn().mockResolvedValue();
}

// ========================= Tests =========================

describe('PostAcceptVerifier', () => {
  let verifier;
  let mockPool;
  let mockCapacityTracker;
  let mockNotifier;

  beforeEach(() => {
    const mocks = createMockBrowserPool();
    mockPool = mocks;
    mockCapacityTracker = createMockCapacityTracker();
    mockNotifier = createMockNotifier();

    verifier = new PostAcceptVerifier({
      browserPool: mocks.pool,
      capacityTracker: mockCapacityTracker,
      notifier: mockNotifier,
    });
  });

  afterEach(() => {
    verifier.stop();
  });

  // ---- Constructor ----

  describe('constructor', () => {
    it('should throw if browserPool is missing', () => {
      expect(() => new PostAcceptVerifier({
        browserPool: null,
        capacityTracker: mockCapacityTracker,
        notifier: mockNotifier,
      })).toThrow('requires browserPool');
    });

    it('should throw if capacityTracker is missing', () => {
      expect(() => new PostAcceptVerifier({
        browserPool: mockPool.pool,
        capacityTracker: null,
        notifier: mockNotifier,
      })).toThrow('requires capacityTracker');
    });

    it('should throw if notifier is not a function', () => {
      expect(() => new PostAcceptVerifier({
        browserPool: mockPool.pool,
        capacityTracker: mockCapacityTracker,
        notifier: 'not a function',
      })).toThrow('requires notifier function');
    });

    it('should initialize with empty queue and results', () => {
      expect(verifier.verificationQueue).toEqual([]);
      expect(verifier.results).toEqual([]);
      expect(verifier._processing).toBe(false);
    });
  });

  // ---- scheduleVerification ----

  describe('scheduleVerification', () => {
    it('should reject missing orderId', () => {
      verifier.scheduleVerification({ url: 'http://test.com' });
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('missing orderId'));
      expect(verifier.verificationQueue).toHaveLength(0);
    });

    it('should reject missing url', () => {
      verifier.scheduleVerification({ orderId: '123' });
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('missing orderId'));
      expect(verifier.verificationQueue).toHaveLength(0);
    });

    it('should reject null task', () => {
      verifier.scheduleVerification(null);
      expect(logFail).toHaveBeenCalled();
    });

    it('should add valid task to queue', () => {
      // Stop processing so item stays in queue
      verifier._processing = true;

      verifier.scheduleVerification({
        orderId: 'ORD-001',
        url: 'http://moravia.com/task/1',
        allocationPlan: [{ date: '2026-01-28', amount: 1000 }],
        amountWords: 1000,
      });

      expect(verifier.verificationQueue).toHaveLength(1);
      expect(verifier.verificationQueue[0].orderId).toBe('ORD-001');
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Scheduled verification'));
    });
  });

  // ---- Verification: Success ----

  describe('_verify - success', () => {
    it('should verify task with "accepted" status', async () => {
      // Mock returns the result of the $eval callback (which runs toLowerCase() in page context)
      mockPool.page.$eval.mockResolvedValue('accepted');

      const result = await verifier._verify({
        orderId: 'ORD-001',
        url: 'http://moravia.com/task/1',
        allocationPlan: [],
      });

      expect(result.verified).toBe(true);
      expect(result.orderId).toBe('ORD-001');
      expect(result.actualStatus).toBe('accepted');
      expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('verified'));
      expect(mockNotifier).not.toHaveBeenCalled();
    });

    it('should verify task with "in progress" status', async () => {
      mockPool.page.$eval.mockResolvedValue('in progress');

      const result = await verifier._verify({
        orderId: 'ORD-002',
        url: 'http://moravia.com/task/2',
        allocationPlan: [],
      });

      expect(result.verified).toBe(true);
      expect(result.actualStatus).toBe('in progress');
    });
  });

  // ---- Verification: Failure ----

  describe('_verify - failure', () => {
    it('should fail when status is not accepted/in progress', async () => {
      // $eval callback in page context does toLowerCase(), so mock returns lowercase
      mockPool.page.$eval.mockResolvedValue('new');

      const result = await verifier._verify({
        orderId: 'ORD-003',
        url: 'http://moravia.com/task/3',
        allocationPlan: [{ date: '2026-01-28', amount: 500 }],
      });

      expect(result.verified).toBe(false);
      expect(result.actualStatus).toBe('new');
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('NOT verified'));
    });

    it('should rollback capacity on failed verification', async () => {
      mockPool.page.$eval.mockResolvedValue('new');

      const allocationPlan = [
        { date: '2026-01-28', amount: 500 },
        { date: '2026-01-29', amount: 300 },
      ];

      await verifier._verify({
        orderId: 'ORD-004',
        url: 'http://moravia.com/task/4',
        allocationPlan,
      });

      expect(mockCapacityTracker.releaseCapacity).toHaveBeenCalledWith(allocationPlan);
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Capacity rolled back'));
    });

    it('should notify on failed verification', async () => {
      mockPool.page.$eval.mockResolvedValue('new');

      await verifier._verify({
        orderId: 'ORD-005',
        url: 'http://moravia.com/task/5',
        allocationPlan: [],
      });

      expect(mockNotifier).toHaveBeenCalledWith(
        expect.stringContaining('ORD-005 NOT accepted')
      );
    });

    it('should not rollback when allocationPlan is empty', async () => {
      mockPool.page.$eval.mockResolvedValue('new');

      await verifier._verify({
        orderId: 'ORD-006',
        url: 'http://moravia.com/task/6',
        allocationPlan: [],
      });

      expect(mockCapacityTracker.releaseCapacity).not.toHaveBeenCalled();
    });

    it('should handle capacity rollback failure gracefully', async () => {
      mockPool.page.$eval.mockResolvedValue('new');
      mockCapacityTracker.releaseCapacity.mockRejectedValue(new Error('File locked'));

      const result = await verifier._verify({
        orderId: 'ORD-007',
        url: 'http://moravia.com/task/7',
        allocationPlan: [{ date: '2026-01-28', amount: 100 }],
      });

      // Should still mark as not verified and log the rollback error
      expect(result.verified).toBe(false);
      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('Capacity rollback failed')
      );
    });
  });

  // ---- Verification: Error handling ----

  describe('_verify - error handling', () => {
    it('should handle page navigation error', async () => {
      mockPool.page.goto.mockRejectedValue(new Error('Navigation timeout'));

      const result = await verifier._verify({
        orderId: 'ORD-ERR-1',
        url: 'http://moravia.com/task/err1',
        allocationPlan: [],
      });

      expect(result.verified).toBe(false);
      expect(result.error).toBe('Navigation timeout');
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('Error verifying'));
    });

    it('should handle $eval error (element not found)', async () => {
      mockPool.page.$eval.mockRejectedValue(new Error('Element not found'));

      const result = await verifier._verify({
        orderId: 'ORD-ERR-2',
        url: 'http://moravia.com/task/err2',
        allocationPlan: [],
      });

      expect(result.verified).toBe(false);
      expect(result.error).toBe('Element not found');
    });

    it('should always release browser resources even on error', async () => {
      mockPool.page.goto.mockRejectedValue(new Error('crash'));

      await verifier._verify({
        orderId: 'ORD-ERR-3',
        url: 'http://moravia.com/task/err3',
        allocationPlan: [],
      });

      expect(mockPool.pool.releasePage).toHaveBeenCalled();
      expect(mockPool.pool.releaseBrowser).toHaveBeenCalled();
    });

    it('should handle getBrowser failure', async () => {
      mockPool.pool.getBrowser.mockRejectedValue(new Error('Pool exhausted'));

      const result = await verifier._verify({
        orderId: 'ORD-ERR-4',
        url: 'http://moravia.com/task/err4',
        allocationPlan: [],
      });

      expect(result.verified).toBe(false);
      expect(result.error).toBe('Pool exhausted');
    });
  });

  // ---- Results bounding ----

  describe('results bounding', () => {
    it('should keep only MAX_RESULTS entries', async () => {
      // MAX_RESULTS is mocked to 5
      for (let i = 0; i < 8; i++) {
        mockPool.page.$eval.mockResolvedValue('Accepted');

        await verifier._verify({
          orderId: `ORD-${i}`,
          url: `http://moravia.com/task/${i}`,
          allocationPlan: [],
        });
      }

      expect(verifier.results).toHaveLength(5);
      // Should keep the last 5 (indices 3-7)
      expect(verifier.results[0].orderId).toBe('ORD-3');
      expect(verifier.results[4].orderId).toBe('ORD-7');
    });
  });

  // ---- getStatus / getResults ----

  describe('getStatus', () => {
    it('should return initial status', () => {
      const status = verifier.getStatus();
      expect(status.pending).toBe(0);
      expect(status.completed).toBe(0);
      expect(status.processing).toBe(false);
      expect(status.lastVerification).toBeNull();
    });

    it('should return updated status after verification', async () => {
      mockPool.page.$eval.mockResolvedValue('Accepted');

      await verifier._verify({
        orderId: 'ORD-S1',
        url: 'http://moravia.com/task/s1',
        allocationPlan: [],
      });

      const status = verifier.getStatus();
      expect(status.completed).toBe(1);
      expect(status.lastVerification).toBeTruthy();
      expect(status.lastVerification.orderId).toBe('ORD-S1');
    });
  });

  describe('getResults', () => {
    it('should return a copy of results', async () => {
      mockPool.page.$eval.mockResolvedValue('Accepted');

      await verifier._verify({
        orderId: 'ORD-R1',
        url: 'http://moravia.com/task/r1',
        allocationPlan: [],
      });

      const results = verifier.getResults();
      expect(results).toHaveLength(1);

      // Mutating the returned array should not affect internal state
      results.push({ fake: true });
      expect(verifier.results).toHaveLength(1);
    });
  });

  // ---- Queue processing (end-to-end) ----

  describe('queue processing', () => {
    it('should process queued items after delay', async () => {
      mockPool.page.$eval.mockResolvedValue('accepted');

      verifier.scheduleVerification({
        orderId: 'ORD-Q1',
        url: 'http://moravia.com/task/q1',
        allocationPlan: [],
      });

      // Wait for processing (delay is 50ms in mock)
      await new Promise(r => setTimeout(r, 200));

      expect(verifier.results).toHaveLength(1);
      expect(verifier.results[0].orderId).toBe('ORD-Q1');
      expect(verifier.results[0].verified).toBe(true);
    });

    it('should process multiple items sequentially', async () => {
      let callOrder = [];
      mockPool.page.$eval.mockImplementation(() => {
        callOrder.push(Date.now());
        return 'accepted';
      });

      verifier.scheduleVerification({
        orderId: 'ORD-Q2',
        url: 'http://moravia.com/task/q2',
        allocationPlan: [],
      });
      verifier.scheduleVerification({
        orderId: 'ORD-Q3',
        url: 'http://moravia.com/task/q3',
        allocationPlan: [],
      });

      // Wait for both to process
      await new Promise(r => setTimeout(r, 400));

      expect(verifier.results).toHaveLength(2);
      expect(verifier.results[0].orderId).toBe('ORD-Q2');
      expect(verifier.results[1].orderId).toBe('ORD-Q3');
    });
  });

  // ---- stop ----

  describe('stop', () => {
    it('should clear queue and set stopped flag', () => {
      // Prevent processing so items stay in queue
      verifier._processing = true;

      verifier.scheduleVerification({
        orderId: 'ORD-STOP',
        url: 'http://moravia.com/task/stop',
      });

      expect(verifier.verificationQueue).toHaveLength(1);

      verifier.stop();

      expect(verifier.verificationQueue).toHaveLength(0);
      expect(verifier._stopped).toBe(true);
    });
  });
});
