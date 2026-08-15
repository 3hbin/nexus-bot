// KnowledgeBase.js — Training / Knowledge Base (tự chỉnh)
// Lưu theo guild + global + theo user (train cá nhân)
const fs = require('fs').promises;
const path = require('path');
const { dataFile } = require('./paths.js');

const KB_FILE = dataFile('knowledgeBase.json');

/**
 * @typedef {{ id: string, text: string, by?: string, at?: number }} KbItem
 * @typedef {{ global: KbItem[], guilds: Record<string, KbItem[]>, users: Record<string, KbItem[]> }} KbStore
 */

/** @type {KbStore} */
let store = { global: [], guilds: {}, users: {} };
let saveTimer = null;
let seq = 1;

const MAX_GLOBAL = 40;
const MAX_GUILD = 30;
const MAX_USER = 20;
const MAX_TEXT = 500;

async function ensureDir() {
  try {
    await fs.mkdir(path.dirname(KB_FILE), { recursive: true });
  } catch (_) {}
}

function nextId() {
  return `kb_${Date.now().toString(36)}_${(seq++).toString(36)}`;
}

async function loadKnowledgeBase() {
  try {
    await ensureDir();
    const raw = await fs.readFile(KB_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!raw) {
      store = { global: [], guilds: {}, users: {} };
      return;
    }
    const obj = JSON.parse(raw);
    store = {
      global: Array.isArray(obj.global) ? obj.global.slice(0, MAX_GLOBAL) : [],
      guilds: obj.guilds && typeof obj.guilds === 'object' ? obj.guilds : {},
      users: obj.users && typeof obj.users === 'object' ? obj.users : {},
    };
    console.log(
      `📂 KnowledgeBase: global=${store.global.length}, guilds=${Object.keys(store.guilds).length}, users=${Object.keys(store.users).length}`
    );
  } catch (e) {
    console.error('KnowledgeBase load', e);
    store = { global: [], guilds: {}, users: {} };
  }
}

async function saveKnowledgeBaseNow() {
  try {
    await ensureDir();
    await fs.writeFile(KB_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('KnowledgeBase save', e);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveKnowledgeBaseNow().catch(() => {});
    saveTimer = null;
  }, 400);
}

function scopeList(scope, guildId, userId) {
  if (scope === 'global') return store.global;
  if (scope === 'guild') {
    const gid = String(guildId || '');
    if (!store.guilds[gid]) store.guilds[gid] = [];
    return store.guilds[gid];
  }
  const uid = String(userId || '');
  if (!store.users[uid]) store.users[uid] = [];
  return store.users[uid];
}

function maxFor(scope) {
  if (scope === 'global') return MAX_GLOBAL;
  if (scope === 'guild') return MAX_GUILD;
  return MAX_USER;
}

/**
 * @param {'global'|'guild'|'user'} scope
 */
function addKnowledge({ scope = 'user', text, guildId, userId, by }) {
  const t = String(text || '').trim().slice(0, MAX_TEXT);
  if (!t) {
    return {
      ok: false,
      message:
        'ℹ️ Thêm tri thức:\n`kb add: nội dung`\n`train: nội dung`\n`kb guild add: ...` (admin server)\n`kb global add: ...` (chủ bot)',
    };
  }
  const list = scopeList(scope, guildId, userId);
  if (list.some((x) => String(x.text).toLowerCase() === t.toLowerCase())) {
    return { ok: false, message: '📌 Mục này đã có trong Knowledge Base.' };
  }
  list.push({
    id: nextId(),
    text: t,
    by: by ? String(by) : undefined,
    at: Date.now(),
  });
  while (list.length > maxFor(scope)) list.shift();
  scheduleSave();
  const label = scope === 'global' ? 'Global' : scope === 'guild' ? 'Server' : 'Cá nhân';
  return {
    ok: true,
    message: `🧠 **Training / KB [${label}]** đã thêm:\n> ${t}\n_(Tối đa ${maxFor(scope)} mục — \`kb list\` xem, \`kb del: từ khóa\` xóa)_`,
  };
}

