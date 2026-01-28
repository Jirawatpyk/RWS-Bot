// BrowserPool/browserPool.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { logSuccess, logFail, logInfo, logProgress } = require('../Logs/logger');
const { TIMEOUTS, BROWSER_POOL } = require('../Config/constants');

class BrowserPool {
  constructor(options = {}) {
    this.poolSize = options.poolSize || 4;
    this.profileRoot =
      options.profileRoot || path.join(__dirname, '../Session/chrome-profiles');

    if (!fs.existsSync(this.profileRoot)) {
      fs.mkdirSync(this.profileRoot, { recursive: true });
    }

    // Use Map<slotIndex, browser> instead of array to prevent memory leak
    this.browsers = new Map();
    this.availableSlots = [];
    this.busySlots = new Set();
    this.isInitialized = false;
    this._initPromise = null; // Guard concurrent initialize() calls
    this._closing = false;    // Guard auto-recreate during closeAll

    // Page tracking: Map<page, { createdAt, browserSlot }> for leak detection
    this.activePages = new Map();
    this._cleanupInterval = null;

    this.baseLaunchOptions = {
      headless: "new",
      executablePath: puppeteer.executablePath(),
      defaultViewport: { width: 1200, height: 800 },
      args: [
        '--disable-setuid-sandbox',
        '--window-size=1200,800',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ]
    };

    // Only add --no-sandbox when explicitly requested (e.g. Docker)
    if (options.noSandbox) {
      this.baseLaunchOptions.args.unshift('--no-sandbox');
    }
  }

  async initialize() {
    if (this.isInitialized) return;
    // Prevent concurrent initialize() calls from double-creating browsers
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInitialize();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  async _doInitialize() {
    logProgress(`Initializing browser pool with ${this.poolSize} browsers...`);

    const launched = [];
    try {
      for (let i = 1; i <= this.poolSize; i++) {
        const browser = await this.createBrowser(i);
        launched.push({ slot: i, browser });
      }

      // All succeeded — register them
      for (const { slot, browser } of launched) {
        this.browsers.set(slot, browser);
        this._makeSlotAvailable(slot);
      }

      this.isInitialized = true;
      this.startPeriodicCleanup();
      logSuccess(`Browser pool initialized successfully (${this.poolSize} browsers)`);
    } catch (error) {
      // Partial failure: close any browsers that were launched
      for (const { browser } of launched) {
        try {
          if (browser.isConnected()) await browser.close();
        } catch (_) { /* ignore close errors during cleanup */ }
      }
      logFail(`Failed to initialize browser pool: ${error.message}`);
      throw error;
    }
  }

  async createBrowser(slotIndex) {
    if (!Number.isInteger(slotIndex) || slotIndex < 1) {
      throw new Error(`createBrowser expects positive integer slot index, got: ${slotIndex}`);
    }

    const userDataDir = path.join(this.profileRoot, `profile_${slotIndex}`);
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    logInfo(`Creating browser slot ${slotIndex} with profile: ${userDataDir}`);

    const browser = await puppeteer.launch({
      ...this.baseLaunchOptions,
      userDataDir
    });

    // Store slot index as a non-enumerable property to avoid accidental serialization
    Object.defineProperty(browser, '_slotIndex', {
      value: slotIndex,
      writable: false,
      enumerable: false,
      configurable: false
    });

    browser.on('disconnected', () => {
      logInfo(`Browser slot ${slotIndex} disconnected`);
      this._handleDisconnected(slotIndex);
    });

    return browser;
  }

  /**
   * Acquire a browser from the pool.
   * Node.js is single-threaded so shift() is atomic within a synchronous block —
   * no mutex needed as long as we don't yield between length check and shift().
   */
  async getBrowser(timeout = TIMEOUTS.BROWSER_ACQUIRE) {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return this._acquireSlot(timeout);
  }

  async _acquireSlot(timeout) {
    const startTime = Date.now();

    while (this.availableSlots.length === 0) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for available browser from pool');
      }
      await new Promise(resolve => setTimeout(resolve, TIMEOUTS.BROWSER_POLLING_INTERVAL));
    }

    // shift() is synchronous — safe from race conditions in Node.js event loop
    const slot = this.availableSlots.shift();
    this.busySlots.add(slot);

    let browser = this.browsers.get(slot);

    // Browser disconnected while idle — recreate it (lazy recreate)
    if (!browser || !browser.isConnected()) {
      logInfo(`Browser slot ${slot} disconnected while acquiring, recreating...`);
      try {
        browser = await this.createBrowser(slot);
        this.browsers.set(slot, browser);
      } catch (err) {
        // Failed to recreate — delay re-add to prevent tight retry loop
        this.busySlots.delete(slot);
        setTimeout(() => this._makeSlotAvailable(slot), TIMEOUTS.BROWSER_RECREATE_DELAY);
        throw new Error(`Failed to recreate browser slot ${slot}: ${err.message}`);
      }
    }

