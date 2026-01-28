const path = require('path');
const fs = require('fs');
const { logInfo, logFail, logProgress } = require('../Logs/logger');
const { CAPACITY, RETRIES, TIMEOUTS } = require('../Config/constants');
const { loadJSON, saveJSON } = require('../Utils/fileUtils');

const QUOTA_FILE = path.join(__dirname, 'wordQuota.json');
const LIMIT = CAPACITY.WORD_QUOTA_LIMIT;
const STEP = CAPACITY.WORD_QUOTA_STEP;
const RESET_HOUR = CAPACITY.WORD_QUOTA_RESET_HOUR;

function getTimeWindowKey() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < RESET_HOUR) {
    now.setDate(now.getDate() - 1);
  }
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}-${RESET_HOUR}h`;
}

function loadQuota() {
  return loadJSON(QUOTA_FILE, {});
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function saveQuota(data, retries = RETRIES.FILE_WRITE) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      saveJSON(QUOTA_FILE, data);
      return true;
    } catch (err) {
      if (attempt === retries) {
        logFail(`❌ Failed to save wordQuota.json after ${retries} attempts: ${err.message}`);
        return false;
      }
      // รอสักครู่แล้ว retry (file อาจถูก lock ชั่วคราว)
      await delay(attempt * TIMEOUTS.SHORT_DELAY);
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
    if (key.endsWith(`-${RESET_HOUR}h`) && key !== currentKey) {
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
