// BrowserPool/browserPool.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { logSuccess, logFail, logInfo, logProgress } = require('../Logs/logger');

class BrowserPool {
  constructor(options = {}) {
    this.poolSize = options.poolSize || 4;
    this.profileRoot =
      options.profileRoot || path.join(__dirname, '../Session/chrome-profiles');

    if (!fs.existsSync(this.profileRoot)) {
      fs.mkdirSync(this.profileRoot, { recursive: true });
    }

    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers = new Set();
    this.isInitialized = false;

    this.baseLaunchOptions = {
      headless: "new",
      executablePath: puppeteer.executablePath(),
      defaultViewport: { width: 1200, height: 800 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1200,800',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    };
  }

  async initialize() {
    if (this.isInitialized) return;

    logProgress(`⚙️ Initializing browser pool with ${this.poolSize} browsers...`);

    try {
      const browserPromises = [];
      for (let i = 0; i < this.poolSize; i++) {
        browserPromises.push(this.createBrowser(i + 1));
      }

      this.browsers = await Promise.all(browserPromises);
      this.availableBrowsers = [...this.browsers];
      this.isInitialized = true;

      logSuccess(`✅ Browser pool initialized successfully (${this.poolSize} browsers)`);
    } catch (error) {
      logFail(`❌ Failed to initialize browser pool: ${error.message}`);
      throw error;
    }
  }

  async createBrowser(index) {
    try {
      if (!Number.isInteger(index)) {
        throw new Error(`createBrowser(index) expects integer slot index, got: ${index}`);
      }

      // ✅ โปรไฟล์แยกต่อ browser (profile_1..profile_4)
      const userDataDir = path.join(this.profileRoot, `profile_${index}`);
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }

      logInfo(`⛏️ Creating browser slot ${index} with profile: ${userDataDir}`);

      const browser = await puppeteer.launch({
        ...this.baseLaunchOptions,
        userDataDir
      });

      // ✅ ผูก slot ไว้กับ browser เพื่อใช้ตอน replace
      browser.__slotIndex = index;

      browser.on('disconnected', () => {
        logInfo(`🔵 Browser slot ${index} disconnected`);
        this.handleBrowserDisconnected(browser);
      });

      return browser;
    } catch (error) {
      logFail(`❌ Failed to create browser ${index}: ${error.message}`);
      throw error;
    }
  }

  async getBrowser(timeout = 30000) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    // รอจนกว่าจะมี browser ว่าง
    while (this.availableBrowsers.length === 0) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for available browser from pool');
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const browser = this.availableBrowsers.shift();
    this.busyBrowsers.add(browser);

    // ตรวจสอบว่า browser ยังเชื่อมต่ออยู่หรือไม่
    if (!browser.isConnected()) {
      const slot = browser.__slotIndex;

      logInfo(`🔁 Browser slot ${slot} disconnected while acquiring, recreating...`);

      // เอา browser ตัวเก่าออกจาก busy
      this.busyBrowsers.delete(browser);

      // สร้างใหม่ด้วย "slot เดิม" เท่านั้น (ห้ามใช้ 'replacement')
      const newBrowser = await this.createBrowser(slot);

      // เก็บในรายการทั้งหมดด้วย
      this.browsers.push(newBrowser);
      this.busyBrowsers.add(newBrowser);

      return newBrowser;
    }

    return browser;
  }

  async releaseBrowser(browser) {
    if (!this.busyBrowsers.has(browser)) {
      logInfo('Browser not found in busy browsers, ignoring release');
      return;
    }

    this.busyBrowsers.delete(browser);

    // ตรวจสอบว่า browser ยังใช้งานได้
    if (browser.isConnected()) {
      this.availableBrowsers.push(browser);
      return;
    }

    // ถ้า disconnected ให้ replace ด้วย slot เดิม
    const slot = browser.__slotIndex;
    logInfo(`🔁 Released browser slot ${slot} is disconnected, recreating...`);

    try {
      const newBrowser = await this.createBrowser(slot);
      this.browsers.push(newBrowser);
      this.availableBrowsers.push(newBrowser);
    } catch (error) {
      logFail(`🔴 Failed to recreate browser slot ${slot}: ${error.message}`);
    }
  }

  handleBrowserDisconnected(browser) {
    // ลบ browser ที่ disconnect ออกจาก available
    const availableIndex = this.availableBrowsers.indexOf(browser);
    if (availableIndex !== -1) {
      this.availableBrowsers.splice(availableIndex, 1);
    }

    // ลบออกจาก busy
    this.busyBrowsers.delete(browser);

    // ลบออกจาก browsers list
    const browsersIndex = this.browsers.indexOf(browser);
    if (browsersIndex !== -1) {
      this.browsers.splice(browsersIndex, 1);
    }
  }

  async closeAll() {
    logProgress('Closing all browsers in pool...');

    try {
      const closePromises = this.browsers.map(browser => {
        if (browser?.isConnected?.()) {
          return browser.close();
        }
        return null;
      });

      await Promise.all(closePromises.filter(Boolean));

      this.browsers = [];
      this.availableBrowsers = [];
      this.busyBrowsers.clear();
      this.isInitialized = false;

      logSuccess('🟢 All browsers closed successfully');
    } catch (error) {
      logFail(`🔴 Error closing browsers: ${error.message}`);
    }
  }

  getStatus() {
    return {
      poolSize: this.poolSize,
      totalBrowsers: this.browsers.length,
      availableBrowsers: this.availableBrowsers.length,
      busyBrowsers: this.busyBrowsers.size,
      isInitialized: this.isInitialized,
      profileRoot: this.profileRoot
    };
  }
}

module.exports = BrowserPool;