    return browser;
  }

  async releaseBrowser(browser) {
    if (!browser || typeof browser._slotIndex !== 'number') {
      logInfo('releaseBrowser called with invalid browser, ignoring');
      return;
    }

    const slot = browser._slotIndex;

    if (!this.busySlots.has(slot)) {
      logInfo(`Browser slot ${slot} not in busy set, ignoring release`);
      return;
    }

    this.busySlots.delete(slot);

    if (browser.isConnected()) {
      this._makeSlotAvailable(slot);
      return;
    }

    // Disconnected — recreate before returning to pool
    logInfo(`Released browser slot ${slot} is disconnected, recreating...`);
    try {
      const newBrowser = await this.createBrowser(slot);
      this.browsers.set(slot, newBrowser);
      this._makeSlotAvailable(slot);
    } catch (error) {
      logFail(`Failed to recreate browser slot ${slot}: ${error.message}`);
      // Delay re-add to prevent tight retry loop if Chrome can't launch
      setTimeout(() => this._makeSlotAvailable(slot), TIMEOUTS.BROWSER_RECREATE_DELAY);
    }
  }

  /**
   * Handle browser disconnect event.
   * Uses lazy-recreate strategy: slot stays in availableSlots (or busySlots),
   * and actual recreation happens in getBrowser/releaseBrowser.
   * This avoids Chrome profile conflicts from dual createBrowser calls.
   */
  _handleDisconnected(slotIndex) {
    // Skip if pool is shutting down
    if (this._closing) return;

    // If slot was idle: leave it in availableSlots — _acquireSlot will
    // detect isConnected() === false and lazy-recreate when acquired.
    if (this.availableSlots.includes(slotIndex)) {
      logInfo(`Browser slot ${slotIndex} disconnected while idle, will lazy-recreate on next acquire`);
      return;
    }

    // If slot was busy: releaseBrowser will handle recreation
    if (this.busySlots.has(slotIndex)) {
      logInfo(`Browser slot ${slotIndex} disconnected while busy, will recreate on release`);
    }
  }

  async closeAll() {
    this._closing = true; // Suppress _handleDisconnected auto-recreate
    this.stopPeriodicCleanup();
    logProgress('Closing all browsers in pool...');
    const CLOSE_TIMEOUT = TIMEOUTS.BROWSER_CLOSE;

    const closePromises = [];
    for (const [slot, browser] of this.browsers) {
      if (browser?.isConnected?.()) {
        const closeWithTimeout = new Promise((resolve) => {
          const timer = setTimeout(() => {
            logFail(`Timeout closing browser slot ${slot}, force killing process`);
            try { browser.process()?.kill(); } catch (_) {}
            resolve();
          }, CLOSE_TIMEOUT);

          browser.close()
            .then(() => { clearTimeout(timer); resolve(); })
            .catch(err => {
              clearTimeout(timer);
              logFail(`Error closing browser slot ${slot}: ${err.message}`);
              try { browser.process()?.kill(); } catch (_) {}
              resolve();
            });
        });
        closePromises.push(closeWithTimeout);
      }
    }

    await Promise.all(closePromises);

    this.browsers.clear();
    this.availableSlots = [];
    this.busySlots.clear();
    this.activePages.clear();
    this.isInitialized = false;
    this._closing = false;

    logSuccess('All browsers closed successfully');
  }

  /**
   * Push slot to availableSlots only if not already present.
   * Prevents duplicate slots from causing double-acquire.
   */
  _makeSlotAvailable(slot) {
    if (!this.availableSlots.includes(slot)) {
      this.availableSlots.push(slot);
    }
  }

  // ============================== Page Tracking ==============================

  /**
   * Create a new page from a browser and track it.
   * Use this instead of browser.newPage() directly to prevent page leaks.
   * @param {import('puppeteer').Browser} browser - browser instance from pool
   * @returns {Promise<import('puppeteer').Page>}
   */
  async getPage(browser) {
    const page = await browser.newPage();
    const slot = typeof browser._slotIndex === 'number' ? browser._slotIndex : -1;

    this.activePages.set(page, {
      createdAt: Date.now(),
      browserSlot: slot,
    });

    logInfo(`Page created on slot ${slot} (active pages: ${this.activePages.size})`);
    return page;
  }

  /**
   * Safely close a tracked page and remove it from tracking.
   * Handles already-closed or crashed pages gracefully.
   * @param {import('puppeteer').Page} page
   */
  async releasePage(page) {
    if (!page) return;

    const meta = this.activePages.get(page);
    this.activePages.delete(page);

    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (err) {
      // Page may already be closed or browser disconnected - force cleanup
      logInfo(`releasePage: close failed (slot ${meta?.browserSlot ?? '?'}): ${err.message}`);
      try {
        // Attempt to remove page from browser's page list by destroying CDP session
        const client = page._client?.();
        if (client) {
          await client.send('Target.closeTarget', { targetId: page.target()._targetId }).catch(() => {});
        }
      } catch (_) {
        // Truly unreachable page, nothing more we can do
      }
    }

    logInfo(`Page released from slot ${meta?.browserSlot ?? '?'} (active pages: ${this.activePages.size})`);
  }

  /**
   * Start periodic cleanup interval that scans for orphaned/leaked pages.
   * - Warns when any browser has more pages than PAGE_WARNING_THRESHOLD
   * - Force closes pages older than PAGE_MAX_AGE when count exceeds PAGE_FORCE_CLEANUP_THRESHOLD
   */
  startPeriodicCleanup() {
    if (this._cleanupInterval) return; // already running

    const interval = BROWSER_POOL.PAGE_CLEANUP_INTERVAL;
    logInfo(`Starting periodic page cleanup (every ${interval / 1000}s)`);

    this._cleanupInterval = setInterval(() => {
      this._runPageCleanup().catch(err => {
        logFail(`Page cleanup error: ${err.message}`);
      });
    }, interval);

    // Allow Node.js to exit even if interval is running
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Stop the periodic cleanup interval.
   */
  stopPeriodicCleanup() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
      logInfo('Periodic page cleanup stopped');
    }
  }

  /**
   * Internal: scan all browsers for page leaks and clean up if needed.
   */
  async _runPageCleanup() {
    const now = Date.now();
    const warnThreshold = BROWSER_POOL.PAGE_WARNING_THRESHOLD;
    const forceThreshold = BROWSER_POOL.PAGE_FORCE_CLEANUP_THRESHOLD;
    const maxAge = BROWSER_POOL.PAGE_MAX_AGE;

    let totalClosed = 0;

    for (const [slot, browser] of this.browsers) {
      if (!browser?.isConnected?.()) continue;

      let pages;
      try {
        pages = await browser.pages();
      } catch {
        continue; // browser may have disconnected mid-scan
      }

      // Filter out the default about:blank page
      const userPages = pages.filter(p => {
        try { return p.url() !== 'about:blank'; } catch { return false; }
      });

      const pageCount = userPages.length;

      if (pageCount > warnThreshold) {
        logInfo(`[PageCleanup] Slot ${slot}: ${pageCount} pages open (warning threshold: ${warnThreshold})`);
      }

      if (pageCount > forceThreshold) {
        logFail(`[PageCleanup] Slot ${slot}: ${pageCount} pages exceeds force threshold (${forceThreshold}), cleaning old pages...`);

        for (const page of userPages) {
          const meta = this.activePages.get(page);
          const age = meta ? now - meta.createdAt : Infinity;

          // Only close pages older than maxAge - active tasks should be younger
          if (age > maxAge) {
            try {
              logInfo(`[PageCleanup] Force closing page on slot ${slot} (age: ${Math.round(age / 1000)}s)`);
              this.activePages.delete(page);
              if (!page.isClosed()) {
                await page.close();
              }
              totalClosed++;
            } catch (err) {
              logInfo(`[PageCleanup] Failed to close page on slot ${slot}: ${err.message}`);
            }
          }
        }
      }
    }

    // Also clean tracked pages whose browser is gone (orphaned entries in activePages)
    for (const [page, meta] of this.activePages) {
      try {
        if (page.isClosed()) {
          this.activePages.delete(page);
          totalClosed++;
          logInfo(`[PageCleanup] Removed closed page from tracking (slot ${meta.browserSlot})`);
        }
      } catch {
        // page reference is invalid, remove from tracking
        this.activePages.delete(page);
        totalClosed++;
      }
    }

    if (totalClosed > 0) {
      logSuccess(`[PageCleanup] Cleaned up ${totalClosed} pages (remaining tracked: ${this.activePages.size})`);
    }
  }

  /**
   * Get the browsers Map for external consumers (e.g., HealthMonitor).
   * Returns a read-only view — callers should not modify the Map directly.
   * @returns {Map<number, import('puppeteer').Browser>}
   */
  getBrowsers() {
    return this.browsers;
  }

  getStatus() {
    return {
      poolSize: this.poolSize,
      totalBrowsers: this.browsers.size,
      availableBrowsers: this.availableSlots.length,
      busyBrowsers: this.busySlots.size,
      activePages: this.activePages.size,
      isInitialized: this.isInitialized,
      profileRoot: this.profileRoot
    };
  }
}

module.exports = BrowserPool;
