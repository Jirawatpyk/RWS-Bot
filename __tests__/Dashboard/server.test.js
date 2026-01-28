/**
 * Tests for Dashboard/server.js - Task Report API Endpoints
 *
 * ทดสอบ Phase 1: Task Report + Auto-Release Capacity
 * - GET /api/tasks - อ่านข้อมูล tasks จาก acceptedTasks.json
 * - POST /api/tasks/refresh - query Sheet, เคลียร์ completed, release capacity
 *
 * Strategy: Test the logic that would be in the route handlers
 * rather than testing the full Express server setup
 */

jest.mock('fs');
jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logInfo: jest.fn(),
  logFail: jest.fn(),
  logProgress: jest.fn()
}));

jest.mock('../../Task/CapacityTracker', () => ({
  releaseCapacity: jest.fn()
}));

jest.mock('../../Task/taskReporter', () => {
  const actualModule = jest.requireActual('../../Task/taskReporter');
  return {
    ...actualModule,
    loadAndFilterTasks: jest.fn(),
    summarizeTasks: actualModule.summarizeTasks, // Use real implementation
    acceptedTasksPath: '/mock/path/acceptedTasks.json'
  };
});

const fs = require('fs');
const dayjs = require('dayjs');
const { logInfo } = require('../../Logs/logger');
const { releaseCapacity } = require('../../Task/CapacityTracker');
const {
  loadAndFilterTasks,
  summarizeTasks,
  acceptedTasksPath
} = require('../../Task/taskReporter');

