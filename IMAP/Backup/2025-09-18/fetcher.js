const { simpleParser } = require('mailparser');
const { parseMoraviaLinksFromEmail } = require('./linkParser');
const { extractMetricsFromEmail } = require('./linkParser');
const { extractOrderIdFromEmail } = require('./linkParser');
const { extractWorkflowNameFromEmail } = require('./linkParser');
const { loadLastSeenUidFromFile, saveLastSeenUid } = require('./uidStore');
const { loadSeenUids, saveSeenUids } = require('./seenUidsStore');
const { logInfo, logSuccess, logFail } = require('../Logs/logger');
const { retry } = require('./retryHandler');

let seenUids = new Set();
let lastSeenUid = 0;
let isFetching = false;
let currentMailboxName = null;

// ✅ โหลด UID ล่าสุดที่ทำล่าสุดจากไฟล์ (ไม่พึ่ง uidNow)
async function initLastSeenUid(client, mailboxName) {
  currentMailboxName = mailboxName;
  seenUids = loadSeenUids(mailboxName);
  lastSeenUid = loadLastSeenUidFromFile(mailboxName) || 0;
  logInfo(`📌 Loaded lastSeenUid from file: ${lastSeenUid}`);
  return lastSeenUid;
}

// ✅ ดึงอีเมลใหม่ทั้งหมดตั้งแต่ lastSeenUid + 1
async function fetchNewEmails(client, mailboxName, callback) {
  if (isFetching) {
    logInfo('⏳ Skip fetch: already running.');
    return;
  }

  isFetching = true;
  const startUid = lastSeenUid + 1;

  try {
    await retry(async () => {
      const lock = await client.getMailboxLock(mailboxName);
      const fetchedUids = [];

      try {
        let uids = [];
        try {
          uids = await client.search({ uid: `${startUid}:*` });
        } catch (err) {
          logFail('❌ Failed to search UID range:', err);
          return;
        }

        if (uids.length === 0) {
          logInfo(`ℹ️ No new UIDs found from ${startUid}`);
          return;
        }

        logInfo(`📨 Found ${uids.length} new UIDs: ${uids.join(', ')}`);

        for await (const message of client.fetch(uids, { uid: true, source: true, envelope: true })) {
          const uid = message.uid;
          if (seenUids.has(uid)) {
            logInfo(`⚠️ Skipping duplicate UID: ${uid}`);
            continue;
          }

          try {
            const parsed = await simpleParser(message.source);
            const content = parsed.html || parsed.text || '';
            const { amountWords, plannedEndDate } = extractMetricsFromEmail(content);
            const moraviaLinks = parseMoraviaLinksFromEmail(content);
            const rawText = `${parsed.subject || ''} ${parsed.text || ''} ${parsed.html || ''}`;
            const orderId = extractOrderIdFromEmail(rawText);
            const workflowName = extractWorkflowNameFromEmail(content);

            logInfo(`📩 UID ${uid} | Subject: ${parsed.subject}`);
            logInfo(`🆔 Order ID: ${orderId}`);
            logInfo(`🔖 Workflow Name: ${workflowName}`);
            logInfo(`✅ WordsCount: ${amountWords} | Deadline: ${plannedEndDate}`);

            for (const link of moraviaLinks) {
              try {
                logInfo(`✅ Moravia Link: ${link}`);
                await callback?.({ orderId, workflowName, url: link, amountWords, plannedEndDate });
              } catch (err) {
                logFail(`❌ Callback failed for UID ${uid} | link: ${link}`, err);
              }
            }

            fetchedUids.push(uid);

          } catch (err) {
            logFail(`❌ Error while processing UID ${uid}`, err);
          }
        }

        if (fetchedUids.length > 0) {
          const maxUid = Math.max(...fetchedUids);
          fetchedUids.forEach(uid => seenUids.add(uid));
          saveSeenUids(mailboxName, seenUids);
          lastSeenUid = maxUid;
          saveLastSeenUid(mailboxName, lastSeenUid);
          logInfo(`📌 Updated lastSeenUid → ${lastSeenUid} (processed ${fetchedUids.length} emails)`);
        }

      } finally {
        lock.release();
      }
    }, 3, 1000);
  } catch (err) {
    logFail('❌ Error while fetching emails (after retry):', err);
  } finally {
    isFetching = false;
  }
}

function cleanupFetcher() {
  if (currentMailboxName && seenUids.size > 0) {
    saveSeenUids(currentMailboxName, seenUids);
    logInfo('🧼 SeenUIDs saved during shutdown.');
  }
}

module.exports = {
  fetchNewEmails,
  initLastSeenUid,
  cleanupFetcher
};
