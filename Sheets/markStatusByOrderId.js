// Sheets/markStatusByOrderId.js
const { google } = require('googleapis');
const { auth } = require('../Google/auth');
const { logInfo, logFail, logProgress } = require('../Logs/logger');
const config = require('../Config/configs');

async function markStatusByOrderId(orderId, status, pmName = 'DTP') {
  const sheets = google.sheets({ version: 'v4', auth });
  const { sheetId: spreadsheetId, tabName, orderIdColumn, statusColumn, pmNameColumn } =
    config.jobLinks.TrackingSheet;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tabName}!${orderIdColumn}5:${orderIdColumn}`,
      majorDimension: 'ROWS'
    });

    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => {
      const v = (row && row[0]) ? String(row[0]).trim() : '';
      return v === String(orderId).trim();
    });

    if (rowIndex === -1) {
      logProgress(`❌ Order ID ${orderId} not found in sheet ${tabName}`);
      return false;
    }

    const realRow = rowIndex + 5;
    const statusRange = `${tabName}!${statusColumn}${realRow}`;
    const pmRange     = `${tabName}!${pmNameColumn}${realRow}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: statusRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] }
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: pmRange,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[pmName]] }
    });

    logInfo(`✅ Updated status to "${status}" at ${tabName}!${statusColumn}${realRow}`);
    return true;

  } catch (err) {
    logFail(`❌ Google Sheets API error: ${err.message}`);
    return false;
  }
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function markStatusWithRetry(orderId, status, pmName = 'DTP', retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ok = await markStatusByOrderId(orderId, status, pmName);
    if (ok) return true;

    logProgress(`⏳ Retry ${attempt}/${retries} – Order ID ${orderId} not yet found, waiting 1 min for Google Sheet sync...`);
    await delay(60000);
  }
  logFail(`❌ Failed to mark "${status}" for Order ID: ${orderId} after ${retries} retries`, true);
  return false;
}

module.exports = {
  markStatusByOrderId,
  markStatusWithRetry,
};
