const { logInfo, logFail, logProgress } = require('../Logs/logger');
const { BrowserAutomationError } = require('../Errors/customErrors');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function retry(taskFn, retries = 3, delayMs = 1000) {
  const totalAttempts = retries + 1;
  let lastResult;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const label = attempt === 1 ? '🟢 First attempt' : `🔁 Retry ${attempt}/${totalAttempts}`;
     logInfo(`${label} → (${taskFn.name || 'anonymous'})`);

    try {
      const result = await taskFn();

      if (result?.success === true) {
         logInfo(`✅ Success on attempt ${attempt}/${totalAttempts} → (${taskFn.name || 'anonymous'})`);
        return result;
      }

      lastResult = result;

      // Log additional step info when result carries a BrowserAutomationError
      if (result?.error instanceof BrowserAutomationError) {
        logFail(`⚠️ Retry failed (${attempt}/${totalAttempts}) [${result.error.step}]: ${result.reason}`);
        if (Object.keys(result.error.details).length > 0) {
          logProgress(`   Details: ${JSON.stringify(result.error.details)}`);
        }
      } else {
        logFail(`⚠️ Retry failed (${attempt}/${totalAttempts}): ${result?.reason || 'Unknown reason'}`);
      }
    } catch (err) {
      // Type-safe error handling: instanceof check before string matching
      if (err instanceof BrowserAutomationError) {
        logFail(`⚠️ Retry exception (${attempt}/${totalAttempts}) [${err.step}]: ${err.message}`);
      } else {
        logFail(`⚠️ Retry exception (${attempt}/${totalAttempts}): ${err.message}`);
      }
    }

    if (attempt < totalAttempts) {
      await delay(delayMs);
    }
  }

  if (lastResult) {
    return lastResult;
  }

  throw new Error(`❌ All ${totalAttempts} attempts failed for ${taskFn.name || 'anonymous'}`);
};
