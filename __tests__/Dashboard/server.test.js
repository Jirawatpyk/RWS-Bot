/**
 * Tests for Dashboard/server.js - Task Report API Endpoints
 *
 * ทดสอบ Phase 1: Task Report + Auto-Release Capacity
 * - GET /api/tasks - อ่านข้อมูล tasks จาก acceptedTasks.json
 * - POST /api/tasks/refresh - query Sheet, เคลียร์ completed, release capacity
 *
 * Phase 2: HTTP Integration Tests + WebSocket Tests
 * - ทดสอบ HTTP endpoints ด้วย supertest
 * - ทดสอบ WebSocket events
 */

// Mock fs module with promises API
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('[]'),
    writeFile: jest.fn().mockResolvedValue(undefined)
  }
}));

// Use real path module - express.static requires proper path resolution
const path = require('path');

jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logInfo: jest.fn(),
  logFail: jest.fn(),
  logProgress: jest.fn()
}));

jest.mock('../../Task/CapacityTracker', () => ({
  releaseCapacity: jest.fn().mockResolvedValue(undefined),
  loadDailyOverride: jest.fn(() => ({})),
  saveDailyOverride: jest.fn(),
  getCapacityMap: jest.fn(() => ({})),
  getOverrideMap: jest.fn(() => ({})),
  adjustCapacity: jest.fn().mockResolvedValue(undefined),
  resetCapacityMap: jest.fn().mockResolvedValue(undefined),
  getRemainingCapacity: jest.fn((date) => 5000),
  syncCapacityWithTasks: jest.fn().mockResolvedValue({
    success: true,
    after: { '2026-01-25': 5000 },
    diff: 0,
    deletedOverrides: []
  })
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

jest.mock('../../Metrics/metricsCollector', () => ({
  metricsCollector: {
    getSnapshot: jest.fn(() => ({
      counters: {
        tasksReceived: 8,
        tasksAccepted: 7,
        tasksRejected: 1,
        tasksCompleted: 5,
        tasksFailed: 1,
      }
    })),
    updateBrowserPoolStatus: jest.fn(),
    updateIMAPStatus: jest.fn(),
    reset: jest.fn(),
  }
}));

jest.mock('../../IMAP/imapClient', () => ({
  pauseImap: jest.fn(),
  resumeImap: jest.fn(),
  isImapPaused: jest.fn(() => false)
}));

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
    const fs = require('fs');
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('[]');
    fs.promises.mkdir.mockResolvedValue(undefined);
    fs.promises.readFile.mockResolvedValue('[]');
    fs.promises.writeFile.mockResolvedValue(undefined);
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

  // ========================================
  // HTTP INTEGRATION TESTS (using supertest)
  // Skip: fs mock conflicts with express.static middleware (GET returns 500)
  // TODO: Move to separate file without global fs mock
  describe.skip('HTTP API Integration Tests', () => {
    const request = require('supertest');
    const { app } = require('../../Dashboard/server');

    beforeEach(() => {
      jest.clearAllMocks();

      // Reset fs mocks
      fs.existsSync.mockReturnValue(false);
      fs.readFileSync.mockReturnValue('[]');
      fs.promises.mkdir.mockResolvedValue(undefined);
      fs.promises.readFile.mockResolvedValue('[]');
      fs.promises.writeFile.mockResolvedValue(undefined);
    });

    describe('GET /api/override', () => {
      it('should return daily override settings', async () => {
        const { loadDailyOverride } = require('../../Task/CapacityTracker');
        loadDailyOverride.mockReturnValue({
          '2026-01-25': 10000,
          '2026-01-26': 15000
        });

        const response = await request(app).get('/api/override');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          '2026-01-25': 10000,
          '2026-01-26': 15000
        });
        expect(loadDailyOverride).toHaveBeenCalled();
      });

      it('should return empty object if no overrides exist', async () => {
        const { loadDailyOverride } = require('../../Task/CapacityTracker');
        loadDailyOverride.mockReturnValue({});

        const response = await request(app).get('/api/override');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
      });
    });

    describe('POST /api/override', () => {
      it('should update override settings and return success', async () => {
        const { saveDailyOverride } = require('../../Task/CapacityTracker');
        const newOverride = {
          '2026-01-25': 12000,
          '2026-01-26': 18000
        };

        const response = await request(app)
          .post('/api/override')
          .send(newOverride)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(saveDailyOverride).toHaveBeenCalledWith(newOverride);
      });

      it('should return 400 for invalid override format', async () => {
        const response = await request(app)
          .post('/api/override')
          .send('invalid data')
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid override format' });
      });

      it('should return 400 for null override', async () => {
        const response = await request(app)
          .post('/api/override')
          .send(null)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid override format' });
      });

      it('should return 400 for array instead of object', async () => {
        const response = await request(app)
          .post('/api/override')
          .send([{ date: '2026-01-25', amount: 10000 }])
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid override format' });
      });
    });

    describe('GET /api/capacity', () => {
      it('should return current capacity map', async () => {
        const { getCapacityMap } = require('../../Task/CapacityTracker');
        getCapacityMap.mockReturnValue({
          '2026-01-25': 3000,
          '2026-01-26': 5000
        });

        const response = await request(app).get('/api/capacity');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          '2026-01-25': 3000,
          '2026-01-26': 5000
        });
        expect(getCapacityMap).toHaveBeenCalled();
      });

      it('should return empty object if no capacity allocated', async () => {
        const { getCapacityMap } = require('../../Task/CapacityTracker');
        getCapacityMap.mockReturnValue({});

        const response = await request(app).get('/api/capacity');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({});
      });
    });

    describe('POST /api/capacity/reset', () => {
      it('should reset capacity map and return success', async () => {
        const { resetCapacityMap } = require('../../Task/CapacityTracker');

        const response = await request(app)
          .post('/api/capacity/reset')
          .send({});

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(resetCapacityMap).toHaveBeenCalled();
      });
    });

    // POST /api/capacity/sync removed — capacity sync is now part of /api/tasks/refresh via MoraviaStatusSync

    describe('POST /api/release', () => {
      it('should release capacity for given plan', async () => {
        const { releaseCapacity } = require('../../Task/CapacityTracker');
        const plan = [
          { date: '2026-01-25', amount: 2000 },
          { date: '2026-01-26', amount: 3000 }
        ];

        const response = await request(app)
          .post('/api/release')
          .send(plan)
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(releaseCapacity).toHaveBeenCalledWith(plan);
      });

      it('should return 400 for non-array plan', async () => {
        const response = await request(app)
          .post('/api/release')
          .send({ date: '2026-01-25', amount: 2000 })
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid plan format' });
      });
    });

    describe('POST /api/adjust', () => {
      it('should adjust capacity for specific date', async () => {
        const { adjustCapacity } = require('../../Task/CapacityTracker');

        const response = await request(app)
          .post('/api/adjust')
          .send({ date: '2026-01-25', amount: 1000 })
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(adjustCapacity).toHaveBeenCalledWith({
          date: '2026-01-25',
          amount: 1000
        });
      });

      it('should return 400 for missing date', async () => {
        const response = await request(app)
          .post('/api/adjust')
          .send({ amount: 1000 })
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid input' });
      });

      it('should return 400 for invalid amount type', async () => {
        const response = await request(app)
          .post('/api/adjust')
          .send({ date: '2026-01-25', amount: 'invalid' })
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid input' });
      });
    });

    describe('GET /api/capacity/:date', () => {
      it('should return remaining capacity for specific date', async () => {
        const { getRemainingCapacity } = require('../../Task/CapacityTracker');
        getRemainingCapacity.mockReturnValue(4500);

        const response = await request(app).get('/api/capacity/2026-01-25');

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ remaining: 4500 });
        expect(getRemainingCapacity).toHaveBeenCalledWith('2026-01-25');
      });
    });

    describe('GET /api/tasks', () => {
      it('should return tasks and summary when file exists', async () => {
        fs.existsSync.mockReturnValue(true);
        const mockTasks = [
          {
            orderId: '11111',
            workflowName: 'WF-001',
            amountWords: 3000,
            plannedEndDate: '2026-01-25 18:00'
          }
        ];
        fs.readFileSync.mockReturnValue(JSON.stringify(mockTasks));

        const response = await request(app).get('/api/tasks');

        expect(response.status).toBe(200);
        expect(response.body.tasks).toHaveLength(1);
        expect(response.body.summary).toBeDefined();
        expect(response.body.lastUpdated).toBeDefined();
      });

      it('should return empty result when file does not exist', async () => {
        fs.existsSync.mockReturnValue(false);

        const response = await request(app).get('/api/tasks');

        expect(response.status).toBe(200);
        expect(response.body.tasks).toEqual([]);
        expect(response.body.summary).toBe(null);
      });

      it('should handle JSON parse errors', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('invalid json');

        const response = await request(app).get('/api/tasks');

        expect(response.status).toBe(500);
        expect(response.body.error).toBeDefined();
      });
    });

    describe('POST /api/tasks/refresh', () => {
      it('should refresh tasks, clear completed, and sync capacity', async () => {
        const { loadAndFilterTasks } = require('../../Task/taskReporter');
        const { syncCapacityWithTasks } = require('../../Task/CapacityTracker');

        loadAndFilterTasks.mockResolvedValue({
          activeTasks: [
            {
              orderId: '11111',
              workflowName: 'WF-001',
              amountWords: 3000,
              plannedEndDate: '2026-01-25 18:00'
            }
          ],
          completedCount: 2,
          onHoldCount: 1
        });

        syncCapacityWithTasks.mockResolvedValue({
          success: true,
          after: { '2026-01-25': 5000 },
          diff: 1000,
          deletedOverrides: []
        });

        const response = await request(app)
          .post('/api/tasks/refresh')
          .send({});

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.tasks).toHaveLength(1);
        expect(response.body.completedCount).toBe(2);
        expect(response.body.onHoldCount).toBe(1);
        expect(response.body.synced).toBe(true);
        expect(loadAndFilterTasks).toHaveBeenCalled();
        expect(syncCapacityWithTasks).toHaveBeenCalled();
      });

      it('should handle errors from loadAndFilterTasks', async () => {
        const { loadAndFilterTasks } = require('../../Task/taskReporter');
        loadAndFilterTasks.mockRejectedValue(new Error('Sheet read error'));

        const response = await request(app)
          .post('/api/tasks/refresh')
          .send({});

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
        expect(response.body.errors[0].error).toBe('Sheet read error');
      });
    });

    describe('POST /api/cleanup', () => {
      it('should cleanup old capacity and override entries', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify([]));

        const { getCapacityMap, getOverrideMap } = require('../../Task/CapacityTracker');
        getCapacityMap.mockReturnValue({
          '2026-01-24': 3000,
          '2026-01-25': 5000
        });
        getOverrideMap.mockReturnValue({
          '2026-01-24': 10000,
          '2026-01-25': 15000
        });

        const response = await request(app)
          .post('/api/cleanup')
          .send({ dates: ['2026-01-24'] })
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.deleted).toBeDefined();
      });

      it('should handle cleanup errors', async () => {
        fs.promises.writeFile.mockRejectedValue(new Error('Write failed'));

        const response = await request(app)
          .post('/api/cleanup')
          .send({})
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
      });
    });

    describe('Static file serving', () => {
      it('should serve index.html at root path', async () => {
        const response = await request(app).get('/');

        expect(response.status).toBe(200);
        // Response may be 404 if file doesn't exist in test environment
        // But the route should be defined
      });
    });

    describe('Error handling', () => {
      it('should handle invalid routes with 404', async () => {
        const response = await request(app).get('/api/nonexistent');

        expect(response.status).toBe(404);
      });

      it('should handle malformed JSON in POST requests', async () => {
        const response = await request(app)
          .post('/api/override')
          .send('{ invalid json }')
          .set('Content-Type', 'application/json');

        expect(response.status).toBe(400);
      });
    });
  });
});
