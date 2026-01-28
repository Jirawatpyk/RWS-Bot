/**
 * Features/capacityLearner.js
 * Smart Capacity Learning - analyzes historical task performance
 * to suggest optimal daily word capacity adjustments.
 *
 * Singleton pattern: use `capacityLearner` export for shared instance.
 *
 * Key behaviors:
 * - Records actual task performance after completion
 * - Retains last 90 days of data (auto-trimmed on every write)
 * - Analyzes utilization trends and produces suggestions
 * - Provides dashboard-friendly summary via getSummary()
 */

const path = require('path');
const { loadJSON, saveJSON } = require('../Utils/fileUtils');
const { CAPACITY } = require('../Config/constants');
const { logInfo } = require('../Logs/logger');

// ---- Constants ----
const HISTORY_RETENTION_DAYS = 90;
const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const HIGH_UTILIZATION_THRESHOLD = 0.9;
const LOW_UTILIZATION_THRESHOLD = 0.5;

const SCALE_UP_FACTOR = 1.2;   // suggest 20% increase when utilization > 90%
const SCALE_DOWN_FACTOR = 0.8; // suggest 20% decrease when utilization < 50%

const DEFAULT_ANALYSIS_DAYS = 30;

class CapacityLearner {
  /**
   * @param {object} [options]
   * @param {string} [options.historyPath] - Override history file path (useful for tests)
   */
  constructor(options = {}) {
    this.historyPath = options.historyPath ||
      path.join(__dirname, '..', 'data', 'capacityHistory.json');
  }

  // ------------------------------------------------------------------ Record

  /**
   * Record a completed task's performance data.
   * Called from taskHandler after a task finishes successfully.
   *
   * @param {object} entry
   * @param {string} entry.date - Allocation date (YYYY-MM-DD)
   * @param {string} entry.orderId - Moravia order ID
   * @param {number} entry.allocatedWords - Words allocated to this task
   * @param {number} [entry.completionTimeMs] - Time spent processing (ms)
   */
  recordPerformance({ date, orderId, allocatedWords, completionTimeMs = 0 }) {
    if (!date || !orderId || typeof allocatedWords !== 'number') {
      logInfo('[CapacityLearner] Skipped record: missing required fields');
      return;
    }

    const history = loadJSON(this.historyPath, []);
    const now = Date.now();

    history.push({
      date,
      orderId,
      allocatedWords,
      completionTimeMs,
      timestamp: now,
    });

    // Trim entries older than retention period
    const cutoff = now - HISTORY_RETENTION_MS;
    const trimmed = history.filter(h => h.timestamp > cutoff);

    saveJSON(this.historyPath, trimmed);
    logInfo(`[CapacityLearner] Recorded: ${orderId} | ${allocatedWords} words on ${date}`);
  }

  // ------------------------------------------------------------------ Analyze

