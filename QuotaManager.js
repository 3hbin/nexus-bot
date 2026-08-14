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
 * Cảnh báo khi gần hết (còn ≤ 8 hoặc ≤ 10% limit).
 */
function maybeWarn(userId, type = 'chat') {
  const { remaining, limit, used } = checkQuota(userId, type);
  if (remaining <= 0) return null;
  const lowAbs = remaining <= 8;
  const lowPct = limit > 0 && remaining / limit <= 0.1;
  if (lowAbs || lowPct) {
    return (
      `⚠️ **Sắp hết hạn mức ${type}** — còn **${remaining}/${limit}** hôm nay.\n` +
      `Hạn mức reset ~00:00 (UTC+7). Dùng \`/quota\` để xem chi tiết.`
    );
  }
  return null;
}

function getQuotaStatusText(userId) {
  const u = getUsage(userId);
  let geminiLine = '';
  const lock = getGeminiLockStatus();
  if (lock.locked) {
    geminiLine = `\n• 🔒 Gemini API: **đang khóa** — mở lại khoảng **${lock.unlockAtLabel}** (còn ~${lock.remainingLabel})`;
  } else {
    geminiLine = `\n• Gemini API: **sẵn sàng**`;
  }
  return (
    `📊 **Hạn mức API hôm nay** (reset 00:00 UTC+7)\n` +
    `• Chat (bot): **${u.chat}/${LIMITS.chat}**\n` +
    `• Ảnh (/imagine): **${u.image}/${LIMITS.image}**\n` +
    `• Video (/video): **${u.video}/${LIMITS.video}**` +
    geminiLine
  );
}

// ==========================================
// KHÓA CHAT KHI GEMINI 429 / HẾT QUOTA
// ==========================================
const GEMINI_LOCK_FILE = path.join(__dirname, 'data', 'geminiLock.json');

/** @type {{ until: number, reason: string, model: string|null, lockedAt: number }|null} */
let geminiLock = null;

/** Midnight tiếp theo theo UTC+7 (ms) — free tier daily thường reset theo ngày */
function nextMidnightUtc7Ms() {
  const now = Date.now();
  const offset = 7 * 60 * 60 * 1000;
  const local = new Date(now + offset);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  // 00:00 ngày mai UTC+7 = Date.UTC(y,m,d+1) - offset
  return Date.UTC(y, m, d + 1, 0, 0, 0) - offset;
}

function formatRemaining(ms) {
  if (ms <= 0) return '0 phút';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60);
  const rm = min % 60;
  return rm ? `${h}h ${rm} phút` : `${h} giờ`;
}

function formatTimeLabel(ts) {
  try {
    return new Date(ts).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  } catch {
    return new Date(ts).toISOString();
  }
}

async function loadGeminiLock() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(GEMINI_LOCK_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!content) {
      geminiLock = null;
      return;
    }
    const obj = JSON.parse(content);
    if (obj && obj.until && Number(obj.until) > Date.now()) {
      geminiLock = {
        until: Number(obj.until),
        reason: obj.reason || 'quota',
        model: obj.model || null,
        lockedAt: obj.lockedAt || Date.now(),
      };
      console.log(`🔒 Gemini lock active until ${formatTimeLabel(geminiLock.until)}`);
    } else {
      geminiLock = null;
      if (obj) await clearGeminiLock();
    }
  } catch (err) {
    console.error('QuotaManager: loadGeminiLock error', err);
    geminiLock = null;
  }
}

async function saveGeminiLock() {
  try {
    await ensureDataDir();
    if (!geminiLock) {
      await fs.writeFile(GEMINI_LOCK_FILE, '{}', 'utf8');
      return;
    }
    await fs.writeFile(GEMINI_LOCK_FILE, JSON.stringify(geminiLock, null, 2), 'utf8');
  } catch (err) {
    console.error('QuotaManager: saveGeminiLock error', err);
  }
}

/**
 * Khóa chat Gemini đến thời điểm unlock.
 * @param {object} opts
 * @param {number} [opts.untilMs] - timestamp mở khóa
 * @param {number} [opts.retryAfterSec] - từ header/API retryDelay
 * @param {string} [opts.model]
 * @param {string} [opts.reason]
 */
