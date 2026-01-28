const retry = require('../Utils/retryHandler');
const withTimeout = require('../Utils/taskTimeout');
const { logSuccess, logFail, logInfo, logProgress } = require('../Logs/logger');
const { BrowserAutomationError } = require('../Errors/customErrors');

// CONSTANTS
const TIMEOUTS = {
  PAGE_LOAD: 30000,
  NETWORK_IDLE: 20000,
  PAGE_READY: 20000,
  ELEMENT_WAIT: 10000,
  ANIMATION_DELAY: 800,
  MODAL_WAIT: 10000,
  BUTTON_WAIT: 5000,
  SHORT_DELAY: 300,
  MEDIUM_DELAY: 1000,
  LONG_DELAY: 1500,
  FILE_LINK_DELAY: 2000,
  SSO_REDIRECT: 3000,
  SSO_WAIT: 15000,
  CHEVRON_RETRY: 8000,
  NAVIGATION_FALLBACK: 3000,
  CHEVRON_SCROLL_DELAY: 400,
  STEP1_TIMEOUT: 15000,
  STEP2TO6_TIMEOUT: 45000
};

const SELECTORS = {
  CHANGE_STATUS_BTN: '#taskActionConfirm',
  ENTITY_STATUS: '#entityStatus',
  ATTACHMENTS_TAB: 'a[href$="/attachments"]',
  FILE_LINK: 'a[onclick^="TMS.startTranslation"]',
  MODAL_CONTENT: '.modal-content, .popup-container',
  MODAL_MESSAGE: '.modal-message',
  SELECT2_CHOSEN: '.select2-chosen',
  MODAL_SELECT2: '.modal-content .select2-chosen, .popup-container .select2-chosen',
  SET_LICENCE_BTN: 'button.btn.btn-primary.js_loader',
  MICROSOFT_EMAIL_INPUT: '#i0116',
  MICROSOFT_PASSWORD_INPUT: '#i0118',
  EMAIL_INPUT: 'input[type="email"]',
  PASSWORD_INPUT: 'input[type="password"]'
};

const CONFIG = {
  LICENCE_NAME: 'EQHOmoraviateam',
  INELIGIBLE_STATUSES: ['on hold'],
  CHEVRON_MAX_RETRIES: 3,
  STEP1_RETRIES: 2,
  STEP2TO6_RETRIES: 2,
  RETRY_DELAY: 1000,
  SCROLL_OFFSET: 300
};

// Helper function to replace deprecated page.waitForTimeout
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits until page is fully ready by checking modal disappearance and navigation completion
 * @param {Page} page - Puppeteer page instance
 * @throws {Error} If page doesn't load within timeout
 */
async function waitUntilPageIsReady(page) {
  try {
    await page.waitForFunction(() => {
      const modal = document.querySelector('.modal-message');
      const text = document.body.innerText;
      return (!modal || modal.offsetParent === null) &&
             !text.includes("Please wait a few moments") &&
             !text.includes("Please wait");
    }, { timeout: TIMEOUTS.PAGE_READY });

    const navResult = await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      sleep(TIMEOUTS.NAVIGATION_FALLBACK).then(() => 'no-navigation')
    ]);

    if (navResult === 'no-navigation') {
      logInfo('No further navigation detected (acceptable)');
    }

    logSuccess('Page fully loaded and ready.');
  } catch (err) {
    throw new Error(`Page did not load in time: ${err.message}`);
  }
}

/**
 * Checks if the current page is a 404 Not Found error
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{ok: boolean, state: string}>} Result object with ok status and state
 */
async function checkNotFound(page) {
  try {
    const title = (await page.title()).toLowerCase();
    const content = (await page.content()).toLowerCase();
    const url = page.url();

    if (
      title.includes('404') ||
      content.includes('404 not found') ||
      content.includes('page not found')
    ) {
      logFail(`404 Not Found: ${url}`);
      return { ok: false, state: 'NOT_FOUND' };
    }

    return { ok: true, state: 'OK' };
  } catch (err) {
    logFail(`Failed to check 404: ${err.message}`);
    return { ok: false, state: 'CHECK_FAILED' };
  }
}

