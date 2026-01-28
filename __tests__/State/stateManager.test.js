/**
 * Tests for State/stateManager.js
 *
 * Covers:
 *   - Singleton export
 *   - Capacity CRUD + events
 *   - Active tasks CRUD + events + dedup
 *   - Browser pool status updates
 *   - IMAP status updates
 *   - System status + lastError
 *   - Snapshot deep copy
 *   - Persistence (saveToFile / loadFromFile)
 *   - reset()
 *   - Input validation / error handling
 */

// Mock dependencies before requiring the module
jest.mock('../../Utils/fileUtils', () => ({
  loadJSON: jest.fn(),
  saveJSON: jest.fn()
}));

jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logFail: jest.fn()
}));

const { StateManager } = require('../../State/stateManager');
const { loadJSON, saveJSON } = require('../../Utils/fileUtils');
const { logInfo, logFail } = require('../../Logs/logger');

describe('StateManager', () => {
  let sm;

  beforeEach(() => {
    sm = new StateManager();
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════
  //  SINGLETON
  // ═══════════════════════════════════════════════════

  test('exports a singleton stateManager instance', () => {
    const { stateManager } = require('../../State/stateManager');
    expect(stateManager).toBeDefined();
    expect(stateManager).toBeInstanceOf(StateManager);
  });

  // ═══════════════════════════════════════════════════
  //  INITIAL STATE
  // ═══════════════════════════════════════════════════

  test('initializes with correct default state', () => {
    const snapshot = sm.getSnapshot();
    expect(snapshot.capacity).toEqual({});
    expect(snapshot.activeTasks).toEqual([]);
    expect(snapshot.browserPool).toEqual({ active: 0, total: 0, available: 0 });
    expect(snapshot.imap).toEqual({ connected: false, paused: false, mailboxes: [] });
    expect(snapshot.system.status).toBe('initializing');
    expect(typeof snapshot.system.startTime).toBe('number');
    expect(snapshot.system.lastError).toBeNull();
  });

  // ═══════════════════════════════════════════════════
  //  CAPACITY
  // ═══════════════════════════════════════════════════

  describe('Capacity', () => {
    test('updateCapacity sets value and emits event', () => {
      const handler = jest.fn();
      sm.on('state:capacity', handler);

      sm.updateCapacity('2026-01-28', 5000);

      expect(sm.getCapacity('2026-01-28')).toBe(5000);
      expect(handler).toHaveBeenCalledWith({ date: '2026-01-28', amount: 5000 });
    });

    test('getCapacity returns 0 for unknown date', () => {
      expect(sm.getCapacity('2099-12-31')).toBe(0);
    });

    test('setCapacityMap replaces entire map', () => {
      sm.updateCapacity('2026-01-28', 1000);
      sm.setCapacityMap({ '2026-02-01': 3000, '2026-02-02': 4000 });

      expect(sm.getCapacity('2026-01-28')).toBe(0); // old date gone
      expect(sm.getCapacity('2026-02-01')).toBe(3000);
      expect(sm.getCapacity('2026-02-02')).toBe(4000);
    });

    test('setCapacityMap emits event with bulk flag', () => {
      const handler = jest.fn();
      sm.on('state:capacity', handler);
      sm.setCapacityMap({ '2026-01-28': 500 });
      expect(handler).toHaveBeenCalledWith({ bulk: true });
    });

    test('getCapacityMap returns deep copy', () => {
      sm.updateCapacity('2026-01-28', 5000);
      const map = sm.getCapacityMap();
      map['2026-01-28'] = 9999; // mutate the copy
      expect(sm.getCapacity('2026-01-28')).toBe(5000); // original unchanged
    });

    test('removeCapacityDate removes and emits', () => {
      const handler = jest.fn();
      sm.on('state:capacity', handler);
      sm.updateCapacity('2026-01-28', 5000);
      handler.mockClear();

      sm.removeCapacityDate('2026-01-28');
      expect(sm.getCapacity('2026-01-28')).toBe(0);
      expect(handler).toHaveBeenCalledWith({ date: '2026-01-28', removed: true });
    });

    test('removeCapacityDate does nothing for unknown date', () => {
      const handler = jest.fn();
      sm.on('state:capacity', handler);
      sm.removeCapacityDate('nonexistent');
      expect(handler).not.toHaveBeenCalled();
    });

    test('updateCapacity throws on invalid input', () => {
      expect(() => sm.updateCapacity(123, 5000)).toThrow(TypeError);
      expect(() => sm.updateCapacity('2026-01-28', 'abc')).toThrow(TypeError);
    });

    test('setCapacityMap throws on non-object', () => {
      expect(() => sm.setCapacityMap('invalid')).toThrow(TypeError);
      expect(() => sm.setCapacityMap([1, 2])).toThrow(TypeError);
      expect(() => sm.setCapacityMap(null)).toThrow(TypeError);
    });
  });

  // ═══════════════════════════════════════════════════
  //  ACTIVE TASKS
  // ═══════════════════════════════════════════════════

  describe('Active Tasks', () => {
    const task1 = { orderId: 'ORD-001', workflowName: 'Test', wordCount: 1000 };
    const task2 = { orderId: 'ORD-002', workflowName: 'Test2', wordCount: 2000 };

    test('addActiveTask adds and emits event', () => {
      const handler = jest.fn();
      sm.on('state:tasks', handler);

      sm.addActiveTask(task1);

      const tasks = sm.getActiveTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].orderId).toBe('ORD-001');
      expect(handler).toHaveBeenCalledWith({ action: 'add', orderId: 'ORD-001' });
    });

    test('addActiveTask prevents duplicates', () => {
      const handler = jest.fn();
      sm.addActiveTask(task1);
      sm.on('state:tasks', handler);

      sm.addActiveTask({ orderId: 'ORD-001', workflowName: 'Different' });

      expect(sm.getActiveTasks()).toHaveLength(1);
      expect(handler).not.toHaveBeenCalled(); // no event for duplicate
    });

    test('addActiveTask stores deep copy (no external mutation)', () => {
      const mutable = { orderId: 'ORD-X', name: 'original' };
      sm.addActiveTask(mutable);
      mutable.name = 'mutated';
      expect(sm.getActiveTasks()[0].name).toBe('original');
    });

    test('removeActiveTask removes and returns task', () => {
      sm.addActiveTask(task1);
      sm.addActiveTask(task2);

      const removed = sm.removeActiveTask('ORD-001');
      expect(removed.orderId).toBe('ORD-001');
      expect(sm.getActiveTasks()).toHaveLength(1);
    });

    test('removeActiveTask returns null for unknown orderId', () => {
      expect(sm.removeActiveTask('NONEXISTENT')).toBeNull();
    });

    test('removeActiveTask emits event', () => {
      sm.addActiveTask(task1);
      const handler = jest.fn();
      sm.on('state:tasks', handler);

      sm.removeActiveTask('ORD-001');
      expect(handler).toHaveBeenCalledWith({ action: 'remove', orderId: 'ORD-001' });
    });

    test('setActiveTasks replaces all tasks', () => {
      sm.addActiveTask(task1);
      sm.setActiveTasks([task2]);

      const tasks = sm.getActiveTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].orderId).toBe('ORD-002');
    });

    test('setActiveTasks emits replace event', () => {
      const handler = jest.fn();
      sm.on('state:tasks', handler);
      sm.setActiveTasks([task1, task2]);
      expect(handler).toHaveBeenCalledWith({ action: 'replace', count: 2 });
    });

    test('setActiveTasks throws on non-array', () => {
      expect(() => sm.setActiveTasks('invalid')).toThrow(TypeError);
    });

    test('getActiveTasks returns deep copy', () => {
      sm.addActiveTask(task1);
      const tasks = sm.getActiveTasks();
      tasks[0].orderId = 'MUTATED';
      expect(sm.getActiveTasks()[0].orderId).toBe('ORD-001');
    });

    test('findTask returns deep copy or undefined', () => {
      sm.addActiveTask(task1);
      const found = sm.findTask('ORD-001');
      expect(found.orderId).toBe('ORD-001');
      found.orderId = 'MUTATED';
      expect(sm.findTask('ORD-001').orderId).toBe('ORD-001');

      expect(sm.findTask('NONEXISTENT')).toBeUndefined();
    });

    test('getActiveTaskCount returns correct count', () => {
      expect(sm.getActiveTaskCount()).toBe(0);
      sm.addActiveTask(task1);
      expect(sm.getActiveTaskCount()).toBe(1);
      sm.addActiveTask(task2);
      expect(sm.getActiveTaskCount()).toBe(2);
    });

    test('addActiveTask throws without orderId', () => {
      expect(() => sm.addActiveTask(null)).toThrow(TypeError);
      expect(() => sm.addActiveTask({})).toThrow(TypeError);
      expect(() => sm.addActiveTask({ name: 'no id' })).toThrow(TypeError);
    });
  });

  // ═══════════════════════════════════════════════════
  //  BROWSER POOL
  // ═══════════════════════════════════════════════════

  describe('Browser Pool', () => {
    test('updateBrowserPool updates and emits', () => {
      const handler = jest.fn();
      sm.on('state:browserPool', handler);

      sm.updateBrowserPool({ active: 2, total: 4, available: 2 });

      expect(sm.getBrowserPoolStatus()).toEqual({ active: 2, total: 4, available: 2 });
      expect(handler).toHaveBeenCalledWith({ active: 2, total: 4, available: 2 });
    });

    test('updateBrowserPool partial update keeps previous values', () => {
      sm.updateBrowserPool({ active: 1, total: 4, available: 3 });
      sm.updateBrowserPool({ active: 2 }); // only update active

      expect(sm.getBrowserPoolStatus()).toEqual({ active: 2, total: 4, available: 3 });
    });

    test('updateBrowserPool throws on invalid input', () => {
      expect(() => sm.updateBrowserPool(null)).toThrow(TypeError);
      expect(() => sm.updateBrowserPool('string')).toThrow(TypeError);
    });
  });

  // ═══════════════════════════════════════════════════
  //  IMAP
  // ═══════════════════════════════════════════════════

  describe('IMAP', () => {
    test('updateIMAPStatus updates and emits', () => {
      const handler = jest.fn();
      sm.on('state:imap', handler);

      sm.updateIMAPStatus({ connected: true, paused: false, mailboxes: ['INBOX'] });

      const status = sm.getIMAPStatus();
      expect(status.connected).toBe(true);
      expect(status.paused).toBe(false);
      expect(status.mailboxes).toEqual(['INBOX']);
      expect(handler).toHaveBeenCalled();
    });

    test('updateIMAPStatus partial update keeps previous values', () => {
      sm.updateIMAPStatus({ connected: true, paused: false, mailboxes: ['INBOX'] });
      sm.updateIMAPStatus({ paused: true }); // only update paused

      const status = sm.getIMAPStatus();
      expect(status.connected).toBe(true);
      expect(status.paused).toBe(true);
      expect(status.mailboxes).toEqual(['INBOX']);
    });

    test('getIMAPStatus returns deep copy', () => {
      sm.updateIMAPStatus({ connected: true, paused: false, mailboxes: ['INBOX'] });
      const status = sm.getIMAPStatus();
      status.mailboxes.push('SENT');
      expect(sm.getIMAPStatus().mailboxes).toEqual(['INBOX']);
    });

    test('updateIMAPStatus throws on invalid input', () => {
      expect(() => sm.updateIMAPStatus(null)).toThrow(TypeError);
    });
  });

  // ═══════════════════════════════════════════════════
  //  SYSTEM
  // ═══════════════════════════════════════════════════

  describe('System', () => {
    test('setSystemStatus updates status', () => {
      const handler = jest.fn();
      sm.on('state:system', handler);

      sm.setSystemStatus('ready');

      expect(sm.getSystemStatus().status).toBe('ready');
      expect(handler).toHaveBeenCalledWith({ status: 'ready' });
    });

    test('setSystemStatus accepts all valid statuses', () => {
      const validStatuses = ['initializing', 'ready', 'running', 'paused', 'error', 'shutting_down'];
      for (const status of validStatuses) {
        sm.setSystemStatus(status);
        expect(sm.getSystemStatus().status).toBe(status);
      }
    });

    test('setSystemStatus throws on invalid status', () => {
      expect(() => sm.setSystemStatus('invalid')).toThrow(/Invalid system status/);
    });

    test('setLastError records error from Error object', () => {
      const handler = jest.fn();
      sm.on('state:system', handler);

      sm.setLastError(new Error('Something broke'));

      const sys = sm.getSystemStatus();
      expect(sys.lastError.message).toBe('Something broke');
      expect(typeof sys.lastError.timestamp).toBe('number');
      expect(handler).toHaveBeenCalled();
    });

    test('setLastError records error from string', () => {
      sm.setLastError('A string error');
      expect(sm.getSystemStatus().lastError.message).toBe('A string error');
    });

    test('getSystemStatus returns deep copy', () => {
      sm.setLastError('test');
      const sys = sm.getSystemStatus();
      sys.status = 'hacked';
      expect(sm.getSystemStatus().status).toBe('initializing');
    });
  });

  // ═══════════════════════════════════════════════════
  //  SNAPSHOT
  // ═══════════════════════════════════════════════════

  describe('Snapshot', () => {
    test('getSnapshot returns full deep copy', () => {
      sm.updateCapacity('2026-01-28', 5000);
      sm.addActiveTask({ orderId: 'ORD-001', wordCount: 1000 });
      sm.updateBrowserPool({ active: 1, total: 4, available: 3 });
      sm.updateIMAPStatus({ connected: true });
      sm.setSystemStatus('running');

      const snap = sm.getSnapshot();

      expect(snap.capacity['2026-01-28']).toBe(5000);
      expect(snap.activeTasks).toHaveLength(1);
      expect(snap.browserPool.active).toBe(1);
      expect(snap.imap.connected).toBe(true);
      expect(snap.system.status).toBe('running');
    });

    test('getSnapshot returns independent copy', () => {
      sm.updateCapacity('2026-01-28', 5000);
      const snap = sm.getSnapshot();
      snap.capacity['2026-01-28'] = 9999;
      snap.activeTasks.push({ orderId: 'FAKE' });

      expect(sm.getCapacity('2026-01-28')).toBe(5000);
      expect(sm.getActiveTasks()).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════
  //  PERSISTENCE
  // ═══════════════════════════════════════════════════

  describe('Persistence', () => {
    test('saveToFile calls saveJSON with correct data', () => {
      sm.updateCapacity('2026-01-28', 5000);
      sm.addActiveTask({ orderId: 'ORD-001', wordCount: 1000 });
      sm.setSystemStatus('running');

      sm.saveToFile();

      expect(saveJSON).toHaveBeenCalledTimes(1);
      const [filePath, data] = saveJSON.mock.calls[0];
      expect(filePath).toContain('state.json');
      expect(data.capacity).toEqual({ '2026-01-28': 5000 });
      expect(data.activeTasks).toHaveLength(1);
      expect(data.system.status).toBe('running');
      expect(data.savedAt).toBeDefined();
    });

    test('saveToFile handles errors gracefully', () => {
      saveJSON.mockImplementation(() => { throw new Error('disk full'); });
      sm.saveToFile();
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    });

    test('loadFromFile restores capacity and tasks', () => {
      const savedData = {
        capacity: { '2026-02-01': 3000 },
        activeTasks: [{ orderId: 'ORD-100', wordCount: 500 }],
        system: { lastError: { message: 'old error', timestamp: 123 } },
        savedAt: '2026-01-28T00:00:00Z'
      };
      loadJSON.mockReturnValue(savedData);

      const result = sm.loadFromFile();

      expect(result).toBe(true);
      expect(sm.getCapacity('2026-02-01')).toBe(3000);
      expect(sm.getActiveTasks()).toHaveLength(1);
      expect(sm.getSystemStatus().lastError.message).toBe('old error');
    });

    test('loadFromFile returns false when no file exists', () => {
      loadJSON.mockReturnValue(null);
      const result = sm.loadFromFile();
      expect(result).toBe(false);
    });

    test('loadFromFile handles errors gracefully', () => {
      loadJSON.mockImplementation(() => { throw new Error('read error'); });
      const result = sm.loadFromFile();
      expect(result).toBe(false);
      expect(logFail).toHaveBeenCalledWith(expect.stringContaining('read error'));
    });

    test('loadFromFile does not restore browser pool or IMAP (runtime only)', () => {
      sm.updateBrowserPool({ active: 3, total: 4, available: 1 });
      sm.updateIMAPStatus({ connected: true });

      loadJSON.mockReturnValue({
        capacity: {},
        activeTasks: [],
        savedAt: '2026-01-28T00:00:00Z'
      });

      sm.loadFromFile();

      // Browser pool and IMAP are runtime-only, NOT restored
      // loadFromFile creates a new StateManager so defaults apply
      // But since we're calling loadFromFile on the same instance,
      // it only overwrites capacity/tasks/system fields
      expect(sm.getBrowserPoolStatus()).toEqual({ active: 3, total: 4, available: 1 });
      expect(sm.getIMAPStatus().connected).toBe(true);
    });

    test('loadFromFile skips invalid capacity data', () => {
      loadJSON.mockReturnValue({
        capacity: 'not-an-object',
        activeTasks: [],
        savedAt: '2026-01-28T00:00:00Z'
      });

      sm.updateCapacity('2026-01-28', 1000);
      sm.loadFromFile();

      // Capacity should remain unchanged (invalid data skipped)
      expect(sm.getCapacity('2026-01-28')).toBe(1000);
    });

    test('loadFromFile skips invalid activeTasks data', () => {
      loadJSON.mockReturnValue({
        capacity: {},
        activeTasks: 'not-an-array',
        savedAt: '2026-01-28T00:00:00Z'
      });

      sm.addActiveTask({ orderId: 'ORD-001' });
      sm.loadFromFile();

      // Tasks should remain unchanged
      expect(sm.getActiveTasks()).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════
  //  RESET
  // ═══════════════════════════════════════════════════

  describe('Reset', () => {
    test('reset restores initial state and emits event', () => {
      sm.updateCapacity('2026-01-28', 5000);
      sm.addActiveTask({ orderId: 'ORD-001' });
      sm.setSystemStatus('running');

      const handler = jest.fn();
      sm.on('state:reset', handler);

      sm.reset();

      const snap = sm.getSnapshot();
      expect(snap.capacity).toEqual({});
      expect(snap.activeTasks).toEqual([]);
      expect(snap.system.status).toBe('initializing');
      expect(handler).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════
  //  MAX LISTENERS
  // ═══════════════════════════════════════════════════

  test('supports up to 50 listeners without warning', () => {
    expect(sm.getMaxListeners()).toBe(50);
  });
});