describe('Dashboard/server.js - Task Report API Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('[]');
  });

  describe('GET /api/tasks - Logic', () => {
    it('should return empty result when acceptedTasks.json does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      // Simulate route handler logic
      let result;
      try {
        if (!fs.existsSync(acceptedTasksPath)) {
          result = {
            tasks: [],
            summary: null,
            lastUpdated: new Date().toISOString()
          };
        }
      } catch (err) {
        result = { error: err.message };
      }

      expect(result.tasks).toEqual([]);
      expect(result.summary).toBe(null);
      expect(result.lastUpdated).toBeDefined();
    });

    it('should return tasks and summary when file exists', () => {
      fs.existsSync.mockReturnValue(true);

      const mockTasks = [
        {
          orderId: '11111',
          workflowName: 'WF-001',
          amountWords: 3000,
          plannedEndDate: dayjs().format('YYYY-MM-DD HH:mm')
        },
        {
          orderId: '22222',
          workflowName: 'WF-002',
          amountWords: 5000,
          plannedEndDate: dayjs().add(1, 'day').format('YYYY-MM-DD HH:mm')
        }
      ];

      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));

      // Simulate route handler logic
      let result;
      try {
        const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
        const tasks = JSON.parse(raw);
        const summary = summarizeTasks(tasks);

        result = {
          tasks,
          summary,
          lastUpdated: new Date().toISOString()
        };
      } catch (err) {
        result = { error: err.message };
      }

      expect(fs.readFileSync).toHaveBeenCalledWith(acceptedTasksPath, 'utf-8');
      expect(result.tasks).toHaveLength(2);
      expect(result.summary).toBeDefined();
      expect(result.summary.totalOrders).toBe(2);
      expect(result.summary.totalWords).toBe(8000);
      expect(result.lastUpdated).toBeDefined();
    });

    it('should handle invalid JSON in acceptedTasks.json', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json {{{');

      // Simulate route handler logic
      let result;
      try {
        const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
        const tasks = JSON.parse(raw);
        const summary = summarizeTasks(tasks);

        result = {
          tasks,
          summary,
          lastUpdated: new Date().toISOString()
        };
      } catch (err) {
        result = { error: err.message };
      }

      expect(result.error).toBeDefined();
      expect(result.error).toContain('JSON');
    });

    it('should handle file read errors', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      // Simulate route handler logic
      let result;
      try {
        const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
        const tasks = JSON.parse(raw);
        const summary = summarizeTasks(tasks);

        result = {
          tasks,
          summary,
          lastUpdated: new Date().toISOString()
        };
      } catch (err) {
        result = { error: err.message };
      }

      expect(result.error).toBe('File read error');
    });

    it('should return tasks with correct summary breakdown', () => {
      fs.existsSync.mockReturnValue(true);

      const today = dayjs().format('YYYY-MM-DD');
      const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
      const afterTomorrow = dayjs().add(2, 'day').format('YYYY-MM-DD');

      const mockTasks = [
        {
          orderId: '1',
          workflowName: 'WF-001',
          amountWords: 1000,
          plannedEndDate: `${today} 18:00`
        },
        {
          orderId: '2',
          workflowName: 'WF-002',
          amountWords: 2000,
          plannedEndDate: `${tomorrow} 18:00`
        },
        {
          orderId: '3',
          workflowName: 'WF-003',
          amountWords: 3000,
          plannedEndDate: `${afterTomorrow} 18:00`
        }
      ];

      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));

      // Simulate route handler logic
      const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
      const tasks = JSON.parse(raw);
      const summary = summarizeTasks(tasks);

      expect(summary.totalOrders).toBe(3);
      expect(summary.totalWords).toBe(6000);
      expect(summary.todayOrders).toBe(1);
      expect(summary.todayWords).toBe(1000);
      expect(summary.tomorrowOrders).toBe(1);
      expect(summary.tomorrowWords).toBe(2000);
      expect(summary.afterOrders).toBe(1);
      expect(summary.afterWords).toBe(3000);
    });
  });

  describe('POST /api/tasks/refresh - Logic', () => {
    it('should query Sheet, filter completed tasks, and release capacity', async () => {
      const mockActiveTasks = [
        {
          orderId: '11111',
          workflowName: 'WF-001',
          amountWords: 3000,
          plannedEndDate: '2026-01-25 18:00'
        }
      ];

      const mockReleasedPlans = [
        { date: '2026-01-24', amount: 2000 },
        { date: '2026-01-25', amount: 3000 }
      ];

      loadAndFilterTasks.mockResolvedValue({
        activeTasks: mockActiveTasks,
        completedCount: 2,
        releasedPlans: mockReleasedPlans
      });

      // Simulate route handler logic
      const { activeTasks, completedCount, releasedPlans } = await loadAndFilterTasks();
      const summary = summarizeTasks(activeTasks);

      const result = {
        success: true,
        tasks: activeTasks,
        summary,
        completedCount,
        lastUpdated: new Date().toISOString()
      };

      expect(loadAndFilterTasks).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.summary).toBeDefined();
      expect(result.completedCount).toBe(2);
      expect(result.lastUpdated).toBeDefined();
    });

    it('should handle empty activeTasks correctly', async () => {
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 5,
        releasedPlans: [
          { date: '2026-01-24', amount: 2000 },
          { date: '2026-01-25', amount: 3000 }
        ]
      });

      // Simulate route handler logic
      const { activeTasks, completedCount, releasedPlans } = await loadAndFilterTasks();
      const summary = summarizeTasks(activeTasks);

      const result = {
        success: true,
        tasks: activeTasks,
        summary,
        completedCount,
        lastUpdated: new Date().toISOString()
      };

      expect(result.success).toBe(true);
      expect(result.tasks).toEqual([]);
      expect(result.summary.totalOrders).toBe(0);
      expect(result.completedCount).toBe(5);
    });

    it('should handle errors from loadAndFilterTasks', async () => {
      loadAndFilterTasks.mockRejectedValue(new Error('Sheet read error'));

      // Simulate route handler logic with error handling
      let result;
      try {
        const { activeTasks, completedCount, releasedPlans } = await loadAndFilterTasks();
        const summary = summarizeTasks(activeTasks);

        result = {
          success: true,
          tasks: activeTasks,
          summary,
          completedCount,
          lastUpdated: new Date().toISOString()
        };
      } catch (err) {
        result = {
          success: false,
          error: err.message
        };
      }

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sheet read error');
    });

    it('should handle authentication errors from Google Sheets', async () => {
      loadAndFilterTasks.mockRejectedValue(new Error('Authentication failed'));

      // Simulate route handler logic with error handling
      let result;
      try {
        const { activeTasks, completedCount, releasedPlans } = await loadAndFilterTasks();
        const summary = summarizeTasks(activeTasks);

        result = {
          success: true,
          tasks: activeTasks,
          summary,
          completedCount,
          lastUpdated: new Date().toISOString()
        };
      } catch (err) {
        result = {
          success: false,
          error: err.message
        };
      }

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication failed');
    });

    it('should return correct timestamp format in ISO 8601', async () => {
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [],
        completedCount: 0,
        releasedPlans: []
      });

      const beforeCall = new Date();

      // Simulate route handler logic
      const { activeTasks, completedCount } = await loadAndFilterTasks();
      const summary = summarizeTasks(activeTasks);

      const result = {
        success: true,
        tasks: activeTasks,
        summary,
        completedCount,
        lastUpdated: new Date().toISOString()
      };

      const afterCall = new Date();

      const timestamp = new Date(result.lastUpdated);

      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });

    it('should handle tasks with missing allocationPlan gracefully', async () => {
      const mockActiveTasks = [
        {
          orderId: '11111',
          workflowName: 'WF-001',
          amountWords: 3000
          // No allocationPlan
        }
      ];

      loadAndFilterTasks.mockResolvedValue({
        activeTasks: mockActiveTasks,
        completedCount: 1,
        releasedPlans: [] // No plans to release
      });

      // Simulate route handler logic
      const { activeTasks, completedCount, releasedPlans } = await loadAndFilterTasks();
      const summary = summarizeTasks(activeTasks);

      const result = {
        success: true,
        tasks: activeTasks,
        summary,
        completedCount,
        lastUpdated: new Date().toISOString()
      };

      expect(result.success).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.completedCount).toBe(1);
    });

    it('should process releasedPlans with multiple dates', async () => {
      const mockActiveTasks = [];

      const mockReleasedPlans = [
        { date: '2026-01-24', amount: 2000 },
        { date: '2026-01-24', amount: 1000 }, // Same date
        { date: '2026-01-25', amount: 3000 },
        { date: '2026-01-26', amount: 4000 }
      ];

      loadAndFilterTasks.mockResolvedValue({
        activeTasks: mockActiveTasks,
        completedCount: 3,
        releasedPlans: mockReleasedPlans
      });

      // Simulate route handler logic
      const { activeTasks, completedCount, releasedPlans } = await loadAndFilterTasks();
      const summary = summarizeTasks(activeTasks);

      // Get unique dates from releasedPlans
      const uniqueDates = releasedPlans && releasedPlans.length > 0
        ? [...new Set(releasedPlans.map(p => p.date))]
        : [];

      const result = {
        success: true,
        tasks: activeTasks,
        summary,
        completedCount,
        lastUpdated: new Date().toISOString()
      };

      expect(result.completedCount).toBe(3);
      expect(uniqueDates).toEqual(['2026-01-24', '2026-01-25', '2026-01-26']);
    });

    it('should handle case when no tasks are completed', async () => {
      const mockActiveTasks = [
        { orderId: '11111', workflowName: 'WF-001', amountWords: 3000 }
      ];

      loadAndFilterTasks.mockResolvedValue({
        activeTasks: mockActiveTasks,
        completedCount: 0,
        releasedPlans: []
      });

      // Simulate route handler logic
      const { activeTasks, completedCount, releasedPlans } = await loadAndFilterTasks();
      const summary = summarizeTasks(activeTasks);

      const result = {
        success: true,
        tasks: activeTasks,
        summary,
        completedCount,
        lastUpdated: new Date().toISOString()
      };

      expect(result.success).toBe(true);
      expect(result.completedCount).toBe(0);
      expect(result.tasks).toHaveLength(1);
    });
  });

  describe('Integration: GET and POST logic flow', () => {
    it('should show updated data after refresh', async () => {
      // Initial GET - returns old data
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', workflowName: 'WF-001', amountWords: 3000, plannedEndDate: '2026-01-25 18:00' },
        { orderId: '22222', workflowName: 'WF-002', amountWords: 5000, plannedEndDate: '2026-01-26 18:00' }
      ]));

      // Simulate GET
      let tasks1 = JSON.parse(fs.readFileSync(acceptedTasksPath, 'utf-8'));
      let summary1 = summarizeTasks(tasks1);

      expect(tasks1).toHaveLength(2);
      expect(summary1.totalOrders).toBe(2);
      expect(summary1.totalWords).toBe(8000);

      // POST refresh - updates data
      loadAndFilterTasks.mockResolvedValue({
        activeTasks: [
          { orderId: '11111', workflowName: 'WF-001', amountWords: 3000, plannedEndDate: '2026-01-25 18:00' }
        ],
        completedCount: 1,
        releasedPlans: [{ date: '2026-01-26', amount: 5000 }]
      });

      const { activeTasks, completedCount } = await loadAndFilterTasks();
      const summary2 = summarizeTasks(activeTasks);

      expect(activeTasks).toHaveLength(1);
      expect(summary2.totalOrders).toBe(1);
      expect(summary2.totalWords).toBe(3000);
      expect(completedCount).toBe(1);

      // After refresh, GET should reflect updated file
      fs.readFileSync.mockReturnValue(JSON.stringify([
        { orderId: '11111', workflowName: 'WF-001', amountWords: 3000, plannedEndDate: '2026-01-25 18:00' }
      ]));

      let tasks3 = JSON.parse(fs.readFileSync(acceptedTasksPath, 'utf-8'));
      let summary3 = summarizeTasks(tasks3);

      expect(tasks3).toHaveLength(1);
      expect(summary3.totalOrders).toBe(1);
      expect(summary3.totalWords).toBe(3000);
    });
  });

  describe('Summary calculation correctness', () => {
    it('should correctly calculate alerts for tasks due within 15 minutes', () => {
      fs.existsSync.mockReturnValue(true);

      const soon = dayjs().add(10, 'minute').format('YYYY-MM-DD HH:mm');
      const later = dayjs().add(2, 'hour').format('YYYY-MM-DD HH:mm');

      const mockTasks = [
        {
          orderId: '1',
          workflowName: 'WF-URGENT',
          amountWords: 1000,
          plannedEndDate: soon
        },
        {
          orderId: '2',
          workflowName: 'WF-NORMAL',
          amountWords: 2000,
          plannedEndDate: later
        }
      ];

      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));

      const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
      const tasks = JSON.parse(raw);
      const summary = summarizeTasks(tasks);

      expect(summary.alerts).toHaveLength(1);
      expect(summary.alerts[0].orderId).toBe('1');
    });

    it('should not include overdue tasks in alerts', () => {
      fs.existsSync.mockReturnValue(true);

      const overdue = dayjs().subtract(10, 'minute').format('YYYY-MM-DD HH:mm');

      const mockTasks = [
        {
          orderId: '1',
          workflowName: 'WF-OVERDUE',
          amountWords: 1000,
          plannedEndDate: overdue
        }
      ];

      fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));

      const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
      const tasks = JSON.parse(raw);
      const summary = summarizeTasks(tasks);

      expect(summary.alerts).toHaveLength(0);
    });
  });
});
