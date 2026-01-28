// Task/runTaskInNewBrowser.js - Updated with Browser Pool
const BrowserPool = require('../BrowserPool/browserPool');
const execAccept = require('../Exec/execAccept');
const withTimeout = require('../Utils/taskTimeout');
const { TIMEOUTS } = require('../Config/constants');

// Config: ใช้จาก env หรือ default from constants
const TASK_TIMEOUT_MS = parseInt(process.env.TASK_TIMEOUT_MS, 10) || TIMEOUTS.TASK_EXECUTION;

// singleton browser pool
let browserPool = null;

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }
  const mode = process.env.MORAVIA_REWRITE_MODE;
  if (mode === 'projects-new') {
    return url.replace('projects.moravia.com', 'projects-new.moravia.com');
  }
  return url;
}

async function initializeBrowserPool(poolSize = 4) {
  if (!browserPool) {
    browserPool = new BrowserPool({ poolSize });
    await browserPool.initialize();
  }
  return browserPool;
}

async function closeBrowserPool() {
  if (browserPool) {
    await browserPool.closeAll();
    browserPool = null;
  }
}

/**
 * Run task in browser from pool
 * @param {Object} param0 - Task object
 * @param {Object} param0.task - Task with url property
 * @returns {Promise<{success: boolean, reason: string, url: string}>}
 */
async function runTaskInNewBrowser({ task }) {
  // Fix #3: Validate task.url
  if (!task?.url) {
    return {
      success: false,
      reason: 'Invalid task: missing url',
      url: null
    };
  }

  const fixedUrl = normalizeUrl(task.url);
  let browser = null;
  let page = null;

  try {
    if (!browserPool) {
      throw new Error('BrowserPool not initialized. Call initializeBrowserPool() in main first.');
    }

    // Fix #1: ย้าย getBrowser ออกมานอก withTimeout
    // เพื่อให้ finally cleanup ทำงานได้แม้ timeout
    browser = await browserPool.getBrowser();
    page = await browser.newPage();

    // Fix #4: ใช้ TASK_TIMEOUT_MS จาก config
    page.setDefaultTimeout(TASK_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(TASK_TIMEOUT_MS);

    // เฉพาะ execAccept ที่อยู่ใน withTimeout
    const taskFn = async () => {
      const result = await execAccept({ page, url: fixedUrl });
      return {
        success: result?.success || false,
        reason: result?.reason || '',
        url: fixedUrl
      };
    };

    return await withTimeout(taskFn, TASK_TIMEOUT_MS);

  } catch (err) {
    return {
      success: false,
      reason: err.message,
      url: fixedUrl
    };
  } finally {
    // Fix #1 & #2: Cleanup ทำงานเสมอ แม้ timeout
    // และ capture reference ก่อนใช้งาน
    if (page) {
      try { await page.close(); } catch {}
    }
    if (browser) {
      const pool = browserPool; // Fix #2: capture reference ป้องกัน race condition
      if (pool) {
        try {
          await pool.releaseBrowser(browser);
        } catch (releaseErr) {
          // Ignore release errors during shutdown
        }
      }
    }
  }
}

module.exports = runTaskInNewBrowser;

// exports for main.js
module.exports.initializeBrowserPool = initializeBrowserPool;
module.exports.closeBrowserPool = closeBrowserPool;
module.exports.getBrowserPoolStatus = () => {
  return browserPool ? browserPool.getStatus() : { status: 'not initialized' };
};
