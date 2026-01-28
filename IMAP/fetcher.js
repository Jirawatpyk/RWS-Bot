const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
const { loadLastSeenUidFromFile, saveLastSeenUid } = require('./uidStore');
const { loadSeenUids, saveSeenUids } = require('./seenUidsStore');
const { logInfo, logSuccess, logFail } = require('../Logs/logger');
const { retry } = require('./retryHandler');
const { TIMEOUTS, CAPACITY, RETRIES } = require('../Config/constants');

// Health monitor instance - set externally via setHealthMonitor()
let healthMonitor = null;

const seenUidsMap = new Map();
const lastSeenUidMap = new Map();
const isFetchingMap = new Map();
const lastHealthCheckMap = new Map();
const HEALTH_CHECK_INTERVAL = TIMEOUTS.IMAP_HEALTH_CHECK_INTERVAL;
const HEALTH_CHECK_TIMEOUT = TIMEOUTS.IMAP_HEALTH_CHECK_TIMEOUT;

// ===== ✅ 1. Email Content Parser Class (ไม่เปลี่ยน) =====
class EmailContentParser {
  constructor() {
    // Pre-compiled regex patterns
    this.patterns = {
      orderId: /\[#(\d+)\]/,
      amountWords: /amountWords\s*[:：]?\s*['"]?([0-9.,]+)/i,
      plannedEndDate: /plannedEndDate\s*[:：]?\s*['"]?([0-9./:\sAPMapm]+)['"]?/i,
      moraviaLinks: /https:\/\/projects\.moravia\.com\/Task\/[^\s<>"']*\/detail\/notification\?command=Accept/g,
      status: /Status\s*[:：]?\s*['"]?([A-Za-z ]+)['"]?/i
    };
  }

  parseEmail(content, rawText) {
    // Single cheerio instance per email
    const $ = cheerio.load(content);
    
    return {
      status: this.extractStatus(content, $),
      orderId: this.extractOrderId(rawText),
      workflowName: this.extractWorkflowName($),
      metrics: this.extractMetrics(content, $),
      moraviaLinks: this.extractMoraviaLinks(content)
    };
  }

  extractStatus(content, $) {
    const domText = $('td:contains("Status")').next().text().trim();
    if (domText) return domText;

    const match = content.match(this.patterns.status);
    return match ? match[1].trim() : null;
  }

  extractOrderId(rawText) {
    const match = rawText.match(this.patterns.orderId);
    return match ? match[1] : null;
  }

  extractWorkflowName($) {
    return $('td:contains("Workflow name")').next().text().trim() || null;
  }

  extractMetrics(content, $) {
    // Try structured data first
    let amountsText = $('td:contains("Amounts")').next().text();
    let deadlineText = $('td:contains("Planned end")').next().text();

    // Fallback to regex
    if (!amountsText) {
      const match = content.match(this.patterns.amountWords);
      amountsText = match ? match[1] : null;
    }
    if (!deadlineText) {
      const match = content.match(this.patterns.plannedEndDate);
      deadlineText = match ? match[1] : null;
    }

    return {
      amountWords: amountsText ? parseFloat(amountsText.replace(/[^0-9.]/g, '')) : null,
      plannedEndDate: this.normalizeDate(deadlineText)
    };
  }

  extractMoraviaLinks(content) {
    return [...(content.match(this.patterns.moraviaLinks) || [])];
  }

  normalizeDate(dateText) {
    if (!dateText) return null;
    
    const cleaned = dateText.replace(/\(.*?\)/g, '').trim();
    const parsed = dayjs(cleaned, [
      'DD.MM.YYYY h:mm A',
      'DD.MM.YYYY h:mmA',
      'DD/MM/YYYY h:mm A',
      'DD-MM-YYYY h:mm A',
      'YYYY-MM-DD HH:mm',
      'YYYY-MM-DD',
      'DD/MM/YYYY',
      'DD-MM-YYYY',
      'DD.MM.YYYY'
    ], true);
    
    return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : null;
  }
}

/**
 * Inject health monitor instance (called from imapClient.js to avoid circular dependency)
 * @param {import('./IMAPHealthMonitor').IMAPHealthMonitor} monitor
 */
function setHealthMonitor(monitor) {
  healthMonitor = monitor;
}

// ===== Smart Health Check per mailbox =====
async function performHealthCheckIfNeeded(client, mailboxName) {
  const now = Date.now();
  const lastCheck = lastHealthCheckMap.get(mailboxName) || 0;
  const elapsed = now - lastCheck;

  // --- ยังไม่ถึงรอบเช็ค ---
  if (elapsed <= HEALTH_CHECK_INTERVAL) {
    const nextCheckIn = Math.round((HEALTH_CHECK_INTERVAL - elapsed) / 1000);
    logInfo(`⚡ [${mailboxName}] Health check not needed (next in ${nextCheckIn}s)`);
    return false;
  }

  const healthCheckStart = Date.now();

  // --- ป้องกัน noop ค้าง ---
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`Health check timeout after ${HEALTH_CHECK_TIMEOUT}ms`)),
      HEALTH_CHECK_TIMEOUT
    );
  });

