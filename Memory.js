// Memory.js — ghi nhớ lâu dài theo user (remember / forget)
const fs = require('fs').promises;
const { dataFile } = require('./paths.js');

const MEMORY_FILE = dataFile('userMemory.json');
/** @type {Map<string, string[]>} */
const memories = new Map();
let saveTimer = null;

async function ensureDir() {
  try {
    const path = require('path');
    await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
  } catch (_) {}
}

async function loadMemory() {
  try {
    await ensureDir();
    const raw = await fs.readFile(MEMORY_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!raw) {
      memories.clear();
      return;
    }
    const obj = JSON.parse(raw);
    memories.clear();
    for (const [k, v] of Object.entries(obj || {})) {
      if (Array.isArray(v)) memories.set(k, v.map(String).slice(0, 20));
    }
    console.log(`📂 Memory: loaded ${memories.size} users`);
  } catch (e) {
    console.error('Memory load', e);
    memories.clear();
  }
}

async function saveMemoryNow() {
  try {
    await ensureDir();
    const obj = Object.fromEntries(memories);
    await fs.writeFile(MEMORY_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('Memory save', e);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveMemoryNow().catch(() => {});
    saveTimer = null;
  }, 400);
}

function getMemories(userId) {
  return [...(memories.get(String(userId)) || [])];
}

function addMemory(userId, text) {
  const id = String(userId);
  const t = String(text || '').trim().slice(0, 300);
  if (!t) return { ok: false, message: 'ℹ️ Dùng: `remember: nội dung cần nhớ`' };
  const list = memories.get(id) || [];
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) {
    return { ok: false, message: '📌 Đã có ghi nhớ giống vậy rồi.' };
  }
  list.push(t);
  while (list.length > 15) list.shift();
  memories.set(id, list);
  scheduleSave();
  return { ok: true, message: `🧠 Đã nhớ:\n> ${t}\n_(Tối đa 15 mục — \`memory\` để xem, \`forget: từ khóa\` để xóa)_` };
}

function forgetMemory(userId, keyword) {
  const id = String(userId);
  const kw = String(keyword || '').trim().toLowerCase();
  const list = memories.get(id) || [];
  if (!list.length) return { ok: false, message: '🧠 Chưa có gì trong bộ nhớ.' };
  if (!kw || kw === 'all' || kw === 'hết' || kw === 'tat ca' || kw === 'tất cả') {
    memories.set(id, []);
    scheduleSave();
    return { ok: true, message: '🧹 Đã xóa toàn bộ ghi nhớ dài hạn của bạn.' };
  }
  const next = list.filter((x) => !x.toLowerCase().includes(kw));
  const removed = list.length - next.length;
  memories.set(id, next);
  scheduleSave();
  if (!removed) return { ok: false, message: `Không tìm thấy ghi nhớ chứa “${keyword}”.` };
  return { ok: true, message: `🧹 Đã xóa ${removed} mục khớp “${keyword}”.` };
}

function formatMemoryList(userId) {
  const list = getMemories(userId);
  if (!list.length) return '🧠 Bộ nhớ dài hạn trống. Dùng `remember: ...` để thêm.';
  return '🧠 **Bộ nhớ dài hạn của bạn:**\n' + list.map((x, i) => `${i + 1}. ${x}`).join('\n');
}

/** Đoạn system instruction từ memory */
function getMemorySystemBlock(userId) {
  const list = getMemories(userId);
  if (!list.length) return '';
  return (
    '\n\n[Ghi nhớ dài hạn về user — dùng khi phù hợp, không bịa thêm]\n' +
    list.map((x) => `- ${x}`).join('\n')
  );
}

module.exports = {
  loadMemory,
  getMemories,
  addMemory,
  forgetMemory,
  formatMemoryList,
  getMemorySystemBlock,
  saveMemoryNow,
};
