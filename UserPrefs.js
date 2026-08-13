// UserPrefs.js
// Lưu preference cá nhân (persona ngoài ticket, TTS, mode…)
const fs = require('fs').promises;
const path = require('path');
const { DEFAULT_PERSONA_ID, PERSONA_PRESETS } = require('./Interest.js');

const PREFS_FILE = path.join(__dirname, 'data', 'userPrefs.json');

/** @type {Map<string, { selectedPersona?: string, customPersonaText?: string|null, ttsEnabled?: boolean, replyMode?: string }>} */
let prefs = new Map();
let saveTimer = null;

async function ensureDataDir() {
  try {
    await fs.mkdir(path.dirname(PREFS_FILE), { recursive: true });
  } catch (_) {}
}

async function loadUserPrefs() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(PREFS_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!content) {
      prefs = new Map();
      return;
    }
    const obj = JSON.parse(content);
    prefs = new Map(Object.entries(obj || {}));
    console.log(`📂 UserPrefs: loaded ${prefs.size} users.`);
  } catch (err) {
    console.error('UserPrefs: load error', err);
    prefs = new Map();
  }
}

async function saveUserPrefsNow() {
  try {
    await ensureDataDir();
    await fs.writeFile(PREFS_FILE, JSON.stringify(Object.fromEntries(prefs), null, 2), 'utf8');
  } catch (err) {
    console.error('UserPrefs: save error', err);
  }
}

function scheduleSave(delay = 300) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveUserPrefsNow().catch(() => {});
    saveTimer = null;
  }, delay);
}

function getUserPrefs(userId) {
  const id = String(userId);
  return (
    prefs.get(id) || {
      selectedPersona: DEFAULT_PERSONA_ID,
      customPersonaText: null,
      ttsEnabled: false,
      replyMode: 'normal', // normal | strict
      voiceChat: false,
    }
  );
}

function setUserPersona(userId, personaId, customText = null) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  cur.selectedPersona = personaId || DEFAULT_PERSONA_ID;
  cur.customPersonaText = personaId === 'custom' ? customText || null : null;
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

function setUserTts(userId, enabled) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  cur.ttsEnabled = !!enabled;
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

function setUserReplyMode(userId, mode) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  cur.replyMode = mode === 'strict' ? 'strict' : 'normal';
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

function setUserVoiceChat(userId, enabled) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  cur.voiceChat = !!enabled;
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

function personaDisplayName(personaId, customText) {
  if (personaId === 'custom') {
    const t = (customText || '').trim();
    return t ? `Tùy chỉnh: ${t.slice(0, 50)}${t.length > 50 ? '…' : ''}` : 'Tùy chỉnh';
  }
  return PERSONA_PRESETS[personaId]?.label || PERSONA_PRESETS[DEFAULT_PERSONA_ID].label;
}

/** Đoạn system instruction thêm khi mode strict */
function getStrictModeBlock() {
  return `
[Chế độ STRICT]
- Trả lời ngắn gọn, đúng trọng tâm, ít hoặc không emoji.
- Không tán gẫu, không meme, không kéo dài.
- Ưu tiên gạch đầu dòng khi liệt kê.
`.trim();
}

module.exports = {
  loadUserPrefs,
  getUserPrefs,
  setUserPersona,
  setUserTts,
  setUserReplyMode,
  setUserVoiceChat,
  personaDisplayName,
  getStrictModeBlock,
  saveUserPrefsNow,
};
