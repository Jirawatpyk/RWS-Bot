/**
 * Tests for IMAP/IMAPHealthMonitor.js
 */

// Mock dependencies before requiring module
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logFail: jest.fn(),
}));

jest.mock('../../Config/constants', () => ({
  IMAP_HEALTH: {
    RECONNECT_ALERT_THRESHOLD: 3,
    RECONNECT_ALERT_WINDOW: 10 * 60 * 1000,      // 10 minutes
    MAX_CONSECUTIVE_FAILURES: 5,
    HISTORY_PRUNE_INTERVAL: 30 * 60 * 1000,       // 30 minutes
  },
}));

const { IMAPHealthMonitor } = require('../../IMAP/IMAPHealthMonitor');

describe('IMAPHealthMonitor', () => {
  let monitor;
  let mockNotifier;

  beforeEach(() => {
    jest.useFakeTimers();
    mockNotifier = jest.fn().mockResolvedValue(undefined);
    monitor = new IMAPHealthMonitor(mockNotifier);
  });

  afterEach(() => {
    monitor.destroy();
    jest.useRealTimers();
  });

  // ===================== constructor =====================
  describe('constructor', () => {
    it('should initialise with empty state', () => {
      expect(monitor.reconnectHistory).toEqual([]);
      expect(monitor.healthStatus.size).toBe(0);
      expect(monitor.notifier).toBe(mockNotifier);
    });

    it('should set alert thresholds from constants', () => {
      expect(monitor.alertThresholds.reconnectsPerWindow).toBe(3);
      expect(monitor.alertThresholds.windowMs).toBe(10 * 60 * 1000);
      expect(monitor.alertThresholds.maxConsecutiveFailures).toBe(5);
    });
  });

  // ===================== recordReconnect =====================
  describe('recordReconnect', () => {
    it('should add entry to reconnectHistory', () => {
      monitor.recordReconnect('Symfonie/Order');
      expect(monitor.reconnectHistory).toHaveLength(1);
      expect(monitor.reconnectHistory[0].mailbox).toBe('Symfonie/Order');
      expect(typeof monitor.reconnectHistory[0].timestamp).toBe('number');
    });

    it('should create healthStatus entry for new mailbox', () => {
      monitor.recordReconnect('Symfonie/Order');
      expect(monitor.healthStatus.has('Symfonie/Order')).toBe(true);
    });

    it('should NOT alert when reconnects are below threshold', () => {
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordReconnect('Symfonie/Order');
      // 2 reconnects, threshold is 3
      expect(mockNotifier).not.toHaveBeenCalled();
    });

    it('should alert when reconnects reach threshold within window', () => {
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordReconnect('Symfonie/Order');
      // 3 reconnects = threshold reached
      expect(mockNotifier).toHaveBeenCalledTimes(1);
      expect(mockNotifier).toHaveBeenCalledWith(
        expect.stringContaining('reconnected 3 times')
      );
    });

    it('should NOT count reconnects outside the window', () => {
      // First reconnect
      monitor.recordReconnect('Symfonie/Order');

      // Advance time past the window (11 minutes)
      jest.advanceTimersByTime(11 * 60 * 1000);

      // Two more reconnects within new window
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordReconnect('Symfonie/Order');

      // Only 2 in current window, should not alert
      expect(mockNotifier).not.toHaveBeenCalled();
    });

    it('should NOT flood alerts for subsequent reconnects in same window (cooldown)', () => {
      // Reconnect 5 times rapidly -- alert should only fire once
      for (let i = 0; i < 5; i++) {
        monitor.recordReconnect('Symfonie/Order');
      }
      expect(mockNotifier).toHaveBeenCalledTimes(1);
    });

    it('should track different mailboxes independently', () => {
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordReconnect('Symfonie/On hold');
      // Order has 2, On hold has 1, neither reaches 3
      expect(mockNotifier).not.toHaveBeenCalled();
    });
  });

  // ===================== recordHealthCheck =====================
  describe('recordHealthCheck', () => {
    it('should record healthy status and reset failures', () => {
      monitor.recordHealthCheck('Symfonie/Order', false, 'timeout');
      monitor.recordHealthCheck('Symfonie/Order', true);

      const status = monitor.healthStatus.get('Symfonie/Order');
      expect(status.healthy).toBe(true);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.lastError).toBeNull();
      expect(status.lastCheck).toBeTruthy();
    });

    it('should increment consecutive failures on unhealthy check', () => {
      monitor.recordHealthCheck('Symfonie/Order', false, 'timeout');
      monitor.recordHealthCheck('Symfonie/Order', false, 'network error');

      const status = monitor.healthStatus.get('Symfonie/Order');
      expect(status.healthy).toBe(false);
      expect(status.consecutiveFailures).toBe(2);
      expect(status.lastError).toBe('network error');
    });

    it('should accept Error objects as error parameter', () => {
      monitor.recordHealthCheck('Symfonie/Order', false, new Error('test error'));
      const status = monitor.healthStatus.get('Symfonie/Order');
      expect(status.lastError).toBe('test error');
    });

    it('should alert after MAX_CONSECUTIVE_FAILURES', () => {
      for (let i = 0; i < 5; i++) {
        monitor.recordHealthCheck('Symfonie/Order', false, 'fail');
      }
      expect(mockNotifier).toHaveBeenCalledTimes(1);
      expect(mockNotifier).toHaveBeenCalledWith(
        expect.stringContaining('failed 5 times consecutively')
      );
    });

    it('should NOT flood alerts for failures 6, 7, 8, 9 (only at multiples of threshold)', () => {
      // First 5 failures -> alert at #5
      for (let i = 0; i < 5; i++) {
        monitor.recordHealthCheck('Symfonie/Order', false, 'fail');
      }
      expect(mockNotifier).toHaveBeenCalledTimes(1);

      // Failures 6-9 -> no alert
      for (let i = 0; i < 4; i++) {
        monitor.recordHealthCheck('Symfonie/Order', false, 'fail');
      }
      expect(mockNotifier).toHaveBeenCalledTimes(1);

      // Failure #10 (2x threshold) -> alert again
      monitor.recordHealthCheck('Symfonie/Order', false, 'fail');
      expect(mockNotifier).toHaveBeenCalledTimes(2);
    });

    it('should NOT alert before reaching MAX_CONSECUTIVE_FAILURES', () => {
      for (let i = 0; i < 4; i++) {
        monitor.recordHealthCheck('Symfonie/Order', false, 'fail');
      }
      expect(mockNotifier).not.toHaveBeenCalled();
    });

    it('should alert again after reset and new failure streak', () => {
      // First streak
      for (let i = 0; i < 5; i++) {
        monitor.recordHealthCheck('Symfonie/Order', false, 'fail');
      }
      expect(mockNotifier).toHaveBeenCalledTimes(1);

      // Reset
      monitor.recordHealthCheck('Symfonie/Order', true);

      // Second streak
      for (let i = 0; i < 5; i++) {
        monitor.recordHealthCheck('Symfonie/Order', false, 'fail2');
      }
      expect(mockNotifier).toHaveBeenCalledTimes(2);
    });
  });

  // ===================== getHealthSnapshot =====================
  describe('getHealthSnapshot', () => {
    it('should return JSON-serialisable object', () => {
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordHealthCheck('Symfonie/Order', true);

      const snapshot = monitor.getHealthSnapshot();
      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('thresholds');
      expect(parsed).toHaveProperty('totalReconnectsTracked');
      expect(parsed).toHaveProperty('mailboxes');
    });

    it('should include per-mailbox data', () => {
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordHealthCheck('Symfonie/Order', true);
      monitor.recordHealthCheck('Symfonie/On hold', false, 'err');

      const snapshot = monitor.getHealthSnapshot();

      expect(snapshot.mailboxes['Symfonie/Order']).toEqual(
        expect.objectContaining({
          healthy: true,
          consecutiveFailures: 0,
          recentReconnects: 1,
        })
      );

      expect(snapshot.mailboxes['Symfonie/On hold']).toEqual(
        expect.objectContaining({
          healthy: false,
          lastError: 'err',
          consecutiveFailures: 1,
          recentReconnects: 0,
        })
      );
    });

    it('should return empty mailboxes when nothing tracked', () => {
      const snapshot = monitor.getHealthSnapshot();
      expect(snapshot.mailboxes).toEqual({});
      expect(snapshot.totalReconnectsTracked).toBe(0);
    });

    it('should count only recent reconnects within window', () => {
      monitor.recordReconnect('Symfonie/Order');

      jest.advanceTimersByTime(11 * 60 * 1000); // past 10-min window

      monitor.recordReconnect('Symfonie/Order');

      const snapshot = monitor.getHealthSnapshot();
      // Only 1 reconnect within the 10-min window
      expect(snapshot.mailboxes['Symfonie/Order'].recentReconnects).toBe(1);
      // But total tracked is still 2
      expect(snapshot.totalReconnectsTracked).toBe(2);
    });
  });

  // ===================== _pruneOldHistory =====================
  describe('_pruneOldHistory', () => {
    it('should remove entries older than prune interval', () => {
      monitor.recordReconnect('Symfonie/Order');
      monitor.recordReconnect('Symfonie/Order');

      // Advance past 30-minute prune interval
      jest.advanceTimersByTime(31 * 60 * 1000);

      // Add one new reconnect
      monitor.recordReconnect('Symfonie/Order');

      // Trigger prune manually
      monitor._pruneOldHistory();

      // Old entries should be removed, only the new one remains
      expect(monitor.reconnectHistory).toHaveLength(1);
    });

    it('should run automatically via setInterval', () => {
      monitor.recordReconnect('Symfonie/Order');

      // Advance past 2 prune intervals (61 min).
      // At 30 min: timer fires but entry timestamp >= cutoff (edge case), kept.
      // At 60 min: timer fires again, entry is now 60 min old > 30 min cutoff, pruned.
      jest.advanceTimersByTime(61 * 60 * 1000);

      // setInterval should have fired and pruned the old entry
      expect(monitor.reconnectHistory).toHaveLength(0);
    });
  });

  // ===================== destroy =====================
  describe('destroy', () => {
    it('should clear the prune timer', () => {
      monitor.destroy();
      expect(monitor._pruneTimer).toBeNull();
    });

    it('should be safe to call twice', () => {
      monitor.destroy();
      monitor.destroy();
      expect(monitor._pruneTimer).toBeNull();
    });
  });

  // ===================== notifier edge cases =====================
  describe('notifier edge cases', () => {
    it('should handle notifier that throws', async () => {
      const failNotifier = jest.fn().mockRejectedValue(new Error('webhook down'));
      const mon = new IMAPHealthMonitor(failNotifier);

      // Should not throw
      for (let i = 0; i < 5; i++) {
        mon.recordHealthCheck('Symfonie/Order', false, 'fail');
      }

      // Allow promise to resolve
      await Promise.resolve();

      expect(failNotifier).toHaveBeenCalledTimes(1);
      mon.destroy();
    });

    it('should handle null notifier gracefully', () => {
      const mon = new IMAPHealthMonitor(null);

      // Should not throw
      for (let i = 0; i < 5; i++) {
        mon.recordHealthCheck('Symfonie/Order', false, 'fail');
      }

      mon.destroy();
    });
  });
});
