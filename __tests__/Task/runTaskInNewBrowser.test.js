/**
 * Tests for Task/runTaskInNewBrowser.js
 * Simplified tests focusing on module exports and basic structure
 */

// Mock dependencies
jest.mock('../../BrowserPool/browserPool');
jest.mock('../../Exec/execAccept');
jest.mock('../../Utils/taskTimeout', () => jest.fn((fn) => fn()));

describe('Task/runTaskInNewBrowser.js', () => {
  let runTaskModule;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    runTaskModule = require('../../Task/runTaskInNewBrowser');
  });

  describe('Module Exports', () => {
    it('should export a default function', () => {
      expect(typeof runTaskModule).toBe('function');
    });

    it('should export initializeBrowserPool function', () => {
      expect(typeof runTaskModule.initializeBrowserPool).toBe('function');
    });

    it('should export closeBrowserPool function', () => {
      expect(typeof runTaskModule.closeBrowserPool).toBe('function');
    });

    it('should export getBrowserPoolStatus function', () => {
      expect(typeof runTaskModule.getBrowserPoolStatus).toBe('function');
    });
  });

  describe('getBrowserPoolStatus()', () => {
    it('should return "not initialized" when pool is not created', () => {
      const status = runTaskModule.getBrowserPoolStatus();
      expect(status).toEqual({ status: 'not initialized' });
    });
  });

  describe('runTaskInNewBrowser()', () => {
    it('should return error when browserPool is not initialized', async () => {
      const task = { url: 'https://projects.moravia.com/task/123' };
      const result = await runTaskModule({ task });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('BrowserPool not initialized');
      expect(result.url).toBe(task.url);
    });

    it('should handle URL normalization', async () => {
      const originalEnv = process.env.MORAVIA_REWRITE_MODE;
      process.env.MORAVIA_REWRITE_MODE = 'projects-new';

      // Reset modules to get fresh state
      jest.resetModules();
      const freshModule = require('../../Task/runTaskInNewBrowser');

      const task = { url: 'https://projects.moravia.com/task/123' };
      const result = await freshModule({ task });

      // URL should be normalized even if pool not initialized
      expect(result.url).toBe('https://projects-new.moravia.com/task/123');

      process.env.MORAVIA_REWRITE_MODE = originalEnv;
    });
  });

  describe('initializeBrowserPool()', () => {
    it('should be callable', async () => {
      const BrowserPool = require('../../BrowserPool/browserPool');
      const mockPoolInstance = {
        initialize: jest.fn().mockResolvedValue(),
        getStatus: jest.fn().mockReturnValue({ totalSlots: 4 })
      };
      BrowserPool.mockImplementation(() => mockPoolInstance);

      // Should not throw
      await expect(runTaskModule.initializeBrowserPool()).resolves.not.toThrow();
    });
  });

  describe('closeBrowserPool()', () => {
    it('should be callable when pool is not initialized', async () => {
      // Should not throw even when pool is null
      await expect(runTaskModule.closeBrowserPool()).resolves.not.toThrow();
    });
  });
});