function listKnowledge({ scope = 'all', guildId, userId }) {
  const lines = [];
  const push = (title, arr) => {
    if (!arr || !arr.length) {
      lines.push(`**${title}:** _(trống)_`);
      return;
    }
    lines.push(`**${title}** (${arr.length}):`);
    arr.forEach((item, i) => {
      lines.push(`\`${i + 1}.\` ${String(item.text).slice(0, 120)}${item.text.length > 120 ? '…' : ''}`);
    });
  };

  if (scope === 'all' || scope === 'user') push('Cá nhân (train)', scopeList('user', null, userId));
  if ((scope === 'all' || scope === 'guild') && guildId) push('Server', scopeList('guild', guildId, null));
  if (scope === 'all' || scope === 'global') push('Global', store.global);

  return '📚 **Knowledge Base / Training**\n' + lines.join('\n');
}

function deleteKnowledge({ scope = 'user', keyword, guildId, userId }) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) {
    return { ok: false, message: 'ℹ️ Xóa: `kb del: từ khóa` hoặc `kb del: 2` (số thứ tự)' };
  }
  const list = scopeList(scope, guildId, userId);
  const before = list.length;
  let removed = [];
  if (/^\d+$/.test(kw)) {
    const idx = parseInt(kw, 10) - 1;
    if (idx >= 0 && idx < list.length) {
      removed = list.splice(idx, 1);
    }
  } else {
    const keep = [];
    for (const item of list) {
      if (String(item.text).toLowerCase().includes(kw)) removed.push(item);
      else keep.push(item);
    }
    list.length = 0;
    list.push(...keep);
  }
  if (!removed.length) {
    return { ok: false, message: `❌ Không tìm thấy mục khớp “${keyword}”.` };
  }
  scheduleSave();
  return {
    ok: true,
    message: `🗑️ Đã xóa ${removed.length} mục:\n` + removed.map((x) => `> ${x.text}`).join('\n'),
  };
}

function clearKnowledge({ scope = 'user', guildId, userId }) {
  if (scope === 'global') store.global = [];
  else if (scope === 'guild' && guildId) store.guilds[String(guildId)] = [];
  else if (userId) store.users[String(userId)] = [];
  scheduleSave();
  return { ok: true, message: `🧹 Đã xóa hết Knowledge Base (**${scope}**).` };
}

/** Ghép vào system instruction */
function getKnowledgeSystemBlock(userId, guildId) {
  const parts = [];
  const take = (arr, n) => (arr || []).slice(-n).map((x) => `- ${x.text}`);

  const g = take(store.global, 15);
  if (g.length) parts.push('### Knowledge Base (Global)\n' + g.join('\n'));

  if (guildId) {
    const s = take(store.guilds[String(guildId)], 12);
    if (s.length) parts.push('### Knowledge Base (Server)\n' + s.join('\n'));
  }

  if (userId) {
    const u = take(store.users[String(userId)], 12);
    if (u.length) parts.push('### Training cá nhân user\n' + u.join('\n'));
  }

  if (!parts.length) return '';
  return (
    '\n\n[Training / Knowledge Base — ưu tiên khi trả lời nếu liên quan]\n' +
    parts.join('\n\n') +
    '\n- Dùng các mục trên khi phù hợp câu hỏi; không bịa thêm fact không có trong KB.\n'
  );
}

function helpKnowledgeText() {
  return (
    '📚 **Training / Knowledge Base** — tự chỉnh:\n' +
    '```\n' +
    'kb add: nội dung          (cá nhân)\n' +
    'train: nội dung           (giống kb add)\n' +
    'kb list                   (xem tất cả)\n' +
    'kb del: từ khóa | số\n' +
    'kb clear                  (xóa KB cá nhân)\n' +
    'kb guild add: ...         (admin server)\n' +
    'kb guild list | del | clear\n' +
    'kb global add: ...        (chủ bot / ADMIN_USER_IDS)\n' +
    '```\n' +
    'Bot sẽ nhớ & dùng khi trả lời (system prompt).'
  );
}

module.exports = {
  loadKnowledgeBase,
  saveKnowledgeBaseNow,
  addKnowledge,
  listKnowledge,
  deleteKnowledge,
  clearKnowledge,
  getKnowledgeSystemBlock,
  helpKnowledgeText,
};
