// BrowserPool/browserPool.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { logSuccess, logFail, logInfo, logProgress } = require('../Logs/logger');
const { TIMEOUTS } = require('../Config/constants');

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

    this.baseLaunchOptions = {
      headless: true,
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
      setTimeout(() => this._makeSlotAvailable(slot), 5000);
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

  getStatus() {
    return {
      poolSize: this.poolSize,
      totalBrowsers: this.browsers.size,
      availableBrowsers: this.availableSlots.length,
      busyBrowsers: this.busySlots.size,
      isInitialized: this.isInitialized,
      profileRoot: this.profileRoot
    };
  }
}

module.exports = BrowserPool;
