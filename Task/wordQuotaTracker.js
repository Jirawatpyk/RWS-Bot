const path = require('path');
const fs = require('fs');
const { logInfo, logFail, logProgress } = require('../Logs/logger');

const QUOTA_FILE = path.join(__dirname, 'wordQuota.json');
const LIMIT = 8000;
const STEP = 2000;

function getTimeWindowKey() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < 18) {
    now.setDate(now.getDate() - 1);
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}-18h`;
}

function loadQuota() {
  try {
    return JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function saveQuota(data, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      fs.writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2));
      return true;
    } catch (err) {
      if (attempt === retries) {
        logFail(`❌ Failed to save wordQuota.json after ${retries} attempts: ${err.message}`);
        return false;
      }
      // รอสักครู่แล้ว retry (file อาจถูก lock ชั่วคราว)
      await delay(attempt * 100);
    }
  }
}

async function trackAmountWords(amount, notifyFn = console.log) {
  if (!amount || amount < 0) return;

  const key = getTimeWindowKey();
  const data = loadQuota();
  const alertedSteps = data[`${key}_alertedSteps`] || [];

  data[key] = (data[key] || 0) + amount;
  await saveQuota(data);

  const currentTotal = data[key];
  logInfo(`🧮 Word count tracked: total ${currentTotal} words (added ${amount})`);
  const targetStep = Math.floor((currentTotal - LIMIT) / STEP);

  for (let i = 0; i <= targetStep; i++) {
    const stepThreshold = LIMIT + i * STEP;
    if (!alertedSteps.includes(stepThreshold) && currentTotal >= stepThreshold) {
      await notifyFn(`⚠️ [Auto RWS] Word count alert: ${currentTotal} words reached (threshold ${stepThreshold})`);
      alertedSteps.push(stepThreshold);
    }
  }

  data[`${key}_alertedSteps`] = alertedSteps;
  await saveQuota(data);
}

async function resetIfNewDay() {
  const data = loadQuota();
  const currentKey = getTimeWindowKey();

  Object.keys(data).forEach(key => {
    if (key.endsWith('-18h') && key !== currentKey) {
      delete data[key];
      delete data[`${key}_alertedSteps`];
    }
  });

  await saveQuota(data);
}

module.exports = {
  trackAmountWords,
  resetIfNewDay
};