  // ✅ กันเคส timeout ชนะ แล้ว noop มา reject ทีหลัง → ไม่ให้เกิด unhandled rejection
  const healthCheckPromise = client.noop().catch(() => {});

  try {
    await Promise.race([healthCheckPromise, timeoutPromise]);

    const dur = Date.now() - healthCheckStart;
    lastHealthCheckMap.set(mailboxName, now);

    logInfo(
      `💚 [${mailboxName}] Connection healthy (${dur}ms) | Interval: ${HEALTH_CHECK_INTERVAL/1000}s | Timeout: ${HEALTH_CHECK_TIMEOUT/1000}s`
    );
    // Report healthy status to monitor
    if (healthMonitor) healthMonitor.recordHealthCheck(mailboxName, true);
    return true;
  } catch (err) {
    const dur = Date.now() - healthCheckStart;

    // ❌ ไม่ throw ขึ้นไป ให้ log ไว้เฉย ๆ
    logFail(`⚠️ [${mailboxName}] Health check failed (continuing)`, {
      error: err.message,
      duration: dur,
      timeSinceLastCheck: Math.round(elapsed / 1000),
      timeout: HEALTH_CHECK_TIMEOUT,
      interval: HEALTH_CHECK_INTERVAL,
    });

    // Report failure to monitor
    if (healthMonitor) healthMonitor.recordHealthCheck(mailboxName, false, err);

    lastHealthCheckMap.set(mailboxName, now); // กัน spam checks
    logInfo(`🔧 [${mailboxName}] Continuing with degraded mode - next check in ${HEALTH_CHECK_INTERVAL/1000}s`);
    return false;
  }
}

// ===== ✅ 2. Memory Management Helper (ไม่เปลี่ยน) =====
function trimSeenUids(mailboxName, seenSet) {
  if (seenSet.size > CAPACITY.SEEN_UIDS_LIMIT) {
    const uidArray = Array.from(seenSet).map(Number).sort((a, b) => b - a);
    const trimmed = new Set(uidArray.slice(0, CAPACITY.SEEN_UIDS_LIMIT));
    logInfo(`🧹 Trimmed seenUids for "${mailboxName}": kept ${trimmed.size} recent UIDs`);
    return trimmed; // ✅ คืนค่า
  }
  return seenSet;
}

// ===== ✅ 3. โหลด UID ล่าสุดจากไฟล์ (ไม่เปลี่ยน) =====
async function initLastSeenUid(client, mailboxName) {
  const seen = loadSeenUids(mailboxName);
  const last = loadLastSeenUidFromFile(mailboxName) || 0;
  seenUidsMap.set(mailboxName, seen);
  lastSeenUidMap.set(mailboxName, last);

  // Initialize health check timer per mailbox
  lastHealthCheckMap.set(mailboxName, Date.now());

  logInfo(`📌 Loaded lastSeenUid for "${mailboxName}": ${last}`);
  logInfo(`⏱️ [${mailboxName}] Health check interval: ${HEALTH_CHECK_INTERVAL/1000}s`);
  return last;
}

/**
 * Searches for new email UIDs starting from the specified UID
 * @param {ImapClient} client - IMAP client instance
 * @param {number} startUid - Starting UID for search
 * @returns {Promise<number[]>} Array of UIDs found
 */
async function searchNewEmailUids(client, startUid) {
  const searchStart = Date.now();
  try {
    const uids = await client.search({ uid: `${startUid}:*` });
    logInfo(`🔍 Search completed: ${uids.length} UIDs (${Date.now() - searchStart}ms)`);
    return uids;
  } catch (err) {
    logFail('❌ Search failed:', {
      error: err.message,
      code: err.code,
      searchRange: `${startUid}:*`,
      duration: Date.now() - searchStart
    });
    throw err;
  }
}

/**
 * Parses email message and extracts task data with receivedDate
 * @param {Object} message - IMAP message object
 * @param {EmailContentParser} parser - Email content parser instance
 * @returns {Promise<Object>} Parsed email data with receivedDate
 */
async function parseEmailMessage(message, parser) {
  const parsed = await simpleParser(message.source);
  const content = parsed.html || parsed.text || '';
  const rawText = `${parsed.subject || ''} ${parsed.text || ''} ${parsed.html || ''}`;

  const receivedDate = parsed.date
    ? dayjs(parsed.date).tz('Asia/Bangkok').format('YYYY-MM-DD h:mm A')
    : null;

  const emailData = parser.parseEmail(content, rawText);

  return { ...emailData, receivedDate };
}

