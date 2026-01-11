const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');
const dayjs = require('dayjs');
const { loadLastSeenUidFromFile, saveLastSeenUid } = require('./uidStore');
const { loadSeenUids, saveSeenUids } = require('./seenUidsStore');
const { logInfo, logSuccess, logFail } = require('../Logs/logger');
const { retry } = require('./retryHandler');

const seenUidsMap = new Map();  
const lastSeenUidMap = new Map();
const isFetchingMap = new Map();
const lastHealthCheckMap = new Map();
const HEALTH_CHECK_INTERVAL = 180000; // 3 นาที
const HEALTH_CHECK_TIMEOUT  = 15000;  // 10 วิ

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

    lastHealthCheckMap.set(mailboxName, now); // กัน spam checks
    logInfo(`🔧 [${mailboxName}] Continuing with degraded mode - next check in ${HEALTH_CHECK_INTERVAL/1000}s`);
    return false;
  }
}

// ===== ✅ 2. Memory Management Helper (ไม่เปลี่ยน) =====
function trimSeenUids(mailboxName, seenSet) {
  if (seenSet.size > 1000) {
    const uidArray = Array.from(seenSet).map(Number).sort((a, b) => b - a);
    const trimmed = new Set(uidArray.slice(0, 1000));
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
    // ✅ Smart Health Check - เช็คเฉพาะเมื่อจำเป็น
    await new Promise(r => setTimeout(r, Math.floor(Math.random()*300)));
    await performHealthCheckIfNeeded(client, mailboxName);

    await retry(async () => {
      const lock = await client.getMailboxLock(mailboxName);
      const fetchedUids = [];
      const parser = new EmailContentParser();

      try {
        // ✅ Search with better logging
        let uids = [];
        const searchStart = Date.now();
        try {
          uids = await client.search({ uid: `${startUid}:*` });
          logInfo(`🔍 Search completed: ${uids.length} UIDs (${Date.now() - searchStart}ms)`);
        } catch (err) {
          logFail('❌ Search failed:', {
            error: err.message,
            code: err.code,
            searchRange: `${startUid}:*`,
            duration: Date.now() - searchStart
          });
          throw err;
        }

        if (uids.length === 0) {
          logInfo(`ℹ️ No new emails found from UID ${startUid}`);
          return;
        }

        if (uids.length) {
          const first = uids[0], last = uids[uids.length - 1];
          logInfo(`📨 Processing ${uids.length} new emails (UID ${first}…${last})`);
        }

        let seen = seenUidsMap.get(mailboxName) || new Set();
        // ✅ Process emails with performance tracking
        const processingStart = Date.now();
        for await (const message of client.fetch(uids, { uid: true, source: true, envelope: true })) {
          const uid = message.uid;
          const emailStart = Date.now();

          if (seen.has(uid)) {
            logInfo(`⚠️ [${mailboxName}] Skipping duplicate UID: ${uid}`);
            continue;
          }

          try {
            // Parse email
            const parsed = await simpleParser(message.source);
            const content = parsed.html || parsed.text || '';
            const rawText = `${parsed.subject || ''} ${parsed.text || ''} ${parsed.html || ''}`;
            
            const emailData = parser.parseEmail(content, rawText);
            
            logInfo(`📩 UID ${uid} | ${emailData.status} :: [${emailData.orderId}] Words: ${emailData.metrics.amountWords} | Deadline: ${emailData.metrics.plannedEndDate}`);
            //logInfo(`🆔 Order: ${emailData.orderId} | Workflow: ${emailData.workflowName}`);
            //logInfo(`📊 Words: ${emailData.metrics.amountWords} | Deadline: ${emailData.metrics.plannedEndDate}`);

            const hasLinks = Array.isArray(emailData.moraviaLinks) && emailData.moraviaLinks.length > 0;

            if (!hasLinks) {
            //logInfo(`⚠️ No Moravia links found in UID ${uid}`);

              if ((emailData.status || '').toLowerCase() === 'on hold') {
                logInfo(`🟡 ${emailData.status} :: [${emailData.orderId}] Without link`);
                const payload = {
                  orderId: emailData.orderId,
                  workflowName: emailData.workflowName,
                  url: null,
                  amountWords: emailData.metrics.amountWords,
                  plannedEndDate: emailData.metrics.plannedEndDate,
                  status: emailData.status,
                };
                setImmediate(() => {
                  Promise.resolve(callback?.(payload)).catch(err => {
                    logFail(`❌ Callback failed (On Hold) for UID ${uid}: ${err.message}`, { orderId: emailData.orderId });
                  });
                });
              }
            }

            if (hasLinks) {
              for (const link of emailData.moraviaLinks) {
                logInfo(`✅ ${emailData.status} :: [${emailData.orderId}] Processing Moravia link`);
                const payload = {
                  orderId: emailData.orderId,
                  workflowName: emailData.workflowName,
                  url: link,
                  amountWords: emailData.metrics.amountWords,
                  plannedEndDate: emailData.metrics.plannedEndDate,
                  status: emailData.status
                };
                setImmediate(() => {
                  Promise.resolve(callback?.(payload)).catch(err => {
                    logFail(`❌ Callback failed for UID ${uid}: ${err.message}`, { link, orderId: emailData.orderId });
                  });
                });
              }
            }

            fetchedUids.push(uid);
            logInfo(`⚡ UID ${uid} processed in ${Date.now() - emailStart}ms`);

          } catch (parseError) {
            logFail(`❌ Failed to process UID ${uid}:`, {
              error: parseError.message,
              subject: message.envelope?.subject,
              from: message.envelope?.from?.[0]?.address,
              duration: Date.now() - emailStart
            });
            fetchedUids.push(uid);
          }
        }

        // ✅ Update tracking with better logging
        if (fetchedUids.length > 0) {
          const maxUid = Math.max(...fetchedUids);
          fetchedUids.forEach(uid => seen.add(uid));
          
          // Memory management
          seen = trimSeenUids(mailboxName, seen);

          seenUidsMap.set(mailboxName, seen);
          saveSeenUids(mailboxName, seen);
          lastSeenUidMap.set(mailboxName, maxUid);
          saveLastSeenUid(mailboxName, maxUid);
          
          logSuccess(`📌 Batch complete: ${fetchedUids.length} emails processed in ${Date.now() - processingStart}ms`);
          logInfo(`📌 [${mailboxName}] Updated lastSeenUid → ${maxUid} | SeenUIDs count: ${seen.size}`);
        }

      } finally {
        lock.release();
      }
    }, 3, 1000); // 3 retries, 1 second delay

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
  EmailContentParser
};