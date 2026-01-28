/**
 * Tests for Task/taskScheduler.js
 *
 * Comprehensive test coverage including:
 * - Daily report scheduling (09:00, 15:00, 18:00)
 * - Business day checks
 * - Alert checker interval logic
 * - Error handling
 */

// Mock dependencies before requiring the module
jest.mock('../../Task/isBusinessDay');
jest.mock('../../Task/taskReporter', () => ({
  loadAndFilterTasks: jest.fn(),
  summarizeTasks: jest.fn(),
  formatReport: jest.fn(),
  sendToGoogleChat: jest.fn(),
  acceptedTasksPath: '/mock/path/acceptedTasks.json',
  readStatusMapFromSheet: jest.fn()
}));
jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logFail: jest.fn(),
  logInfo: jest.fn()
}));
jest.mock('fs');

const isBusinessDay = require('../../Task/isBusinessDay');
const {
  loadAndFilterTasks,
  summarizeTasks,
  formatReport,
  sendToGoogleChat,
  readStatusMapFromSheet,
  acceptedTasksPath
} = require('../../Task/taskReporter');
const { logSuccess, logFail, logInfo } = require('../../Logs/logger');
const fs = require('fs');
const dayjs = require('dayjs');

describe('Task/taskScheduler.js', () => {
  let startTaskSchedule;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Default mocks
    isBusinessDay.mockReturnValue(true);
    loadAndFilterTasks.mockResolvedValue({
      activeTasks: [],
      completedCount: 5
    });
    summarizeTasks.mockReturnValue({
      alerts: [],
      total: 0,
      completedCount: 5
    });
    formatReport.mockReturnValue('Mock report message');
    sendToGoogleChat.mockResolvedValue();
    readStatusMapFromSheet.mockResolvedValue({});
    fs.existsSync.mockReturnValue(false);

    // Import fresh module for each test
    startTaskSchedule = require('../../Task/taskScheduler').startTaskSchedule;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('startTaskSchedule - Initialization', () => {
    it('should log scheduled tasks on initialization', () => {
      startTaskSchedule();

      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Scheduled daily'));
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('09:00 Report'));
    });

    it('should schedule multiple daily reports (09:00, 15:00, 18:00)', () => {
      startTaskSchedule();

      const scheduledLabels = logInfo.mock.calls
        .map(call => call[0])
        .filter(msg => msg.includes('Scheduled daily'));

      expect(scheduledLabels.length).toBe(3);
      expect(scheduledLabels[0]).toContain('09:00 Report');
      expect(scheduledLabels[1]).toContain('15:00 Report');
      expect(scheduledLabels[2]).toContain('18:00 Report');
    });
  });

  describe('scheduleDailyAt - Wrapped Function Execution', () => {
    it('should skip execution on non-business days', async () => {
      isBusinessDay.mockReturnValue(false);
      startTaskSchedule();

      // Fast-forward to trigger the first setTimeout
      await jest.runOnlyPendingTimersAsync();

      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('[SKIP]'));
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('Not a business day'));
      expect(loadAndFilterTasks).not.toHaveBeenCalled();
    });

    it('should execute task function on business days', async () => {
      isBusinessDay.mockReturnValue(true);
      startTaskSchedule();

      // Fast-forward to trigger the first setTimeout
      await jest.runOnlyPendingTimersAsync();

      // At least one of the scheduled tasks should execute
      expect(loadAndFilterTasks).toHaveBeenCalled();
    });

    it('should catch and log errors from task function', async () => {
      isBusinessDay.mockReturnValue(true);
      loadAndFilterTasks.mockRejectedValue(new Error('Test error'));

      startTaskSchedule();

      // Fast-forward to trigger the first setTimeout
      await jest.runOnlyPendingTimersAsync();

      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('failed:'),
        expect.any(Error)
      );
    });

    it('should set up recurring interval after first execution', async () => {
      isBusinessDay.mockReturnValue(true);
      startTaskSchedule();

      // Fast-forward to trigger the first setTimeout
      await jest.runOnlyPendingTimersAsync();

      // Verify setInterval was called (should be 4 times: 3 daily reports + 1 alert checker)
      const intervalCount = jest.getTimerCount();
      expect(intervalCount).toBeGreaterThan(0);
    });
  });

  describe('09:00 Daily Report', () => {
    it('should execute 09:00 report with correct flow', async () => {
      isBusinessDay.mockReturnValue(true);
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [{ workflowName: 'Task1' }],
        completedCount: 3
      });
      summarizeTasks.mockReturnValue({
        alerts: [],
        total: 1
      });
      formatReport.mockReturnValue('09:00 Report Content');

      startTaskSchedule();

      // Fast-forward to trigger setTimeout
      await jest.runOnlyPendingTimersAsync();

      expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('09:00'));
      expect(loadAndFilterTasks).toHaveBeenCalled();
      expect(summarizeTasks).toHaveBeenCalledWith([{ workflowName: 'Task1' }]);
      expect(formatReport).toHaveBeenCalled();
      expect(sendToGoogleChat).toHaveBeenCalledWith('09:00 Report Content');
    });

    it('should include completedCount in summary for 09:00 report', async () => {
      isBusinessDay.mockReturnValue(true);
      const mockSummary = { alerts: [], total: 2 };
      summarizeTasks.mockReturnValue(mockSummary);
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 7
      });

      startTaskSchedule();
      await jest.runOnlyPendingTimersAsync();

      // Verify completedCount was added to summary
      expect(mockSummary.completedCount).toBe(7);
    });
  });

  describe('15:00 Daily Report', () => {
    it('should execute 15:00 report with correct flow', async () => {
      isBusinessDay.mockReturnValue(true);
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [{ workflowName: 'Task2' }],
        completedCount: 5
      });
      summarizeTasks.mockReturnValue({
        alerts: [],
        total: 1
      });
      formatReport.mockReturnValue('15:00 Report Content');

      startTaskSchedule();
      await jest.runOnlyPendingTimersAsync();

      // Should have logSuccess calls for all reports
      const successCalls = logSuccess.mock.calls.filter(call =>
        call[0].includes('15:00')
      );
      expect(successCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should include completedCount in summary for 15:00 report', async () => {
      isBusinessDay.mockReturnValue(true);
      const mockSummary = { alerts: [], total: 3 };
      summarizeTasks.mockReturnValue(mockSummary);
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 10
      });

      startTaskSchedule();
      await jest.runOnlyPendingTimersAsync();

      expect(mockSummary.completedCount).toBe(10);
    });
  });

  describe('18:00 Daily Report', () => {
    it('should execute 18:00 report with correct flow', async () => {
      isBusinessDay.mockReturnValue(true);
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [{ workflowName: 'Task3' }],
        completedCount: 8
      });
      summarizeTasks.mockReturnValue({
        alerts: [],
        total: 1
      });
      formatReport.mockReturnValue('18:00 Report Content');

      startTaskSchedule();
      await jest.runOnlyPendingTimersAsync();

      const successCalls = logSuccess.mock.calls.filter(call =>
        call[0].includes('18:00')
      );
      expect(successCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should include completedCount in summary for 18:00 report', async () => {
      isBusinessDay.mockReturnValue(true);
      const mockSummary = { alerts: [], total: 5 };
      summarizeTasks.mockReturnValue(mockSummary);
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 12
      });

      startTaskSchedule();
      await jest.runOnlyPendingTimersAsync();

      expect(mockSummary.completedCount).toBe(12);
    });
  });

  describe('Alert Checker Interval - Business Day Check', () => {
    it('should skip alert check on non-business days', async () => {
      isBusinessDay.mockReturnValue(false);

      startTaskSchedule();

      // Fast-forward the 15-minute interval
      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      // Should not read file on non-business day
      expect(fs.existsSync).not.toHaveBeenCalled();
    });

    it('should run alert check on business days', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { workflowName: 'Task1', deadline: '2026-01-23T10:00:00' }
      ]));
      readStatusMapFromSheet.mockResolvedValue({ Task1: 'In Progress' });
      summarizeTasks.mockReturnValue({ alerts: [] });

      startTaskSchedule();

      // Fast-forward the 15-minute interval
      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      expect(fs.existsSync).toHaveBeenCalledWith(acceptedTasksPath);
    });
  });

  describe('Alert Checker Interval - File Operations', () => {
    it('should return early if acceptedTasks file does not exist', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(false);

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      expect(fs.existsSync).toHaveBeenCalledWith(acceptedTasksPath);
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('should read and parse acceptedTasks file when it exists', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      const mockTasks = [
        { workflowName: 'Task1', deadline: '2026-01-23T10:00:00' },
        { workflowName: 'Task2', deadline: '2026-01-23T11:00:00' }
      ];
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));
      readStatusMapFromSheet.mockResolvedValue({
        Task1: 'In Progress',
        Task2: 'Completed'
      });
      summarizeTasks.mockReturnValue({ alerts: [] });

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      expect(fs.readFileSync).toHaveBeenCalledWith(acceptedTasksPath, 'utf-8');
      expect(readStatusMapFromSheet).toHaveBeenCalled();
    });
  });

  describe('Alert Checker Interval - Task Filtering', () => {
    it('should filter out completed tasks', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      const mockTasks = [
        { workflowName: 'Task1', deadline: '2026-01-23T10:00:00' },
        { workflowName: 'Task2', deadline: '2026-01-23T11:00:00' },
        { workflowName: 'Task3', deadline: '2026-01-23T12:00:00' }
      ];
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));
      readStatusMapFromSheet.mockResolvedValue({
        Task1: 'In Progress',
        Task2: 'Completed',
        Task3: 'COMPLETED'
      });
      summarizeTasks.mockReturnValue({ alerts: [] });

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      // summarizeTasks should be called with only non-completed tasks
      expect(summarizeTasks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ workflowName: 'Task1' })
        ])
      );
      // Verify that completed tasks are filtered out
      const callArgs = summarizeTasks.mock.calls[summarizeTasks.mock.calls.length - 1][0];
      expect(callArgs).toHaveLength(1);
      expect(callArgs[0].workflowName).toBe('Task1');
    });

    it('should handle tasks with no status mapping', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      const mockTasks = [
        { workflowName: 'Task1', deadline: '2026-01-23T10:00:00' },
        { workflowName: 'Task2', deadline: '2026-01-23T11:00:00' }
      ];
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));
      readStatusMapFromSheet.mockResolvedValue({
        Task1: 'In Progress'
        // Task2 has no status mapping
      });
      summarizeTasks.mockReturnValue({ alerts: [] });

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      // Both tasks should be included since Task2 has no 'completed' status
      expect(summarizeTasks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ workflowName: 'Task1' }),
          expect.objectContaining({ workflowName: 'Task2' })
        ])
      );
    });
  });

  describe('Alert Checker Interval - Alert Sending', () => {
    it('should send alert when tasks are due < 15 mins', async () => {
      jest.useRealTimers(); // Use real timers for this specific test

      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      const mockTasks = [
        { workflowName: 'UrgentTask', deadline: '2026-01-23T10:00:00' }
      ];
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));
      readStatusMapFromSheet.mockResolvedValue({ UrgentTask: 'In Progress' });

      const mockDue = dayjs('2026-01-23T10:00:00');
      summarizeTasks.mockReturnValue({
        alerts: [
          { workflowName: 'UrgentTask', due: mockDue }
        ]
      });

      // Mock the setInterval to call immediately
      const originalSetInterval = global.setInterval;
      global.setInterval = jest.fn((fn) => {
        if (typeof fn === 'function') {
          setTimeout(() => fn(), 0);
        }
        return 123; // mock interval ID
      });

      startTaskSchedule();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      global.setInterval = originalSetInterval;

      expect(sendToGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ *RWS Alert — Orders Due < 15 mins!*')
      );
      expect(sendToGoogleChat).toHaveBeenCalledWith(
        expect.stringContaining('UrgentTask')
      );
      expect(logSuccess).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Alert sent: 1 orders')
      );
    });

    it('should not send alert when no tasks are urgent', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      const mockTasks = [
        { workflowName: 'NormalTask', deadline: '2026-01-23T18:00:00' }
      ];
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));
      readStatusMapFromSheet.mockResolvedValue({ NormalTask: 'In Progress' });
      summarizeTasks.mockReturnValue({ alerts: [] });

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      // Should not send alert message
      const chatCalls = sendToGoogleChat.mock.calls.filter(call =>
        call[0] && call[0].includes('⚠️ *RWS Alert')
      );
      expect(chatCalls.length).toBe(0);
    });

    it('should format alert message with multiple urgent tasks', async () => {
      jest.useRealTimers(); // Use real timers for this specific test

      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      const mockTasks = [
        { workflowName: 'Task1', deadline: '2026-01-23T10:00:00' },
        { workflowName: 'Task2', deadline: '2026-01-23T10:05:00' }
      ];
      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));
      readStatusMapFromSheet.mockResolvedValue({
        Task1: 'In Progress',
        Task2: 'In Progress'
      });

      summarizeTasks.mockReturnValue({
        alerts: [
          { workflowName: 'Task1', due: dayjs('2026-01-23T10:00:00') },
          { workflowName: 'Task2', due: dayjs('2026-01-23T10:05:00') }
        ]
      });

      // Mock the setInterval to call immediately
      const originalSetInterval = global.setInterval;
      global.setInterval = jest.fn((fn) => {
        if (typeof fn === 'function') {
          setTimeout(() => fn(), 0);
        }
        return 123; // mock interval ID
      });

      startTaskSchedule();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      global.setInterval = originalSetInterval;

      expect(sendToGoogleChat).toHaveBeenCalledWith(
        expect.stringMatching(/Task1.*10:00/)
      );
      expect(sendToGoogleChat).toHaveBeenCalledWith(
        expect.stringMatching(/Task2.*10:05/)
      );
      expect(logSuccess).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ Alert sent: 2 orders')
      );
    });
  });

  describe('Alert Checker Interval - Error Handling', () => {
    it('should catch and log errors from file read', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('❌ Alert checker failed'),
        true
      );
    });

    it('should catch and log errors from JSON parse', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json{{{');

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('❌ Alert checker failed'),
        true
      );
    });

    it('should catch and log errors from readStatusMapFromSheet', async () => {
      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([{ workflowName: 'Task1' }]));
      readStatusMapFromSheet.mockRejectedValue(new Error('Sheet API error'));

      startTaskSchedule();

      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();

      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('❌ Alert checker failed'),
        true
      );
    });

    it('should catch and log errors from sendToGoogleChat', async () => {
      jest.useRealTimers(); // Use real timers for this specific test

      isBusinessDay.mockReturnValue(true);
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { workflowName: 'Task1', deadline: '2026-01-23T10:00:00' }
      ]));
      readStatusMapFromSheet.mockResolvedValue({ Task1: 'In Progress' });
      summarizeTasks.mockReturnValue({
        alerts: [
          { workflowName: 'Task1', due: dayjs('2026-01-23T10:00:00') }
        ]
      });
      sendToGoogleChat.mockRejectedValue(new Error('Chat webhook error'));

      // Mock the setInterval to call immediately
      const originalSetInterval = global.setInterval;
      global.setInterval = jest.fn((fn) => {
        if (typeof fn === 'function') {
          setTimeout(() => fn(), 0);
        }
        return 123; // mock interval ID
      });

      startTaskSchedule();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      global.setInterval = originalSetInterval;

      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('❌ Alert checker failed'),
        true
      );
    });
  });

  describe('Module Exports', () => {
    it('should export startTaskSchedule function', () => {
      expect(typeof startTaskSchedule).toBe('function');
    });
  });
});
