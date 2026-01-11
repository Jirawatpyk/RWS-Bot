// Task/runTaskInNewBrowser.js - Updated with Browser Pool
const BrowserPool = require('../BrowserPool/browserPool');
const execAccept = require('../Exec/execAccept');
const withTimeout = require('../Utils/taskTimeout');

// singleton browser pool
let browserPool = null;

function normalizeUrl(url) {
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

module.exports = async function runTaskInNewBrowser({ task }) {
  const fixedUrl = normalizeUrl(task.url);
  let browser = null;

  const taskFn = async () => {
    try {
      if (!browserPool) {
        throw new Error('BrowserPool not initialized. Call initializeBrowserPool() in main first.');
      }

      browser = await browserPool.getBrowser();

      const page = await browser.newPage();
      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);

      try {
        const result = await execAccept({ page, url: fixedUrl });
        return {
          success: result?.success || false,
          reason: result?.reason || '',
          url: fixedUrl
        };
      } finally {
        try { await page.close(); } catch {}
      }
    } catch (err) {
      return {
        success: false,
        reason: err.message,
        url: fixedUrl
      };
    } finally {
      if (browser && browserPool) {
        await browserPool.releaseBrowser(browser);
      }
    }
  };

  return await withTimeout(taskFn, 60000);
};

// exports for main.js
module.exports.initializeBrowserPool = initializeBrowserPool;
module.exports.closeBrowserPool = closeBrowserPool;
module.exports.getBrowserPoolStatus = () => {
  return browserPool ? browserPool.getStatus() : { status: 'not initialized' };
};
