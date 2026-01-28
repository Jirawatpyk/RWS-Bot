// ✅ CapacityTracker.js — now supports REST API updates from Dashboard (with capacity/override editor)

const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const isBusinessDay = require('./isBusinessDay');
const { maxDailyCapacity: MAX_DAILY_CAPACITY } = require('../Config/configs');
const { CAPACITY } = require('../Config/constants');

dayjs.extend(isSameOrBefore);
dayjs.extend(customParseFormat);
let capacityMap = {};

function loadDailyOverride() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../public/dailyOverride.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveDailyOverride(overrideMap) {
  fs.writeFileSync(path.join(__dirname, '../public/dailyOverride.json'), JSON.stringify(overrideMap, null, 2));
}

function loadCapacityMap() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../public/capacity.json'), 'utf-8');
    capacityMap = JSON.parse(raw);
  } catch {
    capacityMap = {};
  }
}

function saveCapacityMap() {
  fs.writeFileSync(path.join(__dirname, '../public/capacity.json'), JSON.stringify(capacityMap, null, 2));
}

function getOverrideMap() {
  return loadDailyOverride();
}
function getCapacityMap() {
  loadCapacityMap();
  return capacityMap;
}

function getAvailableDates(requiredWords, deadlineStr, excludeToday = false) {
  loadCapacityMap();
  const overrideMap = loadDailyOverride();
  const today = dayjs().startOf('day');
  const deadline = dayjs(deadlineStr, [
    'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'YYYY-MM-DD HH:mm',
    'DD.MM.YYYY h:mm A', 'DD/MM/YYYY h:mm A', 'DD-MM-YYYY h:mm A'
  ], true);

  // Validate deadline
  if (!deadline.isValid()) {
    console.error('[CapacityTracker] Invalid deadline format:', deadlineStr);
    return [];
  }

  let businessDates = [];
  let cursor = today;

  while (cursor.isSameOrBefore(deadline, 'day')) {
    if (isBusinessDay(cursor)) {  // isBusinessDay already checks weekends
      businessDates.push(cursor.format('YYYY-MM-DD'));
    }
    cursor = cursor.add(1, 'day');
  }

  // Filter by deadline and excludeToday flag
  const todayStr = today.format('YYYY-MM-DD');
  businessDates = businessDates.filter(d =>
    dayjs(d).isSameOrBefore(deadline, 'day') &&
    (!excludeToday || d !== todayStr)
  );

  businessDates.sort();

  const isUrgent = businessDates.length < CAPACITY.URGENT_DAYS_THRESHOLD;
  const allocationPlan = [];
  let remaining = requiredWords;

  if (isUrgent) {
    // 🚨 URGENT MODE: อัดให้มากที่สุดตามลำดับวัน
    for (const dateStr of businessDates) {
      const used = capacityMap[dateStr] || 0;
      const max = overrideMap[dateStr] || MAX_DAILY_CAPACITY;
      const spaceLeft = max - used;
      if (spaceLeft <= 0) continue;
      const toUse = Math.min(spaceLeft, remaining);
      if (toUse > 0) {
        allocationPlan.push({ date: dateStr, amount: toUse });
        remaining -= toUse;
        if (remaining <= 0) break;
      }
    }
  } else {
    // ✅ BALANCED MODE: แบ่งเท่า ๆ กันก่อน แล้วค่อยเติม
    const perDay = Math.ceil(requiredWords / businessDates.length);

    // 📦 รอบแรก: ใส่ perDay หรือเท่าที่ใส่ได้
    for (const dateStr of businessDates) {
      const used = capacityMap[dateStr] || 0;
      const max = overrideMap[dateStr] || MAX_DAILY_CAPACITY;
      const spaceLeft = max - used;
      if (spaceLeft <= 0) continue;
      const toUse = Math.min(spaceLeft, remaining, perDay);
      if (toUse > 0) {
        allocationPlan.push({ date: dateStr, amount: toUse });
        remaining -= toUse;
      }
    }

    // 🔁 รอบสอง: เติมคำที่เหลือให้วันไหนว่าง (เรียงจากวันที่เหลือ space เยอะสุด → วันก่อนหน้า)
    if (remaining > 0) {
      const sortedBySpace = businessDates
        .map(dateStr => {
          const used = capacityMap[dateStr] || 0;
          const plan = allocationPlan.find(p => p.date === dateStr);
          const alreadyUsed = plan ? plan.amount : 0;
          const max = overrideMap[dateStr] || MAX_DAILY_CAPACITY;
          const spaceLeft = max - used - alreadyUsed;
          return { date: dateStr, spaceLeft };
        })
        .filter(entry => entry.spaceLeft > 0)
        .sort((a, b) => {
          if (b.spaceLeft !== a.spaceLeft) return b.spaceLeft - a.spaceLeft;
          return a.date.localeCompare(b.date); // ถ้า space เท่ากัน → เลือกวันก่อน
        });

      for (const { date: dateStr, spaceLeft } of sortedBySpace) {
        const toAdd = Math.min(spaceLeft, remaining);
        if (toAdd <= 0) continue;

        const existing = allocationPlan.find(p => p.date === dateStr);
        if (existing) {
          existing.amount += toAdd;
        } else {
          allocationPlan.push({ date: dateStr, amount: toAdd });
        }

        remaining -= toAdd;
        if (remaining <= 0) break;
      }
    }
  }

  allocationPlan.sort((a, b) => a.date.localeCompare(b.date));
  return allocationPlan;
}