/**
 * Creates payload object for callback from email data
 * @param {Object} emailData - Parsed email data
 * @param {string|null} url - Moravia task URL or null
 * @returns {Object} Payload object
 */
function createTaskPayload(emailData, url = null) {
  return {
    orderId: emailData.orderId,
    workflowName: emailData.workflowName,
    url,
    amountWords: emailData.metrics.amountWords,
    plannedEndDate: emailData.metrics.plannedEndDate,
    status: emailData.status,
    receivedDate: emailData.receivedDate
  };
}

/**
 * Handles callback invocation for a task with error handling
 * @param {Function} callback - Callback function to invoke
 * @param {Object} payload - Task payload
 * @param {number} uid - Email UID for logging
 * @param {string} context - Context description for error messages
 */
function invokeTaskCallback(callback, payload, uid, context = '') {
  setImmediate(() => {
    Promise.resolve(callback?.(payload)).catch(err => {
      logFail(`❌ Callback failed ${context}for UID ${uid}: ${err.message}`, {
        orderId: payload.orderId,
        url: payload.url
      });
    });
  });
}

/**
 * Processes email data and triggers callbacks for tasks
 * Handles both "On Hold" status (no link) and active tasks (with links)
 * @param {Object} emailData - Parsed email data
 * @param {number} uid - Email UID
 * @param {Function} callback - Callback function for task processing
 */
function processEmailData(emailData, uid, callback) {
  logInfo(`📩 UID ${uid} | ${emailData.status} :: [${emailData.orderId}] Words: ${emailData.metrics.amountWords} | Deadline: ${emailData.metrics.plannedEndDate}`);

  const hasLinks = Array.isArray(emailData.moraviaLinks) && emailData.moraviaLinks.length > 0;

  // Handle "On Hold" status without links
  if (!hasLinks && (emailData.status || '').toLowerCase() === 'on hold') {
    logInfo(`🟡 ${emailData.status} :: [${emailData.orderId}] Without link`);
    const payload = createTaskPayload(emailData, null);
    invokeTaskCallback(callback, payload, uid, '(On Hold) ');
    return;
  }

  // Handle tasks with Moravia links
  if (hasLinks) {
    for (const link of emailData.moraviaLinks) {
      logInfo(`✅ ${emailData.status} :: [${emailData.orderId}] Processing Moravia link`);
      const payload = createTaskPayload(emailData, link);
      invokeTaskCallback(callback, payload, uid);
    }
  }
}

/**
 * Processes a single email message
 * @param {Object} message - IMAP message object
 * @param {Set} seenSet - Set of already seen UIDs
 * @param {string} mailboxName - Mailbox name
 * @param {EmailContentParser} parser - Email parser instance
 * @param {Function} callback - Callback function
 * @returns {Promise<boolean>} True if processed, false if skipped
 */
async function processSingleEmail(message, seenSet, mailboxName, parser, callback) {
  const uid = message.uid;
  const emailStart = Date.now();

  if (seenSet.has(uid)) {
    logInfo(`⚠️ [${mailboxName}] Skipping duplicate UID: ${uid}`);
    return false;
  }

  try {
    const emailData = await parseEmailMessage(message, parser);
    processEmailData(emailData, uid, callback);

    logInfo(`⚡ UID ${uid} processed in ${Date.now() - emailStart}ms`);
    return true;
  } catch (parseError) {
    logFail(`❌ Failed to process UID ${uid}:`, {
      error: parseError.message,
      subject: message.envelope?.subject,
      from: message.envelope?.from?.[0]?.address,
      duration: Date.now() - emailStart
    });
    return true; // Still count as processed to prevent reprocessing
  }
}

/**
 * Processes batch of emails and returns processed UIDs
 * @param {ImapClient} client - IMAP client instance
 * @param {number[]} uids - Array of UIDs to process
 * @param {Set} seenSet - Set of already seen UIDs
 * @param {string} mailboxName - Mailbox name
 * @param {Function} callback - Callback function
 * @returns {Promise<number[]>} Array of processed UIDs
 */
async function processEmailBatch(client, uids, seenSet, mailboxName, callback) {
  const parser = new EmailContentParser();
  const fetchedUids = [];
  const processingStart = Date.now();

  for await (const message of client.fetch(uids, { uid: true, source: true, envelope: true })) {
    const processed = await processSingleEmail(message, seenSet, mailboxName, parser, callback);
    if (processed) {
      fetchedUids.push(message.uid);
    }
  }

  if (fetchedUids.length > 0) {
    logSuccess(`📌 Batch complete: ${fetchedUids.length} emails processed in ${Date.now() - processingStart}ms`);
  }

  return fetchedUids;
}

