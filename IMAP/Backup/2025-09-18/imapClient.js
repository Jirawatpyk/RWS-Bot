// ✅ imapClient.js
require('dotenv').config();
const { ImapFlow } = require('imapflow');
const { logInfo, logSuccess, logFail, logProgress } = require('../Logs/logger');
const { notifyGoogleChat } = require('../Logs/notifier');
const { fetchNewEmails, initLastSeenUid } = require('./fetcher');

const MAILBOX = process.env.MAILBOX || 'Symfonie/Order';
const ALLOW_BACKFILL = process.env.ALLOW_BACKFILL === 'true';

let client = null;
let callbackRef = null;
let isConnecting = false;
let alreadyHandled = false;
let reconnecting = false;
let retryCount = 0;
let isPaused = false; // ✅ IMAP Pause state
const MAX_RETRIES = 5;

async function connectToImap(callback) {
	if (isConnecting) return;
	isConnecting = true;
	callbackRef = callback;

    const config = {
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        logger: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    };

	if (!config.auth.user || !config.auth.pass) {
		logFail('❌ Missing EMAIL_USER or EMAIL_PASS in .env');
		isConnecting = false;
		return;
	}

	client = new ImapFlow(config);

	try {
		logInfo('📡 Connecting to IMAP...');
		await client.connect();
		alreadyHandled = false;
		logSuccess('🟢 IMAP connection established.');
		retryCount = 0;

		await client.mailboxOpen(MAILBOX);
		logInfo(`📬 Mailbox "${MAILBOX}" opened.`);
		await initLastSeenUid(client, MAILBOX, ALLOW_BACKFILL);
		notifyGoogleChat(`🟢 [Auto RWS] System is online — standing by for task assignments.`);

		client.on('exists', async () => {
			if (isPaused) return; // ✅ Skip if paused
			logInfo('🔔 New mail detected');
			await fetchNewEmails(client, MAILBOX, callbackRef);
		});

		client.on('error', err => {
			if (alreadyHandled) return;
			alreadyHandled = true;
			logFail(`❌ IMAP Error: ${err.message}`);
			notifyGoogleChat(`❌ [Auto RWS] IMAP Error: ${err.message}`);
			attemptReconnect();
		});

		client.on('close', () => {
			if (alreadyHandled) return;
			alreadyHandled = true;
			logFail('🔌 IMAP connection closed.');
			attemptReconnect();
		});

		client.on('end', () => {
			if (alreadyHandled) return;
			alreadyHandled = true;
			logFail('📴 IMAP connection ended by server.');
			notifyGoogleChat('📴 [Auto RWS] IMAP connection ended by server.');
			attemptReconnect();
		});

	} catch (err) {
		logFail(`❌ IMAP setup failed: ${err.message}`);
		notifyGoogleChat(`❌ [Auto RWS] IMAP setup failed: ${err.message}`);
		attemptReconnect();
	} finally {
		isConnecting = false;
	}
}

function attemptReconnect(delayMs = 5000) {
	if (reconnecting) return;

	if (retryCount >= MAX_RETRIES) {
		logFail('🛑 Max retries reached. Will try again in 10 minutes.');
		notifyGoogleChat('⚠️ [Auto RWS] IMAP failed 5 times. Will retry after 10 minutes.');
		setTimeout(() => {
			retryCount = 0;
			reconnecting = false;
			connectToImap(callbackRef);
		}, 10 * 60 * 1000);
		return;
	}

	retryCount++;
	reconnecting = true;
	logInfo(`🔁 Reconnecting to IMAP in ${delayMs / 1000}s (attempt ${retryCount}/${MAX_RETRIES})`);
	notifyGoogleChat(`🔴 [Auto RWS] IMAP disconnected. Attempting reconnect (${retryCount}/${MAX_RETRIES})...`);
	setTimeout(() => {
		reconnecting = false;
		connectToImap(callbackRef);
	}, delayMs);
}

function pauseImap() {
	isPaused = true;
	logInfo("⏸️ IMAP paused by user.");
}

function resumeImap() {
	isPaused = false;
	logInfo("▶️ IMAP resumed by user.");
}

function isImapPaused() {
	return isPaused;
}

module.exports = {
	startListeningEmails: connectToImap,
	pauseImap,
	resumeImap,
	isImapPaused
};
