/**
 * Tests for Features/capacityLearner.js
 * Covers: recordPerformance, analyzePastPerformance, getSummary, 90-day trimming
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock logger to avoid console noise
jest.mock('../../Logs/logger', () => ({
  logInfo: jest.fn(),
  logSuccess: jest.fn(),
  logFail: jest.fn(),
  logProgress: jest.fn(),
}));

// Mock constants with known values
jest.mock('../../Config/constants', () => ({
  CAPACITY: {
    MAX_DAILY_WORDS: 12000,
    URGENT_DAYS_THRESHOLD: 3,
    URGENT_HOURS_THRESHOLD: 6,
    SEEN_UIDS_LIMIT: 1000,
    WORD_QUOTA_LIMIT: 8000,
    WORD_QUOTA_STEP: 2000,
    WORD_QUOTA_RESET_HOUR: 18,
  },
}));

const { CapacityLearner } = require('../../Features/capacityLearner');

describe('CapacityLearner', () => {
  let learner;
  let tempDir;
  let historyPath;

  beforeEach(() => {
    // Use a unique temp file per test to avoid interference
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-learner-'));
    historyPath = path.join(tempDir, 'capacityHistory.json');
    learner = new CapacityLearner({ historyPath });
  });

  afterEach(() => {
    // Cleanup temp files
    try {
      if (fs.existsSync(historyPath)) fs.unlinkSync(historyPath);
      fs.rmdirSync(tempDir);
    } catch { /* ignore */ }
  });

  // =========================================================== recordPerformance

  describe('recordPerformance', () => {
    test('should write a valid entry to history file', () => {
      learner.recordPerformance({
        date: '2026-01-20',
        orderId: 'ORD-001',
        allocatedWords: 3000,
        completionTimeMs: 5000,
      });

      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        date: '2026-01-20',
        orderId: 'ORD-001',
        allocatedWords: 3000,
        completionTimeMs: 5000,
      });
      expect(history[0].timestamp).toBeDefined();
    });

    test('should append multiple entries', () => {
      learner.recordPerformance({ date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 3000 });
      learner.recordPerformance({ date: '2026-01-20', orderId: 'ORD-002', allocatedWords: 2000 });
      learner.recordPerformance({ date: '2026-01-21', orderId: 'ORD-003', allocatedWords: 4000 });

      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(history).toHaveLength(3);
    });

    test('should default completionTimeMs to 0 when not provided', () => {
      learner.recordPerformance({ date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 1000 });

      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(history[0].completionTimeMs).toBe(0);
    });

    test('should skip record when required fields are missing', () => {
      learner.recordPerformance({ date: '2026-01-20', orderId: null, allocatedWords: 1000 });
      learner.recordPerformance({ date: null, orderId: 'ORD-001', allocatedWords: 1000 });
      learner.recordPerformance({ date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 'invalid' });

      // File should not exist or be empty array
      if (fs.existsSync(historyPath)) {
        const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        expect(history).toHaveLength(0);
      }
    });

    test('should trim entries older than 90 days', () => {
      // Seed with an old entry (91 days ago)
      const oldTimestamp = Date.now() - 91 * 24 * 60 * 60 * 1000;
      const seedData = [
        { date: '2025-10-01', orderId: 'OLD-001', allocatedWords: 5000, completionTimeMs: 0, timestamp: oldTimestamp },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      // Record a new entry
      learner.recordPerformance({ date: '2026-01-20', orderId: 'NEW-001', allocatedWords: 2000 });

      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      // Old entry should be trimmed
      expect(history).toHaveLength(1);
      expect(history[0].orderId).toBe('NEW-001');
    });

    test('should keep entries within 90 days', () => {
      const recentTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const seedData = [
        { date: '2025-12-28', orderId: 'RECENT-001', allocatedWords: 4000, completionTimeMs: 0, timestamp: recentTimestamp },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      learner.recordPerformance({ date: '2026-01-20', orderId: 'NEW-001', allocatedWords: 2000 });

      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(history).toHaveLength(2);
    });
  });

  // =========================================================== analyzePastPerformance

  describe('analyzePastPerformance', () => {
    test('should return empty analysis when no data exists', () => {
      const analysis = learner.analyzePastPerformance(30);

      expect(analysis).toEqual({
        period: 30,
        totalDays: 0,
        avgDailyWords: 0,
        avgUtilization: 0,
        peakDay: null,
        suggestions: {},
      });
    });

    test('should calculate correct daily stats', () => {
      const now = Date.now();
      const seedData = [
        { date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 5000, completionTimeMs: 3000, timestamp: now - 1000 },
        { date: '2026-01-20', orderId: 'ORD-002', allocatedWords: 3000, completionTimeMs: 2000, timestamp: now - 500 },
        { date: '2026-01-21', orderId: 'ORD-003', allocatedWords: 8000, completionTimeMs: 5000, timestamp: now },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const analysis = learner.analyzePastPerformance(30);

      expect(analysis.totalDays).toBe(2);
      // Day 1: 8000 words, Day 2: 8000 words -> avg 8000
      expect(analysis.avgDailyWords).toBe(8000);
      expect(analysis.peakDay).toBeDefined();
      // Both days have 8000 words, peak should be one of them
      expect(analysis.peakDay.allocated).toBe(8000);
    });

    test('should suggest increase for high utilization (>90%)', () => {
      const now = Date.now();
      // 11000 / 12000 = 91.7% utilization
      const seedData = [
        { date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 11000, completionTimeMs: 0, timestamp: now },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const analysis = learner.analyzePastPerformance(30);

      expect(analysis.suggestions['2026-01-20']).toBeDefined();
      expect(analysis.suggestions['2026-01-20'].reason).toBe('high_utilization');
      expect(analysis.suggestions['2026-01-20'].suggested).toBe(Math.ceil(12000 * 1.2));
    });

    test('should suggest decrease for low utilization (<50%)', () => {
      const now = Date.now();
      // 4000 / 12000 = 33.3% utilization
      const seedData = [
        { date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 4000, completionTimeMs: 0, timestamp: now },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const analysis = learner.analyzePastPerformance(30);

      expect(analysis.suggestions['2026-01-20']).toBeDefined();
      expect(analysis.suggestions['2026-01-20'].reason).toBe('low_utilization');
      expect(analysis.suggestions['2026-01-20'].suggested).toBe(Math.ceil(12000 * 0.8));
    });

    test('should not suggest for balanced utilization (50%-90%)', () => {
      const now = Date.now();
      // 7000 / 12000 = 58.3%
      const seedData = [
        { date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 7000, completionTimeMs: 0, timestamp: now },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const analysis = learner.analyzePastPerformance(30);

      expect(analysis.suggestions['2026-01-20']).toBeUndefined();
    });

    test('should only include entries within the specified period', () => {
      const now = Date.now();
      const seedData = [
        { date: '2025-12-01', orderId: 'OLD-001', allocatedWords: 5000, completionTimeMs: 0, timestamp: now - 60 * 24 * 60 * 60 * 1000 },
        { date: '2026-01-20', orderId: 'NEW-001', allocatedWords: 6000, completionTimeMs: 0, timestamp: now },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      // Only look at last 7 days
      const analysis = learner.analyzePastPerformance(7);

      expect(analysis.totalDays).toBe(1);
      expect(analysis.avgDailyWords).toBe(6000);
    });

    test('should calculate avgUtilization as percentage', () => {
      const now = Date.now();
      // Day 1: 6000/12000 = 50%, Day 2: 12000/12000 = 100% -> avg = 75%
      const seedData = [
        { date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 6000, completionTimeMs: 0, timestamp: now - 1000 },
        { date: '2026-01-21', orderId: 'ORD-002', allocatedWords: 12000, completionTimeMs: 0, timestamp: now },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const analysis = learner.analyzePastPerformance(30);

      expect(analysis.avgUtilization).toBe(75);
    });
  });

  // =========================================================== getSummary

  describe('getSummary', () => {
    test('should return a complete summary object', () => {
      const summary = learner.getSummary();

      expect(summary).toHaveProperty('lastUpdated');
      expect(summary).toHaveProperty('historySize');
      expect(summary).toHaveProperty('retentionDays', 90);
      expect(summary).toHaveProperty('currentMaxDaily', 12000);
      expect(summary).toHaveProperty('analysis');
      expect(summary).toHaveProperty('recommendation');
    });

    test('should provide appropriate recommendation with no data', () => {
      const summary = learner.getSummary();

      expect(summary.recommendation).toContain('No data yet');
    });

    test('should provide appropriate recommendation with insufficient data', () => {
      const now = Date.now();
      // Only 3 days of data
      const seedData = [
        { date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 11000, completionTimeMs: 0, timestamp: now - 2 * 24 * 60 * 60 * 1000 },
        { date: '2026-01-21', orderId: 'ORD-002', allocatedWords: 11500, completionTimeMs: 0, timestamp: now - 1 * 24 * 60 * 60 * 1000 },
        { date: '2026-01-22', orderId: 'ORD-003', allocatedWords: 10800, completionTimeMs: 0, timestamp: now },
      ];
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const summary = learner.getSummary();

      expect(summary.recommendation).toContain('Only 3 days');
      expect(summary.recommendation).toContain('at least 7 days');
    });

    test('should recommend increase when many high-utilization days', () => {
      const now = Date.now();
      // 8 days, all >90% utilization -> more than 30% are high
      const seedData = [];
      for (let i = 0; i < 8; i++) {
        seedData.push({
          date: `2026-01-${String(15 + i).padStart(2, '0')}`,
          orderId: `ORD-${i}`,
          allocatedWords: 11000 + i * 100, // 11000-11700 (all >90%)
          completionTimeMs: 0,
          timestamp: now - i * 24 * 60 * 60 * 1000,
        });
      }
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const summary = learner.getSummary();

      expect(summary.recommendation).toContain('high utilization');
      expect(summary.recommendation).toContain('increasing');
    });

    test('should recommend decrease when many low-utilization days', () => {
      const now = Date.now();
      // 8 days, all <50% utilization
      const seedData = [];
      for (let i = 0; i < 8; i++) {
        seedData.push({
          date: `2026-01-${String(15 + i).padStart(2, '0')}`,
          orderId: `ORD-${i}`,
          allocatedWords: 3000 + i * 100, // 3000-3700 (all <50%)
          completionTimeMs: 0,
          timestamp: now - i * 24 * 60 * 60 * 1000,
        });
      }
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const summary = learner.getSummary();

      expect(summary.recommendation).toContain('low utilization');
      expect(summary.recommendation).toContain('decreasing');
    });

    test('should recommend no changes when balanced', () => {
      const now = Date.now();
      // 8 days, all between 50%-90%
      const seedData = [];
      for (let i = 0; i < 8; i++) {
        seedData.push({
          date: `2026-01-${String(15 + i).padStart(2, '0')}`,
          orderId: `ORD-${i}`,
          allocatedWords: 7000 + i * 100, // 7000-7700 (all balanced)
          completionTimeMs: 0,
          timestamp: now - i * 24 * 60 * 60 * 1000,
        });
      }
      fs.writeFileSync(historyPath, JSON.stringify(seedData));

      const summary = learner.getSummary();

      expect(summary.recommendation).toContain('well-balanced');
      expect(summary.recommendation).toContain('No changes recommended');
    });
  });

  // =========================================================== Edge Cases

  describe('Edge Cases', () => {
    test('should handle corrupted history file gracefully', () => {
      fs.writeFileSync(historyPath, 'not valid json{{{');

      // Should not throw, returns empty analysis
      const analysis = learner.analyzePastPerformance(30);
      expect(analysis.totalDays).toBe(0);

      // Record should still work (overwrites corrupt file)
      learner.recordPerformance({ date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 5000 });
      const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      expect(history).toHaveLength(1);
    });

    test('should handle missing history file gracefully', () => {
      // Don't create the file
      const analysis = learner.analyzePastPerformance(30);
      expect(analysis.totalDays).toBe(0);
    });

    test('should create data directory if it does not exist', () => {
      const deepPath = path.join(tempDir, 'sub', 'deep', 'capacityHistory.json');
      const deepLearner = new CapacityLearner({ historyPath: deepPath });

      deepLearner.recordPerformance({ date: '2026-01-20', orderId: 'ORD-001', allocatedWords: 5000 });

      expect(fs.existsSync(deepPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(deepPath);
      fs.rmdirSync(path.join(tempDir, 'sub', 'deep'));
      fs.rmdirSync(path.join(tempDir, 'sub'));
    });
  });
});
