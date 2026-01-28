// __tests__/BrowserPool/healthMonitor.test.js
const BrowserHealthMonitor = require('../../BrowserPool/healthMonitor');

// Mock constants
jest.mock('../../Config/constants', () => ({
  BROWSER_HEALTH: {
    CHECK_INTERVAL: 1000,
    MEMORY_WARN_MB: 300,
    MEMORY_RECYCLE_MB: 500,
    MAX_PAGES_PER_BROWSER: 20,
    HEALTH_HISTORY_SIZE: 5,
  },
}));

// Mock logger
jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logFail: jest.fn(),
  logInfo: jest.fn(),
  logProgress: jest.fn(),
}));

/**
 * Helper: create a mock BrowserPool
 */
function createMockPool(browserEntries = []) {
  const browsers = new Map();
  for (const { slot, connected, pages, metricsData } of browserEntries) {
    const mockPages = (pages || []).map(p => ({
      isClosed: () => false,
      url: () => p.url || 'https://example.com',
      metrics: jest.fn().mockResolvedValue(metricsData || { JSHeapUsedSize: 50 * 1024 * 1024 }),
    }));

    browsers.set(slot, {
      isConnected: jest.fn().mockReturnValue(connected !== false),
      pages: jest.fn().mockResolvedValue(mockPages),
      close: jest.fn().mockResolvedValue(undefined),
      process: jest.fn().mockReturnValue({ kill: jest.fn() }),
      _slotIndex: slot,
    });
  }

  return {
    browsers,
    availableSlots: browserEntries.filter(b => b.available !== false).map(b => b.slot),
    busySlots: new Set(browserEntries.filter(b => b.busy).map(b => b.slot)),
    getStatus: jest.fn().mockReturnValue({
      poolSize: browserEntries.length,
      totalBrowsers: browsers.size,
      availableBrowsers: browserEntries.filter(b => b.available !== false).length,
      busyBrowsers: browserEntries.filter(b => b.busy).length,
      activePages: 0,
      isInitialized: true,
    }),
    createBrowser: jest.fn().mockImplementation(async (slotIndex) => {
      const newBrowser = {
        isConnected: jest.fn().mockReturnValue(true),
        pages: jest.fn().mockResolvedValue([]),
        close: jest.fn().mockResolvedValue(undefined),
        process: jest.fn().mockReturnValue({ kill: jest.fn() }),
        _slotIndex: slotIndex,
      };
      browsers.set(slotIndex, newBrowser);
      return newBrowser;
    }),
    _makeSlotAvailable: jest.fn(),
  };
}