/**
 * Checks if task status is eligible for acceptance
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{allowed: boolean, reason?: string}>} Result object indicating if status is allowed
 */
async function checkTaskStatus(page) {
  try {
    const statusText = await page.$eval(SELECTORS.ENTITY_STATUS, el => el.innerText.trim().toLowerCase());
    if (CONFIG.INELIGIBLE_STATUSES.includes(statusText)) {
      logFail(`Status not allowed: ${statusText}`);
      return { allowed: false, reason: `Status is not eligible: ${statusText}` };
    }
    return { allowed: true };
  } catch (err) {
    logFail(`Failed to check status: ${err.message}`);
    return { allowed: false, reason: `Unable to read status: ${err.message}` };
  }
}

/**
 * Step 1: Clicks the Change Status button
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{success: boolean, reason?: string}>} Result object
 */
async function step1_ChangeStatus(page) {
  try {
    const selector = SELECTORS.CHANGE_STATUS_BTN;

    await page.waitForFunction(sel => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return (
        el.offsetParent !== null &&
        !el.disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight
      );
    }, { timeout: TIMEOUTS.ELEMENT_WAIT }, selector);

    await page.evaluate(sel => {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.click();
      }
    }, selector);

    logSuccess('STEP 1: Clicked Change Status button.');
    return { success: true };
  } catch (err) {
    const reason = `STEP 1 failed: ${err.message}`;
    return {
      success: false,
      reason,
      error: new BrowserAutomationError(reason, 'STEP_1', { selector: SELECTORS.CHANGE_STATUS_BTN })
    };
  }
}

/**
 * Helper: Waits for element and clicks it with scroll into view
 * @param {Page} page - Puppeteer page instance
 * @param {string} selector - CSS selector
 * @param {Object} options - Wait options
 * @returns {Promise<void>}
 */
async function waitAndClick(page, selector, options = {}) {
  const { timeout = TIMEOUTS.ELEMENT_WAIT, scrollIntoView = true } = options;
  await page.waitForSelector(selector, { timeout });

  if (scrollIntoView) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: 'center' });
    }, selector);
    await sleep(TIMEOUTS.SHORT_DELAY);
  }

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.click();
  }, selector);
}

/**
 * Helper: Selects option from Select2 dropdown by text content
 * @param {Page} page - Puppeteer page instance
 * @param {string} optionText - Text to match in dropdown options
 * @returns {Promise<void>}
 */
async function selectDropdownOption(page, optionText) {
  const optionXPath = `//div[contains(@class, 'select2-result-label') and contains(text(), '${optionText}')]`;
  const option = await page.waitForXPath(optionXPath, { timeout: TIMEOUTS.ELEMENT_WAIT });
  await option.click();
  await sleep(TIMEOUTS.ANIMATION_DELAY);
}

