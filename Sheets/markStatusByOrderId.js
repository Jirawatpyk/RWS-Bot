// Sheets/markStatusByOrderId.js
const { logInfo, logFail, logProgress } = require('../Logs/logger');
const config = require('../Config/configs');
const { safeUpdateSheet, safeGetSheet } = require('./sheetCircuitBreaker');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

// จำนวน row สูงสุดที่จะดึงจาก Sheet (ป้องกัน timeout/memory issues)
const MAX_ROWS = 10000;

/**
 * แปลง column letter เป็น index (A=0, B=1, ..., Z=25, AA=26, AB=27)
 * รองรับทั้ง single และ multi-letter columns
 */
function columnToIndex(col) {
  if (!col || typeof col !== 'string') return -1;
  let index = 0;
  const upper = col.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1; // 0-based
}

/**
 * Mark status by Order ID + Received Date (for precise matching when duplicate Order IDs exist)
 * @param {string} orderId - Order ID to find
 * @param {string} status - Status to set
 * @param {string} pmName - PM name (default: 'DTP')
 * @param {string|null} receivedDate - Received date from email (format: 'YYYY-MM-DD h:mm A')
 */
async function markStatusByOrderId(orderId, status, pmName = 'DTP', receivedDate = null) {
  const { sheetId: spreadsheetId, tabName, orderIdColumn, statusColumn, pmNameColumn, receivedDateColumn } =
    config.jobLinks.TrackingSheet;

  try {
    // ถ้ามี receivedDate ให้ดึงทั้ง Order ID และ Received Date มาเช็คคู่กัน
    // จำกัด row สูงสุดเพื่อป้องกัน timeout/memory issues
    const endRow = 5 + MAX_ROWS - 1;
    const range = receivedDate && receivedDateColumn
      ? `${tabName}!${orderIdColumn}5:${receivedDateColumn}${endRow}`
      : `${tabName}!${orderIdColumn}5:${orderIdColumn}${endRow}`;

    const response = await safeGetSheet({
      spreadsheetId,
      range,
      majorDimension: 'ROWS',
    });

    const rows = response.data.values || [];

    // หา row ที่ตรงกับ Order ID + Received Date (ถ้ามี)
    const rowIndex = rows.findIndex(row => {
      const sheetOrderId = (row && row[0]) ? String(row[0]).trim() : '';
      const orderIdMatch = sheetOrderId === String(orderId).trim();

      // ถ้าไม่มี receivedDate หรือไม่มี receivedDateColumn ให้เช็คแค่ Order ID
      if (!receivedDate || !receivedDateColumn) {
        return orderIdMatch;
      }

      // คำนวณ index ของ receivedDateColumn ใน row array
      // ใช้ columnToIndex() รองรับทั้ง A-Z และ AA, AB, etc.
      const colDiff = columnToIndex(receivedDateColumn) - columnToIndex(orderIdColumn);
      const sheetReceivedDate = (row && row[colDiff]) ? String(row[colDiff]).trim() : '';

      // เปรียบเทียบ receivedDate (รองรับหลาย format)
      const dateFormats = [
        'YYYY-MM-DD h:mm A',
        'YYYY-MM-DD HH:mm:ss',
        'YYYY-MM-DD HH:mm',
        'M/D/YYYY h:mm:ss A',
        'DD/MM/YYYY HH:mm'
      ];
      const emailDate = dayjs(receivedDate, dateFormats, true);
      const sheetDate = dayjs(sheetReceivedDate, dateFormats, true);

      // ถ้า parse ไม่ได้ ให้เช็คแค่ Order ID
      if (!emailDate.isValid() || !sheetDate.isValid()) {
        return orderIdMatch;
      }

      // เช็คว่าตรงกันทั้ง Order ID และ Received Date (tolerance 2 นาที)
      const dateMatch = Math.abs(emailDate.diff(sheetDate, 'minute')) <= 2;
      return orderIdMatch && dateMatch;
    });

    if (rowIndex === -1) {
      logProgress(`❌ Order ID ${orderId} (receivedDate: ${receivedDate || 'N/A'}) not found in sheet ${tabName}`);
      return false;
    }

    const realRow = rowIndex + 5;
    const statusRange = `${tabName}!${statusColumn}${realRow}`;
    const pmRange     = `${tabName}!${pmNameColumn}${realRow}`;

    await safeUpdateSheet({
      spreadsheetId,
      range: statusRange,
      values: [[status]],
      valueInputOption: 'USER_ENTERED',
    });

    await safeUpdateSheet({
      spreadsheetId,
      range: pmRange,
      values: [[pmName]],
      valueInputOption: 'USER_ENTERED',
    });

    logInfo(`✅ Updated status to "${status}" at ${tabName}!${statusColumn}${realRow} (Order: ${orderId}, Date: ${receivedDate || 'N/A'})`);
    return true;

  } catch (err) {
    logFail(`❌ Google Sheets API error: ${err.message}`);
    return false;
  }
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Mark status with retry (includes receivedDate for precise matching)
 * @param {string} orderId - Order ID to find
 * @param {string} status - Status to set
 * @param {string} pmName - PM name (default: 'DTP')
 * @param {string|null} receivedDate - Received date from email
 * @param {number} retries - Number of retries (default: 3)
 */
async function markStatusWithRetry(orderId, status, pmName = 'DTP', receivedDate = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ok = await markStatusByOrderId(orderId, status, pmName, receivedDate);
    if (ok) return true;

    logProgress(`⏳ Retry ${attempt}/${retries} – Order ID ${orderId} (Date: ${receivedDate || 'N/A'}) not yet found, waiting 1 min for Google Sheet sync...`);
    await delay(60000);
  }
  logFail(`❌ Failed to mark "${status}" for Order ID: ${orderId} (Date: ${receivedDate || 'N/A'}) after ${retries} retries`, true);
  return false;
}

module.exports = {
  markStatusByOrderId,
  markStatusWithRetry,
  columnToIndex, // export สำหรับ testing
  MAX_ROWS,
};
