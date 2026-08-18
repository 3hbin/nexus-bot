// UserPrefs.js
// Lưu preference cá nhân (persona ngoài ticket, TTS, mode…)
const fs = require('fs').promises;
const path = require('path');
const { dataFile } = require('./paths.js');
const { DEFAULT_PERSONA_ID, PERSONA_PRESETS } = require('./Interest.js');

const PREFS_FILE = dataFile('userPrefs.json');

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
      aiName: null,
      geminiApiKey: null, // DM chat — key Gemini của user
      voiceGender: 'nu', // nam | nu
      language: 'vi', // vi | en | ko | … | auto
      languageSetByUser: false,
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

/** Đặt tên gọi AI (null/empty = mặc định Nexus AI) */
function setUserAiName(userId, name) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  const n = String(name || '').trim().slice(0, 40);
  cur.aiName = n || null;
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

/** Key Gemini cho chat DM (null = xóa) */
function setUserGeminiKey(userId, apiKey) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  const k = String(apiKey || '').trim();
  cur.geminiApiKey = k.length >= 12 ? k : null;
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

function getUserGeminiKey(userId) {
  const k = getUserPrefs(userId).geminiApiKey;
  return k && String(k).trim().length >= 12 ? String(k).trim() : null;
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


function setUserVoiceGender(userId, gender) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  const g = String(gender || 'nu').toLowerCase();
  cur.voiceGender = g === 'nam' || g === 'male' || g === 'm' ? 'nam' : 'nu';
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

/** Mã ngôn ngữ hỗ trợ */
const LANGUAGE_PRESETS = {
  vi: { id: 'vi', label: 'Tiếng Việt', native: 'Tiếng Việt', flag: '🇻🇳' },
  en: { id: 'en', label: 'English', native: 'English', flag: '🇬🇧' },
  ko: { id: 'ko', label: '한국어 (Korean)', native: '한국어', flag: '🇰🇷' },
  ja: { id: 'ja', label: '日本語 (Japanese)', native: '日本語', flag: '🇯🇵' },
  zh: { id: 'zh', label: '中文 (Chinese)', native: '中文', flag: '🇨🇳' },
  th: { id: 'th', label: 'ไทย (Thai)', native: 'ไทย', flag: '🇹🇭' },
  fr: { id: 'fr', label: 'Français', native: 'Français', flag: '🇫🇷' },
  es: { id: 'es', label: 'Español', native: 'Español', flag: '🇪🇸' },
  de: { id: 'de', label: 'Deutsch', native: 'Deutsch', flag: '🇩🇪' },
  ru: { id: 'ru', label: 'Русский', native: 'Русский', flag: '🇷🇺' },
  id: { id: 'id', label: 'Bahasa Indonesia', native: 'Bahasa Indonesia', flag: '🇮🇩' },
};

function normalizeLanguage(code) {
  const c = String(code || 'vi').toLowerCase().trim();
  const aliases = {
    vn: 'vi', viet: 'vi', vietnamese: 'vi', 'tieng-viet': 'vi', 'tiếng việt': 'vi',
    eng: 'en', english: 'en', 'en-us': 'en', 'en-gb': 'en',
    kr: 'ko', korean: 'ko', hangul: 'ko',
    jp: 'ja', japanese: 'ja',
    cn: 'zh', chinese: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh',
    thai: 'th',
    french: 'fr',
    spanish: 'es',
    german: 'de',
    russian: 'ru',
    indo: 'id', indonesian: 'id',
  };
  if (LANGUAGE_PRESETS[c]) return c;
  if (aliases[c]) return aliases[c];
  return 'vi';
}

function setUserLanguage(userId, langCode) {
  const id = String(userId);
  const cur = { ...getUserPrefs(id) };
  const code = String(langCode || 'vi').toLowerCase().trim();
  if (code === 'auto') {
    cur.language = 'auto';
    cur.languageSetByUser = true;
  } else {
    cur.language = normalizeLanguage(code);
    cur.languageSetByUser = true;
  }
  prefs.set(id, cur);
  scheduleSave();
  return cur;
}

function getUserLanguage(userId) {
  return normalizeLanguage(getUserPrefs(userId).language || 'vi');
}

/**
 * Block system instruction bắt AI trả lời đúng ngôn ngữ.
 */
function getLanguageSystemBlock(langCode) {
  const id = normalizeLanguage(langCode);
  const meta = LANGUAGE_PRESETS[id] || LANGUAGE_PRESETS.vi;
  const name = meta.native;
  return `
[Ngôn ngữ trả lời — BẮT BUỘC]
- User đã chọn ngôn ngữ: **${name}** (${id}).
- MỌI câu trả lời phải dùng **${name}** làm ngôn ngữ chính (trừ khi user yêu cầu đổi ngôn ngữ trong tin nhắn đó).
- Code, tên kỹ thuật, brand có thể giữ nguyên tiếng Anh.
- Không trộn ngôn ngữ lung tung; giải thích bằng ${name}.
`.trim();
}


/**
 * Map Discord locale (interaction.locale / guildPreferredLocale) → mã ngôn ngữ bot.
 * Bot Discord KHÔNG nhận IP người dùng → dùng locale Discord (vùng app) thay cho IP.
 */
function localeToLanguage(discordLocale) {
  const loc = String(discordLocale || '').toLowerCase().replace('_', '-');
  if (!loc) return null;
  if (loc.startsWith('vi')) return 'vi';
  if (loc.startsWith('en')) return 'en';
  if (loc.startsWith('ko')) return 'ko';
  if (loc.startsWith('ja')) return 'ja';
  if (loc.startsWith('zh')) return 'zh';
  if (loc.startsWith('th')) return 'th';
  if (loc.startsWith('fr')) return 'fr';
  if (loc.startsWith('es')) return 'es';
  if (loc.startsWith('de')) return 'de';
  if (loc.startsWith('ru')) return 'ru';
  if (loc.startsWith('id')) return 'id';
  return null;
}

/**
 * Ngôn ngữ hiệu lực của user.
 * - Nếu đã set thủ công (languageSetByUser) → dùng language
 * - Nếu language === 'auto' hoặc chưa set → suy từ discordLocale
 * - Mặc định vi
 */
function resolveLanguageForUser(userId, discordLocale) {
  const p = getUserPrefs(userId);
  const raw = String(p.language || 'vi').toLowerCase();
  if (raw === 'auto') {
    return normalizeLanguage(localeToLanguage(discordLocale) || 'vi');
  }
  // Chưa từng chọn thủ công và vẫn default vi → thử locale
  if (!p.languageSetByUser && raw === 'vi') {
    const fromLoc = localeToLanguage(discordLocale);
    if (fromLoc) return fromLoc;
  }
  return normalizeLanguage(raw);
}

function languageDisplay(langCode) {
  const id = normalizeLanguage(langCode);
  const m = LANGUAGE_PRESETS[id] || LANGUAGE_PRESETS.vi;
  return `${m.flag} ${m.label}`;
}

module.exports = {
  loadUserPrefs,
  getUserPrefs,
  setUserPersona,
  setUserTts,
  setUserReplyMode,
  setUserVoiceChat,
  setUserAiName,
  setUserGeminiKey,
  setUserVoiceGender,
  setUserLanguage,
  getUserLanguage,
  getLanguageSystemBlock,
  languageDisplay,
  normalizeLanguage,
  LANGUAGE_PRESETS,
  localeToLanguage,
  resolveLanguageForUser,
  getUserGeminiKey,
  personaDisplayName,
  getStrictModeBlock,
  saveUserPrefsNow,
};