  /**
   * Analyze past N days of performance and produce utilization stats + suggestions.
   *
   * @param {number} [days=30] - Number of days to look back
   * @returns {{ period: number, totalDays: number, avgDailyWords: number,
   *             avgUtilization: number, peakDay: object|null, suggestions: object }}
   */
  analyzePastPerformance(days = DEFAULT_ANALYSIS_DAYS) {
    const history = loadJSON(this.historyPath, []);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const recent = history.filter(h => h.timestamp > cutoff);

    // Group by date
    const dailyStats = {};
    for (const entry of recent) {
      if (!dailyStats[entry.date]) {
        dailyStats[entry.date] = { allocated: 0, count: 0, orders: [] };
      }
      dailyStats[entry.date].allocated += entry.allocatedWords;
      dailyStats[entry.date].count++;
      dailyStats[entry.date].orders.push(entry.orderId);
    }

    const currentMax = CAPACITY.MAX_DAILY_WORDS;
    const dates = Object.keys(dailyStats);
    const totalDays = dates.length;

    if (totalDays === 0) {
      return {
        period: days,
        totalDays: 0,
        avgDailyWords: 0,
        avgUtilization: 0,
        confidence: 0,
        trend: 'stable',
        peakDay: null,
        slowDay: null,
        dailyBreakdown: [],
        suggestions: {},
      };
    }

    // Calculate per-day utilization and collect suggestions
    const suggestions = {};
    const dailyBreakdown = [];
    let totalWords = 0;
    let totalUtilization = 0;
    let peakDay = null;
    let slowDay = null;

    for (const [date, stats] of Object.entries(dailyStats)) {
      totalWords += stats.allocated;
      const utilization = stats.allocated / currentMax;
      totalUtilization += utilization;

      dailyBreakdown.push({
        date,
        words: stats.allocated,
        count: stats.count,
        utilization: Math.round(utilization * 100),
      });

      // Track peak day
      if (!peakDay || stats.allocated > peakDay.allocated) {
        peakDay = { date, allocated: stats.allocated, count: stats.count, utilization };
      }
      // Track slow day
      if (!slowDay || stats.allocated < slowDay.allocated) {
        slowDay = { date, allocated: stats.allocated, count: stats.count, utilization };
      }

      // Generate suggestion based on utilization
      if (utilization > HIGH_UTILIZATION_THRESHOLD) {
        suggestions[date] = {
          current: currentMax,
          suggested: Math.ceil(currentMax * SCALE_UP_FACTOR),
          utilization: Math.round(utilization * 100),
          reason: 'high_utilization',
        };
      } else if (utilization < LOW_UTILIZATION_THRESHOLD) {
        suggestions[date] = {
          current: currentMax,
          suggested: Math.ceil(currentMax * SCALE_DOWN_FACTOR),
          utilization: Math.round(utilization * 100),
          reason: 'low_utilization',
        };
      }
    }

    // Sort daily breakdown by date
    dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date));

    const avgDailyWords = Math.round(totalWords / totalDays);
    const avgUtilization = Math.round((totalUtilization / totalDays) * 100);

    // Compute trend: compare first half vs second half of data
    let trend = 'stable';
    if (dailyBreakdown.length >= 4) {
      const mid = Math.floor(dailyBreakdown.length / 2);
      const firstHalf = dailyBreakdown.slice(0, mid);
      const secondHalf = dailyBreakdown.slice(mid);
      const avgFirst = firstHalf.reduce((s, d) => s + d.words, 0) / firstHalf.length;
      const avgSecond = secondHalf.reduce((s, d) => s + d.words, 0) / secondHalf.length;
      const changeRatio = avgFirst > 0 ? (avgSecond - avgFirst) / avgFirst : 0;
      if (changeRatio > 0.1) trend = 'up';
      else if (changeRatio < -0.1) trend = 'down';
    }

    // Confidence based on data volume (0-100)
    const confidence = Math.min(100, Math.round((totalDays / days) * 100));

    return {
      period: days,
      totalDays,
      avgDailyWords,
      avgUtilization,
      confidence,
      trend,
      peakDay,
      slowDay,
      dailyBreakdown,
      suggestions,
    };
  }

  // ------------------------------------------------------------------ Summary

  /**
   * Dashboard-friendly summary of capacity learning insights.
   *
   * @returns {{ lastUpdated: string, historySize: number, analysis: object,
   *             recommendation: string }}
   */
  getSummary() {
    const history = loadJSON(this.historyPath, []);
    const analysis = this.analyzePastPerformance(DEFAULT_ANALYSIS_DAYS);

    const recommendation = this._deriveRecommendation(analysis);

    return {
      lastUpdated: new Date().toISOString(),
      historySize: history.length,
      retentionDays: HISTORY_RETENTION_DAYS,
      currentMaxDaily: CAPACITY.MAX_DAILY_WORDS,
      analysis,
      recommendation,
    };
  }

  // ------------------------------------------------------------------ Private

  /**
   * Derive a human-readable recommendation from analysis results.
   * @param {object} analysis - Result from analyzePastPerformance
   * @returns {string} Recommendation text
   */
  _deriveRecommendation(analysis) {
    if (analysis.totalDays === 0) {
      return 'No data yet. Keep running tasks to build a performance baseline.';
    }

    if (analysis.totalDays < 7) {
      return `Only ${analysis.totalDays} days of data. Need at least 7 days for reliable suggestions.`;
    }

    const highCount = Object.values(analysis.suggestions)
      .filter(s => s.reason === 'high_utilization').length;
    const lowCount = Object.values(analysis.suggestions)
      .filter(s => s.reason === 'low_utilization').length;

    if (highCount > lowCount && highCount > analysis.totalDays * 0.3) {
      const suggested = Math.ceil(CAPACITY.MAX_DAILY_WORDS * SCALE_UP_FACTOR);
      return `Frequent high utilization (${highCount}/${analysis.totalDays} days >90%). ` +
        `Consider increasing MAX_DAILY_WORDS from ${CAPACITY.MAX_DAILY_WORDS} to ${suggested}.`;
    }

    if (lowCount > highCount && lowCount > analysis.totalDays * 0.3) {
      const suggested = Math.ceil(CAPACITY.MAX_DAILY_WORDS * SCALE_DOWN_FACTOR);
      return `Frequent low utilization (${lowCount}/${analysis.totalDays} days <50%). ` +
        `Consider decreasing MAX_DAILY_WORDS from ${CAPACITY.MAX_DAILY_WORDS} to ${suggested}.`;
    }

    return `Capacity is well-balanced (avg ${analysis.avgUtilization}% utilization over ${analysis.totalDays} days). No changes recommended.`;
  }
}

// Singleton instance for production use
const capacityLearner = new CapacityLearner();

module.exports = { CapacityLearner, capacityLearner };