/**
 * Step 2: Opens the Attachments tab if not already there
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function openAttachmentsTab(page) {
  try {
    const currentUrl = page.url();

    if (currentUrl.includes('/attachments')) {
      logInfo('Already in Attachments tab. Skipping STEP 2.');
      return { success: true };
    }

    await waitAndClick(page, SELECTORS.ATTACHMENTS_TAB);
    logSuccess('STEP 2: Attachments tab opened.');
    return { success: true };
  } catch (err) {
    const reason = `STEP 2 failed: ${err.message}`;
    return {
      success: false,
      reason,
      error: new BrowserAutomationError(reason, 'STEP_2', { selector: SELECTORS.ATTACHMENTS_TAB })
    };
  }
}

/**
 * Step 3: Expands the Source section by clicking chevron icon
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function expandSourceSection(page) {
  try {
    const sourceChevronXPath = "//div[contains(@class,'grid-row') and .//span[contains(normalize-space(.), 'Source')]]//span[contains(@class,'grid-chevron-icon')]";
    const maxTries = CONFIG.CHEVRON_MAX_RETRIES;
    let success = false;

    for (let i = 1; i <= maxTries; i++) {
      await page.evaluate((offset) => window.scrollBy(0, offset), CONFIG.SCROLL_OFFSET);
      await sleep(TIMEOUTS.CHEVRON_SCROLL_DELAY);

      try {
        await page.waitForXPath(sourceChevronXPath, { timeout: TIMEOUTS.CHEVRON_RETRY });
        const sourceChevron = await page.$x(sourceChevronXPath);

        if (sourceChevron.length > 0) {
          const className = await page.evaluate(el => el.className, sourceChevron[0]);

          if (className.includes('fa-angle-right')) {
            logSuccess('STEP 3: Source section is collapsed. Expanding...');
            await sourceChevron[0].click();
            await sleep(TIMEOUTS.ANIMATION_DELAY);
          } else {
            logSuccess('STEP 3: Source section already expanded.');
          }

          success = true;
          break;
        }
      } catch (innerErr) {
        logFail(`STEP 3: Attempt ${i} failed: ${innerErr.message}`);
      }

      await sleep(TIMEOUTS.MEDIUM_DELAY);
    }

    if (!success) {
      throw new Error('Source chevron not found after retries.');
    }

    return { success: true };
  } catch (err) {
    const reason = `STEP 3 failed: ${err.message}`;
    return {
      success: false,
      reason,
      error: new BrowserAutomationError(reason, 'STEP_3', { context: 'Source chevron expand' })
    };
  }
}

/**
 * Step 4: Clicks file link to trigger licence modal
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function triggerLicenceModal(page) {
  try {
    const fileLink = await page.waitForSelector(SELECTORS.FILE_LINK, { timeout: TIMEOUTS.ELEMENT_WAIT });
    await fileLink.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await sleep(TIMEOUTS.SHORT_DELAY);
    await page.evaluate(el => el.click(), fileLink);
    await sleep(TIMEOUTS.FILE_LINK_DELAY);

    logSuccess('STEP 4: File link clicked.');
    return { success: true };
  } catch (err) {
    const reason = `STEP 4 failed: ${err.message}`;
    return {
      success: false,
      reason,
      error: new BrowserAutomationError(reason, 'STEP_4', { selector: SELECTORS.FILE_LINK })
    };
  }
}

/**
 * Step 5: Selects licence from dropdown and confirms
 * Handles dynamic Select2 dropdown IDs and "About this build" modal interference
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function selectLicenceAndConfirm(page) {
  try {
    await page.waitForSelector(SELECTORS.MODAL_CONTENT, { timeout: TIMEOUTS.MODAL_WAIT });

    // Check and dismiss "About this build" modal if present
    const modalTitle = await page.evaluate(() => {
      const modal = document.querySelector('.modal-content, .popup-container');
      const title = modal?.querySelector('.modal-header, .popup-header, h4, h3');
      return title ? title.textContent.trim() : '';
    });

    if (modalTitle.includes('About this build')) {
      await page.evaluate(() => {
        const closeBtn = document.querySelector('.modal-content .close, .popup-container .close, [data-dismiss="modal"]');
        if (closeBtn) closeBtn.click();
      });
      await sleep(TIMEOUTS.SHORT_DELAY);
    }

    // Wait for dropdown to be ready
    await page.waitForSelector('[id^="select2-chosen"]', { timeout: TIMEOUTS.MODAL_WAIT });

    // Find correct dropdown ID (dynamic)
    const dropdownId = await page.evaluate(() => {
      const allChosen = document.querySelectorAll('[id^="select2-chosen"]');
      for (const el of allChosen) {
        const text = el.textContent.toLowerCase();
        if (text.includes('licence') || text.includes('license') || text.includes('create or select')) {
          return el.id;
        }
      }
      return allChosen[0]?.id || null;
    });

    if (!dropdownId) {
      throw new Error('Licence dropdown not found');
    }

    // Click dropdown to open options
    const licenceDropdown = await page.$(`#${dropdownId}`);
    await licenceDropdown.click();
    await sleep(TIMEOUTS.SHORT_DELAY);

    // Select licence option
    await selectDropdownOption(page, CONFIG.LICENCE_NAME);

    logSuccess('STEP 5: Licence selected.');
    return { success: true };
  } catch (err) {
    const reason = `STEP 5 failed: ${err.message}`;
    return {
      success: false,
      reason,
      error: new BrowserAutomationError(reason, 'STEP_5', { context: 'Licence dropdown selection' })
    };
  }
}

/**
 * Step 6: Clicks the Set Licence button to confirm selection
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function clickSetLicenceButton(page) {
  try {
    const setBtn = await page.waitForSelector(SELECTORS.SET_LICENCE_BTN, { timeout: TIMEOUTS.BUTTON_WAIT });
    await setBtn.evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.evaluate(el => el.click(), setBtn);
    await sleep(TIMEOUTS.MEDIUM_DELAY);

    logSuccess('STEP 6: Licence set successfully.');
    return { success: true };
  } catch (err) {
    const reason = `STEP 6 failed: ${err.message}`;
    return {
      success: false,
      reason,
      error: new BrowserAutomationError(reason, 'STEP_6', { selector: SELECTORS.SET_LICENCE_BTN })
    };
  }
}

/**
 * Step 2-6: Main workflow for setting licence
 * Orchestrates the complete licence selection workflow
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{success: boolean, reason: string}>} Result object
 */
