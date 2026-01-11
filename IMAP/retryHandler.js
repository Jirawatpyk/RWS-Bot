async function retry(fn, maxRetries = 3, delayMs = 1000, factor = 1.6, jitter = true) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        let sleep = Math.round(delayMs * Math.pow(factor, attempt - 1));
        if (jitter) {
          const jitterMs = Math.floor(Math.random() * Math.min(250, sleep * 0.15)); // max 250ms
          sleep += jitterMs;
        }
        console.warn(`🔁 Retry #${attempt} failed: ${err.message} (sleep ${sleep}ms)`);
        await new Promise(res => setTimeout(res, sleep));
      }
    }
  }
  throw lastError;
}
module.exports = { retry };