async function lockGeminiQuota(opts = {}) {
  const now = Date.now();
  let until = opts.untilMs || 0;

  if (!until && opts.retryAfterSec && opts.retryAfterSec > 0) {
    // retryDelay ngắn (vài phút) → dùng đúng; nếu < 2 phút nhưng lỗi daily → ưu tiên midnight
    const retryMs = opts.retryAfterSec * 1000;
    until = now + Math.max(retryMs, 60 * 1000);
  }

  // Daily free tier: nếu không có retry rõ ràng hoặc retry quá ngắn so với daily limit message
  if (!until || (opts.isDailyQuota && until - now < 30 * 60 * 1000)) {
    until = nextMidnightUtc7Ms();
  }

  // Tối thiểu khóa 2 phút để tránh spam API
  if (until < now + 2 * 60 * 1000) {
    until = now + 2 * 60 * 1000;
  }

  geminiLock = {
    until,
    reason: opts.reason || 'gemini_quota',
    model: opts.model || null,
    lockedAt: now,
  };
  await saveGeminiLock();
  console.log(`🔒 lockGeminiQuota until ${formatTimeLabel(until)} model=${opts.model || '?'}`);
  return getGeminiLockStatus();
}

async function clearGeminiLock() {
  geminiLock = null;
  await saveGeminiLock();
}

/**
 * @returns {{ locked: boolean, remainingMs: number, remainingLabel: string, unlockAtLabel: string, model: string|null, message: string|null }}
 */
function getGeminiLockStatus() {
  if (!geminiLock || !geminiLock.until) {
    return {
      locked: false,
      remainingMs: 0,
      remainingLabel: '0',
      unlockAtLabel: '',
      model: null,
      message: null,
    };
  }
  const remainingMs = geminiLock.until - Date.now();
  if (remainingMs <= 0) {
    // Hết hạn khóa — mở lại (lazy clear)
    geminiLock = null;
    saveGeminiLock().catch(() => {});
    return {
      locked: false,
      remainingMs: 0,
      remainingLabel: '0',
      unlockAtLabel: '',
      model: null,
      message: null,
    };
  }

  const remainingLabel = formatRemaining(remainingMs);
  const unlockAtLabel = formatTimeLabel(geminiLock.until);
  const modelLine = geminiLock.model ? `\n> Model bị limit: \`${geminiLock.model}\`` : '';

  const message =
    `⏳ **Nexus đang chờ quota Gemini reset**\n` +
    `Google báo hết hạn mức free tier — chat AI tạm **khóa** để không spam lỗi.\n\n` +
    `• Mở lại khoảng: **${unlockAtLabel}** (UTC+7)\n` +
    `• Còn khoảng: **${remainingLabel}**` +
    modelLine +
    `\n\n💡 Có thể: đổi model trong ticket, dùng key/project khác, hoặc bật Billing trên AI Studio.\n` +
    `📌 Gõ \`/quota\` để xem trạng thái.`;

  return {
    locked: true,
    remainingMs,
    remainingLabel,
    unlockAtLabel,
    model: geminiLock.model,
    message,
  };
}

/**
 * Parse lỗi Gemini để quyết định có khóa không + retry seconds.
 * @param {any} apiErr
 * @param {string|null} modelId
 */
function parseGeminiQuotaError(apiErr, modelId = null) {
  const status =
    apiErr?.status || apiErr?.code || apiErr?.response?.status || apiErr?.error?.code || '';
  const rawMsg = String(
    apiErr?.message ||
      apiErr?.error?.message ||
      apiErr?.response?.data?.error?.message ||
      apiErr ||
      ''
  );

  const is429 = String(status).includes('429') || /RESOURCE_EXHAUSTED/i.test(rawMsg);
  const isQuota =
    is429 ||
    /quota|rate limit|limit:\s*0|exceeded your current quota|free_tier/i.test(rawMsg);

  if (!isQuota) {
    return { isQuota: false };
  }

  const isDailyQuota =
    /PerDay|free_tier_requests|RequestsPerDay|quotaValue":\s*"?\d+/i.test(rawMsg) ||
    /generate_content_free_tier/i.test(rawMsg);

  let retryAfterSec = 0;
  const m = rawMsg.match(/retryDelay["\s:]*"?(\d+(?:\.\d+)?)s?/i);
  if (m) retryAfterSec = Math.ceil(parseFloat(m[1]));
  const m2 = rawMsg.match(/Retry-After["\s:]*(\d+)/i);
  if (m2) retryAfterSec = Math.max(retryAfterSec, parseInt(m2[1], 10));

  // Lấy model từ message nếu có
  let model = modelId;
  const mm = rawMsg.match(/model[:\s]+([a-z0-9._-]+)/i);
  if (mm) model = mm[1];

  return {
    isQuota: true,
    isDailyQuota,
    retryAfterSec,
    model: model || modelId,
    rawMsg,
  };
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
  loadGeminiLock,
  lockGeminiQuota,
  clearGeminiLock,
  getGeminiLockStatus,
  parseGeminiQuotaError,
};
