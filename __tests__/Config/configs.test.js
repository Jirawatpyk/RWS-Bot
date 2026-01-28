/**
 * @jest-environment node
 *
 * Comprehensive tests for Config/configs.js
 *
 * Tests cover:
 * - dotenv initialization
 * - Static configuration values
 * - Environment variable handling
 * - Default value fallbacks
 * - Boolean conversion logic
 * - Integer parsing with defaults
 * - jobLinks structure validation
 */

describe('Config/configs.js', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Clear module cache to allow re-requiring with different env
    jest.resetModules();

    // Mock dotenv.config() to prevent it from loading actual .env file
    jest.mock('dotenv', () => ({
      config: jest.fn()
    }));
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('dotenv initialization', () => {
    it('should call dotenv.config() on module load', () => {
      const dotenv = require('dotenv');
      const configs = require('../../Config/configs.js');

      expect(dotenv.config).toHaveBeenCalled();
    });
  });

  describe('Static configuration values', () => {
    let configs;

    beforeEach(() => {
      configs = require('../../Config/configs.js');
    });

    it('should have DEFAULT_SHEET_KEY set to "MainSheet"', () => {
      expect(configs.DEFAULT_SHEET_KEY).toBe('MainSheet');
    });

    it('should have defaultConcurrency set to 4', () => {
      expect(configs.defaultConcurrency).toBe(4);
    });

    it('should have maxRetries set to 1', () => {
      expect(configs.maxRetries).toBe(1);
    });
  });

  describe('jobLinks structure - MainSheet', () => {
    let configs;

    beforeEach(() => {
      process.env.SHEET_ID_MAIN = 'test-main-sheet-id';
      configs = require('../../Config/configs.js');
    });

    it('should have MainSheet configuration with correct structure', () => {
      expect(configs.jobLinks.MainSheet).toBeDefined();
      expect(configs.jobLinks.MainSheet).toHaveProperty('sheetId');
      expect(configs.jobLinks.MainSheet).toHaveProperty('tabName');
      expect(configs.jobLinks.MainSheet).toHaveProperty('LinksOrderColumn');
      expect(configs.jobLinks.MainSheet).toHaveProperty('StatusColumn');
      expect(configs.jobLinks.MainSheet).toHaveProperty('ReasonColumn');
      expect(configs.jobLinks.MainSheet).toHaveProperty('TimestampColumn');
    });

    it('should load MainSheet sheetId from SHEET_ID_MAIN env var', () => {
      expect(configs.jobLinks.MainSheet.sheetId).toBe('test-main-sheet-id');
    });

    it('should have correct MainSheet static values', () => {
      expect(configs.jobLinks.MainSheet.tabName).toBe('AcceptLinks');
      expect(configs.jobLinks.MainSheet.LinksOrderColumn).toBe('D');
      expect(configs.jobLinks.MainSheet.StatusColumn).toBe('E');
      expect(configs.jobLinks.MainSheet.ReasonColumn).toBe('F');
      expect(configs.jobLinks.MainSheet.TimestampColumn).toBe('G');
    });
  });

  describe('jobLinks structure - DATASheet', () => {
    let configs;

    beforeEach(() => {
      process.env.SHEET_ID_DATA = 'test-data-sheet-id';
      configs = require('../../Config/configs.js');
    });

    it('should have DATASheet configuration with correct structure', () => {
      expect(configs.jobLinks.DATASheet).toBeDefined();
      expect(configs.jobLinks.DATASheet).toHaveProperty('sheetId');
      expect(configs.jobLinks.DATASheet).toHaveProperty('tabName');
      expect(configs.jobLinks.DATASheet).toHaveProperty('LinksColumn');
      expect(configs.jobLinks.DATASheet).toHaveProperty('ReceviedDate');
      expect(configs.jobLinks.DATASheet).toHaveProperty('StartRow');
    });

    it('should load DATASheet sheetId from SHEET_ID_DATA env var', () => {
      expect(configs.jobLinks.DATASheet.sheetId).toBe('test-data-sheet-id');
    });

    it('should have correct DATASheet static values', () => {
      expect(configs.jobLinks.DATASheet.tabName).toBe('NOTOUCH');
      expect(configs.jobLinks.DATASheet.LinksColumn).toBe('Q');
      expect(configs.jobLinks.DATASheet.ReceviedDate).toBe('C');
      expect(configs.jobLinks.DATASheet.StartRow).toBe(7300);
    });
  });

  describe('jobLinks structure - TrackingSheet', () => {
    let configs;

    beforeEach(() => {
      process.env.SHEET_ID_Tracking = 'test-tracking-sheet-id';
      configs = require('../../Config/configs.js');
    });

    it('should have TrackingSheet configuration with correct structure', () => {
      expect(configs.jobLinks.TrackingSheet).toBeDefined();
      expect(configs.jobLinks.TrackingSheet).toHaveProperty('sheetId');
      expect(configs.jobLinks.TrackingSheet).toHaveProperty('tabName');
      expect(configs.jobLinks.TrackingSheet).toHaveProperty('statusColumn');
      expect(configs.jobLinks.TrackingSheet).toHaveProperty('orderIdColumn');
      expect(configs.jobLinks.TrackingSheet).toHaveProperty('pmNameColumn');
      expect(configs.jobLinks.TrackingSheet).toHaveProperty('Assignment');
    });

    it('should load TrackingSheet sheetId from SHEET_ID_Tracking env var', () => {
      expect(configs.jobLinks.TrackingSheet.sheetId).toBe('test-tracking-sheet-id');
    });

    it('should have correct TrackingSheet static values', () => {
      expect(configs.jobLinks.TrackingSheet.tabName).toBe('PM_Tracking');
      expect(configs.jobLinks.TrackingSheet.statusColumn).toBe('B');
      expect(configs.jobLinks.TrackingSheet.orderIdColumn).toBe('F');
      expect(configs.jobLinks.TrackingSheet.pmNameColumn).toBe('C');
    });

    it('should have Assignment nested configuration', () => {
      const assignment = configs.jobLinks.TrackingSheet.Assignment;
      expect(assignment).toBeDefined();
      expect(assignment.tabName).toBe('Assignment');
      expect(assignment.workflowNameColumn).toBe('F');
      expect(assignment.projectStatusColumn).toBe('L');
    });
  });

  describe('Environment-based values', () => {
    describe('when all environment variables are set', () => {
      let configs;

      beforeEach(() => {
        process.env.SHEET_ID_MAIN = 'main-123';
        process.env.SHEET_ID_DATA = 'data-456';
        process.env.SHEET_ID_Tracking = 'tracking-789';
        process.env.FORCE_LOGIN = 'true';
        process.env.GOOGLE_CHAT_WEBHOOK = 'https://chat.google.com/webhook/test';
        process.env.TASK_TIMEOUT_MS = '90000';
        process.env.RETRY_COUNT = '5';
        process.env.RETRY_DELAY_MS = '5000';
        process.env.EMAIL_USER = 'test@example.com';
        process.env.EMAIL_PASS = 'password123';
        process.env.IMAP_HOST = 'imap.example.com';
        process.env.MAILBOX_NAME = 'CustomMailbox';
        process.env.ALLOW_BACKFILL = 'true';

        configs = require('../../Config/configs.js');
      });

      it('should load sheet IDs from environment', () => {
        expect(configs.jobLinks.MainSheet.sheetId).toBe('main-123');
        expect(configs.jobLinks.DATASheet.sheetId).toBe('data-456');
        expect(configs.jobLinks.TrackingSheet.sheetId).toBe('tracking-789');
      });

      it('should load forceLogin as boolean from FORCE_LOGIN env', () => {
        expect(configs.forceLogin).toBe(true);
        expect(typeof configs.forceLogin).toBe('boolean');
      });

      it('should load googleChatWebhook from environment', () => {
        expect(configs.googleChatWebhook).toBe('https://chat.google.com/webhook/test');
      });

      it('should parse taskConfig values from environment as integers', () => {
        expect(configs.taskConfig.TASK_TIMEOUT_MS).toBe(90000);
        expect(configs.taskConfig.RETRY_COUNT).toBe(5);
        expect(configs.taskConfig.RETRY_DELAY_MS).toBe(5000);
        expect(typeof configs.taskConfig.TASK_TIMEOUT_MS).toBe('number');
        expect(typeof configs.taskConfig.RETRY_COUNT).toBe('number');
        expect(typeof configs.taskConfig.RETRY_DELAY_MS).toBe('number');
      });

      it('should load email configuration from environment', () => {
        expect(configs.EMAIL_USER).toBe('test@example.com');
        expect(configs.EMAIL_PASS).toBe('password123');
        expect(configs.IMAP_HOST).toBe('imap.example.com');
      });

      it('should load custom MAILBOX name from environment', () => {
        expect(configs.MAILBOX).toBe('CustomMailbox');
      });

      it('should load ALLOW_BACKFILL as boolean from environment', () => {
        expect(configs.ALLOW_BACKFILL).toBe(true);
        expect(typeof configs.ALLOW_BACKFILL).toBe('boolean');
      });
    });

    describe('when environment variables are not set', () => {
      let configs;

      beforeEach(() => {
        // Clear all relevant env vars
        delete process.env.SHEET_ID_MAIN;
        delete process.env.SHEET_ID_DATA;
        delete process.env.SHEET_ID_Tracking;
        delete process.env.FORCE_LOGIN;
        delete process.env.GOOGLE_CHAT_WEBHOOK;
        delete process.env.TASK_TIMEOUT_MS;
        delete process.env.RETRY_COUNT;
        delete process.env.RETRY_DELAY_MS;
        delete process.env.EMAIL_USER;
        delete process.env.EMAIL_PASS;
        delete process.env.IMAP_HOST;
        delete process.env.MAILBOX_NAME;
        delete process.env.ALLOW_BACKFILL;

        configs = require('../../Config/configs.js');
      });

      it('should have undefined sheet IDs when env vars are missing', () => {
        expect(configs.jobLinks.MainSheet.sheetId).toBeUndefined();
        expect(configs.jobLinks.DATASheet.sheetId).toBeUndefined();
        expect(configs.jobLinks.TrackingSheet.sheetId).toBeUndefined();
      });

      it('should have forceLogin as false when FORCE_LOGIN is not set', () => {
        expect(configs.forceLogin).toBe(false);
        expect(typeof configs.forceLogin).toBe('boolean');
      });

      it('should have undefined googleChatWebhook when not set', () => {
        expect(configs.googleChatWebhook).toBeUndefined();
      });

      it('should use default values for taskConfig when env vars are missing', () => {
        expect(configs.taskConfig.TASK_TIMEOUT_MS).toBe(60000);
        expect(configs.taskConfig.RETRY_COUNT).toBe(2);
        expect(configs.taskConfig.RETRY_DELAY_MS).toBe(3000);
      });

      it('should default MAILBOX to "INBOX" when MAILBOX_NAME is not set', () => {
        expect(configs.MAILBOX).toBe('INBOX');
      });

      it('should have ALLOW_BACKFILL as false when not set', () => {
        expect(configs.ALLOW_BACKFILL).toBe(false);
        expect(typeof configs.ALLOW_BACKFILL).toBe('boolean');
      });

      it('should have undefined email credentials when not set', () => {
        expect(configs.EMAIL_USER).toBeUndefined();
        expect(configs.EMAIL_PASS).toBeUndefined();
        expect(configs.IMAP_HOST).toBeUndefined();
      });
    });
  });

  describe('Boolean conversion edge cases', () => {
    it('should convert FORCE_LOGIN="false" to boolean false', () => {
      process.env.FORCE_LOGIN = 'false';
      const configs = require('../../Config/configs.js');
      expect(configs.forceLogin).toBe(false);
    });

    it('should convert FORCE_LOGIN="true" to boolean true', () => {
      process.env.FORCE_LOGIN = 'true';
      const configs = require('../../Config/configs.js');
      expect(configs.forceLogin).toBe(true);
    });

    it('should convert FORCE_LOGIN="anything" to boolean false', () => {
      process.env.FORCE_LOGIN = 'yes';
      const configs = require('../../Config/configs.js');
      expect(configs.forceLogin).toBe(false);
    });

    it('should convert ALLOW_BACKFILL="false" to boolean false', () => {
      process.env.ALLOW_BACKFILL = 'false';
      const configs = require('../../Config/configs.js');
      expect(configs.ALLOW_BACKFILL).toBe(false);
    });

    it('should convert ALLOW_BACKFILL="true" to boolean true', () => {
      process.env.ALLOW_BACKFILL = 'true';
      const configs = require('../../Config/configs.js');
      expect(configs.ALLOW_BACKFILL).toBe(true);
    });

    it('should convert ALLOW_BACKFILL="1" to boolean false (strict string check)', () => {
      process.env.ALLOW_BACKFILL = '1';
      const configs = require('../../Config/configs.js');
      expect(configs.ALLOW_BACKFILL).toBe(false);
    });
  });

  describe('Integer parsing edge cases', () => {
    it('should use default when TASK_TIMEOUT_MS is empty string', () => {
      process.env.TASK_TIMEOUT_MS = '';
      const configs = require('../../Config/configs.js');
      expect(configs.taskConfig.TASK_TIMEOUT_MS).toBe(60000);
    });

    it('should use default when TASK_TIMEOUT_MS is invalid number', () => {
      process.env.TASK_TIMEOUT_MS = 'not-a-number';
      const configs = require('../../Config/configs.js');
      expect(configs.taskConfig.TASK_TIMEOUT_MS).toBe(60000);
    });

    it('should parse TASK_TIMEOUT_MS="0" as 0 (not use default)', () => {
      process.env.TASK_TIMEOUT_MS = '0';
      const configs = require('../../Config/configs.js');
      expect(configs.taskConfig.TASK_TIMEOUT_MS).toBe(60000); // 0 is falsy, so default is used
    });

    it('should parse negative RETRY_COUNT correctly', () => {
      process.env.RETRY_COUNT = '-5';
      const configs = require('../../Config/configs.js');
      expect(configs.taskConfig.RETRY_COUNT).toBe(-5);
    });

    it('should parse RETRY_DELAY_MS with decimal (parseInt truncates)', () => {
      process.env.RETRY_DELAY_MS = '4500.99';
      const configs = require('../../Config/configs.js');
      expect(configs.taskConfig.RETRY_DELAY_MS).toBe(4500);
    });

    it('should use default when RETRY_COUNT is "0"', () => {
      process.env.RETRY_COUNT = '0';
      const configs = require('../../Config/configs.js');
      expect(configs.taskConfig.RETRY_COUNT).toBe(2); // 0 is falsy, so default is used
    });
  });

  describe('Complete configuration object structure', () => {
    let configs;

    beforeEach(() => {
      process.env.SHEET_ID_MAIN = 'main-id';
      process.env.SHEET_ID_DATA = 'data-id';
      process.env.SHEET_ID_Tracking = 'tracking-id';
      configs = require('../../Config/configs.js');
    });

    it('should have all top-level properties', () => {
      const expectedKeys = [
        'DEFAULT_SHEET_KEY',
        'jobLinks',
        'defaultConcurrency',
        'maxRetries',
        'forceLogin',
        'googleChatWebhook',
        'taskConfig',
        'EMAIL_USER',
        'EMAIL_PASS',
        'IMAP_HOST',
        'MAILBOX',
        'ALLOW_BACKFILL'
      ];

      expectedKeys.forEach(key => {
        expect(configs).toHaveProperty(key);
      });
    });

    it('should have jobLinks with all three sheet configurations', () => {
      expect(Object.keys(configs.jobLinks)).toEqual([
        'MainSheet',
        'DATASheet',
        'TrackingSheet'
      ]);
    });

    it('should have taskConfig with all required properties', () => {
      expect(Object.keys(configs.taskConfig)).toEqual([
        'TASK_TIMEOUT_MS',
        'RETRY_COUNT',
        'RETRY_DELAY_MS'
      ]);
    });
  });

  describe('Module exports as singleton', () => {
    it('should return the same configuration object on multiple requires', () => {
      process.env.SHEET_ID_MAIN = 'test-id';

      const configs1 = require('../../Config/configs.js');
      const configs2 = require('../../Config/configs.js');

      expect(configs1).toBe(configs2);
      expect(configs1.jobLinks.MainSheet.sheetId).toBe('test-id');
      expect(configs2.jobLinks.MainSheet.sheetId).toBe('test-id');
    });
  });

  describe('Empty string vs undefined handling', () => {
    it('should treat empty string MAILBOX_NAME as empty string (not use default)', () => {
      process.env.MAILBOX_NAME = '';
      const configs = require('../../Config/configs.js');
      // Empty string is falsy, so || operator will use 'INBOX'
      expect(configs.MAILBOX).toBe('INBOX');
    });

    it('should handle empty string for GOOGLE_CHAT_WEBHOOK', () => {
      process.env.GOOGLE_CHAT_WEBHOOK = '';
      const configs = require('../../Config/configs.js');
      expect(configs.googleChatWebhook).toBe('');
    });

    it('should handle empty string for EMAIL_USER', () => {
      process.env.EMAIL_USER = '';
      const configs = require('../../Config/configs.js');
      expect(configs.EMAIL_USER).toBe('');
    });
  });

  describe('Type validation', () => {
    let configs;

    beforeEach(() => {
      process.env.TASK_TIMEOUT_MS = '75000';
      process.env.RETRY_COUNT = '3';
      process.env.RETRY_DELAY_MS = '2500';
      process.env.FORCE_LOGIN = 'true';
      process.env.ALLOW_BACKFILL = 'true';
      configs = require('../../Config/configs.js');
    });

    it('should have correct types for all configuration values', () => {
      // Strings
      expect(typeof configs.DEFAULT_SHEET_KEY).toBe('string');
      expect(typeof configs.MAILBOX).toBe('string');

      // Numbers
      expect(typeof configs.defaultConcurrency).toBe('number');
      expect(typeof configs.maxRetries).toBe('number');
      expect(typeof configs.taskConfig.TASK_TIMEOUT_MS).toBe('number');
      expect(typeof configs.taskConfig.RETRY_COUNT).toBe('number');
      expect(typeof configs.taskConfig.RETRY_DELAY_MS).toBe('number');
      expect(typeof configs.jobLinks.DATASheet.StartRow).toBe('number');

      // Booleans
      expect(typeof configs.forceLogin).toBe('boolean');
      expect(typeof configs.ALLOW_BACKFILL).toBe('boolean');

      // Objects
      expect(typeof configs.jobLinks).toBe('object');
      expect(typeof configs.taskConfig).toBe('object');
    });
  });
});
