// imapClient.js — multi-mailbox ready
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { logInfo, logSuccess, logFail, logProgress } = require('../Logs/logger');
const { notifyGoogleChat } = require('../Logs/notifier');
const { IMAPHealthMonitor } = require('./IMAPHealthMonitor');
const { fetchNewEmails, initLastSeenUid, setHealthMonitor } = require('./fetcher');
const { stateManager } = require('../State/stateManager');

// Singleton IMAP health monitor
const healthMonitor = new IMAPHealthMonitor(notifyGoogleChat);

// Inject health monitor into fetcher (avoids circular dependency)
setHealthMonitor(healthMonitor);

// อ่านหลายกล่องจาก .env: MAILBOXES=Symfonie/Order,Symfonie/On hold
const MAILBOXES = (process.env.MAILBOXES || process.env.MAILBOX || 'Symfonie/Order')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const ALLOW_BACKFILL = process.env.ALLOW_BACKFILL === 'true';

const CONFIG = {
  CONNECTION_TIMEOUT: 45000,
  IDLE_TIMEOUT: 600000,        
  KEEPALIVE_INTERVAL: 30000,
  MAX_RETRIES: 5,
  INITIAL_RETRY_DELAY: 3000,
  MAX_RETRY_DELAY: 300000,
};

// ---- per-mailbox state ----
const clients = new Map();          // mailbox -> ImapFlow
const retryCount = new Map();       // mailbox -> number
const reconnecting = new Map();     // mailbox -> boolean
const alreadyHandled = new Map();   // mailbox -> boolean
let isPaused = false;

// metrics (รวม)
const connectionStats = {
  startTime: Date.now(),
  totalConnections: 0,
  totalReconnects: 0,
  lastConnectionTime: null,
};

// ---------------- helpers ----------------
function getRetry(mb)          { return retryCount.get(mb) || 0; }
function setRetry(mb, v)       { retryCount.set(mb, v); }
function getReconnecting(mb)   { return reconnecting.get(mb) === true; }
function setReconnecting(mb,v) { reconnecting.set(mb, !!v); }
function getHandled(mb)        { return alreadyHandled.get(mb) === true; }
function setHandled(mb, v)     { alreadyHandled.set(mb, !!v); }

function buildImapConfig() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) throw new Error('Missing EMAIL_USER or EMAIL_PASS');

  return {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    logger: false,
    socketTimeout: CONFIG.CONNECTION_TIMEOUT,
    greetingTimeout: CONFIG.CONNECTION_TIMEOUT,
    auth: { user, pass },
  };
}

// -------------- core: connect single mailbox --------------
async function connectToImapForMailbox(mailboxName, callback) {
  if (getReconnecting(mailboxName)) return; // ป้องกันซ้ำซ้อนระหว่าง reconnect

  const baseConfig = buildImapConfig();

  const client = new ImapFlow({
    ...baseConfig,
    idleTimeout: CONFIG.IDLE_TIMEOUT,            // 👈 ใช้ค่า timeout จาก CONFIG
    keepaliveInterval: CONFIG.KEEPALIVE_INTERVAL // 👈 ใช้ค่า keepalive จาก CONFIG
  });

  clients.set(mailboxName, client);
  setHandled(mailboxName, false);

  try {
    logInfo(`🔡 Connecting to IMAP for "${mailboxName}"...`);
    const t0 = Date.now();
    await client.connect();
    const tConn = Date.now() - t0;
    logSuccess(`🟢 IMAP connected (${tConn} ms) for "${mailboxName}"`);

    connectionStats.totalConnections++;
    connectionStats.lastConnectionTime = Date.now();
    if (getRetry(mailboxName) > 0) connectionStats.totalReconnects++;
    setRetry(mailboxName, 0);

    await client.mailboxOpen(mailboxName);
    logInfo(`📬 Mailbox "${mailboxName}" opened`);
    await initLastSeenUid(client, mailboxName, ALLOW_BACKFILL);
    try { stateManager.updateIMAPStatus({ connected: true, mailboxes: MAILBOXES }); } catch (_) { /* non-critical */ }

    // แจ้งครั้งเดียวพอเมื่อระบบออนไลน์
    if (MAILBOXES.indexOf(mailboxName) === 0) {
      const upMin = Math.round((Date.now() - connectionStats.startTime) / 60000);
      notifyGoogleChat(`🟢 [Auto RWS] System online (${connectionStats.totalConnections} connections, ${upMin} min uptime)`);
    }

    // New mail event
    client.on('exists', async () => {
      if (isPaused) return;
      logInfo(`🔔 New mail in "${mailboxName}"`);
      try {
        await fetchNewEmails(client, mailboxName, callback);
      } catch (err) {
        logFail(`❌ fetchNewEmails error in "${mailboxName}": ${err.message}`);
      }
    });

    // Errors
    client.on('error', err => {
      if (getHandled(mailboxName)) return;
      setHandled(mailboxName, true);
      logFail(`❌ IMAP error (${mailboxName}): ${err.message}`);
      try { stateManager.updateIMAPStatus({ connected: false }); } catch (_) { /* non-critical */ }
      notifyGoogleChat(`❌ [Auto RWS] IMAP error (${mailboxName}): ${err.message}`);
      attemptReconnect(mailboxName, callback);
    });

    client.on('close', () => {
      if (getHandled(mailboxName)) return;
      setHandled(mailboxName, true);
      logFail(`🔌 IMAP closed (${mailboxName})`);
      try { stateManager.updateIMAPStatus({ connected: false }); } catch (_) { /* non-critical */ }
      attemptReconnect(mailboxName, callback);
    });

    client.on('end', () => {
      if (getHandled(mailboxName)) return;
      setHandled(mailboxName, true);
      logFail(`🔴 IMAP ended by server (${mailboxName})`);
      try { stateManager.updateIMAPStatus({ connected: false }); } catch (_) { /* non-critical */ }
      notifyGoogleChat(`🔴 [Auto RWS] IMAP ended (${mailboxName})`);
      attemptReconnect(mailboxName, callback);
    });
  } catch (err) {
    logFail(`❌ IMAP setup failed (${mailboxName}): ${err.message}`);
    try { stateManager.updateIMAPStatus({ connected: false }); } catch (_) { /* non-critical */ }
    notifyGoogleChat(`❌ [Auto RWS] IMAP setup failed (${mailboxName}): ${err.message}`);
    attemptReconnect(mailboxName, callback);
  }
}


