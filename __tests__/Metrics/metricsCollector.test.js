const { MetricsCollector } = require('../../Metrics/metricsCollector');

describe('MetricsCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('Task counters', () => {
    test('recordTaskReceived increments tasksReceived', () => {
      collector.recordTaskReceived();
      collector.recordTaskReceived();
      expect(collector.counters.tasksReceived).toBe(2);
    });

    test('recordTaskAccepted increments tasksAccepted', () => {
      collector.recordTaskAccepted();
      expect(collector.counters.tasksAccepted).toBe(1);
    });

    test('recordTaskRejected increments counter and tracks reason', () => {
      collector.recordTaskRejected('REJECT_CAPACITY');
      collector.recordTaskRejected('REJECT_CAPACITY');
      collector.recordTaskRejected('REJECT_URGENT_OUT_OF_HOURS');

      expect(collector.counters.tasksRejected).toBe(3);
      expect(collector.rejectionReasons).toEqual({
        REJECT_CAPACITY: 2,
        REJECT_URGENT_OUT_OF_HOURS: 1,
      });
    });

    test('recordTaskCompleted increments counter and stores processing time', () => {
      collector.recordTaskCompleted(1500);
      collector.recordTaskCompleted(2000);

      expect(collector.counters.tasksCompleted).toBe(2);
      expect(collector.processingTimes).toEqual([1500, 2000]);
    });

    test('recordTaskFailed increments tasksFailed', () => {
      collector.recordTaskFailed();
      collector.recordTaskFailed();
      expect(collector.counters.tasksFailed).toBe(2);
    });
  });

  describe('Processing time history limit', () => {
    test('keeps only last _maxHistorySize entries', () => {
      collector._maxHistorySize = 5;
      for (let i = 1; i <= 8; i++) {
        collector.recordTaskCompleted(i * 100);
      }
      expect(collector.processingTimes).toEqual([400, 500, 600, 700, 800]);
      expect(collector.processingTimes.length).toBe(5);
    });

    test('default max history size is 100', () => {
      expect(collector._maxHistorySize).toBe(100);
    });
  });

  describe('Browser pool status', () => {
    test('updateBrowserPoolStatus stores status', () => {
      collector.updateBrowserPoolStatus({
        busyBrowsers: 2,
        totalBrowsers: 4,
        availableBrowsers: 2,
        activePages: 3,
      });

      expect(collector.browserPool).toEqual({
        active: 2,
        total: 4,
        available: 2,
        activePages: 3,
      });
    });

    test('handles missing fields with defaults', () => {
      collector.updateBrowserPoolStatus({});

      expect(collector.browserPool).toEqual({
        active: 0,
        total: 0,
        available: 0,
        activePages: 0,
      });
    });
  });

  describe('IMAP status', () => {
    test('updateIMAPStatus stores status', () => {
      collector.updateIMAPStatus({
        totalConnections: 2,
        mailboxes: ['INBOX', 'Sent'],
        isPaused: false,
        totalReconnects: 3,
      });

      expect(collector.imapStatus).toEqual({
        connected: true,
        mailboxes: 2,
        isPaused: false,
        totalReconnects: 3,
      });
    });

    test('connected is false when totalConnections is 0', () => {
      collector.updateIMAPStatus({ totalConnections: 0 });

      expect(collector.imapStatus.connected).toBe(false);
    });

    test('handles missing fields with defaults', () => {
      collector.updateIMAPStatus({});

      expect(collector.imapStatus).toEqual({
        connected: false,
        mailboxes: 0,
        isPaused: false,
        totalReconnects: 0,
      });
    });
  });

  describe('Computed metrics', () => {
    test('getAverageProcessingTime returns 0 when no data', () => {
      expect(collector.getAverageProcessingTime()).toBe(0);
    });

    test('getAverageProcessingTime calculates correctly', () => {
      collector.recordTaskCompleted(1000);
      collector.recordTaskCompleted(2000);
      collector.recordTaskCompleted(3000);

      expect(collector.getAverageProcessingTime()).toBe(2000);
    });

    test('getAverageProcessingTime rounds to integer', () => {
      collector.recordTaskCompleted(1000);
      collector.recordTaskCompleted(1500);

      expect(collector.getAverageProcessingTime()).toBe(1250);
    });

    test('getAcceptanceRate returns 0 when no decisions made', () => {
      expect(collector.getAcceptanceRate()).toBe(0);
    });

    test('getAcceptanceRate calculates percentage', () => {
      collector.recordTaskAccepted();
      collector.recordTaskAccepted();
      collector.recordTaskAccepted();
      collector.recordTaskRejected('REJECT_CAPACITY');

      expect(collector.getAcceptanceRate()).toBe(75);
    });

    test('getSuccessRate returns 0 when no completions', () => {
      expect(collector.getSuccessRate()).toBe(0);
    });

    test('getSuccessRate calculates percentage', () => {
      collector.recordTaskCompleted(100);
      collector.recordTaskCompleted(200);
      collector.recordTaskFailed();

      expect(collector.getSuccessRate()).toBe(67);
    });
  });

  describe('getSnapshot', () => {
    test('returns a plain serializable object', () => {
      collector.recordTaskReceived();
      collector.recordTaskAccepted();
      collector.recordTaskCompleted(1500);

      const snapshot = collector.getSnapshot();

      // Should be serializable to JSON
      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json);
      expect(parsed).toBeDefined();

      // Verify structure
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('uptimeMs');
      expect(snapshot).toHaveProperty('counters');
      expect(snapshot).toHaveProperty('rates');
      expect(snapshot).toHaveProperty('performance');
      expect(snapshot).toHaveProperty('rejectionReasons');
      expect(snapshot).toHaveProperty('browserPool');
      expect(snapshot).toHaveProperty('imap');
    });

    test('snapshot counters reflect recorded data', () => {
      collector.recordTaskReceived();
      collector.recordTaskReceived();
      collector.recordTaskAccepted();
      collector.recordTaskRejected('REJECT_CAPACITY');

      const snapshot = collector.getSnapshot();

      expect(snapshot.counters.tasksReceived).toBe(2);
      expect(snapshot.counters.tasksAccepted).toBe(1);
      expect(snapshot.counters.tasksRejected).toBe(1);
      expect(snapshot.rates.acceptanceRate).toBe(50);
    });

    test('snapshot performance includes recent processing times (last 10)', () => {
      for (let i = 1; i <= 15; i++) {
        collector.recordTaskCompleted(i * 100);
      }

      const snapshot = collector.getSnapshot();
      expect(snapshot.performance.recentProcessingTimes.length).toBe(10);
      expect(snapshot.performance.recentProcessingTimes[0]).toBe(600);
      expect(snapshot.performance.recentProcessingTimes[9]).toBe(1500);
    });

    test('snapshot is a deep copy (mutations do not affect collector)', () => {
      collector.recordTaskReceived();
      const snapshot = collector.getSnapshot();
      snapshot.counters.tasksReceived = 999;

      expect(collector.counters.tasksReceived).toBe(1);
    });

    test('uptimeMs is positive', () => {
      const snapshot = collector.getSnapshot();
      expect(snapshot.uptimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reset', () => {
    test('resets counters, rejection reasons, and processing times', () => {
      collector.recordTaskReceived();
      collector.recordTaskAccepted();
      collector.recordTaskRejected('REJECT_CAPACITY');
      collector.recordTaskCompleted(1000);
      collector.recordTaskFailed();

      collector.reset();

      expect(collector.counters).toEqual({
        tasksReceived: 0,
        tasksAccepted: 0,
        tasksRejected: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
      });
      expect(collector.rejectionReasons).toEqual({});
      expect(collector.processingTimes).toEqual([]);
    });

    test('resets browser pool and IMAP status to defaults', () => {
      collector.updateBrowserPoolStatus({ busyBrowsers: 2, totalBrowsers: 4, availableBrowsers: 2 });
      collector.updateIMAPStatus({ totalConnections: 3, mailboxes: ['a', 'b'], isPaused: true, totalReconnects: 5 });
      collector.reset();

      expect(collector.browserPool).toEqual({ active: 0, total: 0, available: 0, activePages: 0 });
      expect(collector.imapStatus).toEqual({ connected: false, mailboxes: 0, isPaused: false, totalReconnects: 0 });
    });
  });

  describe('Singleton export', () => {
    test('module exports a singleton instance', () => {
      const { metricsCollector: instance1 } = require('../../Metrics/metricsCollector');
      const { metricsCollector: instance2 } = require('../../Metrics/metricsCollector');
      expect(instance1).toBe(instance2);
    });

    test('module exports MetricsCollector class for testing', () => {
      expect(MetricsCollector).toBeDefined();
      expect(typeof MetricsCollector).toBe('function');
    });
  });
});
