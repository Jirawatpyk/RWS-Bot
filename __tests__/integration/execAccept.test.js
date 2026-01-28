/**
 * Integration Tests for Exec/execAccept.js
 *
 * Tests the complete browser automation workflow for accepting tasks
 * on the Moravia platform, covering all 6 steps and error scenarios.
 *
 * Key design decisions:
 * - jest.config.js uses resetMocks:true, so mock implementations are cleared
 *   between tests. We must re-set them in beforeEach.
 * - retryHandler wraps async functions and calls fn() -- our mock must do the same.
 * - taskTimeout wraps fn() in Promise.race -- our mock simply calls fn().
 * - page.waitForXPath in selectDropdownOption returns a SINGLE element (not array).
 */

// Declare mock references at module scope so we can re-set in beforeEach
const mockRetry = jest.fn();
const mockWithTimeout = jest.fn();

jest.mock('../../Utils/retryHandler', () => mockRetry);
jest.mock('../../Utils/taskTimeout', () => mockWithTimeout);
jest.mock('../../Logs/logger', () => ({
  logSuccess: jest.fn(),
  logFail: jest.fn(),
  logInfo: jest.fn(),
  logProgress: jest.fn()
}));

const execAccept = require('../../Exec/execAccept');
const { BrowserAutomationError } = require('../../Errors/customErrors');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Re-set mock implementations that resetMocks clears before each test.
 * retry: calls fn() and returns the result (passthrough).
 * withTimeout: calls fn() and returns the result (passthrough).
 */
function setupDefaultMocks() {
  mockRetry.mockImplementation(async (fn) => fn());
  mockWithTimeout.mockImplementation(async (fn) => fn());
}

/**
 * Creates a mock Puppeteer page that passes all checks by default:
 * - goto succeeds
 * - URL is Moravia (login OK)
 * - title/content are normal (no 404)
 * - entityStatus is "new" (allowed)
 * - All step functions resolve successfully
 *
 * The evaluate mock intelligently handles the different contexts it is called in:
 * 1. Scroll/click actions (selector string arg) -> null
 * 2. Chevron className check (element with .click) -> 'fa-angle-down' (expanded)
 * 3. Modal title check (fn references 'modal-content') -> '' (no interfering modal)
 * 4. Dropdown ID lookup (fn references 'select2-chosen' + 'allChosen') -> 'select2-chosen-1'
 * 5. Login form check (fn receives SELECTORS object) -> false (not stuck on login)
 */
function createFullSuccessPage() {
  const mockElement = {
    click: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockResolvedValue(null)
  };

  const page = {
    // Navigation
    goto: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://projects.moravia.com/Task/123/detail'),
    title: jest.fn().mockResolvedValue('Task Detail'),
    content: jest.fn().mockResolvedValue('<html><body>Normal page</body></html>'),

    // Navigation/SSO
    waitForNavigation: jest.fn().mockResolvedValue(null),

    // Used by step1 (button check) and waitUntilPageIsReady, checkLoginStatus
    waitForFunction: jest.fn().mockResolvedValue(null),

    // Used by checkTaskStatus
    $eval: jest.fn().mockResolvedValue('new'),

    // Used by waitAndClick, triggerLicenceModal, selectLicenceAndConfirm, clickSetLicenceButton
    waitForSelector: jest.fn().mockResolvedValue(mockElement),

    // Used by expandSourceSection (waitForXPath) and selectDropdownOption
    // selectDropdownOption expects a SINGLE element, not array
    waitForXPath: jest.fn().mockResolvedValue(mockElement),

    // Used by expandSourceSection ($x returns array)
    $x: jest.fn().mockResolvedValue([mockElement]),

    // Used by selectLicenceAndConfirm to get dropdown element by ID
    $: jest.fn().mockResolvedValue(mockElement),

    // General evaluate - handles multiple contexts
    evaluate: jest.fn().mockImplementation((fn, ...args) => {
      const fnStr = typeof fn === 'function' ? fn.toString() : '';

      // Chevron className check: arg is an element-like object
      if (args.length > 0 && args[0] && typeof args[0] === 'object' && args[0].click) {
        return Promise.resolve('fa-angle-down'); // Already expanded
      }

      // Modal title check
      if (fnStr.includes('modal-content') && fnStr.includes('modal-header')) {
        return Promise.resolve('');
      }

      // Dropdown ID lookup
      if (fnStr.includes('select2-chosen') && fnStr.includes('allChosen')) {
        return Promise.resolve('select2-chosen-1');
      }

      // Login form check (receives SELECTORS object)
      if (fnStr.includes('MICROSOFT_EMAIL_INPUT') || fnStr.includes('selectors')) {
        return Promise.resolve(false);
      }

      // Default: scroll/click actions return null
      return Promise.resolve(null);
    }),

    // Cleanup
    click: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(null),
    isClosed: jest.fn().mockReturnValue(false),

    // Browser reference for fallback tab creation
    browser: jest.fn().mockReturnValue({
      newPage: jest.fn().mockResolvedValue(null)
    })
  };

  return page;
}

