// Moderation.js — lọc spam / link lạ trong kênh AI (Admin bật theo server)
const fs = require('fs').promises;
const path = require('path');

const MOD_FILE = path.join(__dirname, 'data', 'moderation.json');

/** @type {Map<string, { enabled: boolean, deleteMsg: boolean, maxRepeats: number }>} */
let settings = new Map();

/** userId -> { content, count, at } */
const recent = new Map();

async function ensureDataDir() {
  try {
    await fs.mkdir(path.dirname(MOD_FILE), { recursive: true });
  } catch (_) {}
}

async function loadModeration() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(MOD_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!content) {
      settings = new Map();
      return;
    }
    const obj = JSON.parse(content);
    settings = new Map(Object.entries(obj || {}));
    console.log(`📂 Moderation: loaded ${settings.size} guilds.`);
  } catch (err) {
    console.error('Moderation load error', err);
    settings = new Map();
  }
}

async function saveModeration() {
  try {
    await ensureDataDir();
    await fs.writeFile(MOD_FILE, JSON.stringify(Object.fromEntries(settings), null, 2), 'utf8');
  } catch (err) {
    console.error('Moderation save error', err);
  }
}

function getModSettings(guildId) {
  const id = String(guildId);
  return (
    settings.get(id) || {
      enabled: false,
      deleteMsg: true,
      maxRepeats: 3,
    }
  );
}

function setModEnabled(guildId, enabled) {
  const id = String(guildId);
  const cur = { ...getModSettings(id), enabled: !!enabled };
  settings.set(id, cur);
  saveModeration().catch(() => {});
  return cur;
}

const SUSPICIOUS_LINK =
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:discord\.gift|discordgift|steamcommunity\.ru|free-nitro|nitro-free|bit\.ly|tinyurl)(?:\/\S*)?/i;
const INVITE_SPAM = /(?:discord\.gg|discord\.com\/invite)\/[a-z0-9-]+/i;

/**
 * @returns {null | { action: 'warn'|'delete', reason: string }}
 */
function checkMessageModeration(message, { isAiChannel = false } = {}) {
  if (!message.guild) return null;
  const cfg = getModSettings(message.guild.id);
  if (!cfg.enabled) return null;
  if (!isAiChannel) return null;
  if (message.member?.permissions?.has?.('ManageMessages')) return null;

  const text = String(message.content || '').trim();
  if (!text) return null;

  if (SUSPICIOUS_LINK.test(text)) {
    return { action: cfg.deleteMsg ? 'delete' : 'warn', reason: 'Link đáng ngờ (nitro/scam pattern)' };
  }

  // Spam lặp cùng nội dung
  const uid = message.author.id;
  const key = `${message.guild.id}:${uid}`;
  const now = Date.now();
  const prev = recent.get(key);
  if (prev && prev.content === text && now - prev.at < 60_000) {
    prev.count += 1;
    prev.at = now;
    recent.set(key, prev);
    if (prev.count >= (cfg.maxRepeats || 3)) {
      return {
        action: cfg.deleteMsg ? 'delete' : 'warn',
        reason: `Spam lặp tin (${prev.count} lần trong 1 phút)`,
      };
    }
  } else {
    recent.set(key, { content: text, count: 1, at: now });
  }

  // Flood: tin quá dài toàn link
  const links = text.match(/https?:\/\/\S+/gi) || [];
  if (links.length >= 4) {
    return { action: cfg.deleteMsg ? 'delete' : 'warn', reason: 'Quá nhiều link trong 1 tin' };
  }

  return null;
}

module.exports = {
  loadModeration,
  getModSettings,
  setModEnabled,
  checkMessageModeration,
};
