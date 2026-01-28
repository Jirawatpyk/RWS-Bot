/**
 * Tests for IMAP/imapClient.js
 * Simplified version to avoid worker crashes
 */

// Mock all dependencies before requiring the module
const mockLogInfo = jest.fn();
const mockLogSuccess = jest.fn();
const mockLogFail = jest.fn();
const mockLogProgress = jest.fn();
const mockNotifyGoogleChat = jest.fn();
const mockFetchNewEmails = jest.fn();
const mockInitLastSeenUid = jest.fn();

jest.mock('dotenv', () => ({
  config: jest.fn()
}));

jest.mock('../../Logs/logger', () => ({
  logInfo: (...args) => mockLogInfo(...args),
  logSuccess: (...args) => mockLogSuccess(...args),
  logFail: (...args) => mockLogFail(...args),
  logProgress: (...args) => mockLogProgress(...args)
}));

jest.mock('../../Logs/notifier', () => ({
  notifyGoogleChat: (...args) => mockNotifyGoogleChat(...args)
}));

jest.mock('../../IMAP/fetcher', () => ({
  fetchNewEmails: (...args) => mockFetchNewEmails(...args),
  initLastSeenUid: (...args) => mockInitLastSeenUid(...args),
  setHealthMonitor: jest.fn()
}));

// Mock IMAPHealthMonitor (required by imapClient.js at module level)
jest.mock('../../IMAP/IMAPHealthMonitor', () => ({
  IMAPHealthMonitor: jest.fn().mockImplementation(() => ({
    recordReconnect: jest.fn(),
    recordHealthCheck: jest.fn(),
    getHealthSnapshot: jest.fn().mockReturnValue({
      timestamp: Date.now(),
      thresholds: {},
      totalReconnectsTracked: 0,
      mailboxes: {}
    }),
    destroy: jest.fn(),
    _pruneTimer: null
  }))
}));

// Mock ImapFlow
const mockOn = jest.fn();
const mockConnect = jest.fn().mockResolvedValue();
const mockMailboxOpen = jest.fn().mockResolvedValue();
const mockNoop = jest.fn().mockResolvedValue();

jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    mailboxOpen: mockMailboxOpen,
    on: mockOn,
    noop: mockNoop,
    destroyed: false
  }))
}));

describe('IMAP/imapClient.js', () => {
  let imapClient;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset process.env
    process.env = {
      ...originalEnv,
      EMAIL_USER: 'test@example.com',
      EMAIL_PASS: 'testpass',
      MAILBOXES: 'Symfonie/Order',
      ALLOW_BACKFILL: 'false'
    };

    // Reset modules to get fresh state
    jest.resetModules();
    imapClient = require('../../IMAP/imapClient');
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('pauseImap()', () => {
    it('should set paused state to true', () => {
      imapClient.pauseImap();
      expect(imapClient.isImapPaused()).toBe(true);
      expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('paused'));
    });
  });

  describe('resumeImap()', () => {
    it('should set paused state to false', () => {
      imapClient.pauseImap();
      imapClient.resumeImap();
      expect(imapClient.isImapPaused()).toBe(false);
      expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('resumed'));
    });
  });

  describe('isImapPaused()', () => {
    it('should return false initially', () => {
      expect(imapClient.isImapPaused()).toBe(false);
    });

    it('should return true after pause', () => {
      imapClient.pauseImap();
      expect(imapClient.isImapPaused()).toBe(true);
    });

    it('should return false after resume', () => {
      imapClient.pauseImap();
      imapClient.resumeImap();
      expect(imapClient.isImapPaused()).toBe(false);
    });
  });

  describe('getConnectionStats()', () => {
    it('should return stats object with correct structure', () => {
      const stats = imapClient.getConnectionStats();

      expect(stats).toHaveProperty('startTime');
      expect(stats).toHaveProperty('totalConnections');
      expect(stats).toHaveProperty('totalReconnects');
      expect(stats).toHaveProperty('lastConnectionTime');
      expect(stats).toHaveProperty('currentRetryCount');
      expect(stats).toHaveProperty('isPaused');
      expect(stats).toHaveProperty('mailboxes');
    });

    it('should reflect paused state', () => {
      imapClient.pauseImap();
      const stats = imapClient.getConnectionStats();
      expect(stats.isPaused).toBe(true);
    });

    it('should have mailboxes array', () => {
      const stats = imapClient.getConnectionStats();
      expect(Array.isArray(stats.mailboxes)).toBe(true);
    });
  });

  describe('checkConnection()', () => {
    it('should return empty results when no clients connected', async () => {
      const results = await imapClient.checkConnection();
      expect(typeof results).toBe('object');
    });
  });

  describe('startListeningEmails()', () => {
    it('should be a function', () => {
      expect(typeof imapClient.startListeningEmails).toBe('function');
    });
  });

  describe('Module Exports', () => {
    it('should export all required functions', () => {
      expect(imapClient.startListeningEmails).toBeDefined();
      expect(imapClient.pauseImap).toBeDefined();
      expect(imapClient.resumeImap).toBeDefined();
      expect(imapClient.isImapPaused).toBeDefined();
      expect(imapClient.checkConnection).toBeDefined();
      expect(imapClient.getConnectionStats).toBeDefined();
    });

    it('should export health monitor functions', () => {
      expect(imapClient.getIMAPHealthStatus).toBeDefined();
      expect(imapClient.getIMAPHealthMonitor).toBeDefined();
      expect(typeof imapClient.getIMAPHealthStatus).toBe('function');
      expect(typeof imapClient.getIMAPHealthMonitor).toBe('function');
    });
  });

  describe('getIMAPHealthStatus()', () => {
    it('should return a health snapshot object', () => {
      const snapshot = imapClient.getIMAPHealthStatus();
      expect(snapshot).toBeDefined();
      expect(typeof snapshot).toBe('object');
    });
  });

  describe('getIMAPHealthMonitor()', () => {
    it('should return the health monitor instance', () => {
      const monitor = imapClient.getIMAPHealthMonitor();
      expect(monitor).toBeDefined();
      expect(monitor.recordReconnect).toBeDefined();
      expect(monitor.getHealthSnapshot).toBeDefined();
    });
  });
});