async function step2to6_Workflow(page) {
  try {
    logProgress('STEP 2+: Waiting for page to be ready...');
    await waitUntilPageIsReady(page);

    // Step 2: Open Attachments tab
    const step2Result = await openAttachmentsTab(page);
    if (!step2Result.success) return step2Result;

    await sleep(TIMEOUTS.LONG_DELAY);

    // Step 3: Expand Source section
    const step3Result = await expandSourceSection(page);
    if (!step3Result.success) return step3Result;

    // Step 4: Trigger licence modal by clicking file link
    const step4Result = await triggerLicenceModal(page);
    if (!step4Result.success) return step4Result;

    // Step 5: Select licence from dropdown
    const step5Result = await selectLicenceAndConfirm(page);
    if (!step5Result.success) return step5Result;

    // Step 6: Click Set Licence button
    const step6Result = await clickSetLicenceButton(page);
    if (!step6Result.success) return step6Result;

    return { success: true, reason: 'Licence set successfully.' };
  } catch (err) {
    const reason = `Steps 2-6 failed: ${err.message}`;
    return {
      success: false,
      reason,
      error: err instanceof BrowserAutomationError
        ? err
        : new BrowserAutomationError(reason, 'STEP_2TO6', { originalError: err.message })
    };
  }
}

/**
 * Checks if user is logged in or if session has expired
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<{ok: boolean, state: string}>} Result object with ok status and state
 */
async function checkLoginStatus(page) {
  const isMoravia = (url) =>
    url.includes('projects.moravia.com') ||
    url.includes('projects-new.moravia.com');

  try {
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUTS.SSO_REDIRECT });
  } catch (navErr) {
    logInfo(`SSO navigation timeout (acceptable): ${navErr.message}`);
  }

  const currentUrl = page.url();

  if (isMoravia(currentUrl)) {
    return { ok: true, state: 'OK' };
  }

  if (currentUrl.includes('login.microsoftonline.com')) {
    try {
      await page.waitForFunction(
        () =>
          location.hostname.includes('projects.moravia.com') ||
          location.hostname.includes('projects-new.moravia.com'),
        { timeout: TIMEOUTS.SSO_WAIT }
      );
      return { ok: true, state: 'SSO_REDIRECT' };
    } catch (redirectErr) {
      logInfo(`SSO redirect timeout: ${redirectErr.message}`);

      const stuckOnLogin = await page.evaluate((selectors) => Boolean(
        document.querySelector(selectors.MICROSOFT_EMAIL_INPUT) ||
        document.querySelector(selectors.MICROSOFT_PASSWORD_INPUT) ||
        document.querySelector(selectors.EMAIL_INPUT) ||
        document.querySelector(selectors.PASSWORD_INPUT)
      ), SELECTORS);

      if (stuckOnLogin) {
        logFail(`Login session expired: ${currentUrl}`, true);
        return { ok: false, state: 'LOGIN_EXPIRED' };
      }

      return { ok: true, state: 'UNKNOWN_REDIRECT' };
    }
  }

  return { ok: true, state: 'UNKNOWN' };
}