function attemptReconnect(mailboxName, callback, baseDelay = CONFIG.INITIAL_RETRY_DELAY) {
  if (getReconnecting(mailboxName)) return;

  // Track reconnect event in health monitor
  healthMonitor.recordReconnect(mailboxName);

  let tries = getRetry(mailboxName);

  if (tries >= CONFIG.MAX_RETRIES) {
    logFail(`🛑 Max retries for "${mailboxName}". Will retry after ${CONFIG.MAX_RETRY_DELAY / 60000}m.`);
    notifyGoogleChat(`⚠️ [Auto RWS] ${mailboxName} failed ${CONFIG.MAX_RETRIES} times; retrying later.`);
    setReconnecting(mailboxName, true);
    setTimeout(() => {
      setRetry(mailboxName, 0);
      setReconnecting(mailboxName, false);
      setHandled(mailboxName, false);
      connectToImapForMailbox(mailboxName, callback);
    }, CONFIG.MAX_RETRY_DELAY);
    return;
  }

  tries += 1;
  setRetry(mailboxName, tries);
  setReconnecting(mailboxName, true);

  const delay = Math.min(baseDelay * Math.pow(1.5, tries - 1), CONFIG.MAX_RETRY_DELAY);
  logInfo(`🔄 Reconnecting "${mailboxName}" in ${Math.round(delay / 1000)}s (attempt ${tries}/${CONFIG.MAX_RETRIES})`);

  setTimeout(() => {
    setReconnecting(mailboxName, false);
    setHandled(mailboxName, false);
    connectToImapForMailbox(mailboxName, callback);
  }, delay);
}

// -------------- public entrypoint: start all mailboxes --------------
async function connectToImap(callback) {
  // สปิน 1 client ต่อ 1 mailbox (ขนานกัน)
  for (const mb of MAILBOXES) {
    connectToImapForMailbox(mb, callback);
  }
}

// -------------- utilities --------------
function pauseImap() {
  isPaused = true;
  try { stateManager.updateIMAPStatus({ paused: true }); } catch (_) { /* non-critical */ }
  logInfo('⏸️ IMAP paused');
}

function resumeImap() {
  isPaused = false;
  try { stateManager.updateIMAPStatus({ paused: false }); } catch (_) { /* non-critical */ }
  logInfo('▶️ IMAP resumed');
}

function isImapPaused() { return isPaused; }

async function checkConnection() {
  const results = {};
  for (const [mb, client] of clients.entries()) {
    try {
      if (!client || client.destroyed) {
        results[mb] = { healthy: false, error: 'no-client' };
        continue;
      }
      await client.noop();
      results[mb] = { healthy: true };
    } catch (e) {
      results[mb] = { healthy: false, error: e.message };
    }
  }
  return results;
}

function getConnectionStats() {
  return {
    startTime: connectionStats.startTime,
    totalConnections: connectionStats.totalConnections,
    totalReconnects: connectionStats.totalReconnects,
    lastConnectionTime: connectionStats.lastConnectionTime,
    currentRetryCount: Object.fromEntries(retryCount.entries()),
    isPaused,
    mailboxes: MAILBOXES,
  };
}

function getIMAPHealthStatus() {
  return healthMonitor.getHealthSnapshot();
}

function getIMAPHealthMonitor() {
  return healthMonitor;
}

module.exports = {
  startListeningEmails: connectToImap,   // ใช้ตัวนี้จาก main.js
  pauseImap,
  resumeImap,
  isImapPaused,
  checkConnection,
  getConnectionStats,
  getIMAPHealthStatus,
  getIMAPHealthMonitor,
};
