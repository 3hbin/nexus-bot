/**
 * GeminiKeyPool — xoay vòng nhiều API key Gemini (chỉ cho KEY BOT).
 * Ticket / DM key riêng của user không dùng pool này.
 *
 * Env:
 *   GEMINI_API_KEYS=key1,key2,key3   (ưu tiên)
 *   GEMINI_API_KEY=key1             (fallback nếu chưa set KEYS)
 */

function loadKeysFromEnv() {
  const multi = String(process.env.GEMINI_API_KEYS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi.length) return [...new Set(multi)];

  const single = String(process.env.GEMINI_API_KEY || '').trim();
  return single ? [single] : [];
}

let keys = loadKeysFromEnv();
let activeIndex = 0;
/** Số lần rotate trong chu kỳ hiện tại (reset khi resetRotation) */
let rotatesThisCycle = 0;

function maskKey(k) {
  if (!k || k.length < 12) return '***';
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

function reloadFromEnv() {
  keys = loadKeysFromEnv();
  if (activeIndex >= keys.length) activeIndex = 0;
  return keys.length;
}

function getCurrentKey() {
  if (!keys.length) reloadFromEnv();
  if (!keys.length) return null;
  if (activeIndex < 0 || activeIndex >= keys.length) activeIndex = 0;
  return keys[activeIndex];
}

/**
 * Chuyển sang key kế tiếp (vòng tròn).
 * @returns {string|null} key mới, hoặc null nếu đã thử hết cả pool trong chu kỳ này
 */
function rotateKey() {
  if (!keys.length) reloadFromEnv();
  if (keys.length <= 1) {
    // Không phải bug: env chỉ có 1 key → không thể xoay
    console.warn(
      `[KeyPool] Không thể rotate — pool chỉ có ${keys.length} key. ` +
        `Thêm key: GEMINI_API_KEYS=key1,key2,key3`
    );
    return null;
  }

  const from = activeIndex;
  // Đã rotate keys.length - 1 lần trong chu kỳ → lần tới sẽ về key đầu = đã thử hết
  if (rotatesThisCycle >= keys.length - 1) {
    console.warn(
      `[KeyPool] Đã thử hết ${keys.length} key trong chu kỳ (index ${from}) → null`
    );
    return null;
  }

  activeIndex = (activeIndex + 1) % keys.length;
  rotatesThisCycle += 1;
  console.log(
    `[KeyPool] rotateKey: index ${from} → ${activeIndex} (chu kỳ ${rotatesThisCycle}/${keys.length - 1})`
  );
  return keys[activeIndex];
}

/** Reset chu kỳ rotate — gọi khi bắt đầu xử lý tin nhắn bot-key mới */
function resetRotation() {
  rotatesThisCycle = 0;
  // Giữ activeIndex hiện tại (key vừa dùng ổn) — chỉ reset “đã thử hết”
}

function getPoolSize() {
  if (!keys.length) reloadFromEnv();
  return keys.length;
}

function getActiveIndex() {
  return activeIndex;
}

function getPoolStatus() {
  if (!keys.length) reloadFromEnv();
  if (!keys.length) {
    return '🔑 Key pool: **trống** — set `GEMINI_API_KEYS` hoặc `GEMINI_API_KEY`.';
  }
  const lines = keys.map((k, i) => {
    const mark = i === activeIndex ? '→' : ' ';
    return `${mark} [${i + 1}/${keys.length}] \`${maskKey(k)}\``;
  });
  return (
    `🔑 **Gemini key pool:** ${keys.length} key · đang dùng #${activeIndex + 1}\n` +
    lines.join('\n')
  );
}

module.exports = {
  loadKeysFromEnv,
  reloadFromEnv,
  getCurrentKey,
  rotateKey,
  resetRotation,
  getPoolSize,
  getActiveIndex,
  getPoolStatus,
  maskKey,
};
