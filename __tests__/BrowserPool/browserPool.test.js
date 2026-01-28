/**
 * Tests for BrowserPool/browserPool.js
 *
 * Testing Strategy:
 * 1. Test browser pool initialization
 * 2. Test getBrowser with availability and timeout
 * 3. Test releaseBrowser
 * 4. Test browser disconnection handling (lazy recreate)
 * 5. Test closeAll with timeout and _closing guard
 * 6. Test getStatus
 * 7. Test _makeSlotAvailable dedup
 * 8. Test concurrent initialize guard
 */

const path = require('path');

// Mock dependencies
jest.mock('puppeteer', () => ({
  executablePath: jest.fn(() => '/mock/chromium'),
  launch: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn()
}));

jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logFail: jest.fn(),
  logInfo: jest.fn(),
  logProgress: jest.fn()
}));

const puppeteer = require('puppeteer');
const fs = require('fs');
const BrowserPool = require('../../BrowserPool/browserPool');

describe('BrowserPool/browserPool.js', () => {

  // Helper to create unique mock browser instances
  const createMockBrowser = () => {
    const browser = {
      isConnected: jest.fn(() => true),
      close: jest.fn(() => Promise.resolve()),
      on: jest.fn()
    };
    return browser;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Return new browser instance on each call
    puppeteer.launch.mockImplementation(() => {
      return Promise.resolve(createMockBrowser());
    });
  });

  describe('Constructor', () => {
    it('should initialize with default pool size of 4', () => {
      const pool = new BrowserPool();

      expect(pool.poolSize).toBe(4);
      expect(pool.browsers).toBeInstanceOf(Map);
      expect(pool.browsers.size).toBe(0);
      expect(pool.availableSlots).toEqual([]);
      expect(pool.busySlots).toBeInstanceOf(Set);
      expect(pool.isInitialized).toBe(false);
      expect(pool._closing).toBe(false);
      expect(pool._initPromise).toBeNull();
    });

    it('should initialize with custom pool size', () => {
      const pool = new BrowserPool({ poolSize: 2 });

      expect(pool.poolSize).toBe(2);
    });

    it('should create profile directory if not exists', () => {
      fs.existsSync.mockReturnValue(false);

      new BrowserPool();

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should use custom profile root', () => {
      const customRoot = 'C:\\custom\\profiles';
      const pool = new BrowserPool({ profileRoot: customRoot });

      expect(pool.profileRoot).toBe(customRoot);
    });

    it('should NOT include --no-sandbox by default', () => {
      const pool = new BrowserPool();

      expect(pool.baseLaunchOptions.args).not.toContain('--no-sandbox');
    });

    it('should include --no-sandbox when noSandbox option is true', () => {
      const pool = new BrowserPool({ noSandbox: true });

      expect(pool.baseLaunchOptions.args).toContain('--no-sandbox');
    });
  });

  describe('initialize()', () => {
    it('should create browsers equal to pool size', async () => {
      const pool = new BrowserPool({ poolSize: 3 });

      await pool.initialize();

      expect(puppeteer.launch).toHaveBeenCalledTimes(3);
      expect(pool.browsers.size).toBe(3);
      expect(pool.availableSlots.length).toBe(3);
      expect(pool.isInitialized).toBe(true);
    });

    it('should not re-initialize if already initialized', async () => {
      const pool = new BrowserPool({ poolSize: 2 });

      await pool.initialize();
      const firstCallCount = puppeteer.launch.mock.calls.length;

      await pool.initialize();
      const secondCallCount = puppeteer.launch.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should prevent concurrent initialize calls (deduplicate)', async () => {
      const pool = new BrowserPool({ poolSize: 2 });

      // Call initialize twice concurrently
      const [r1, r2] = await Promise.all([pool.initialize(), pool.initialize()]);

      // Should only launch 2 browsers, not 4
      expect(puppeteer.launch).toHaveBeenCalledTimes(2);
      expect(pool.browsers.size).toBe(2);
    });

    it('should clear _initPromise after completion', async () => {
      const pool = new BrowserPool({ poolSize: 1 });

      await pool.initialize();

      expect(pool._initPromise).toBeNull();
    });

    it('should clear _initPromise after failure', async () => {
      puppeteer.launch.mockRejectedValueOnce(new Error('Launch failed'));

      const pool = new BrowserPool({ poolSize: 1 });

      await expect(pool.initialize()).rejects.toThrow('Launch failed');
      expect(pool._initPromise).toBeNull();
    });

    it('should create browsers with separate profiles', async () => {
      const pool = new BrowserPool({ poolSize: 2 });

      await pool.initialize();

      const call1 = puppeteer.launch.mock.calls[0][0];
      const call2 = puppeteer.launch.mock.calls[1][0];

      expect(call1.userDataDir).toContain('profile_1');
      expect(call2.userDataDir).toContain('profile_2');
      expect(call1.userDataDir).not.toBe(call2.userDataDir);
    });

    it('should attach slot index to each browser', async () => {
      const pool = new BrowserPool({ poolSize: 2 });

      await pool.initialize();

      expect(pool.browsers.get(1)._slotIndex).toBe(1);
      expect(pool.browsers.get(2)._slotIndex).toBe(2);
    });

    it('should throw error and clean up on partial failure', async () => {
      puppeteer.launch
        .mockResolvedValueOnce(createMockBrowser())
        .mockRejectedValueOnce(new Error('Launch failed'));

      const pool = new BrowserPool({ poolSize: 2 });

      await expect(pool.initialize()).rejects.toThrow('Launch failed');
      expect(pool.isInitialized).toBe(false);
    });
  });

  describe('createBrowser()', () => {
    it('should create browser with correct slot index', async () => {
      const pool = new BrowserPool();

      const browser = await pool.createBrowser(3);

      expect(browser._slotIndex).toBe(3);
      expect(puppeteer.launch).toHaveBeenCalled();
    });

    it('should create profile directory for slot', async () => {
      fs.existsSync.mockReturnValue(false);

      const pool = new BrowserPool();
      await pool.createBrowser(2);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('profile_2'),
        expect.any(Object)
      );
    });

    it('should attach disconnected event handler', async () => {
      const pool = new BrowserPool();

      const browser = await pool.createBrowser(1);

      expect(browser.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
    });

    it('should throw error if index is not integer', async () => {
      const pool = new BrowserPool();

      await expect(pool.createBrowser('not-a-number')).rejects.toThrow('expects positive integer');
    });

    it('should throw error if index is less than 1', async () => {
      const pool = new BrowserPool();

      await expect(pool.createBrowser(0)).rejects.toThrow('expects positive integer');
    });

    it('should throw error if browser launch fails', async () => {
      puppeteer.launch.mockRejectedValueOnce(new Error('Launch error'));

      const pool = new BrowserPool();

      await expect(pool.createBrowser(1)).rejects.toThrow('Launch error');
    });
  });

  describe('getBrowser()', () => {
    it('should initialize pool if not initialized', async () => {
      const pool = new BrowserPool({ poolSize: 1 });

      await pool.getBrowser();

      expect(pool.isInitialized).toBe(true);
    });

    it('should return available browser and mark slot as busy', async () => {
      const pool = new BrowserPool({ poolSize: 2 });
      await pool.initialize();

      const browser = await pool.getBrowser();

      expect(browser).toBeDefined();
      expect(pool.availableSlots.length).toBe(1);
      expect(pool.busySlots.size).toBe(1);
    });

    it('should wait for browser to become available', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      const browser1 = await pool.getBrowser();

      const getBrowserPromise = pool.getBrowser(1000);

      setTimeout(() => pool.releaseBrowser(browser1), 50);

      const browser2 = await getBrowserPromise;

      expect(browser2).toBeDefined();
    });

    it('should timeout if no browser available within timeout', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      await pool.getBrowser();

      await expect(pool.getBrowser(100)).rejects.toThrow('Timeout waiting');
    });

    it('should recreate browser if disconnected when acquiring', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      // Make the browser appear disconnected
      const oldBrowser = pool.browsers.get(1);
      oldBrowser.isConnected.mockReturnValue(false);

      puppeteer.launch.mockClear();

      const browser = await pool.getBrowser();

      expect(puppeteer.launch).toHaveBeenCalled();
      expect(browser).not.toBe(oldBrowser);
    });

    it('should delay re-add slot when recreate fails in _acquireSlot', async () => {
      jest.useFakeTimers();
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      // Make browser disconnected
      pool.browsers.get(1).isConnected.mockReturnValue(false);

      puppeteer.launch.mockClear();
      puppeteer.launch.mockRejectedValueOnce(new Error('Recreate failed'));

      await expect(pool.getBrowser(100)).rejects.toThrow('Failed to recreate');

      // Slot NOT immediately available (delayed 5s to prevent tight retry loop)
      expect(pool.availableSlots).not.toContain(1);
      expect(pool.busySlots.size).toBe(0);

      // After 5s delay, slot comes back
      jest.advanceTimersByTime(5000);
      expect(pool.availableSlots).toContain(1);

      jest.useRealTimers();
    });
  });

  describe('releaseBrowser()', () => {
    it('should move slot from busy to available', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      const browser = await pool.getBrowser();

      expect(pool.busySlots.size).toBe(1);
      expect(pool.availableSlots.length).toBe(0);

      await pool.releaseBrowser(browser);

      expect(pool.busySlots.size).toBe(0);
      expect(pool.availableSlots.length).toBe(1);
    });

    it('should ignore releasing browser without _slotIndex', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      const randomBrowser = { isConnected: () => true };

      await expect(pool.releaseBrowser(randomBrowser)).resolves.not.toThrow();
    });

    it('should ignore releasing null browser', async () => {
      const pool = new BrowserPool({ poolSize: 1 });

      await expect(pool.releaseBrowser(null)).resolves.not.toThrow();
    });

    it('should recreate browser if disconnected when releasing', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      const browser = await pool.getBrowser();
      browser.isConnected.mockReturnValue(false);

      puppeteer.launch.mockClear();

      await pool.releaseBrowser(browser);

      expect(puppeteer.launch).toHaveBeenCalled();
      expect(pool.availableSlots.length).toBe(1);
    });

    it('should delay re-add slot when recreation fails on release', async () => {
      jest.useFakeTimers();
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      const browser = await pool.getBrowser();
      browser.isConnected.mockReturnValue(false);

      puppeteer.launch.mockRejectedValueOnce(new Error('Recreation failed'));

      await expect(pool.releaseBrowser(browser)).resolves.not.toThrow();

      // Slot NOT immediately available (delayed 5s)
      expect(pool.availableSlots.length).toBe(0);

      // After 5s delay, slot comes back
      jest.advanceTimersByTime(5000);
      expect(pool.availableSlots.length).toBe(1);

      jest.useRealTimers();
    });
  });

  describe('_handleDisconnected()', () => {
    it('should skip when _closing is true', async () => {
      const { logInfo } = require('../../Logs/logger');
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      pool._closing = true;
      logInfo.mockClear();

      pool._handleDisconnected(1);

      // Should not log anything about disconnect handling
      expect(logInfo).not.toHaveBeenCalledWith(
        expect.stringContaining('lazy-recreate')
      );
    });

    it('should log lazy-recreate message for idle slot', async () => {
      const { logInfo } = require('../../Logs/logger');
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      logInfo.mockClear();
      pool._handleDisconnected(1);

      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('lazy-recreate')
      );
      // Slot should remain in availableSlots for lazy recreate
      expect(pool.availableSlots).toContain(1);
    });

    it('should log message for busy slot disconnect', async () => {
      const { logInfo } = require('../../Logs/logger');
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      const browser = await pool.getBrowser();
      logInfo.mockClear();

      pool._handleDisconnected(browser._slotIndex);

      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('disconnected while busy')
      );
    });

    it('should NOT trigger createBrowser (lazy strategy)', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      puppeteer.launch.mockClear();
      pool._handleDisconnected(1);

      // No new browser created — lazy recreate on next acquire
      expect(puppeteer.launch).not.toHaveBeenCalled();
    });
  });

  describe('closeAll()', () => {
    it('should close all connected browsers', async () => {
      const pool = new BrowserPool({ poolSize: 3 });
      await pool.initialize();

      const browsers = [];
      for (const [, browser] of pool.browsers) {
        browsers.push(browser);
      }

      await pool.closeAll();

      browsers.forEach(browser => {
        expect(browser.close).toHaveBeenCalled();
      });
    });

    it('should clear all collections and reset state', async () => {
      const pool = new BrowserPool({ poolSize: 2 });
      await pool.initialize();

      await pool.closeAll();

      expect(pool.browsers.size).toBe(0);
      expect(pool.availableSlots.length).toBe(0);
      expect(pool.busySlots.size).toBe(0);
      expect(pool.isInitialized).toBe(false);
      expect(pool._closing).toBe(false); // Reset after close
    });

    it('should set _closing flag during close', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      // Replace close to check _closing during execution
      const originalBrowser = pool.browsers.get(1);
      let closingDuringClose = false;
      originalBrowser.close.mockImplementation(() => {
        closingDuringClose = pool._closing;
        return Promise.resolve();
      });

      await pool.closeAll();

      expect(closingDuringClose).toBe(true);
    });

    it('should handle browsers that are not connected', async () => {
      const pool = new BrowserPool({ poolSize: 2 });
      await pool.initialize();

      pool.browsers.get(1).isConnected.mockReturnValue(false);

      await expect(pool.closeAll()).resolves.not.toThrow();
    });

    it('should handle close errors gracefully', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      pool.browsers.get(1).close.mockRejectedValueOnce(new Error('Close failed'));

      await expect(pool.closeAll()).resolves.not.toThrow();
    });
  });

  describe('_makeSlotAvailable()', () => {
    it('should add slot to availableSlots', () => {
      const pool = new BrowserPool();

      pool._makeSlotAvailable(1);

      expect(pool.availableSlots).toEqual([1]);
    });

    it('should NOT add duplicate slot', () => {
      const pool = new BrowserPool();

      pool._makeSlotAvailable(1);
      pool._makeSlotAvailable(1);

      expect(pool.availableSlots).toEqual([1]);
    });

    it('should add different slots', () => {
      const pool = new BrowserPool();

      pool._makeSlotAvailable(1);
      pool._makeSlotAvailable(2);

      expect(pool.availableSlots).toEqual([1, 2]);
    });
  });

  describe('getStatus()', () => {
    it('should return correct status for uninitialized pool', () => {
      const pool = new BrowserPool({ poolSize: 4 });

      const status = pool.getStatus();

      expect(status.poolSize).toBe(4);
      expect(status.totalBrowsers).toBe(0);
      expect(status.availableBrowsers).toBe(0);
      expect(status.busyBrowsers).toBe(0);
      expect(status.isInitialized).toBe(false);
    });

    it('should return correct status for initialized pool', async () => {
      const pool = new BrowserPool({ poolSize: 3 });
      await pool.initialize();

      const status = pool.getStatus();

      expect(status.poolSize).toBe(3);
      expect(status.totalBrowsers).toBe(3);
      expect(status.availableBrowsers).toBe(3);
      expect(status.busyBrowsers).toBe(0);
      expect(status.isInitialized).toBe(true);
    });

    it('should return correct status with busy browsers', async () => {
      const pool = new BrowserPool({ poolSize: 3 });
      await pool.initialize();

      await pool.getBrowser();
      await pool.getBrowser();

      const status = pool.getStatus();

      expect(status.availableBrowsers).toBe(1);
      expect(status.busyBrowsers).toBe(2);
    });

    it('should include profileRoot in status', () => {
      const customRoot = 'C:\\custom\\path';
      const pool = new BrowserPool({ profileRoot: customRoot });

      const status = pool.getStatus();

      expect(status.profileRoot).toBe(customRoot);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle rapid getBrowser/releaseBrowser cycles', async () => {
      const pool = new BrowserPool({ poolSize: 2 });
      await pool.initialize();

      for (let i = 0; i < 5; i++) {
        const browser = await pool.getBrowser();
        await pool.releaseBrowser(browser);
      }

      const status = pool.getStatus();
      expect(status.availableBrowsers).toBe(2);
      expect(status.busyBrowsers).toBe(0);
    });

    it('should maintain slot index when recreating browser on release', async () => {
      const pool = new BrowserPool({ poolSize: 1 });
      await pool.initialize();

      const originalBrowser = await pool.getBrowser();
      const originalSlot = originalBrowser._slotIndex;

      originalBrowser.isConnected.mockReturnValue(false);

      await pool.releaseBrowser(originalBrowser);

      const newBrowser = pool.browsers.get(originalSlot);
      expect(newBrowser._slotIndex).toBe(originalSlot);
    });
  });
});
