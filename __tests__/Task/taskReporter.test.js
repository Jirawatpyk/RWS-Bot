/**
 * Tests for Task/taskReporter.js
 */

jest.mock('fs');
jest.mock('axios');
jest.mock('google-spreadsheet');
jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logFail: jest.fn(),
  logInfo: jest.fn(),
  logProgress: jest.fn()
}));

// Mock credentials
jest.mock('../../credentials.json', () => ({
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: 'test-private-key'
}), { virtual: true });

// Mock environment variables
process.env.GOOGLE_CHAT_Moravia = 'https://chat.googleapis.com/v1/spaces/test/messages';
process.env.SHEET_ID_Tracking = 'test-sheet-id';

const fs = require('fs');
const axios = require('axios');
const dayjs = require('dayjs');
const { logSuccess, logFail, logInfo } = require('../../Logs/logger');

// Need to require after mocks
const {
  appendAcceptedTask,
  summarizeTasks,
  formatReport,
  sendToGoogleChat,
  removeTaskCapacity,
  loadAndFilterTasks,
  readStatusMapFromSheet,
  acceptedTasksPath
} = require('../../Task/taskReporter');

describe('Task/taskReporter.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('[]');
    fs.writeFileSync.mockImplementation(() => {});
  });

  describe('appendAcceptedTask', () => {
    it('should create new file when none exists', () => {
      fs.existsSync.mockReturnValue(false);

      const task = { orderId: '12345', workflowName: 'Test Task' };
      appendAcceptedTask(task);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        acceptedTasksPath,
        expect.stringContaining('12345')
      );
    });

    it('should append to existing tasks', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([{ orderId: '11111' }]));

      const task = { orderId: '22222', workflowName: 'New Task' };
      appendAcceptedTask(task);

      const writtenData = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(writtenData).toHaveLength(2);
      expect(writtenData[1].orderId).toBe('22222');
    });

    it('should handle corrupted JSON file', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json{{{');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const task = { orderId: '33333' };
      appendAcceptedTask(task);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse'),
        expect.any(Error)
      );

      // Should still write the new task
      const writtenData = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(writtenData).toHaveLength(1);

      consoleSpy.mockRestore();
    });

    it('should handle write errors', () => {
      fs.existsSync.mockReturnValue(false);
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      appendAcceptedTask({ orderId: '44444' });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('removeTaskCapacity', () => {
    it('should return early when file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);

      const result = await removeTaskCapacity('12345');

      expect(result.ok).toBe(true);
      expect(result.removed).toBe(false);
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('No acceptedTasks.json'));
    });

    it('should remove task and update file', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', amountWords: 1000 },
        { orderId: '22222', amountWords: 2000 },
        { orderId: '33333', amountWords: 3000 }
      ]));

      const result = await removeTaskCapacity('22222');

      expect(result.ok).toBe(true);
      expect(result.removed).toBe(true);
      expect(result.remaining).toBe(2);
      expect(result.totalWords).toBe(4000); // 1000 + 3000
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(logSuccess).toHaveBeenCalledWith(expect.stringContaining('removed'));
    });

    it('should handle order not found', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', amountWords: 1000 }
      ]));

      const result = await removeTaskCapacity('99999');

      expect(result.ok).toBe(true);
      expect(result.removed).toBe(false);
      expect(result.remaining).toBe(1);
      expect(logInfo).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('should handle string vs number orderId comparison', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: 12345, amountWords: 1000 }
      ]));

      const result = await removeTaskCapacity('12345');

      expect(result.ok).toBe(true);
      expect(result.removed).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      const result = await removeTaskCapacity('12345');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Read error');
      expect(logFail).toHaveBeenCalled();
    });
  });

  describe('summarizeTasks', () => {
    it('should summarize empty task list', () => {
      const result = summarizeTasks([]);

      expect(result.totalOrders).toBe(0);
      expect(result.totalWords).toBe(0);
      expect(result.todayOrders).toBe(0);
      expect(result.alerts).toEqual([]);
    });

    it('should categorize tasks by due date', () => {
      const today = dayjs().format('YYYY-MM-DD');
      const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
      const nextWeek = dayjs().add(7, 'day').format('YYYY-MM-DD');

      const tasks = [
        { orderId: '1', plannedEndDate: `${today} 18:00`, amountWords: 1000 },
        { orderId: '2', plannedEndDate: `${today} 20:00`, amountWords: 2000 },
        { orderId: '3', plannedEndDate: `${tomorrow} 12:00`, amountWords: 3000 },
        { orderId: '4', plannedEndDate: `${nextWeek} 12:00`, amountWords: 4000 }
      ];

      const result = summarizeTasks(tasks);

      expect(result.totalOrders).toBe(4);
      expect(result.totalWords).toBe(10000);
      expect(result.todayOrders).toBe(2);
      expect(result.todayWords).toBe(3000);
      expect(result.tomorrowOrders).toBe(1);
      expect(result.tomorrowWords).toBe(3000);
      expect(result.afterOrders).toBe(1);
      expect(result.afterWords).toBe(4000);
    });

    it('should identify alert tasks (due within 15 mins)', () => {
      const soon = dayjs().add(10, 'minute').format('YYYY-MM-DD HH:mm');

      const tasks = [
        { orderId: '1', plannedEndDate: soon, amountWords: 1000 }
      ];

      const result = summarizeTasks(tasks);

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].orderId).toBe('1');
    });

    it('should not include overdue tasks in alerts', () => {
      const overdue = dayjs().subtract(10, 'minute').format('YYYY-MM-DD HH:mm');

      const tasks = [
        { orderId: '1', plannedEndDate: overdue, amountWords: 1000 }
      ];

      const result = summarizeTasks(tasks);

      expect(result.alerts).toHaveLength(0);
    });

    it('should handle tasks without amountWords', () => {
      const today = dayjs().format('YYYY-MM-DD');

      const tasks = [
        { orderId: '1', plannedEndDate: `${today} 18:00` },
        { orderId: '2', plannedEndDate: `${today} 20:00`, amountWords: null }
      ];

      const result = summarizeTasks(tasks);

      expect(result.totalWords).toBe(0);
    });
  });

  describe('formatReport', () => {
    it('should format basic report', () => {
      const summary = {
        totalOrders: 3,
        totalWords: 5000,
        todayOrders: 1,
        todayWords: 1000,
        tomorrowOrders: 1,
        tomorrowWords: 2000,
        afterOrders: 1,
        afterWords: 2000,
        tasks: [
          { workflowName: 'Task A' },
          { workflowName: 'Task B' }
        ]
      };

      const result = formatReport(summary);

      expect(result).toContain('RWS Task Report');
      expect(result).toContain('In Progress: 3 orders');
      expect(result).toContain('5000 words');
      expect(result).toContain('Task A');
      expect(result).toContain('Task B');
      expect(result).toContain('Due Today: 1 orders');
      expect(result).toContain('Due Tomorrow: 1 orders');
    });

    it('should include completed count when present', () => {
      const summary = {
        totalOrders: 2,
        totalWords: 3000,
        todayOrders: 1,
        todayWords: 1500,
        tomorrowOrders: 1,
        tomorrowWords: 1500,
        afterOrders: 0,
        afterWords: 0,
        completedCount: 5,
        tasks: []
      };

      const result = formatReport(summary);

      expect(result).toContain('Completed Today: 5 orders');
    });

    it('should not include completed section when zero', () => {
      const summary = {
        totalOrders: 2,
        totalWords: 3000,
        todayOrders: 1,
        todayWords: 1500,
        tomorrowOrders: 1,
        tomorrowWords: 1500,
        afterOrders: 0,
        afterWords: 0,
        completedCount: 0,
        tasks: []
      };

      const result = formatReport(summary);

      expect(result).not.toContain('Completed Today');
    });
  });

  describe('sendToGoogleChat', () => {
    it('should send message to webhook', async () => {
      axios.post.mockResolvedValue({ status: 200 });

      await sendToGoogleChat('Test message');

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        { text: 'Test message' },
        { timeout: 10000 }
      );
    });

    it('should handle webhook errors', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      await sendToGoogleChat('Test message');

      expect(logFail).toHaveBeenCalledWith(
        expect.stringContaining('[sendToGoogleChat] Failed')
      );
    });

    it('should skip when no webhook configured', async () => {
      const originalWebhook = process.env.GOOGLE_CHAT_Moravia;
      delete process.env.GOOGLE_CHAT_Moravia;

      // Re-require to get the updated env
      jest.resetModules();

      // Re-setup mocks after resetModules
      jest.mock('fs');
      jest.mock('axios');
      jest.mock('google-spreadsheet');
      jest.mock('../../Logs/logger', () => ({
        logSuccess: jest.fn(),
        logFail: jest.fn(),
        logInfo: jest.fn(),
        logProgress: jest.fn()
      }));
      jest.mock('../../credentials.json', () => ({
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: 'test-private-key'
      }), { virtual: true });

      const { logInfo: logInfoFn } = require('../../Logs/logger');
      const { sendToGoogleChat: sendFn } = require('../../Task/taskReporter');
      const axiosMock = require('axios');

      await sendFn('Test message');

      expect(axiosMock.post).not.toHaveBeenCalled();
      expect(logInfoFn).toHaveBeenCalledWith(
        expect.stringContaining('No webhook configured')
      );

      process.env.GOOGLE_CHAT_Moravia = originalWebhook;

      // Restore modules for subsequent tests
      jest.resetModules();
    });
  });

  describe('loadAndFilterTasks', () => {
    let mockDoc, mockSheet, mockGetRows;
    let loadAndFilterTasksFn, fsMock, acceptedTasksPathVal;

    beforeEach(() => {
      // Reset modules to get fresh state (important after sendToGoogleChat tests)
      jest.resetModules();

      // Re-setup all mocks
      jest.mock('fs');
      jest.mock('axios');
      jest.mock('google-spreadsheet');
      jest.mock('../../Logs/logger', () => ({
        logSuccess: jest.fn(),
        logFail: jest.fn(),
        logInfo: jest.fn(),
        logProgress: jest.fn()
      }));
      jest.mock('../../credentials.json', () => ({
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: 'test-private-key'
      }), { virtual: true });

      // Restore env variables
      process.env.GOOGLE_CHAT_Moravia = 'https://chat.googleapis.com/v1/spaces/test/messages';
      process.env.SHEET_ID_Tracking = 'test-sheet-id';

      const { GoogleSpreadsheet } = require('google-spreadsheet');

      mockGetRows = jest.fn();
      mockSheet = {
        getRows: mockGetRows
      };

      mockDoc = {
        useServiceAccountAuth: jest.fn().mockResolvedValue(undefined),
        loadInfo: jest.fn().mockResolvedValue(undefined),
        sheetsByTitle: {
          'Assignment': mockSheet
        }
      };

      GoogleSpreadsheet.mockImplementation(() => mockDoc);

      // Re-require modules after mocks are set up
      fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(false);
      fsMock.readFileSync.mockReturnValue('[]');
      fsMock.writeFileSync.mockImplementation(() => {});

      const taskReporter = require('../../Task/taskReporter');
      loadAndFilterTasksFn = taskReporter.loadAndFilterTasks;
      acceptedTasksPathVal = taskReporter.acceptedTasksPath;
    });

    it('should return empty result when acceptedTasks.json does not exist', async () => {
      fsMock.existsSync.mockReturnValue(false);

      const result = await loadAndFilterTasksFn();

      expect(result.activeTasks).toEqual([]);
      expect(result.completedCount).toBe(0);
      // Check that readFileSync was NOT called with acceptedTasksPath (dotenv may call it for .env)
      expect(fsMock.readFileSync).not.toHaveBeenCalledWith(acceptedTasksPathVal);
      expect(fsMock.readFileSync).not.toHaveBeenCalledWith(acceptedTasksPathVal, 'utf-8');
    });

    it('should filter out completed tasks and update file', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', workflowName: 'WF-001', amountWords: 1000 },
        { orderId: '22222', workflowName: 'WF-002', amountWords: 2000 },
        { orderId: '33333', workflowName: 'WF-003', amountWords: 3000 }
      ]));

      // Mock sheet rows
      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, 'In Progress'] },
        { _rawData: [null, null, null, null, null, 'WF-002', null, null, null, null, null, 'Completed'] },
        { _rawData: [null, null, null, null, null, 'WF-003', null, null, null, null, null, 'In Progress'] }
      ]);

      const result = await loadAndFilterTasksFn();

      expect(result.activeTasks).toHaveLength(2);
      expect(result.completedCount).toBe(1);
      expect(result.activeTasks.find(t => t.orderId === '11111')).toBeDefined();
      expect(result.activeTasks.find(t => t.orderId === '33333')).toBeDefined();
      expect(result.activeTasks.find(t => t.orderId === '22222')).toBeUndefined();

      // Should update file with only active tasks
      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        acceptedTasksPathVal,
        expect.stringContaining('11111')
      );
    });

    it('should authenticate with Google Sheets correctly', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify([]));
      mockGetRows.mockResolvedValue([]);

      await loadAndFilterTasksFn();

      expect(mockDoc.useServiceAccountAuth).toHaveBeenCalledWith({
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: 'test-private-key'
      });
      expect(mockDoc.loadInfo).toHaveBeenCalled();
    });

    it('should handle tasks not found in sheet (no matching row)', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', workflowName: 'WF-NOTFOUND', amountWords: 1000 }
      ]));

      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-OTHER', null, null, null, null, null, 'In Progress'] }
      ]);

      const result = await loadAndFilterTasksFn();

      // Task not found in sheet should be kept as active (no status means not completed)
      expect(result.activeTasks).toHaveLength(1);
      expect(result.completedCount).toBe(0);
    });

    it('should handle case-insensitive status matching', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', workflowName: 'WF-001', amountWords: 1000 },
        { orderId: '22222', workflowName: 'WF-002', amountWords: 2000 },
        { orderId: '33333', workflowName: 'WF-003', amountWords: 3000 }
      ]));

      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, 'COMPLETED'] },
        { _rawData: [null, null, null, null, null, 'WF-002', null, null, null, null, null, 'Completed'] },
        { _rawData: [null, null, null, null, null, 'WF-003', null, null, null, null, null, 'completed  '] }
      ]);

      const result = await loadAndFilterTasksFn();

      expect(result.activeTasks).toHaveLength(0);
      expect(result.completedCount).toBe(3);
    });

    it('should handle empty status values', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', workflowName: 'WF-001', amountWords: 1000 }
      ]));

      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, ''] }
      ]);

      const result = await loadAndFilterTasksFn();

      // Empty status should keep task as active
      expect(result.activeTasks).toHaveLength(1);
      expect(result.completedCount).toBe(0);
    });

    it('should handle undefined status values', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', workflowName: 'WF-001', amountWords: 1000 }
      ]));

      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-001'] } // No status column
      ]);

      const result = await loadAndFilterTasksFn();

      expect(result.activeTasks).toHaveLength(1);
      expect(result.completedCount).toBe(0);
    });

    it('should call getRows with correct parameters', async () => {
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(JSON.stringify([]));
      mockGetRows.mockResolvedValue([]);

      await loadAndFilterTasksFn();

      expect(mockGetRows).toHaveBeenCalledWith({ headerRow: 5, offset: 0 });
    });
  });

  describe('readStatusMapFromSheet', () => {
    let mockDoc, mockSheet, mockGetRows;
    let readStatusMapFn;

    beforeEach(() => {
      // Reset modules to get fresh state
      jest.resetModules();

      // Re-setup all mocks
      jest.mock('fs');
      jest.mock('axios');
      jest.mock('google-spreadsheet');
      jest.mock('../../Logs/logger', () => ({
        logSuccess: jest.fn(),
        logFail: jest.fn(),
        logInfo: jest.fn(),
        logProgress: jest.fn()
      }));
      jest.mock('../../credentials.json', () => ({
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: 'test-private-key'
      }), { virtual: true });

      // Restore env variables
      process.env.GOOGLE_CHAT_Moravia = 'https://chat.googleapis.com/v1/spaces/test/messages';
      process.env.SHEET_ID_Tracking = 'test-sheet-id';

      const { GoogleSpreadsheet } = require('google-spreadsheet');

      mockGetRows = jest.fn();
      mockSheet = {
        getRows: mockGetRows
      };

      mockDoc = {
        useServiceAccountAuth: jest.fn().mockResolvedValue(undefined),
        loadInfo: jest.fn().mockResolvedValue(undefined),
        sheetsByTitle: {
          'Assignment': mockSheet
        }
      };

      GoogleSpreadsheet.mockImplementation(() => mockDoc);

      // Re-require the module after mocks are set up
      readStatusMapFn = require('../../Task/taskReporter').readStatusMapFromSheet;
    });

    it('should build status map from sheet rows', async () => {
      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, 'In Progress'] },
        { _rawData: [null, null, null, null, null, 'WF-002', null, null, null, null, null, 'Completed'] },
        { _rawData: [null, null, null, null, null, 'WF-003', null, null, null, null, null, 'On Hold'] }
      ]);

      const result = await readStatusMapFn();

      expect(result).toEqual({
        'WF-001': 'in progress',
        'WF-002': 'completed',
        'WF-003': 'on hold'
      });
    });

    it('should authenticate with Google Sheets correctly', async () => {
      mockGetRows.mockResolvedValue([]);

      await readStatusMapFn();

      expect(mockDoc.useServiceAccountAuth).toHaveBeenCalledWith({
        client_email: 'test@test.iam.gserviceaccount.com',
        private_key: 'test-private-key'
      });
      expect(mockDoc.loadInfo).toHaveBeenCalled();
    });

    it('should handle empty sheet rows', async () => {
      mockGetRows.mockResolvedValue([]);

      const result = await readStatusMapFn();

      expect(result).toEqual({});
    });

    it('should skip rows with empty workflowName', async () => {
      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, '', null, null, null, null, null, 'In Progress'] },
        { _rawData: [null, null, null, null, null, null, null, null, null, null, null, 'Completed'] },
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, 'On Hold'] }
      ]);

      const result = await readStatusMapFn();

      expect(result).toEqual({
        'WF-001': 'on hold'
      });
      expect(Object.keys(result)).toHaveLength(1);
    });

    it('should trim whitespace from workflowName and status', async () => {
      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, '  WF-001  ', null, null, null, null, null, '  In Progress  '] }
      ]);

      const result = await readStatusMapFn();

      expect(result).toEqual({
        'WF-001': 'in progress'
      });
    });

    it('should convert status to lowercase', async () => {
      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, 'IN PROGRESS'] },
        { _rawData: [null, null, null, null, null, 'WF-002', null, null, null, null, null, 'COMPLETED'] },
        { _rawData: [null, null, null, null, null, 'WF-003', null, null, null, null, null, 'On Hold'] }
      ]);

      const result = await readStatusMapFn();

      expect(result['WF-001']).toBe('in progress');
      expect(result['WF-002']).toBe('completed');
      expect(result['WF-003']).toBe('on hold');
    });

    it('should handle rows where status is empty string', async () => {
      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, ''] }
      ]);

      const result = await readStatusMapFn();

      // With empty string status, it should still create entry
      expect(Object.keys(result)).toContain('WF-001');
      expect(result['WF-001']).toBe(''); // empty string trimmed and lowercased
    });

    it('should call getRows with correct parameters', async () => {
      mockGetRows.mockResolvedValue([]);

      await readStatusMapFn();

      expect(mockGetRows).toHaveBeenCalledWith({ headerRow: 5, offset: 0 });
    });

    it('should use correct sheet ID from environment', async () => {
      const { GoogleSpreadsheet } = require('google-spreadsheet');
      mockGetRows.mockResolvedValue([]);

      await readStatusMapFn();

      expect(GoogleSpreadsheet).toHaveBeenCalledWith('test-sheet-id');
    });

    it('should skip rows with null or whitespace-only workflowName', async () => {
      mockGetRows.mockResolvedValue([
        { _rawData: [null, null, null, null, null, null, null, null, null, null, null, 'In Progress'] }, // null workflowName
        { _rawData: [null, null, null, null, null, '   ', null, null, null, null, null, 'Completed'] }, // whitespace workflowName
        { _rawData: [null, null, null, null, null, 'WF-001', null, null, null, null, null, 'On Hold'] } // valid
      ]);

      const result = await readStatusMapFn();

      // Only the valid workflowName should be included
      expect(Object.keys(result)).toEqual(['WF-001']);
      expect(result['WF-001']).toBe('on hold');
    });
  });
});
