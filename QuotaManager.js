// QuotaManager.js
// Giới hạn số lần gọi API theo user / ngày (chat, imagine, video)
const fs = require('fs').promises;
const path = require('path');

const QUOTA_FILE = path.join(__dirname, 'data', 'quota.json');

/** Giới hạn mặc định — có thể override bằng env */
const LIMITS = {
  chat: Number(process.env.QUOTA_CHAT_PER_DAY) || 80,
  image: Number(process.env.QUOTA_IMAGE_PER_DAY) || 12,
  video: Number(process.env.QUOTA_VIDEO_PER_DAY) || 3,
};

/** @type {Map<string, { chat: number, image: number, video: number }>} key = `${date}:${userId}` */
let usage = new Map();
let saveTimer = null;

function todayKey() {
  // Asia/Ho_Chi_Minh gần đúng UTC+7
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function entryKey(userId) {
  return `${todayKey()}:${userId}`;
}

async function ensureDataDir() {
  try {
    await fs.mkdir(path.dirname(QUOTA_FILE), { recursive: true });
  } catch (_) {}
}

async function loadQuota() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(QUOTA_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!content) {
      usage = new Map();
      return;
    }
    const obj = JSON.parse(content);
    usage = new Map(Object.entries(obj || {}));
    // Dọn entry không phải hôm nay
    const prefix = todayKey() + ':';
    for (const k of [...usage.keys()]) {
      if (!k.startsWith(prefix)) usage.delete(k);
    }
    console.log(`📂 QuotaManager: loaded ${usage.size} entries (today).`);
  } catch (err) {
    console.error('QuotaManager: load error', err);
    usage = new Map();
  }
}

async function saveQuotaNow() {
  try {
    await ensureDataDir();
    const obj = Object.fromEntries(usage);
    await fs.writeFile(QUOTA_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('QuotaManager: save error', err);
  }
}

function scheduleSave(delay = 400) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveQuotaNow().catch(() => {});
    saveTimer = null;
  }, delay);
}

function getUsage(userId) {
  const key = entryKey(userId);
  const cur = usage.get(key) || { chat: 0, image: 0, video: 0 };
  return { ...cur };
}

/**
 * Kiểm tra quota trước khi dùng.
 * @param {string} userId
 * @param {'chat'|'image'|'video'} type
 * @returns {{ allowed: boolean, remaining: number, limit: number, used: number, message?: string }}
 */
function checkQuota(userId, type = 'chat') {
  const limit = LIMITS[type] ?? LIMITS.chat;
  const cur = getUsage(userId);
  const used = cur[type] || 0;
  const remaining = Math.max(0, limit - used);
  if (used >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      used,
      message:
        `⏳ **Bạn đã hết hạn mức ${type} hôm nay** (${used}/${limit}).\n` +
        `Hạn mức reset vào 00:00 (UTC+7). Thử lại vào ngày mai nhé!`,
    };
  }
  return { allowed: true, remaining, limit, used };
}

/**
 * Tăng bộ đếm sau khi gọi API thành công.
 * @param {string} userId
 * @param {'chat'|'image'|'video'} type
 */
function consumeQuota(userId, type = 'chat') {
  const key = entryKey(userId);
  const cur = usage.get(key) || { chat: 0, image: 0, video: 0 };
  cur[type] = (cur[type] || 0) + 1;
  usage.set(key, cur);
  scheduleSave();
  return getUsage(userId);
}

/**
 * Cảnh báo khi gần hết (còn ≤ 5 hoặc ≤ 20%).
 */
function maybeWarn(userId, type = 'chat') {
  const { remaining, limit, used } = checkQuota(userId, type);
  if (remaining <= 0) return null;
  const lowAbs = remaining <= 5;
  const lowPct = remaining / limit <= 0.2;
  if (lowAbs || lowPct) {
    return `⚠️ Còn **${remaining}/${limit}** lượt **${type}** hôm nay.`;
  }
  return null;
}

function getQuotaStatusText(userId) {
  const u = getUsage(userId);
  return (
    `📊 **Hạn mức API hôm nay** (reset 00:00 UTC+7)\n` +
    `• Chat: **${u.chat}/${LIMITS.chat}**\n` +
    `• Ảnh (/imagine): **${u.image}/${LIMITS.image}**\n` +
    `• Video (/video): **${u.video}/${LIMITS.video}**`
  );
}

module.exports = {
  LIMITS,
  loadQuota,
  checkQuota,
  consumeQuota,
  maybeWarn,
  getQuotaStatusText,
  getUsage,
  saveQuotaNow,
};