describe('BrowserHealthMonitor', () => {
  let monitor;
  let mockPool;

  afterEach(() => {
    if (monitor) {
      monitor.stopMonitoring();
      monitor = null;
    }
  });

  describe('constructor', () => {
    it('should throw if no browserPool provided', () => {
      expect(() => new BrowserHealthMonitor(null)).toThrow('requires a BrowserPool instance');
    });

    it('should initialize with default values', () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      expect(monitor.recycleCount).toBe(0);
      expect(monitor.healthHistory).toEqual([]);
      expect(monitor._running).toBe(false);
    });

    it('should accept optional metricsCollector and notifier', () => {
      mockPool = createMockPool([]);
      const metrics = { updateBrowserPoolStatus: jest.fn() };
      const notifier = { notifyGoogleChat: jest.fn() };

      monitor = new BrowserHealthMonitor(mockPool, metrics, notifier);
      expect(monitor.metrics).toBe(metrics);
      expect(monitor.notifier).toBe(notifier);
    });
  });

  describe('startMonitoring / stopMonitoring', () => {
    it('should start and stop monitoring', () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      monitor.startMonitoring(60000);
      expect(monitor._running).toBe(true);
      expect(monitor._interval).not.toBeNull();

      monitor.stopMonitoring();
      expect(monitor._running).toBe(false);
      expect(monitor._interval).toBeNull();
    });

    it('should not start duplicate monitoring', () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      monitor.startMonitoring(60000);
      const firstInterval = monitor._interval;

      monitor.startMonitoring(60000);
      expect(monitor._interval).toBe(firstInterval); // same interval, not re-created
    });
  });

  describe('checkHealth', () => {
    it('should return healthy snapshot when pool is empty', async () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snapshot = await monitor.checkHealth();
      expect(snapshot.healthy).toBe(true);
      expect(snapshot.browsers).toEqual([]);
    });

    it('should report healthy browsers', async () => {
      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          pages: [{ url: 'https://example.com' }],
          metricsData: { JSHeapUsedSize: 50 * 1024 * 1024 }, // 50MB - healthy
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snapshot = await monitor.checkHealth();
      expect(snapshot.healthy).toBe(true);
      expect(snapshot.browsers).toHaveLength(1);
      expect(snapshot.browsers[0].status).toBe('healthy');
      expect(snapshot.browsers[0].connected).toBe(true);
      expect(snapshot.browsers[0].memoryMB).toBeCloseTo(50, 0);
    });

    it('should detect disconnected browsers', async () => {
      mockPool = createMockPool([
        { slot: 1, connected: false },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snapshot = await monitor.checkHealth();
      expect(snapshot.healthy).toBe(false);
      expect(snapshot.browsers[0].status).toBe('disconnected');
    });

    it('should trigger recycle when memory exceeds threshold', async () => {
      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          pages: [{ url: 'https://example.com' }],
          metricsData: { JSHeapUsedSize: 600 * 1024 * 1024 }, // 600MB > 500MB threshold
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snapshot = await monitor.checkHealth();
      expect(snapshot.recycledSlots).toContain(1);
      expect(monitor.recycleCount).toBe(1);
    });

    it('should NOT recycle busy browser even if memory is high', async () => {
      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          busy: true,
          available: false,
          pages: [{ url: 'https://example.com' }],
          metricsData: { JSHeapUsedSize: 600 * 1024 * 1024 },
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snapshot = await monitor.checkHealth();
      // Recycle was attempted but skipped because slot is busy
      expect(monitor.recycleCount).toBe(0);
    });

    it('should warn but not recycle when memory exceeds warn threshold', async () => {
      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          pages: [{ url: 'https://example.com' }],
          metricsData: { JSHeapUsedSize: 350 * 1024 * 1024 }, // 350MB > 300MB warn, < 500MB recycle
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snapshot = await monitor.checkHealth();
      expect(snapshot.healthy).toBe(true); // warning does not mark as unhealthy
      expect(snapshot.recycledSlots).toHaveLength(0);
      expect(snapshot.browsers[0].status).toContain('warning_memory');
    });

    it('should trigger recycle when page count exceeds max', async () => {
      // Create a mock with many pages
      const manyPages = Array.from({ length: 25 }, (_, i) => ({
        url: `https://example.com/page${i}`,
      }));

      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          pages: manyPages,
          metricsData: { JSHeapUsedSize: 50 * 1024 * 1024 },
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snapshot = await monitor.checkHealth();
      expect(snapshot.recycledSlots).toContain(1);
      expect(snapshot.browsers[0].status).toContain('recycle_pages');
    });

    it('should bound healthHistory to configured size', async () => {
      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          pages: [{ url: 'https://example.com' }],
          metricsData: { JSHeapUsedSize: 10 * 1024 * 1024 },
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      // History size is 5 (from mock constants)
      for (let i = 0; i < 10; i++) {
        await monitor.checkHealth();
      }

      expect(monitor.healthHistory.length).toBe(5);
    });

    it('should update metricsCollector when available', async () => {
      const metrics = { updateBrowserPoolStatus: jest.fn() };
      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          pages: [{ url: 'https://example.com' }],
          metricsData: { JSHeapUsedSize: 10 * 1024 * 1024 },
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool, metrics);

      await monitor.checkHealth();
      expect(metrics.updateBrowserPoolStatus).toHaveBeenCalled();
    });
  });

  describe('_getMemoryUsage', () => {
    it('should return 0 when no pages available', async () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      const result = await monitor._getMemoryUsage({}, []);
      expect(result).toBe(0);
    });

    it('should return 0 when metrics call fails', async () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      const failPage = { metrics: jest.fn().mockRejectedValue(new Error('crash')) };
      const result = await monitor._getMemoryUsage({}, [failPage]);
      expect(result).toBe(0);
    });

    it('should convert bytes to MB correctly', async () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      const page = {
        metrics: jest.fn().mockResolvedValue({ JSHeapUsedSize: 100 * 1024 * 1024 }),
      };

      const result = await monitor._getMemoryUsage({}, [page]);
      expect(result).toBe(100);
    });
  });

  describe('_recycleBrowser', () => {
    it('should skip recycle for busy slots', async () => {
      mockPool = createMockPool([
        { slot: 1, connected: true, busy: true, available: false, pages: [] },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      await monitor._recycleBrowser(1, 'test reason');
      expect(monitor.recycleCount).toBe(0);
      expect(mockPool.createBrowser).not.toHaveBeenCalled();
    });

    it('should close and recreate browser for idle slots', async () => {
      mockPool = createMockPool([
        { slot: 1, connected: true, pages: [] },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      await monitor._recycleBrowser(1, 'test reason');
      expect(monitor.recycleCount).toBe(1);
      expect(mockPool.createBrowser).toHaveBeenCalledWith(1);
      expect(mockPool._makeSlotAvailable).toHaveBeenCalledWith(1);
    });

    it('should notify when notifier is available', async () => {
      const notifier = { notifyGoogleChat: jest.fn().mockResolvedValue(undefined) };
      mockPool = createMockPool([
        { slot: 1, connected: true, pages: [] },
      ]);
      monitor = new BrowserHealthMonitor(mockPool, null, notifier);

      await monitor._recycleBrowser(1, 'memory too high');
      expect(notifier.notifyGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('slot 1 recycled')
      );
    });

    it('should re-add slot to available on createBrowser failure', async () => {
      mockPool = createMockPool([
        { slot: 1, connected: true, pages: [] },
      ]);
      mockPool.createBrowser.mockRejectedValueOnce(new Error('Chrome failed to launch'));
      monitor = new BrowserHealthMonitor(mockPool);

      await monitor._recycleBrowser(1, 'test');
      // Should still make slot available to prevent permanent loss
      expect(mockPool._makeSlotAvailable).toHaveBeenCalledWith(1);
      expect(monitor.recycleCount).toBe(0); // recycle failed, count not incremented
    });
  });

  describe('getHealthSnapshot', () => {
    it('should return monitoring state and thresholds', () => {
      mockPool = createMockPool([]);
      monitor = new BrowserHealthMonitor(mockPool);

      const snap = monitor.getHealthSnapshot();
      expect(snap.monitoring).toBe(false);
      expect(snap.recycleCount).toBe(0);
      expect(snap.historySize).toBe(0);
      expect(snap.thresholds).toEqual({
        memoryWarnMB: 300,
        memoryRecycleMB: 500,
        maxPagesPerBrowser: 20,
      });
      expect(snap.latestCheck).toBeNull();
      expect(snap.recentHistory).toEqual([]);
    });

    it('should include latest check after running checkHealth', async () => {
      mockPool = createMockPool([
        {
          slot: 1,
          connected: true,
          pages: [{ url: 'https://example.com' }],
          metricsData: { JSHeapUsedSize: 10 * 1024 * 1024 },
        },
      ]);
      monitor = new BrowserHealthMonitor(mockPool);

      await monitor.checkHealth();
      const snap = monitor.getHealthSnapshot();
      expect(snap.latestCheck).not.toBeNull();
      expect(snap.latestCheck.browsers).toHaveLength(1);
      expect(snap.historySize).toBe(1);
    });
  });
});
