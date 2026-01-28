/**
 * Tests for State/stateSyncService.js
 *
 * Covers:
 *   - Constructor validation
 *   - Listener setup for all state events
 *   - Debounced broadcasting
 *   - sendFullState to individual client
 *   - destroy() cleanup
 */

jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logFail: jest.fn()
}));

const { StateSyncService } = require('../../State/stateSyncService');
const { StateManager } = require('../../State/stateManager');

describe('StateSyncService', () => {
  let sm;
  let broadcast;
  let service;

  beforeEach(() => {
    sm = new StateManager();
    broadcast = jest.fn();
    // Use debounceMs=0 for synchronous tests (no waiting for timers)
    service = new StateSyncService(sm, broadcast, { debounceMs: 0 });
  });

  afterEach(() => {
    if (service) service.destroy();
  });

  // ═══════════════════════════════════════════════════
  //  CONSTRUCTOR VALIDATION
  // ═══════════════════════════════════════════════════

  test('throws if stateManager is missing', () => {
    expect(() => new StateSyncService(null, broadcast)).toThrow(/stateManager/);
  });

  test('throws if broadcastToClients is not a function', () => {
    expect(() => new StateSyncService(sm, 'not-a-function')).toThrow(/broadcastToClients/);
  });

  // ═══════════════════════════════════════════════════
  //  CAPACITY EVENTS
  // ═══════════════════════════════════════════════════

  test('broadcasts capacityUpdated when capacity changes', () => {
    sm.updateCapacity('2026-01-28', 5000);

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'capacityUpdated',
      capacity: { '2026-01-28': 5000 }
    }));
  });

  test('broadcasts capacityUpdated on bulk capacity set', () => {
    sm.setCapacityMap({ '2026-02-01': 3000 });

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'capacityUpdated'
    }));
  });

  // ═══════════════════════════════════════════════════
  //  TASK EVENTS
  // ═══════════════════════════════════════════════════

  test('broadcasts tasksUpdated when task is added', () => {
    sm.addActiveTask({ orderId: 'ORD-001', wordCount: 1000 });

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tasksUpdated',
      action: 'add',
      count: 1
    }));
  });

  test('broadcasts tasksUpdated when task is removed', () => {
    sm.addActiveTask({ orderId: 'ORD-001' });
    broadcast.mockClear();

    sm.removeActiveTask('ORD-001');

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tasksUpdated',
      action: 'remove',
      count: 0
    }));
  });

  test('broadcasts tasksUpdated on setActiveTasks', () => {
    sm.setActiveTasks([{ orderId: 'ORD-001' }, { orderId: 'ORD-002' }]);

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tasksUpdated',
      action: 'replace',
      count: 2
    }));
  });

  // ═══════════════════════════════════════════════════
  //  BROWSER POOL EVENTS
  // ═══════════════════════════════════════════════════

  test('broadcasts browserPoolUpdated on pool status change', () => {
    sm.updateBrowserPool({ active: 2, total: 4, available: 2 });

    expect(broadcast).toHaveBeenCalledWith({
      type: 'browserPoolUpdated',
      browserPool: { active: 2, total: 4, available: 2 }
    });
  });

  // ═══════════════════════════════════════════════════
  //  IMAP EVENTS
  // ═══════════════════════════════════════════════════

  test('broadcasts imapUpdated on IMAP status change', () => {
    sm.updateIMAPStatus({ connected: true, paused: false, mailboxes: ['INBOX'] });

    expect(broadcast).toHaveBeenCalledWith({
      type: 'imapUpdated',
      imap: { connected: true, paused: false, mailboxes: ['INBOX'] }
    });
  });

  // ═══════════════════════════════════════════════════
  //  SYSTEM EVENTS
  // ═══════════════════════════════════════════════════

  test('broadcasts systemUpdated on system status change', () => {
    sm.setSystemStatus('ready');

    expect(broadcast).toHaveBeenCalledWith({
      type: 'systemUpdated',
      system: { status: 'ready' }
    });
  });

  test('broadcasts systemUpdated on lastError', () => {
    sm.setLastError('something failed');

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'systemUpdated',
      system: expect.objectContaining({
        lastError: expect.objectContaining({ message: 'something failed' })
      })
    }));
  });

  // ═══════════════════════════════════════════════════
  //  RESET EVENT
  // ═══════════════════════════════════════════════════

  test('broadcasts stateReset on reset', () => {
    sm.updateCapacity('2026-01-28', 5000);
    broadcast.mockClear();

    sm.reset();

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'stateReset',
      snapshot: expect.objectContaining({
        capacity: {},
        activeTasks: []
      })
    }));
  });

  // ═══════════════════════════════════════════════════
  //  DEBOUNCE
  // ═══════════════════════════════════════════════════

  test('debounce groups rapid events into one broadcast', () => {
    jest.useFakeTimers();

    // Create a new service WITH debounce
    service.destroy();
    const debouncedBroadcast = jest.fn();
    service = new StateSyncService(sm, debouncedBroadcast, { debounceMs: 200 });

    // Fire 5 rapid capacity updates
    sm.updateCapacity('2026-01-28', 1000);
    sm.updateCapacity('2026-01-28', 2000);
    sm.updateCapacity('2026-01-28', 3000);
    sm.updateCapacity('2026-01-28', 4000);
    sm.updateCapacity('2026-01-28', 5000);

    // Before timer fires, no broadcast
    expect(debouncedBroadcast).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);

    // Only 1 broadcast after debounce
    expect(debouncedBroadcast).toHaveBeenCalledTimes(1);
    expect(debouncedBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'capacityUpdated',
      capacity: { '2026-01-28': 5000 } // latest value
    }));

    jest.useRealTimers();
  });

  // ═══════════════════════════════════════════════════
  //  sendFullState
  // ═══════════════════════════════════════════════════

  test('sendFullState sends snapshot to individual client', () => {
    sm.updateCapacity('2026-01-28', 5000);
    sm.setSystemStatus('running');

    const clientSend = jest.fn();
    service.sendFullState(clientSend);

    expect(clientSend).toHaveBeenCalledTimes(1);
    const payload = clientSend.mock.calls[0][0];
    expect(payload.type).toBe('fullState');
    expect(payload.snapshot.capacity['2026-01-28']).toBe(5000);
    expect(payload.snapshot.system.status).toBe('running');
  });

  test('sendFullState does nothing if sendToClient is not a function', () => {
    expect(() => service.sendFullState(null)).not.toThrow();
    expect(() => service.sendFullState('not-a-function')).not.toThrow();
  });

  test('sendFullState handles errors gracefully', () => {
    const failingSend = jest.fn(() => { throw new Error('connection closed'); });
    expect(() => service.sendFullState(failingSend)).not.toThrow();
  });

  // ═══════════════════════════════════════════════════
  //  DESTROY
  // ═══════════════════════════════════════════════════

  test('destroy removes all listeners', () => {
    const listenerCountBefore = sm.listenerCount('state:capacity');
    expect(listenerCountBefore).toBeGreaterThan(0);

    service.destroy();

    expect(sm.listenerCount('state:capacity')).toBe(0);
    expect(sm.listenerCount('state:tasks')).toBe(0);
    expect(sm.listenerCount('state:browserPool')).toBe(0);
    expect(sm.listenerCount('state:imap')).toBe(0);
    expect(sm.listenerCount('state:system')).toBe(0);
    expect(sm.listenerCount('state:reset')).toBe(0);

    service = null; // prevent double destroy in afterEach
  });

  test('destroy clears debounce timers', () => {
    jest.useFakeTimers();

    service.destroy();
    const debouncedBroadcast = jest.fn();
    service = new StateSyncService(sm, debouncedBroadcast, { debounceMs: 1000 });

    sm.updateCapacity('2026-01-28', 5000);

    service.destroy();
    service = null;

    jest.advanceTimersByTime(1000);

    // Broadcast should NOT fire because service was destroyed
    expect(debouncedBroadcast).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  // ═══════════════════════════════════════════════════
  //  BROADCAST ERROR HANDLING
  // ═══════════════════════════════════════════════════

  test('handles broadcast errors without crashing', () => {
    const failingBroadcast = jest.fn(() => { throw new Error('WS error'); });
    service.destroy();
    service = new StateSyncService(sm, failingBroadcast, { debounceMs: 0 });

    // Should not throw
    expect(() => sm.updateBrowserPool({ active: 1, total: 2, available: 1 })).not.toThrow();
  });
});