/**
 * Updates UID tracking state after processing emails
 * @param {string} mailboxName - Mailbox name
 * @param {number[]} fetchedUids - Array of processed UIDs
 * @param {Set} seenSet - Set of seen UIDs
 */
function updateUidTracking(mailboxName, fetchedUids, seenSet) {
  const maxUid = Math.max(...fetchedUids);

  // Add to seen set
  fetchedUids.forEach(uid => seenSet.add(uid));

  // Memory management
  const trimmedSeen = trimSeenUids(mailboxName, seenSet);

  // Save to state
  seenUidsMap.set(mailboxName, trimmedSeen);
  saveSeenUids(mailboxName, trimmedSeen);
  lastSeenUidMap.set(mailboxName, maxUid);
  saveLastSeenUid(mailboxName, maxUid);

  logInfo(`📌 [${mailboxName}] Updated lastSeenUid → ${maxUid} | SeenUIDs count: ${trimmedSeen.size}`);
}

/**
 * Main email processing workflow with mailbox lock
 * @param {ImapClient} client - IMAP client instance
 * @param {string} mailboxName - Mailbox name
 * @param {number} startUid - Starting UID for search
 * @param {Function} callback - Callback function
 */
async function processMailboxWithLock(client, mailboxName, startUid, callback) {
  const lock = await client.getMailboxLock(mailboxName);

  try {
    const uids = await searchNewEmailUids(client, startUid);

    if (uids.length === 0) {
      logInfo(`ℹ️ No new emails found from UID ${startUid}`);
      return;
    }

    const first = uids[0], last = uids[uids.length - 1];
    logInfo(`📨 Processing ${uids.length} new emails (UID ${first}…${last})`);

    const seen = seenUidsMap.get(mailboxName) || new Set();
    const fetchedUids = await processEmailBatch(client, uids, seen, mailboxName, callback);

    if (fetchedUids.length > 0) {
      updateUidTracking(mailboxName, fetchedUids, seen);
    }
  } finally {
    lock.release();
  }
}

// ===== ✅ 4. Optimized fetchNewEmails =====
async function fetchNewEmails(client, mailboxName, callback) {
  if (isFetchingMap.get(mailboxName)) {
    logInfo(`⏳ Skip fetch: already running for "${mailboxName}"`);
    return;
  }

  const fetchStartTime = Date.now();
  isFetchingMap.set(mailboxName, true);
  const lastSeenUid = lastSeenUidMap.get(mailboxName) || 0;
  const startUid = lastSeenUid + 1;

  try {
    // Smart Health Check - check only when needed
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 300)));
    await performHealthCheckIfNeeded(client, mailboxName);

    // Process mailbox with retry logic
    await retry(
      () => processMailboxWithLock(client, mailboxName, startUid, callback),
      RETRIES.IMAP_FETCH,
      RETRIES.IMAP_FETCH_DELAY
    );
  } catch (err) {
    logFail('❌ Email fetch failed after retry:', {
      error: err.message,
      code: err.code,
      totalDuration: Date.now() - fetchStartTime,
      startUid: startUid,
      lastSeenUid: lastSeenUid
    });
  } finally {
    const totalTime = Date.now() - fetchStartTime;
    logInfo(`📈 Fetch cycle completed in ${totalTime}ms`);
    isFetchingMap.set(mailboxName, false);
  }
}

// ✅ Enhanced cleanup function
function cleanupFetcher() {
  // Save seenUids ของทุก mailbox
  for (const [mb, seen] of seenUidsMap.entries()) {
    if (seen.size) {
      saveSeenUids(mb, seen);
      logInfo(`🧼 SeenUIDs for "${mb}" saved during shutdown.`);
    }
  }

  // Save lastSeenUid ของทุก mailbox
  for (const [mb, lastUid] of lastSeenUidMap.entries()) {
    if (lastUid) {
      saveLastSeenUid(mb, lastUid);
      logInfo(`💾 LastSeenUid for "${mb}" saved during shutdown: ${lastUid}`);
    }
  }

  // Reset isFetching state ของทุก mailbox
  for (const mb of isFetchingMap.keys()) {
    isFetchingMap.set(mb, false);
  }

  // Reset health check timer
  lastHealthCheckMap.clear();
}

// NEW: Function to manually trigger health check (for debugging)
async function forceHealthCheck(client, mailboxName) {
  lastHealthCheckMap.set(mailboxName, 0);
  return performHealthCheckIfNeeded(client, mailboxName);
}

module.exports = {
  fetchNewEmails,
  initLastSeenUid,
  cleanupFetcher,
  forceHealthCheck, // Export for debugging
  setHealthMonitor, // Inject health monitor instance
  EmailContentParser
};