function applyCapacity(plan) {
  loadCapacityMap();  // Load latest before modifying
  for (const { date, amount } of plan) {
    if (!capacityMap[date]) capacityMap[date] = 0;
    capacityMap[date] += amount;
  }
  saveCapacityMap();
}

function getReport() {
  return Object.entries(capacityMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount]) => `${date}: ${amount} words`)
    .join('\n');
}

function getRemainingCapacity(date) {
  loadCapacityMap();
  const overrideMap = loadDailyOverride();
  const max = overrideMap[date] || MAX_DAILY_CAPACITY;
  const used = capacityMap[date] || 0;
  return Math.max(0, max - used);
}

function adjustCapacity({ date, amount }) {
  loadCapacityMap();  // Load latest before modifying
  if (!capacityMap[date]) capacityMap[date] = 0;
  capacityMap[date] = Math.max(0, capacityMap[date] + amount);
  saveCapacityMap();
}

function releaseCapacity(plan) {
  loadCapacityMap();  // โหลดข้อมูลล่าสุดก่อน release
  for (const { date, amount } of plan) {
    const used = capacityMap[date] || 0;
    const safeRelease = Math.min(amount, used);
    if (safeRelease > 0) {
      capacityMap[date] = used - safeRelease;
    }
  }
  saveCapacityMap();
}

function resetCapacityMap() {
  capacityMap = {};
  saveCapacityMap();
}

/**
 * Sync capacity กับ tasks ใน acceptedTasks.json
 * คำนวณ capacity ใหม่จาก allocationPlan ของทุก tasks
 * และ cleanup dailyOverride วันเก่า
 */
function syncCapacityWithTasks() {
  const acceptedTasksPath = path.join(__dirname, 'acceptedTasks.json');
  const today = dayjs().format('YYYY-MM-DD');

  let tasks = [];
  try {
    if (fs.existsSync(acceptedTasksPath)) {
      const raw = fs.readFileSync(acceptedTasksPath, 'utf-8');
      tasks = JSON.parse(raw);

      // Validate tasks is an array
      if (!Array.isArray(tasks)) {
        console.error('[CapacityTracker] acceptedTasks.json is not an array');
        return { success: false, error: 'Invalid tasks format: expected array' };
      }
    }
  } catch (err) {
    console.error('❌ Failed to read acceptedTasks.json:', err.message);
    return { success: false, error: err.message };
  }

  // คำนวณ capacity ใหม่จาก allocationPlan
  loadCapacityMap();
  const beforeCapacity = { ...capacityMap };

  const newCapacity = {};
  for (const task of tasks) {
    if (task.allocationPlan && Array.isArray(task.allocationPlan)) {
      for (const plan of task.allocationPlan) {
        newCapacity[plan.date] = (newCapacity[plan.date] || 0) + plan.amount;
      }
    }
  }

  // อัปเดต capacityMap
  capacityMap = newCapacity;
  saveCapacityMap();

  // Cleanup dailyOverride วันเก่า (< today)
  const overrideMap = loadDailyOverride();
  const beforeOverride = { ...overrideMap };
  let deletedOverrides = [];

  for (const date of Object.keys(overrideMap)) {
    if (date < today) {
      delete overrideMap[date];
      deletedOverrides.push(date);
    }
  }

  if (deletedOverrides.length > 0) {
    saveDailyOverride(overrideMap);
  }

  const totalBefore = Object.values(beforeCapacity).reduce((a, b) => a + b, 0);
  const totalAfter = Object.values(newCapacity).reduce((a, b) => a + b, 0);

  return {
    success: true,
    taskCount: tasks.length,
    before: beforeCapacity,
    after: newCapacity,
    totalBefore,
    totalAfter,
    diff: totalAfter - totalBefore,
    deletedOverrides
  };
}

module.exports = {
  getAvailableDates,
  applyCapacity,
  releaseCapacity,
  adjustCapacity,
  getReport,
  getRemainingCapacity,
  resetCapacityMap,
  syncCapacityWithTasks,
  loadDailyOverride,
  saveDailyOverride,
  loadCapacityMap,
  getCapacityMap,
  getOverrideMap
};
