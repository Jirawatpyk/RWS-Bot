/**
 * Tests for Features/moraviaStatusSync.js
 */

// Mock dependencies before requiring the module
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logSuccess: jest.fn(),
  logFail: jest.fn(),
}));

jest.mock('../../Config/constants', () => ({
  STATUS_SYNC: {
    POLLING_INTERVAL: 5 * 60 * 1000,
    ENABLED: true,
  },
}));

const { MoraviaStatusSync } = require('../../Features/moraviaStatusSync');
const { logInfo, logSuccess, logFail } = require('../../Logs/logger');

// Helper: create mock dependencies
function createMocks(overrides = {}) {
  const taskReporter = {
    loadAndFilterTasks: jest.fn().mockResolvedValue({
      activeTasks: [{ orderId: '1' }, { orderId: '2' }],
      completedCount: 0,
      onHoldCount: 0,
    }),
    ...overrides.taskReporter,
  };

  const broadcastToClients = jest.fn();
  const notifier = jest.fn().mockResolvedValue(undefined);

  const eventBus = {
    emit: jest.fn(),
    on: jest.fn(),
    ...overrides.eventBus,
  };

  return { taskReporter, broadcastToClients, notifier, eventBus };
}

describe('MoraviaStatusSync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create instance with valid dependencies', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      expect(sync).toBeDefined();
      expect(sync.lastSyncResult).toBeNull();
      expect(sync._syncing).toBe(false);
      expect(sync._interval).toBeNull();
    });

    it('should throw if taskReporter is missing', () => {
      const mocks = createMocks();
      delete mocks.taskReporter;

      expect(() => new MoraviaStatusSync(mocks)).toThrow(
        'MoraviaStatusSync requires taskReporter with loadAndFilterTasks()'
      );
    });

    it('should throw if taskReporter lacks loadAndFilterTasks', () => {
      const mocks = createMocks();
      mocks.taskReporter = {};

      expect(() => new MoraviaStatusSync(mocks)).toThrow(
        'MoraviaStatusSync requires taskReporter with loadAndFilterTasks()'
      );
    });

    it('should throw if broadcastToClients is not a function', () => {
      const mocks = createMocks();
      mocks.broadcastToClients = 'not-a-function';

      expect(() => new MoraviaStatusSync(mocks)).toThrow(
        'MoraviaStatusSync requires broadcastToClients function'
      );
    });
  });

  describe('startPolling', () => {
    it('should start polling with default interval', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      sync.startPolling();

      expect(sync._interval).not.toBeNull();
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('Polling started')
      );
    });

    it('should start polling with custom interval', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      sync.startPolling(10000);

      expect(sync._interval).not.toBeNull();
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('every 10s')
      );
    });

    it('should not start polling twice', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      sync.startPolling(60000);
      const firstInterval = sync._interval;
      sync.startPolling(60000);

      expect(sync._interval).toBe(firstInterval);
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('already active')
      );
    });

    it('should call sync on interval tick', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);
      const syncSpy = jest.spyOn(sync, 'sync').mockResolvedValue(null);

      sync.startPolling(1000);
      jest.advanceTimersByTime(1000);

      expect(syncSpy).toHaveBeenCalledTimes(1);

      syncSpy.mockRestore();
    });
  });

  describe('stopPolling', () => {
    it('should clear the interval', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      sync.startPolling(60000);
      expect(sync._interval).not.toBeNull();

      sync.stopPolling();
      expect(sync._interval).toBeNull();
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('Polling stopped')
      );
    });

    it('should be safe to call when not polling', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      expect(() => sync.stopPolling()).not.toThrow();
    });
  });

  describe('sync', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it('should call loadAndFilterTasks and update lastSyncResult', async () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      const result = await sync.sync();

      expect(mocks.taskReporter.loadAndFilterTasks).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.activeTasks).toBe(2);
      expect(result.activeTasksList).toHaveLength(2);
      expect(result.completedCount).toBe(0);
      expect(result.onHoldCount).toBe(0);
    });

    it('should broadcast when there are completed tasks', async () => {
      const mocks = createMocks();
      mocks.taskReporter.loadAndFilterTasks.mockResolvedValue({
        activeTasks: [{ orderId: '1' }],
        completedCount: 3,
        onHoldCount: 1,
      });
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      expect(mocks.broadcastToClients).toHaveBeenCalledWith({
        type: 'tasksUpdated',
        completedCount: 3,
        onHoldCount: 1,
        activeTasks: 1,
        timestamp: expect.any(Number),
      });
    });

    it('should not broadcast when no status changes', async () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      expect(mocks.broadcastToClients).not.toHaveBeenCalled();
    });

    it('should emit eventBus events for completed tasks', async () => {
      const mocks = createMocks();
      mocks.taskReporter.loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 2,
        onHoldCount: 0,
      });
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      expect(mocks.eventBus.emit).toHaveBeenCalledWith('sync:completed', { count: 2 });
    });

    it('should emit eventBus events for on-hold tasks', async () => {
      const mocks = createMocks();
      mocks.taskReporter.loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 0,
        onHoldCount: 3,
      });
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      expect(mocks.eventBus.emit).toHaveBeenCalledWith('sync:onhold', { count: 3 });
    });

    it('should call notifier when tasks completed', async () => {
      const mocks = createMocks();
      mocks.taskReporter.loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 5,
        onHoldCount: 2,
      });
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      expect(mocks.notifier).toHaveBeenCalledWith(
        expect.stringContaining('5 tasks completed')
      );
    });

    it('should not call notifier when only on-hold tasks', async () => {
      const mocks = createMocks();
      mocks.taskReporter.loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 0,
        onHoldCount: 2,
      });
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      expect(mocks.notifier).not.toHaveBeenCalled();
    });

    it('should handle notifier failure gracefully', async () => {
      const mocks = createMocks();
      mocks.notifier.mockRejectedValue(new Error('Webhook failed'));
      mocks.taskReporter.loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 1,
        onHoldCount: 0,
      });
      const sync = new MoraviaStatusSync(mocks);

      const result = await sync.sync();

      // Sync itself should still succeed
      expect(result.success).toBe(true);
      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('Notification failed')
      );
    });

    it('should handle loadAndFilterTasks failure', async () => {
      const mocks = createMocks();
      mocks.taskReporter.loadAndFilterTasks.mockRejectedValue(
        new Error('Sheet API down')
      );
      const sync = new MoraviaStatusSync(mocks);

      const result = await sync.sync();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sheet API down');
      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('Sheet API down')
      );
    });

    it('should prevent concurrent sync (concurrency guard)', async () => {
      const mocks = createMocks();
      // Make loadAndFilterTasks take time
      let resolveSync;
      mocks.taskReporter.loadAndFilterTasks.mockReturnValue(
        new Promise((resolve) => {
          resolveSync = resolve;
        })
      );
      const sync = new MoraviaStatusSync(mocks);

      // Start first sync
      const firstSync = sync.sync();

      // Try second sync while first is in progress
      const secondResult = await sync.sync();

      expect(secondResult).toBeNull();
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('already in progress')
      );

      // Resolve first sync
      resolveSync({
        activeTasks: [],
        completedCount: 0,
        onHoldCount: 0,
      });
      await firstSync;
    });

    it('should increment syncCount for each sync call', async () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();
      expect(sync._syncCount).toBe(1);

      await sync.sync();
      expect(sync._syncCount).toBe(2);
    });

    it('should work without eventBus', async () => {
      const mocks = createMocks();
      mocks.eventBus = null;
      mocks.taskReporter.loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 1,
        onHoldCount: 0,
      });
      const sync = new MoraviaStatusSync(mocks);

      const result = await sync.sync();

      expect(result.success).toBe(true);
    });

    it('should reset _syncing flag even on error', async () => {
      const mocks = createMocks();
      mocks.taskReporter.loadAndFilterTasks.mockRejectedValue(
        new Error('Boom')
      );
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      expect(sync._syncing).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return null result when never synced', () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      const status = sync.getStatus();

      expect(status.isPolling).toBe(false);
      expect(status.syncCount).toBe(0);
      expect(status.isSyncing).toBe(false);
    });

    it('should reflect polling state', () => {
      jest.useFakeTimers();
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      sync.startPolling(60000);
      expect(sync.getStatus().isPolling).toBe(true);

      sync.stopPolling();
      expect(sync.getStatus().isPolling).toBe(false);
      jest.useRealTimers();
    });

    it('should include last sync result after sync', async () => {
      const mocks = createMocks();
      const sync = new MoraviaStatusSync(mocks);

      await sync.sync();

      const status = sync.getStatus();
      expect(status.success).toBe(true);
      expect(status.activeTasks).toBe(2);
      expect(status.syncCount).toBe(1);
      expect(status.timestamp).toBeDefined();
    });
  });
});
