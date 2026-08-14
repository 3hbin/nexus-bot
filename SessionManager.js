// SessionManager.js
// Lưu lịch sử hội thoại xuống đĩa (DATA_DIR / Volume) để không mất khi redeploy
const fs = require('fs').promises;
const path = require('path');
const { dataFile } = require('./paths.js');

const SESSIONS_FILE = process.env.SESSIONS_FILE || dataFile('sessions.json');

const MAX_HISTORY_MESSAGES = 20;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

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
      console.log(
        '📂 SessionManager: Chưa có sessions.json trong DATA_DIR — tạo mới (gắn Volume để không mất khi deploy).'
      );
      sessionStore = new Map();
    } else {
      console.error('SessionManager: Lỗi khi load sessions:', err);
      sessionStore = new Map();
    }
  }
}

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

function startSessionCleanupScheduler() {
  if (cleanupIntervalHandle) return;
  cleanupIntervalHandle = setInterval(() => {
    pruneExpiredSessions();
  }, CLEANUP_INTERVAL_MS);
}

function getSavedHistory(sessionKey) {
  const data = sessionStore.get(sessionKey);
  return data?.history || [];
}

function updateSessionHistory(sessionKey, fullHistory, model) {
  const trimmed = Array.isArray(fullHistory) ? fullHistory.slice(-MAX_HISTORY_MESSAGES) : [];

  sessionStore.set(sessionKey, {
    history: trimmed,
    model: model || null,
    lastActive: Date.now(),
  });

  scheduleSaveSessions();
}

function clearSessionHistory(sessionKey) {
  if (sessionStore.delete(sessionKey)) {
    scheduleSaveSessions();
    return true;
  }
  return false;
}

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
