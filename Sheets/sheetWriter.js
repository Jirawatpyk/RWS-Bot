const dayjs = require('dayjs');
const { logSuccess, logFail } = require('../Logs/logger');
const { DEFAULT_SHEET_KEY, jobLinks } = require('../Config/configs');
const { safeAppendToSheet } = require('./sheetCircuitBreaker');

async function appendStatusToMainSheet({ url, status, reason, timestamp, sheetKey }) {
  const usedSheetKey = sheetKey || DEFAULT_SHEET_KEY;
  const config = jobLinks[usedSheetKey];

  if (!config) throw new Error(`❌ MainSheet config not found`);

  const range = `${config.tabName}!${config.LinksOrderColumn}:${config.TimestampColumn}`;
  const values = [[url, status, reason, timestamp || dayjs().format('YYYY-MM-DD HH:mm:ss')]];

  try {
    await safeAppendToSheet({
      spreadsheetId: config.sheetId,
      range,
      values,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
    });

    logSuccess(`📝 Append to ${usedSheetKey} successful.`);
  } catch (err) {
    logFail(`❌ Append failed: ${err.message}`, true);
  }
}

module.exports = {
  appendStatusToMainSheet
};
