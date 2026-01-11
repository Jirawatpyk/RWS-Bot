// tools/cloneProfile.js
const fs = require('fs');
const path = require('path');

const CHROMIUM_LOCK_FILES = new Set([
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
  'LOCK',
]);

function isSafeCount(n) {
  return Number.isInteger(n) && n >= 1 && n <= 10; // ปรับเพดานได้
}

function removeIfExists(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // ✅ ข้ามไฟล์ lock ที่อาจทำให้ปลายทางเพี้ยน
    if (CHROMIUM_LOCK_FILES.has(entry.name)) continue;

    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);

    if (entry.isSymbolicLink()) {
      // ป้องกัน edge case (เลือก: ข้ามไปก่อน)
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Clone profile_master -> profile_1..profile_N
 * @param {Object} opts
 * @param {number} opts.count จำนวนโปรไฟล์ที่ต้องการสร้าง
 * @param {string} opts.rootDir path โฟลเดอร์ chrome-profiles (optional)
 */
async function cloneProfiles({ count = 4, rootDir } = {}) {
  if (!isSafeCount(count)) {
    throw new Error(`Invalid count: ${count} (must be integer 1..10)`);
  }

  const root = rootDir || path.join(__dirname, '..', 'Session', 'chrome-profiles');
  const master = path.join(root, 'profile_master');

  if (!fs.existsSync(master)) {
    throw new Error(`profile_master not found: ${master}`);
  }

  // ✅ ถ้าเจอไฟล์ lock ใน master ให้แจ้งปิด browser ก่อน (กัน clone profile พัง)
  for (const f of CHROMIUM_LOCK_FILES) {
    const p = path.join(master, f);
    if (fs.existsSync(p)) {
      throw new Error(
        `profile_master appears to be in use (lock file: ${f}). Close Chrome/Puppeteer and try again.`
      );
    }
  }

  for (let i = 1; i <= count; i++) {
    const dest = path.join(root, `profile_${i}`);
    removeIfExists(dest);
    copyDir(master, dest);
  }

  return { success: true, count, root };
}

module.exports = { cloneProfiles };