/**
 * Creates a basic mock page with minimal defaults.
 * Override specific methods as needed per test.
 */
function createBasicPage(overrides = {}) {
  const mockElement = {
    click: jest.fn().mockResolvedValue(null),
    evaluate: jest.fn().mockResolvedValue(null)
  };

  const page = {
    goto: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://projects.moravia.com/Task/123/detail'),
    title: jest.fn().mockResolvedValue('Task Detail'),
    content: jest.fn().mockResolvedValue('<html><body>Normal</body></html>'),
    waitForNavigation: jest.fn().mockResolvedValue(null),
    waitForFunction: jest.fn().mockResolvedValue(null),
    $eval: jest.fn().mockResolvedValue('new'),
    waitForSelector: jest.fn().mockResolvedValue(mockElement),
    waitForXPath: jest.fn().mockResolvedValue(mockElement),
    $x: jest.fn().mockResolvedValue([mockElement]),
    $: jest.fn().mockResolvedValue(mockElement),
    evaluate: jest.fn().mockResolvedValue(null),
    click: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(null),
    isClosed: jest.fn().mockReturnValue(false),
    browser: jest.fn().mockReturnValue({
      newPage: jest.fn().mockResolvedValue(null)
    }),
    ...overrides
  };

  return page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Exec/execAccept', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  // =========================================================================
  // 1. Happy Path
  // =========================================================================
  describe('Happy Path', () => {
    it('should complete all 6 steps and return success', async () => {
      const page = createFullSuccessPage();

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result).toEqual({ success: true, reason: 'Licence set successfully.' });
      expect(page.goto).toHaveBeenCalledWith(
        'https://projects.moravia.com/Task/123/detail',
        expect.any(Object)
      );
    });
  });

  // =========================================================================
  // 2. Navigation & Login
  // =========================================================================
  describe('Navigation & Login', () => {
    it('should retry with new tab when initial goto fails, then succeed', async () => {
      const fallbackPage = createFullSuccessPage();
      const page = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Navigation timeout')),
        browser: jest.fn().mockReturnValue({
          newPage: jest.fn().mockResolvedValue(fallbackPage)
        })
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(true);
      expect(fallbackPage.goto).toHaveBeenCalled();
    });

    it('should return failure when retry goto also fails', async () => {
      const failPage = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Network error'))
      });

      const page = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Initial timeout')),
        browser: jest.fn().mockReturnValue({
          newPage: jest.fn().mockResolvedValue(failPage)
        })
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Retry goto failed');
    });

    it('should detect LOGIN_EXPIRED when stuck on Microsoft login', async () => {
      const page = createBasicPage({
        // checkLoginStatus calls url() at line 471 -- must return login page URL
        url: jest.fn()
          .mockReturnValue('https://login.microsoftonline.com/common/oauth2/authorize'),

        // SSO navigation timeout (caught in checkLoginStatus)
        waitForNavigation: jest.fn().mockRejectedValue(new Error('SSO timeout')),

        // SSO redirect wait times out (caught, then checks for login form)
        waitForFunction: jest.fn().mockRejectedValue(new Error('SSO redirect timeout')),

        // Login form IS present -> stuckOnLogin = true
        evaluate: jest.fn().mockResolvedValue(true)
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('LOGIN_EXPIRED');
    });

    it('should detect 404 Not Found page', async () => {
      const page = createBasicPage({
        title: jest.fn().mockResolvedValue('404 - Not Found'),
        content: jest.fn().mockResolvedValue('<html><body>404 not found</body></html>')
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/999/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('404');
    });

    it('should handle SSO redirect that completes successfully', async () => {
      const page = createFullSuccessPage();

      // checkLoginStatus: url() returns login page -> enters SSO path
      // openAttachmentsTab: url() returns moravia detail page
      page.url = jest.fn()
        .mockReturnValueOnce('https://login.microsoftonline.com/oauth2') // checkLoginStatus
        .mockReturnValue('https://projects.moravia.com/Task/123/detail'); // subsequent calls

      // SSO navigation rejects (caught), then waitForFunction resolves (redirect success)
      page.waitForNavigation = jest.fn()
        .mockRejectedValueOnce(new Error('nav timeout'))  // SSO nav
        .mockResolvedValue(null); // waitUntilPageIsReady

      // waitForFunction succeeds for all calls (SSO redirect + step1 + pageReady)
      page.waitForFunction = jest.fn().mockResolvedValue(null);

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // 3. Task Status Validation
  // =========================================================================
  describe('Task Status Validation', () => {
    it('should reject "on hold" status', async () => {
      const page = createBasicPage({
        $eval: jest.fn().mockResolvedValue('on hold')
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('not eligible');
      expect(result.reason).toContain('on hold');
    });

    it('should return failure when status element not found', async () => {
      const page = createBasicPage({
        $eval: jest.fn().mockRejectedValue(new Error('Element not found'))
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Unable to read status');
    });
  });

  // =========================================================================
  // 4. Step 1: Change Status Button
  // =========================================================================
  describe('Step 1: Change Status Button', () => {
    it('should fail with BrowserAutomationError when button not found', async () => {
      const page = createBasicPage({
        // waitForFunction fails in step1 (button not visible/found)
        waitForFunction: jest.fn().mockRejectedValue(new Error('Timeout waiting for button'))
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('STEP 1 failed');
      expect(result.error).toBeInstanceOf(BrowserAutomationError);
      expect(result.error.step).toBe('STEP_1');
      expect(result.error.details.selector).toBe('#taskActionConfirm');
    });
  });

  // =========================================================================
  // 5. Step 2: Attachments Tab
  // =========================================================================
  describe('Step 2: Attachments Tab', () => {
    it('should skip if already on attachments URL', async () => {
      const page = createFullSuccessPage();
      // All url() calls return attachments URL
      page.url = jest.fn().mockReturnValue('https://projects.moravia.com/Task/123/attachments');

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(true);
    });

    it('should fail when attachments tab not found', async () => {
      // Step 1 passes (waitForFunction resolves first call), but waitForSelector fails
      const callCount = { waitForFunction: 0 };
      const page = createBasicPage({
        waitForFunction: jest.fn().mockImplementation(() => {
          callCount.waitForFunction++;
          // First call is step1 button check, let it pass
          // Second call is waitUntilPageIsReady, let it pass
          return Promise.resolve(null);
        }),
        waitForSelector: jest.fn().mockRejectedValue(new Error('Tab not found'))
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('STEP 2 failed');
    });
  });

  // =========================================================================
  // 6. Step 3: Source Section Expansion
  // =========================================================================
  describe('Step 3: Source Section Expansion', () => {
    it('should fail when chevron not found after retries', async () => {
      const page = createBasicPage({
        // waitForFunction passes (step1 + pageReady)
        waitForFunction: jest.fn().mockResolvedValue(null),
        // waitForSelector passes (attachments tab)
        waitForSelector: jest.fn().mockResolvedValue({
          click: jest.fn().mockResolvedValue(null),
          evaluate: jest.fn().mockResolvedValue(null)
        }),
        // chevron XPath never found
        waitForXPath: jest.fn().mockRejectedValue(new Error('Chevron not found')),
        $x: jest.fn().mockResolvedValue([])
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('STEP 3 failed');
    });
  });

  // =========================================================================
  // 7. Step 4: File Link
  // =========================================================================
  describe('Step 4: File Link', () => {
    it('should fail when file link not found', async () => {
      let waitForSelectorCount = 0;
      const page = createFullSuccessPage();

      // Override waitForSelector to fail on file link selector
      page.waitForSelector = jest.fn().mockImplementation((selector) => {
        waitForSelectorCount++;
        // First call: attachments tab (step 2) -> pass
        if (selector === 'a[href$="/attachments"]') {
          return Promise.resolve({
            click: jest.fn().mockResolvedValue(null),
            evaluate: jest.fn().mockResolvedValue(null)
          });
        }
        // File link selector -> fail
        if (selector === 'a[onclick^="TMS.startTranslation"]') {
          return Promise.reject(new Error('File link not found'));
        }
        // Other selectors pass
        return Promise.resolve({
          click: jest.fn().mockResolvedValue(null),
          evaluate: jest.fn().mockResolvedValue(null)
        });
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('STEP 4 failed');
    });
  });

  // =========================================================================
  // 8. Step 5: Licence Dropdown
  // =========================================================================
  describe('Step 5: Licence Dropdown', () => {
    it('should fail when dropdown ID is null', async () => {
      const page = createFullSuccessPage();

      // Override evaluate to return null for dropdown ID lookup
      page.evaluate = jest.fn().mockImplementation((fn, ...args) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : '';

        // Chevron className
        if (args.length > 0 && args[0] && typeof args[0] === 'object' && args[0].click) {
          return Promise.resolve('fa-angle-down');
        }
        // Modal title
        if (fnStr.includes('modal-content') && fnStr.includes('modal-header')) {
          return Promise.resolve('');
        }
        // Dropdown ID -> return null to trigger failure
        if (fnStr.includes('select2-chosen') && fnStr.includes('allChosen')) {
          return Promise.resolve(null);
        }
        return Promise.resolve(null);
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('STEP 5 failed');
    });
  });

  // =========================================================================
  // 9. Step 6: Set Licence Button
  // =========================================================================
  describe('Step 6: Set Licence Button', () => {
    it('should fail when Set Licence button not found', async () => {
      const page = createFullSuccessPage();

      // Override waitForSelector to fail on the Set Licence button
      page.waitForSelector = jest.fn().mockImplementation((selector) => {
        // Set Licence button selector
        if (selector === 'button.btn.btn-primary.js_loader') {
          return Promise.reject(new Error('Button not found'));
        }
        return Promise.resolve({
          click: jest.fn().mockResolvedValue(null),
          evaluate: jest.fn().mockResolvedValue(null)
        });
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('STEP 6 failed');
    });
  });

  // =========================================================================
  // 10. Error Classes and Metadata
  // =========================================================================
  describe('Error Metadata', () => {
    it('should include selector in BrowserAutomationError details for Step 1', async () => {
      const page = createBasicPage({
        waitForFunction: jest.fn().mockRejectedValue(new Error('Element not found'))
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.error).toBeInstanceOf(BrowserAutomationError);
      expect(result.error.details.selector).toBe('#taskActionConfirm');
    });

    it('should wrap generic errors in catch block', async () => {
      const page = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Network error')),
        browser: jest.fn().mockReturnValue({
          newPage: jest.fn().mockRejectedValue(new Error('Cannot create page'))
        })
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Retry goto failed');
    });
  });

  // =========================================================================
  // 11. Resource Cleanup
  // =========================================================================
  describe('Resource Cleanup', () => {
    it('should close fallback page in finally block when goto retry succeeds', async () => {
      const fallbackPage = createFullSuccessPage();

      const page = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Navigation timeout')),
        browser: jest.fn().mockReturnValue({
          newPage: jest.fn().mockResolvedValue(fallbackPage)
        })
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(true);
      // Fallback page should be closed in finally block
      expect(fallbackPage.close).toHaveBeenCalled();
    });

    it('should close fallback page when retry goto also fails', async () => {
      const failPage = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Network error')),
        close: jest.fn().mockResolvedValue(null),
        isClosed: jest.fn().mockReturnValue(false)
      });

      const page = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Initial timeout')),
        browser: jest.fn().mockReturnValue({
          newPage: jest.fn().mockResolvedValue(failPage)
        })
      });

      await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(failPage.close).toHaveBeenCalled();
    });

    it('should NOT close the original page (managed by browserPool)', async () => {
      const fallbackPage = createFullSuccessPage();
      const originalClose = jest.fn();

      const page = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Navigation timeout')),
        close: originalClose,
        browser: jest.fn().mockReturnValue({
          newPage: jest.fn().mockResolvedValue(fallbackPage)
        })
      });

      await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(originalClose).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 12. Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    it('should handle null page gracefully', async () => {
      const result = await execAccept({
        page: null,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
    });

    it('should handle undefined URL', async () => {
      const page = createBasicPage({
        goto: jest.fn().mockRejectedValue(new Error('Invalid URL')),
        browser: jest.fn().mockReturnValue({
          newPage: jest.fn().mockRejectedValue(new Error('Cannot create'))
        })
      });

      const result = await execAccept({ page, url: undefined });

      expect(result.success).toBe(false);
    });

    it('should stop processing when status is not allowed', async () => {
      const page = createBasicPage({
        $eval: jest.fn().mockResolvedValue('on hold')
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      // waitForFunction should only be called for checkLoginStatus, NOT for step1
      // (because checkTaskStatus returns early before step1)
    });
  });

  // =========================================================================
  // 13. Additional Coverage
  // =========================================================================
  describe('Additional Coverage', () => {
    it('should handle checkNotFound when title/content throws', async () => {
      const page = createBasicPage({
        title: jest.fn().mockRejectedValue(new Error('Page crashed')),
        content: jest.fn().mockRejectedValue(new Error('Page crashed'))
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      // checkNotFound catch returns { ok: false, state: 'CHECK_FAILED' }
      expect(result.success).toBe(false);
      expect(result.reason).toContain('Failed to verify');
    });

    it('should expand collapsed chevron (fa-angle-right)', async () => {
      const chevronEl = {
        click: jest.fn().mockResolvedValue(null),
        evaluate: jest.fn().mockResolvedValue(null)
      };

      const page = createFullSuccessPage();
      page.$x = jest.fn().mockResolvedValue([chevronEl]);

      // Make evaluate return 'fa-angle-right' for chevron className check
      page.evaluate = jest.fn().mockImplementation((fn, ...args) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : '';

        // Chevron className check -> collapsed
        if (args.length > 0 && args[0] && typeof args[0] === 'object' && args[0].click) {
          return Promise.resolve('fa-angle-right grid-chevron-icon');
        }
        // Modal title
        if (fnStr.includes('modal-content') && fnStr.includes('modal-header')) {
          return Promise.resolve('');
        }
        // Dropdown ID
        if (fnStr.includes('select2-chosen') && fnStr.includes('allChosen')) {
          return Promise.resolve('select2-chosen-1');
        }
        return Promise.resolve(null);
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(true);
      expect(chevronEl.click).toHaveBeenCalled();
    });

    it('should dismiss "About this build" modal before licence selection', async () => {
      const page = createFullSuccessPage();

      page.evaluate = jest.fn().mockImplementation((fn, ...args) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : '';

        // Chevron className
        if (args.length > 0 && args[0] && typeof args[0] === 'object' && args[0].click) {
          return Promise.resolve('fa-angle-down');
        }
        // Modal title -> return "About this build" to trigger dismissal
        if (fnStr.includes('modal-content') && fnStr.includes('modal-header')) {
          return Promise.resolve('About this build v1.0');
        }
        // Close modal button click
        if (fnStr.includes('data-dismiss')) {
          return Promise.resolve(null);
        }
        // Dropdown ID
        if (fnStr.includes('select2-chosen') && fnStr.includes('allChosen')) {
          return Promise.resolve('select2-chosen-1');
        }
        return Promise.resolve(null);
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(true);
    });

    it('should handle unknown URL (not moravia, not microsoft login)', async () => {
      const page = createFullSuccessPage();
      // URL is neither moravia nor microsoft login
      page.url = jest.fn()
        .mockReturnValueOnce('https://unknown-site.com/page') // checkLoginStatus
        .mockReturnValue('https://projects.moravia.com/Task/123/detail'); // rest

      // waitForNavigation rejects (no redirect detected)
      page.waitForNavigation = jest.fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue(null);

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      // checkLoginStatus returns { ok: true, state: 'UNKNOWN' } for non-moravia non-login URLs
      expect(result.success).toBe(true);
    });

    it('should handle step2to6 throwing an unexpected error', async () => {
      const page = createFullSuccessPage();

      // Make waitForNavigation in waitUntilPageIsReady throw
      // step1 passes, then step2to6 calls waitUntilPageIsReady which calls waitForFunction
      let waitForFunctionCalls = 0;
      page.waitForFunction = jest.fn().mockImplementation(() => {
        waitForFunctionCalls++;
        if (waitForFunctionCalls === 1) return Promise.resolve(null); // step1
        // pageReady check in step2to6 -> throw generic error
        throw new Error('Unexpected page crash');
      });

      const result = await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Steps 2-6 failed');
    });
  });

  // =========================================================================
  // 14. Timeout Handling
  // =========================================================================
  describe('Timeout Handling', () => {
    it('should apply STEP1_TIMEOUT (15000) and STEP2TO6_TIMEOUT (45000)', async () => {
      const timeoutValues = [];

      mockWithTimeout.mockImplementation(async (fn, timeout) => {
        timeoutValues.push(timeout);
        return fn();
      });

      const page = createFullSuccessPage();

      await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      expect(timeoutValues).toContain(15000);
      expect(timeoutValues).toContain(45000);
    });
  });

  // =========================================================================
  // 14. Retry Behavior
  // =========================================================================
  describe('Retry Behavior', () => {
    it('should pass retry config to retryHandler', async () => {
      const retryCalls = [];

      mockRetry.mockImplementation(async (fn, retries, delay) => {
        retryCalls.push({ retries, delay });
        return fn();
      });

      const page = createFullSuccessPage();

      await execAccept({
        page,
        url: 'https://projects.moravia.com/Task/123/detail'
      });

      // step1 retry: CONFIG.STEP1_RETRIES = 2, CONFIG.RETRY_DELAY = 1000
      expect(retryCalls[0]).toEqual({ retries: 2, delay: 1000 });
      // step2to6 retry: CONFIG.STEP2TO6_RETRIES = 2, CONFIG.RETRY_DELAY = 1000
      expect(retryCalls[1]).toEqual({ retries: 2, delay: 1000 });
    });
  });
});
