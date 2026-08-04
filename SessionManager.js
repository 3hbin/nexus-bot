// SessionManager.js
// Quản lý lưu trữ & khôi phục lịch sử hội thoại (chat history) xuống đĩa,
// để userSessions không bị mất khi bot restart (redeploy trên Render, crash, v.v.)
//
// Thiết kế:
// - Lưu theo sessionKey (giống key dùng trong userSessions ở index.js): `${userId}_${channelId}_${model}`
// - Mỗi session lưu: { history: [...], model, lastActive }
// - history là mảng theo format Gemini SDK: [{ role: 'user'|'model', parts: [{ text }] }, ...]
// - Giới hạn tối đa MAX_HISTORY_MESSAGES tin/session (mặc định 20) để tránh phình file.
// - Session không hoạt động quá SESSION_TTL_MS (mặc định 7 ngày) sẽ tự động bị dọn khi load hoặc theo lịch định kỳ.
// - Ghi file có debounce để tránh I/O liên tục khi chat dồn dập.

const fs = require('fs').promises;
const path = require('path');

const SESSIONS_FILE =
  process.env.SESSIONS_FILE || path.join(__dirname, 'data', 'sessions.json');

const MAX_HISTORY_MESSAGES = 20; // giữ 20 tin gần nhất mỗi session (user+model tính chung)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // dọn dẹp mỗi giờ

// Map<sessionKey, { history: Array, model: string, lastActive: number }>
let sessionStore = new Map();

let saveTimeout = null;
let cleanupIntervalHandle = null;

async function ensureDataDir() {
  const dir = path.dirname(SESSIONS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error('SessionManager: Lỗi khi tạo thư mục data:', err);
  }
}

async function saveSessionsToFile() {
  try {
    await ensureDataDir();
    const obj = Object.fromEntries(sessionStore);
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('SessionManager: Lỗi khi lưu sessions:', err);
  }
}

function scheduleSaveSessions(delay = 500) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveSessionsToFile().catch((err) =>
      console.error('SessionManager: Lỗi scheduleSaveSessions:', err)
    );
    saveTimeout = null;
  }, delay);
}

async function loadSessionsFromFile() {
  try {
    const content = await fs.readFile(SESSIONS_FILE, 'utf8');
    const obj = JSON.parse(content || '{}');
    sessionStore = new Map(Object.entries(obj));
    console.log(`📂 SessionManager: Loaded ${sessionStore.size} sessions từ ${SESSIONS_FILE}`);
    pruneExpiredSessions();
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('📂 SessionManager: Không tìm thấy file sessions, khởi tạo mới.');
      sessionStore = new Map();
    } else {
      console.error('SessionManager: Lỗi khi load sessions:', err);
      sessionStore = new Map();
    }
  }
}

/**
 * Xoá các session đã quá hạn (không hoạt động > SESSION_TTL_MS).
 * Trả về số lượng session đã bị xoá.
 */
function pruneExpiredSessions() {
  const now = Date.now();
  let removed = 0;
  for (const [key, data] of sessionStore.entries()) {
    const lastActive = data?.lastActive || 0;
    if (now - lastActive > SESSION_TTL_MS) {
      sessionStore.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`🧹 SessionManager: Đã dọn ${removed} session hết hạn (>7 ngày không hoạt động).`);
    scheduleSaveSessions();
  }
  return removed;
}

/**
 * Bắt đầu lịch dọn dẹp session hết hạn định kỳ.
 */
function startSessionCleanupScheduler() {
  if (cleanupIntervalHandle) return;
  cleanupIntervalHandle = setInterval(() => {
    pruneExpiredSessions();
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Lấy lịch sử đã lưu cho một sessionKey (dùng để khôi phục chat session khi tạo mới).
 */
function getSavedHistory(sessionKey) {
  const data = sessionStore.get(sessionKey);
  return data?.history || [];
}

/**
 * Cập nhật (ghi đè) toàn bộ lịch sử cho một sessionKey, tự động cắt bớt theo MAX_HISTORY_MESSAGES
 * và cập nhật lastActive. Lên lịch lưu xuống file (debounced).
 */
function updateSessionHistory(sessionKey, fullHistory, model) {
  const trimmed = Array.isArray(fullHistory)
    ? fullHistory.slice(-MAX_HISTORY_MESSAGES)
    : [];

  sessionStore.set(sessionKey, {
    history: trimmed,
    model: model || null,
    lastActive: Date.now(),
  });

  scheduleSaveSessions();
}

/**
 * Xoá lịch sử đã lưu cho một sessionKey cụ thể (ví dụ khi /reset).
 */
function clearSessionHistory(sessionKey) {
  if (sessionStore.delete(sessionKey)) {
    scheduleSaveSessions();
    return true;
  }
  return false;
}

/**
 * Xoá tất cả session có key bắt đầu bằng prefix (ví dụ theo userId khi /reset).
 */
function clearSessionsByPrefix(prefix) {
  let removed = 0;
  for (const key of sessionStore.keys()) {
    if (key.startsWith(prefix)) {
      sessionStore.delete(key);
      removed++;
    }
  }
  if (removed > 0) scheduleSaveSessions();
  return removed;
}

function getSessionCount() {
  return sessionStore.size;
}

async function flushSessionsNow() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  await saveSessionsToFile();
}

module.exports = {
  loadSessionsFromFile,
  startSessionCleanupScheduler,
  getSavedHistory,
  updateSessionHistory,
  clearSessionHistory,
  clearSessionsByPrefix,
  pruneExpiredSessions,
  getSessionCount,
  flushSessionsNow,
};