/**
 * Executes task acceptance workflow on Moravia platform
 * @param {Object} params - Parameters object
 * @param {Page} params.page - Puppeteer page instance
 * @param {string} params.url - Task URL to navigate to
 * @returns {Promise<{success: boolean, reason?: string, url?: string}>} Result object
 */
module.exports = async function execAccept({ page, url }) {
  // Track any fallback page created during retry so we can clean it up
  let fallbackPage = null;

  try {
    logProgress('Starting Moravia task acceptance');
    let currentPage = page;

    try {
      await currentPage.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUTS.PAGE_LOAD });
      logSuccess('Initial navigation successful');
    } catch (gotoErr) {
      logInfo(`First goto failed: ${gotoErr.message} - retrying with new tab...`);

      try {
        const newPage = await page.browser().newPage();
        fallbackPage = newPage; // track for cleanup
        await newPage.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUTS.PAGE_LOAD });

        // Don't close the original page -- it's managed by the caller (browserPool.releasePage).
        // Only switch our reference for the remaining workflow steps.
        logSuccess('Retried with new tab and succeeded.');

        currentPage = newPage;

      } catch (retryErr) {
        // Close fallback page on failure to prevent leak
        if (fallbackPage) {
          try { if (!fallbackPage.isClosed()) await fallbackPage.close(); } catch (_) {}
          fallbackPage = null;
        }
        return {
          success: false,
          reason: `Retry goto failed: ${retryErr.message}`,
          url
        };
      }
    }

    const login = await checkLoginStatus(currentPage);
    if (!login.ok && login.state === 'LOGIN_EXPIRED') {
      logFail('Login expired - will trigger restart');
      return { success: false, reason: 'LOGIN_EXPIRED' };
    }

    const nf = await checkNotFound(currentPage);
    if (!nf.ok) {
      return {
        success: false,
        reason: nf.state === 'NOT_FOUND'
          ? 'Task page returned 404 Not Found'
          : 'Failed to verify task page'
      };
    }

    const taskStatus = await checkTaskStatus(currentPage);
    if (!taskStatus.allowed) {
      return { success: false, reason: taskStatus.reason };
    }

    const step1WithTimeout = async () => await withTimeout(() => step1_ChangeStatus(currentPage), TIMEOUTS.STEP1_TIMEOUT);
    const step2WithTimeout = async () => await withTimeout(() => step2to6_Workflow(currentPage), TIMEOUTS.STEP2TO6_TIMEOUT);

    const step1 = await retry(step1WithTimeout, CONFIG.STEP1_RETRIES, CONFIG.RETRY_DELAY);
    if (!step1.success) return step1;

    const step2to6 = await retry(step2WithTimeout, CONFIG.STEP2TO6_RETRIES, CONFIG.RETRY_DELAY);
    return step2to6;
  } catch (err) {
    const reason = `Error: ${err.message}`;
    return {
      success: false,
      reason,
      error: err instanceof BrowserAutomationError
        ? err
        : new BrowserAutomationError(reason, 'EXEC_ACCEPT', { url, originalError: err.message })
    };
  } finally {
    // Clean up fallback page if it was created and is separate from the original
    if (fallbackPage && fallbackPage !== page) {
      try { if (!fallbackPage.isClosed()) await fallbackPage.close(); } catch (_) {}
    }
  }
};
