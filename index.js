// index.js
// Nexus AI Discord Bot (Node.js, discord.js v14) tích hợp Google Gemini + Express (keep-alive)
require('dotenv').config();

const express = require('express');
const path = require('path');
const { DATA_DIR, dataFile } = require('./paths.js');
const fs = require('fs').promises;

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { GoogleGenAI } = require('@google/genai');
const { getGifForEmotion, getGifByKeyword } = require('./GifSearch.js');
const {
  loadAutoClearChannels,
  enableAutoClear,
  disableAutoClear,
  isAutoClearEnabled,
  clearRecentMessages,
  startAutoClearScheduler,
} = require('./ClearManager.js');
const {
  loadTickets,
  syncTicketsOnStartup,
  handleSetupTicketCommand,
  handleTicketInteraction,
  getTicketByChannel,
  getTicketCount,
  ensureTicketRecord,
  setTicketApiKey,
  setTicketNote,
  setTicketAiName,
} = require('./TicketManager.js');
const {
  generateImage,
  generateVideo,
  cleanupTempFile,
  checkMediaCooldown,
} = require('./MediaGen.js');
const {
  loadSessionsFromFile,
  startSessionCleanupScheduler,
  getSavedHistory,
  updateSessionHistory,
  clearSessionHistory,
  clearSessionsByPrefix,
  flushSessionsNow,
} = require('./SessionManager.js');
const {
  getSystemInstructionForPersona,
  handleToxicBehavior,
  detectJailbreakPrompt,
  getPromptShieldBlock,
  DEFAULT_PERSONA_ID,
} = require('./Interest.js');
const {
  detectUserEmotion,
  detectEmotion,
  appendEmotionToInstruction,
  tryQuickEmotionalReply,
  resolveEmotionalGif,
  parseGifRequest,
} = require('./Emotion.js');
const {
  loadQuota,
  checkQuota,
  consumeQuota,
  maybeWarn,
  getQuotaStatusText,
  loadGeminiLock,
  lockGeminiQuota,
  clearGeminiLock,
  getGeminiLockStatus,
  parseGeminiQuotaError,
} = require('./QuotaManager.js');
const {
  loadUserPrefs,
  getUserPrefs,
  setUserPersona,
  setUserTts,
  setUserReplyMode,
  setUserVoiceChat,
  setUserAiName,
  setUserGeminiKey,
  getUserGeminiKey,
  personaDisplayName,
  getStrictModeBlock,
} = require('./UserPrefs.js');
const { synthesizeSpeech, writeTempMp3, cleanupTemp } = require('./Tts.js');
const { PERSONA_PRESETS } = require('./Interest.js');
const { setAdminLogClient, adminLog } = require('./AdminLog.js');
const {
  loadModeration,
  getModSettings,
  setModEnabled,
  checkMessageModeration,
} = require('./Moderation.js');
const {
  parseKeyMessage,
  helpKeyText,
  chatExternal,
  providerFromModel,
  providerForPersona,
  PROVIDER_META,
} = require('./Providers.js');
const {
  loadMemory,
  addMemory,
  forgetMemory,
  formatMemoryList,
  getMemorySystemBlock,
} = require('./Memory.js');
const {
  loadKnowledgeBase,
  addKnowledge,
  listKnowledge,
  deleteKnowledge,
  clearKnowledge,
  getKnowledgeSystemBlock,
  helpKnowledgeText,
} = require('./KnowledgeBase.js');
const { startQuiz, tryAnswer, hasActiveQuiz } = require('./Quiz.js');
const {
  isVoiceAvailable,
  joinVoiceChannel,
  leaveVoice,
  speakInGuild,
} = require('./VoiceManager.js');

/** Lưu prompt gần nhất để nút Regenerate — key: userId_channelId */
const lastPrompts = new Map();
/** key -> { text, userId, at } for translate / feedback */
const lastReplies = new Map();

/** Bỏ URL media (Giphy/Tenor/…) khỏi text AI — tránh hiện link xấu; GIF chỉ qua embed */




/** Tách text dài thành nhiều phần ≤ maxLen, ưu tiên xuống dòng / câu */

function buildHelpEmbed() {
  return new EmbedBuilder()
    .setTitle('📖 Nexus AI — Hướng dẫn')
    .setColor(0x5865f2)
    .setDescription(
      'Chat trong **kênh AI** / **ticket** / **mention bot**. Ticket: chọn model + persona, có thể `key:` API riêng.'
    )
    .addFields(
      {
        name: '🤖 Chat & AI',
        value:
          '`/ask` — hỏi 1 phát (riêng tư)\n' +
          '`/persona` — đổi tính cách AI\n' +
          '`/summary` — tóm tắt kênh\n' +
          '`/imagine` · `/video` — tạo media\n' +
          '**DM bot** — chat Gemini (cần `key gemini:` của bạn, model mặc định, không ticket)\n' +
          '`kb add:` / `train:` — Training & Knowledge Base tự chỉnh\n' +
          '`/mode` · `/tts` · `/auto-speech` · `/speak` · `/quota`',
      },
      {
        name: '🎫 Ticket & bộ nhớ',
        value:
          '`setup_ticketai` (Admin)\n' +
          '`note: ...` — ghim ngữ cảnh ticket\n' +
          '`remember:` · `memory` · `forget:` — nhớ lâu dài\n' +
          'Code dài → **link paste** (không cần tải file)',
      },
      {
        name: '🛠️ Tiện ích',
        value:
          '`/dich` · `dịch: ...` — dịch VI↔EN\n' +
          '`/export` — xuất chat .txt\n' +
          '`/quiz` · `/ship` · `/remind`\n' +
          '`/voice` · `/ping` · `/reset` · `/feedback`\n' +
          'Admin: `/adminpanel` · `/moderation`\n' +
          'Nút: Trả lời lại · Dịch · 👍/👎\n' +
          'Gõ `help` hoặc `!help` cũng xem được hướng dẫn này',
      },
      {
        name: '📎 Ảnh',
        value: 'Gửi **ảnh / video** (≤15MB) trong ticket/kênh AI để bot xem & mô tả (Gemini).',
      }
    )
    .setFooter({ text: 'Nexus AI' });
}


async function translateTextFull(ai, text) {
  const chat = ai.chats.create({
    model: DEFAULT_MODEL,
    config: {
      maxOutputTokens: 8192,
      systemInstruction:
        'Bạn là dịch giả chuyên nghiệp. ' +
        'Nếu input chủ yếu tiếng Việt → dịch sang English. ' +
        'Nếu chủ yếu English → dịch sang tiếng Việt. ' +
        'Dịch ĐỦ toàn bộ nội dung, không tóm tắt, không cắt bớt, không bỏ đoạn. ' +
        'Giữ heading/emoji nếu có. Chỉ trả bản dịch, không giải thích thêm.',
    },
  });
  const result = await chat.sendMessage({ message: String(text || '').slice(0, 12000) });
  return (result?.text || '').trim() || '…';
}

/** Gửi bản dịch dài: tin đầu + follow-up / channel messages */
async function sendLongTranslation(interactionOrMessage, translated, { ephemeral = false } = {}) {
  const chunks = splitLongMessage(`🌐 **Bản dịch**\n${translated}`, 1900);
  if (interactionOrMessage.editReply && interactionOrMessage.followUp) {
    // Discord interaction
    await interactionOrMessage.editReply({ content: chunks[0] });
    for (let i = 1; i < chunks.length; i++) {
      await interactionOrMessage.followUp({ content: chunks[i], ephemeral }).catch(() => {});
    }
    return;
  }
  // message
  await interactionOrMessage.reply({ content: chunks[0] });
  for (let i = 1; i < chunks.length; i++) {
    await interactionOrMessage.channel.send({ content: chunks[i] }).catch(() => {});
  }
}

/** Gỡ LaTeX thường gặp — Discord không render math */
function sanitizeDiscordMath(text) {
  let s = String(text || '');
  const plain = (inner) => {
    let x = String(inner);
    x = x.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
    x = x.replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)');
    x = x.replace(/\\sqrt\s*([a-zA-Z0-9])/g, 'sqrt($1)');
    x = x.replace(/\\times/g, '×');
    x = x.replace(/\\cdot/g, '·');
    x = x.replace(/\\approx/g, '≈');
    x = x.replace(/\\pm/g, '±');
    x = x.replace(/\\infty/g, '∞');
    x = x.replace(/\\leq|\\le(?![a-zA-Z])/g, '≤');
    x = x.replace(/\\geq|\\ge(?![a-zA-Z])/g, '≥');
    x = x.replace(/\\neq|\\ne(?![a-zA-Z])/g, '≠');
    x = x.replace(/\\rightarrow|\\to(?![a-zA-Z])/g, '→');
    x = x.replace(/\\leftarrow/g, '←');
    x = x.replace(/\\text\{([^{}]*)\}/g, '$1');
    x = x.replace(/\\mathrm\{([^{}]*)\}/g, '$1');
    x = x.replace(/\\left|\\right/g, '');
    x = x.replace(/\\,/g, ' ');
    x = x.replace(/\\ /g, ' ');
    x = x.replace(/[{}]/g, '');
    x = x.replace(/\\([a-zA-Z]+)/g, '$1'); // leftover \cmd
    return x.trim();
  };
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => plain(inner));
  s = s.replace(/\$([^$\n]+?)\$/g, (_, inner) => plain(inner));
  // Sót ngoài $
  s = plain(s);
  // dọn khoảng trắng kép
  s = s.replace(/[ \t]{2,}/g, ' ');
  return s;
}

function splitLongMessage(text, maxLen = 1900) {
  const src = String(text || '');
  if (src.length <= maxLen) return [src];
  const chunks = [];
  let rest = src;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf('. ', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(' ', maxLen);
    if (cut < maxLen * 0.3) cut = maxLen;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.length) chunks.push(rest);
  return chunks.filter(Boolean);
}

/** Đăng code dài lên paste (link) — không bắt tải file. */
async function pasteCodeOnline(code, lang) {
  const body = String(code || '');
  if (!body.trim()) return null;
  const fetchFn = globalThis.fetch;
  if (!fetchFn) return null;

  try {
    const res = await fetchFn('https://paste.rs/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body,
    });
    if (res.ok) {
      const url = (await res.text()).trim();
      if (/^https?:\/\//i.test(url)) return url.split(/\s+/)[0];
    }
  } catch (e) {
    console.warn('paste.rs fail', e && e.message);
  }

  try {
    const params = new URLSearchParams();
    params.set('content', body.slice(0, 250000));
    params.set('syntax', lang || 'text');
    params.set('expiry_days', '7');
    const res = await fetchFn('https://dpaste.com/api/v2/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'NexusAI-DiscordBot',
      },
      body: params.toString(),
    });
    if (res.ok) {
      const url = (await res.text()).trim();
      if (/^https?:\/\//i.test(url)) return url.split(/\s+/)[0];
    }
  } catch (e) {
    console.warn('dpaste fail', e && e.message);
  }

  return null;
}

/** Code dài → link paste (ưu tiên) hoặc file (fallback). */
async function extractLongCodeToFiles(text, maxInline = 900) {
  const files = [];
  if (!text) return { text: text || '', files };

  let idx = 0;
  const parts = [];
  const re = /```([\w.+-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    parts.push(text.slice(last, m.index));
    const lang = m[1] || '';
    const body = (m[2] || '').replace(/\s+$/, '');
    if (body.length < maxInline) {
      parts.push(m[0]);
    } else {
      idx += 1;
      const url = await pasteCodeOnline(body, lang || 'text');
      if (url) {
        parts.push(
          `📦 **Code #${idx}** (${lang || 'text'}, ${body.length} ký tự) — mở link (không cần tải file):\n${url}`
        );
      } else {
        const extMap = {
          js: 'js',
          javascript: 'js',
          ts: 'ts',
          python: 'py',
          py: 'py',
          json: 'json',
          html: 'html',
          css: 'css',
          sh: 'sh',
          bash: 'sh',
          txt: 'txt',
        };
        const ext = extMap[String(lang).toLowerCase()] || 'txt';
        const name = `nexus-code-${idx}.${ext}`;
        files.push(new AttachmentBuilder(Buffer.from(body, 'utf8'), { name }));
        parts.push(`📦 **Code #${idx}** — paste lỗi, gửi file **${name}** (fallback).`);
      }
    }
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  let out = parts.join('');

  if (!idx && out.length > 3500) {
    const url = await pasteCodeOnline(out, 'text');
    if (url) {
      return {
        text: `📦 Nội dung dài — xem full tại:\n${url}\n\n_Tóm tắt:_\n${out.slice(0, 400)}…`,
        files: [],
      };
    }
    files.push(new AttachmentBuilder(Buffer.from(out, 'utf8'), { name: 'nexus-reply-full.txt' }));
    return {
      text: `📦 Nội dung dài — file **nexus-reply-full.txt** (paste lỗi).\n${out.slice(0, 400)}…`,
      files,
    };
  }
  return { text: out, files };
}

function stripMediaUrls(text) {
  if (!text) return text;
  return String(text)
    .replace(/https?:\/\/(?:media\.)?giphy\.com\/\S+/gi, '')
    .replace(/https?:\/\/(?:media\.)?tenor\.com\/\S+/gi, '')
    .replace(/https?:\/\/i\.imgur\.com\/\S+/gi, '')
    .replace(/https?:\/\/c\.tenor\.com\/\S+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}



// ==========================================
// CONFIG & INIT
// ==========================================
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ALLOWED_CHANNELS_FILE =
  process.env.ALLOWED_CHANNELS_FILE || dataFile('allowedChannels.json');

const CHAT_COOLDOWN_SECONDS = 5;
const userCooldowns = new Map();

if (!DISCORD_TOKEN) {
  console.error('❌ Thiếu DISCORD_TOKEN trong Environment Variables trên Render!');
}
if (!GEMINI_API_KEY) {
  console.error('❌ Thiếu GEMINI_API_KEY trong Environment Variables trên Render!');
}

// ==========================================
// EXPRESS KEEP-ALIVE SERVER (Render)
// ==========================================
const app = express();
app.get('/', (req, res) => {
  res.send('🤖 Nexus AI Bot is running 24/7!');
});
app.listen(PORT, () => {
  console.log(`🌐 Web server đang chạy tại port ${PORT}`);
});

// ==========================================
// GOOGLE GEMINI CONFIG
// ==========================================
const aiInstance = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

function isBotOwner(userId) {
  const raw = process.env.ADMIN_USER_IDS || process.env.OWNER_ID || '';
  const ids = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(userId));
}

const SYSTEM_INSTRUCTION =
  'Bạn là trợ lý AI trên Discord, thân thiện, dí dỏm. ' +
  'Tên gọi của bạn do hệ thống chỉ định (thường trùng tên bot). ' +
  'Hãy tự động thêm emoji phù hợp ngữ cảnh khi trả lời. ' +
  'Trả lời ngắn gọn, rõ ràng.\n' +
  'ĐỊNH DẠNG DISCORD (bắt buộc):\n' +
  '- KHÔNG dùng LaTeX/KaTeX: cấm $...$, $$...$$, \\[ \\, \\sqrt, \\times, \\approx, \\le, \\ge, \\rightarrow.\n' +
  '- Công thức viết plain text hoặc Unicode: O(sqrt(n)), ≈, ≤, ≥, ×, →, n^2, sqrt(n).\n' +
  '- Code để trong hàng rào markdown ```language ... ```.\n' +
  '- Bảng markdown đơn giản được; trong bảng cũng không dùng $...$.\n' +
  '- Heading dùng **in đậm** hoặc ### ít thôi, tránh #### rối.';

const DEFAULT_MODEL = 'gemini-3.6-flash';

const IMAGE_MODEL_NAME = 'gemini-2.5-flash-image';
const VIDEO_MODEL_NAME = 'veo-3.1-generate-preview';

// ==========================================
// DISCORD CLIENT
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ==========================================
// BỘ NHỚ
// ==========================================
const userSessions = new Map();
const allowedChannels = new Map();

/** Tên AI: custom user/ticket → không thì đúng tên bot Discord */
/** Key Gemini cho media: ticket/DM user trước, không có thì null (không đốt key bot nếu trong ticket) */
function getGeminiKeyFromTicket(channelId) {
  const tk = channelId ? getTicketByChannel(channelId) : null;
  if (!tk) return null;
  const pk = { ...(tk.providerKeys || {}) };
  if (tk.userApiKey && !pk.gemini) pk.gemini = tk.userApiKey;
  return pk.gemini || null;
}

function resolveGeminiClient(interaction) {
  const channelId = interaction.channelId;
  const inTicket = !!(channelId && getTicketByChannel(channelId));
  if (inTicket) {
    const k = getGeminiKeyFromTicket(channelId);
    if (!k) {
      return {
        ok: false,
        message:
          '🔑 **Tạo ảnh/video trong ticket cần key Gemini của bạn** (tránh tốn quota bot).\n' +
          'Gửi: `key gemini: AIza...`\n' +
          'Lấy key: https://aistudio.google.com\n' +
          '_(Veo / image model có thể cần billing trên key của bạn)_',
      };
    }
    return { ok: true, ai: new GoogleGenAI({ apiKey: k }), usingUserKey: true };
  }
  // DM: key user
  if (!interaction.guildId) {
    const k = getUserGeminiKey(interaction.user.id);
    if (!k) {
      return {
        ok: false,
        message:
          '🔑 **DM cần key Gemini của bạn.**\nGửi: `key gemini: AIza...`',
      };
    }
    return { ok: true, ai: new GoogleGenAI({ apiKey: k }), usingUserKey: true };
  }
  // Kênh server (không ticket): key bot
  if (!aiInstance) {
    return {
      ok: false,
      message: '❌ Bot chưa cấu hình GEMINI_API_KEY trên server!',
    };
  }
  return { ok: true, ai: aiInstance, usingUserKey: false };
}

function resolveAiDisplayName(ticketData, userPrefs) {
  const custom =
    (ticketData && ticketData.aiName) ||
    (userPrefs && userPrefs.aiName) ||
    null;
  if (custom && String(custom).trim()) return String(custom).trim().slice(0, 40);
  const u = client.user;
  if (!u) return 'Nexus AI';
  return (u.displayName || u.globalName || u.username || 'Nexus AI').slice(0, 40);
}


const PAID_ONLY_MODELS = new Set([
  'gemini-3.1-pro-preview',
  'gemini-3.1-pro',
  'gemini-3.1-flash-image',
  'gemini-2.5-flash-image',
  'veo-3.1-generate-preview',
]);

function formatApiError(apiErr, modelId = null) {
  const status =
    apiErr?.status || apiErr?.code || apiErr?.response?.status || apiErr?.error?.code || 'N/A';
  const rawMsg =
    apiErr?.message ||
    apiErr?.error?.message ||
    apiErr?.response?.data?.error?.message ||
    'Không có thông tin chi tiết.';

  let hint = '';
  let friendly = null;
  const s = String(status);
  const isQuota = s.includes('429') || /quota|rate limit|limit: 0/i.test(rawMsg);

  if (isQuota) {
    friendly =
      `💳 **Chức năng này yêu cầu API Key đã bật thanh toán (Billing)!**\n` +
      `Key hiện tại chưa gắn thẻ thanh toán hoặc đã hết hạn mức sử dụng (Quota: 0).\n\n` +
      `**Cách khắc phục:**\n` +
      `• Truy cập https://aistudio.google.com để liên kết thẻ thanh toán (Visa/Mastercard) cho Google Cloud Project.\n` +
      `• Tạo lại API Key mới sau khi đã bật Billing.`;
  } else if (s.includes('401') || /API key not valid|api key invalid/i.test(rawMsg)) {
    hint = '👉 API Key sai hoặc không hợp lệ. Hãy tạo lại Key tại https://aistudio.google.com';
  } else if (s.includes('403') || /permission|forbidden/i.test(rawMsg)) {
    hint = '👉 Key không có quyền dùng model này, hoặc chưa bật Gemini API cho project.';
  } else if (s.includes('404') || /not found|does not exist/i.test(rawMsg)) {
    hint = '👉 Model không tồn tại hoặc Key không có quyền truy cập model này.';
  } else if (s.includes('400') || /invalid argument/i.test(rawMsg)) {
    hint = '👉 Request không hợp lệ: model có thể đã đổi tên/ngừng hỗ trợ, hoặc key/payload sai. Thử model Grok **grok-4.5** / **grok-4.6**. Mã 400 ≠ hết tiền (hết tiền thường 402/403).';
  } else if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(rawMsg)) {
    hint = '👉 Lỗi mạng/timeout khi gọi Gemini API. Hãy thử lại.';
  }

  return { status, rawMsg, hint, friendly };
}

// ==========================================
// PERSISTENCE: LOAD & SAVE ALLOWED CHANNELS
// ==========================================
async function ensureDataDir() {
  const dir = path.dirname(ALLOWED_CHANNELS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error('❌ Lỗi khi tạo thư mục data:', err);
  }
}

async function saveAllowedChannelsToFile() {
  try {
    await ensureDataDir();
    const obj = Object.fromEntries(allowedChannels);
    await fs.writeFile(ALLOWED_CHANNELS_FILE, JSON.stringify(obj, null, 2), 'utf8');
    console.log(`💾 Saved allowedChannels to ${ALLOWED_CHANNELS_FILE}`);
  } catch (err) {
    console.error('❌ Error saving allowedChannels:', err);
  }
}

let saveTimeout = null;
function scheduleSaveAllowedChannels(delay = 200) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveAllowedChannelsToFile().catch((err) => console.error('❌ Lỗi scheduleSave:', err));
    saveTimeout = null;
  }, delay);
}

async function loadAllowedChannelsFromFile() {
  try {
    const content = await fs.readFile(ALLOWED_CHANNELS_FILE, 'utf8');
    const obj = JSON.parse(content);
    for (const [guildId, channelId] of Object.entries(obj || {})) {
      allowedChannels.set(guildId, channelId);
    }
    console.log(`📂 Loaded allowedChannels from ${ALLOWED_CHANNELS_FILE}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('📂 allowedChannels: chưa có file trong DATA_DIR — tạo mới (gắn Volume để không mất khi deploy).');
    } else {
      console.error('❌ Error loading allowedChannels:', err);
    }
  }
}

// ==========================================
// SLASH COMMANDS
// ==========================================
const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Kiểm tra độ trễ kết nối của Bot'),
  new SlashCommandBuilder().setName('help').setDescription('Xem hướng dẫn lệnh & tính năng Nexus AI'),
  new SlashCommandBuilder().setName('reset').setDescription('Xóa lịch sử trò chuyện cá nhân với Nexus AI'),
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Thiết lập kênh hiện tại làm kênh duy nhất bot phản hồi (Chỉ Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('unsetchannel')
    .setDescription('Bỏ thiết lập kênh duy nhất (Chỉ Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('status').setDescription('Hiển thị trạng thái hiện tại của Nexus AI trong server này'),
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Xoá nhanh tin nhắn trong kênh (mặc định 100 tin, chỉ Admin)')
    .addIntegerOption((opt) =>
      opt
        .setName('amount')
        .setDescription('Số lượng tin nhắn muốn xoá (1-1000, mặc định 100)')
        .setMinValue(1)
        .setMaxValue(1000)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('clear24h')
    .setDescription('Bật tự động xoá tin nhắn cũ hơn 24h trong kênh này (chỉ Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('unclear24h')
    .setDescription('Tắt tự động xoá tin nhắn 24h cho kênh này (chỉ Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('setup_ticketai')
    .setDescription('Gửi embed + nút tạo Ticket Chat AI vào kênh này (chỉ Admin)')
    .addChannelOption((opt) =>
      opt
        .setName('category')
        .setDescription('Chọn danh mục chứa kênh Ticket')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('imagine')
    .setDescription('Tạo ảnh bằng AI (Nano Banana)')
    .addStringOption((opt) =>
      opt.setName('prompt').setDescription('Mô tả ảnh bạn muốn tạo').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('video')
    .setDescription('Tạo video ngắn bằng AI (Veo 3.1, có thể mất tới vài phút)')
    .addStringOption((opt) =>
      opt.setName('prompt').setDescription('Mô tả video bạn muốn tạo').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('persona')
    .setDescription('Đổi tính cách / sở thích AI (áp dụng ngoài ticket; trong ticket dùng menu)')
    .addStringOption((opt) =>
      opt
        .setName('style')
        .setDescription('Chọn persona')
        .setRequired(true)
        .addChoices(
          { name: 'Nexus mặc định', value: 'default' },
          { name: 'ChatGPT (Luna)', value: 'chatgpt' },
          { name: 'Gemini', value: 'gemini' },
          { name: 'Claude (Nam)', value: 'claude' },
          { name: 'Grok', value: 'grok' },
          { name: 'Dola', value: 'dola' },
          { name: 'Copilot', value: 'copilot' },
          { name: 'DeepSeek (Mây)', value: 'deepseek' },
          { name: 'Tùy chỉnh (kèm mô tả)', value: 'custom' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('custom')
        .setDescription('Mô tả tính cách khi chọn Tùy chỉnh')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('quota')
    .setDescription('Xem hạn mức API (chat / ảnh / video) còn lại hôm nay'),
  new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Bật/tắt đọc to câu trả lời bằng giọng nói (file MP3)')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('on = bật, off = tắt')
        .setRequired(true)
        .addChoices({ name: 'Bật', value: 'on' }, { name: 'Tắt', value: 'off' })
    ),
  new SlashCommandBuilder()
    .setName('auto-speech')
    .setDescription('Bật/tắt tự đọc to mỗi câu trả lời (giống /tts)')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('on = bật, off = tắt')
        .setRequired(true)
        .addChoices({ name: 'Bật (on)', value: 'on' }, { name: 'Tắt (off)', value: 'off' })
    ),
  new SlashCommandBuilder()
    .setName('speak')
    .setDescription('Đọc một đoạn text thành file giọng nói (MP3)')
    .addStringOption((opt) =>
      opt.setName('text').setDescription('Nội dung cần đọc').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('mode')
    .setDescription('Chế độ trả lời: normal (mặc định) hoặc strict (ngắn, ít emoji)')
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Chọn mode')
        .setRequired(true)
        .addChoices({ name: 'Normal', value: 'normal' }, { name: 'Strict', value: 'strict' })
    ),
  new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('Mini-game đố vui (ticket hoặc kênh AI)'),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Bot join/leave voice hoặc đọc text trong voice')
    .addStringOption((opt) =>
      opt
        .setName('action')
        .setDescription('join | leave | speak')
        .setRequired(true)
        .addChoices(
          { name: 'Join kênh voice của bạn', value: 'join' },
          { name: 'Leave voice', value: 'leave' },
          { name: 'Speak (đọc text)', value: 'speak' },
          { name: 'Bật chat thoại (bot đọc câu trả lời)', value: 'chat_on' },
          { name: 'Tắt chat thoại', value: 'chat_off' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('text').setDescription('Nội dung khi action=speak').setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('voicechat')
    .setDescription('Bật/tắt bot đọc to câu trả lời (chat thoại)')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('on hoặc off')
        .setRequired(true)
        .addChoices({ name: 'Bật', value: 'on' }, { name: 'Tắt', value: 'off' })
    ),

  new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Tóm tắt 15–20 tin nhắn gần nhất trong kênh/ticket này'),
  new SlashCommandBuilder()
    .setName('dich')
    .setDescription('Dịch Việt ↔ Anh (tự nhận ngôn ngữ)')
    .addStringOption((opt) =>
      opt.setName('text').setDescription('Đoạn cần dịch').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Nhắc bạn sau X phút')
    .addIntegerOption((opt) =>
      opt
        .setName('minutes')
        .setDescription('Số phút (1–1440)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1440)
    )
    .addStringOption((opt) =>
      opt.setName('note').setDescription('Nội dung nhắc').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Hỏi AI 1 phát (ephemeral, không lưu history)')
    .addStringOption((opt) =>
      opt.setName('question').setDescription('Câu hỏi').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('export')
    .setDescription('Xuất hội thoại gần đây trong kênh/ticket ra file .txt'),
  new SlashCommandBuilder()
    .setName('ainame')
    .setDescription('Đặt tên gọi AI (vd: Luna, Mây) — không bắt buộc giống Nexus')
    .addStringOption((opt) =>
      opt
        .setName('name')
        .setDescription('Tên mới (để trống / "reset" = về mặc định)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('kb')
    .setDescription('Training / Knowledge Base — dạy bot nhớ fact')
    .addSubcommand((sc) =>
      sc
        .setName('add')
        .setDescription('Thêm tri thức (train)')
        .addStringOption((opt) =>
          opt.setName('noidung').setDescription('Nội dung cần bot nhớ').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('phamvi')
            .setDescription('Cá nhân / server / global')
            .setRequired(false)
            .addChoices(
              { name: 'Cá nhân (mặc định)', value: 'user' },
              { name: 'Server (cần Admin)', value: 'guild' },
              { name: 'Global (chủ bot)', value: 'global' }
            )
        )
    )
    .addSubcommand((sc) =>
      sc.setName('list').setDescription('Xem Knowledge Base đã lưu')
    )
    .addSubcommand((sc) =>
      sc
        .setName('del')
        .setDescription('Xóa mục theo từ khóa hoặc số thứ tự')
        .addStringOption((opt) =>
          opt.setName('tukhoa').setDescription('Từ khóa hoặc số (vd: 1)').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('phamvi')
            .setDescription('Cá nhân / server / global')
            .setRequired(false)
            .addChoices(
              { name: 'Cá nhân (mặc định)', value: 'user' },
              { name: 'Server (cần Admin)', value: 'guild' },
              { name: 'Global (chủ bot)', value: 'global' }
            )
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName('clear')
        .setDescription('Xóa hết KB theo phạm vi')
        .addStringOption((opt) =>
          opt
            .setName('phamvi')
            .setDescription('Cá nhân / server / global')
            .setRequired(false)
            .addChoices(
              { name: 'Cá nhân (mặc định)', value: 'user' },
              { name: 'Server (cần Admin)', value: 'guild' },
              { name: 'Global (chủ bot)', value: 'global' }
            )
        )
    )
    .addSubcommand((sc) =>
      sc.setName('help').setDescription('Hướng dẫn Training / KB')
    ),
  new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Góp ý / báo lỗi — gửi tới kênh admin log')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Nội dung góp ý').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('adminpanel')
    .setDescription('Panel admin: online, ticket, quota lock, lệnh nhanh')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('Bật/tắt lọc spam & link lạ trong kênh AI (Admin)')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('on hoặc off')
        .setRequired(true)
        .addChoices({ name: 'Bật', value: 'on' }, { name: 'Tắt', value: 'off' })
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Chấm “độ hợp” vibe giữa 2 người (meme)')
    .addUserOption((opt) => opt.setName('user1').setDescription('Người 1').setRequired(true))
    .addUserOption((opt) => opt.setName('user2').setDescription('Người 2').setRequired(true)),
];

/** @type {Map<string, NodeJS.Timeout>} */
const pendingReminders = new Map();

const EMOTION_REACTIONS = {
  sad: '😢',
  lonely: '🥺',
  angry: '😤',
  anxious: '😰',
  tired: '😮‍💨',
  confused: '🤔',
  excited: '🤩',
  love: '🥰',
  happy: '😄',
  thanks: '🙏',
};

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN || 'none');

client.once('ready', async () => {
  console.log(`✅ Bot ${client.user.tag} đã online!`);
  console.log(`📂 DATA_DIR = ${DATA_DIR}`);
  try {
    console.log('🔄 Đang đăng ký Slash Commands lên Discord...');
    const body = commands.map((c) =>
      typeof c?.toJSON === 'function' ? c.toJSON() : c
    );
    // Chỉ đăng ký GUILD (hiện ngay). Xóa GLOBAL để tránh lệnh bị TRÙNG 2 lần trong menu /
    try {
      await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
      console.log('🧹 Đã xóa slash commands global (tránh duplicate)');
    } catch (ge) {
      console.warn('Clear global commands fail', ge && ge.message);
    }
    for (const [gid, guild] of client.guilds.cache) {
      try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, gid), { body });
        console.log(`🎉 Slash commands (guild) → ${guild.name}`);
      } catch (ge) {
        console.warn('Guild commands fail', gid, ge && ge.message);
      }
    }
    console.log('🎉 Đã đăng ký Slash Commands (guild only)!');
  } catch (error) {
    console.error('❌ Lỗi khi đăng ký Slash Commands:', error);
  }

  startAutoClearScheduler(client);
  startSessionCleanupScheduler();
  setAdminLogClient(client);

  // Đóng ticket → tóm tắt ngắn gửi admin log (6)
  global.__nexusOnTicketClose = async ({ channelName, closedBy, transcript }) => {
    let summary = transcript ? transcript.slice(0, 800) : '(không lấy được transcript)';
    if (aiInstance && transcript && transcript.length > 40) {
      try {
        const chat = aiInstance.chats.create({
          model: DEFAULT_MODEL,
          config: {
            maxOutputTokens: 300,
            systemInstruction: 'Tóm tắt hội thoại ticket Discord bằng tiếng Việt, 3–6 gạch đầu dòng.',
          },
        });
        const r = await chat.sendMessage({ message: transcript.slice(0, 3500) });
        if (r?.text) summary = r.text.slice(0, 900);
      } catch (_) {}
    }
    await adminLog({
      title: '🔒 Ticket đã đóng',
      description: summary,
      color: 0xed4245,
      fields: [
        { name: 'Kênh', value: channelName || '?', inline: true },
        { name: 'Đóng bởi', value: closedBy ? `${closedBy.tag}` : '?', inline: true },
      ],
    });
  };

  await syncTicketsOnStartup(client).catch((e) => console.error('Lỗi syncTickets:', e));

  // Trạng thái Discord
  try {
    await client.user.setPresence({
      status: 'online',
      activities: [{ name: 'AI chat · /help', type: 3 }], // Watching
    });
  } catch (pe) {
    console.warn('setPresence', pe && pe.message);
  }

  const botName = client.user.displayName || client.user.username || client.user.tag;
  const onlineEmbed = new EmbedBuilder()
    .setTitle(`🟢 ${botName} đã online`)
    .setDescription(
      `Bot vừa **deploy / khởi động** xong.\n` +
        `• Tag: **${client.user.tag}**\n` +
        `• Server: **${client.guilds.cache.size}**\n` +
        `• Gõ \`/help\` hoặc \`help\` để xem lệnh.`
    )
    .setColor(0x57f287)
    .setTimestamp(new Date())
    .setFooter({ text: botName });

  // 1) Kênh admin log
  await adminLog({
    title: `🟢 ${botName} online`,
    description: `Logged in as **${client.user.tag}** · ${client.guilds.cache.size} server(s)`,
    color: 0x57f287,
  });

  // 2) Kênh chỉ định ONLINE_ANNOUNCE_CHANNEL_ID (optional)
  const announceId = (process.env.ONLINE_ANNOUNCE_CHANNEL_ID || '').trim();
  if (announceId) {
    try {
      const ch = await client.channels.fetch(announceId).catch(() => null);
      if (ch && ch.isTextBased()) {
        await ch.send({ embeds: [onlineEmbed] }).catch(() => {});
      }
    } catch (_) {}
  }

  // 3) Mỗi server: kênh AI đã /setchannel
  for (const [guildId, channelId] of allowedChannels.entries()) {
    if (announceId && channelId === announceId) continue;
    try {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (ch && ch.isTextBased()) {
        await ch
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle(`🟢 ${botName} đã online`)
                .setDescription(
                  `AI sẵn sàng chat tại kênh này.\n` +
                    `Gõ \`help\` · \`/persona\` · tạo **Ticket** nếu cần.`
                )
                .setColor(0x57f287)
                .setTimestamp(new Date()),
            ],
          })
          .catch(() => {});
      }
    } catch (e) {
      console.warn('online announce guild', guildId, e && e.message);
    }
  }

  console.log(`📢 Đã gửi thông báo online (admin log + ${allowedChannels.size} kênh AI).`);
});

// ==========================================
// XỬ LÝ SLASH COMMANDS & TICKET INTERACTIONS
// ==========================================

client.on('guildMemberAdd', async (member) => {
  try {
    if (!member || member.user?.bot) return;
    const guild = member.guild;
    const aiCh = allowedChannels.get(guild.id);
    const lines = [
      `👋 Chào **${member.user.username}** — mình là **Nexus AI** trên server **${guild.name}**.`,
      '',
      '**Bắt đầu nhanh**',
      aiCh
        ? `• Chat AI tại <#${aiCh}> (hoặc mention bot)`
        : '• Mention bot hoặc hỏi admin kênh AI (`/setchannel`)',
      '• Tạo **Ticket** nếu server có panel ticket → chọn model + persona + key',
      '• Gõ `help` hoặc `/help` để xem lệnh',
      '',
      '**Mẹo**',
      '• `/persona` — đổi tính cách AI',
      '• `gif: funny` — gửi GIF (nếu server có Giphy)',
      '• `/feedback` — góp ý cho admin',
    ];
    await member.send(lines.join('\n')).catch(() => {
      /* DM đóng */
    });
  } catch (e) {
    console.warn('guildMemberAdd welcome', e && e.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Nút xóa memory ticket

    // Nút feedback 👍 / 👎
    if (interaction.isButton() && interaction.customId.startsWith('nexus_fb:')) {
      const parts = interaction.customId.split(':'); // nexus_fb:up|down:key
      const vote = parts[1];
      const key = parts.slice(2).join(':');
      const stored = lastReplies.get(key);
      await interaction.reply({
        content: vote === 'up' ? '👍 Cảm ơn feedback!' : '👎 Đã ghi nhận — sẽ cố cải thiện.',
        ephemeral: true,
      }).catch(() => {});
      adminLog({
        title: vote === 'up' ? '👍 Feedback tốt' : '👎 Feedback xấu',
        description: (stored?.text || '(không có text)').slice(0, 500),
        color: vote === 'up' ? 0x57f287 : 0xed4245,
        fields: [
          { name: 'User', value: `${interaction.user.tag}`, inline: true },
          { name: 'Channel', value: `<#${interaction.channelId}>`, inline: true },
        ],
      }).catch(() => {});
      return;
    }

    // Nút Dịch câu trả lời AI
    if (interaction.isButton() && interaction.customId.startsWith('nexus_tr:')) {
      const key = interaction.customId.slice('nexus_tr:'.length);
      const stored = lastReplies.get(key);
      if (!stored?.text) {
        return interaction.reply({ content: '❌ Không tìm thấy nội dung để dịch (hết hạn).', ephemeral: true });
      }
      if (!aiInstance) {
        return interaction.reply({ content: '❌ Chưa có GEMINI_API_KEY.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const translated = await translateTextFull(aiInstance, stored.text);
        return await sendLongTranslation(interaction, translated, { ephemeral: true });
      } catch (e) {
        console.error('translate btn', e);
        return interaction.editReply('❌ Không dịch được.');
      }
    }

    if (interaction.isButton() && interaction.customId === 'nexus_clear_memory') {
      const ticketInfo = getTicketByChannel(interaction.channelId);
      if (!ticketInfo) {
        return interaction.reply({ content: '❌ Chỉ dùng trong kênh ticket.', ephemeral: true });
      }
      let cleared = 0;
      for (const key of [...userSessions.keys()]) {
        if (key.includes(`_${interaction.channelId}_`)) {
          userSessions.delete(key);
          cleared++;
        }
      }
      try {
        clearSessionsByPrefix(`${interaction.user.id}_${interaction.channelId}`);
        // xóa mọi session gắn channel này
        clearSessionsByPrefix(interaction.channelId);
      } catch (_) {}
      return interaction.reply({
        content: `🧹 Đã xóa memory chat của ticket này (${cleared} session RAM). Lịch sử hội thoại bắt đầu lại từ tin nhắn sau.`,
        ephemeral: true,
      });
    }

    // Nút Regenerate
    if (interaction.isButton() && interaction.customId.startsWith('nexus_regen:')) {
      const key = interaction.customId.slice('nexus_regen:'.length);
      const stored = lastPrompts.get(key);
      if (!stored || stored.userId !== interaction.user.id) {
        return interaction.reply({
          content: '❌ Không tìm thấy prompt để tạo lại (hết hạn hoặc không phải của bạn).',
          ephemeral: true,
        });
      }
      await interaction.deferReply();
      // Giả lập tin nhắn: xử lý qua cùng pipeline bằng cách gửi lại nội dung
      try {
        const fakeContent = stored.prompt;
        // Gọi lại logic ngắn: dùng Gemini với session hiện tại
        const ticketData = getTicketByChannel(interaction.channelId);
        let activeAi = aiInstance;
        let selectedModel = DEFAULT_MODEL;
        let selectedPersona = DEFAULT_PERSONA_ID;
        let customPersonaText = null;
        const up = getUserPrefs(interaction.user.id);
        selectedPersona = up.selectedPersona || DEFAULT_PERSONA_ID;
        customPersonaText = up.customPersonaText || null;
        if (ticketData) {
          const pk = { ...(ticketData.providerKeys || {}) };
          if (ticketData.userApiKey && !pk.gemini) pk.gemini = ticketData.userApiKey;
          const hasAny = Object.values(pk).some(Boolean);
          if (!hasAny) {
            return interaction.editReply(
              '🔑 **Ticket chưa có API key** — nhập `key gemini: ...` (hoặc chatgpt/claude/grok/deepseek) trước.'
            );
          }
          if (pk.gemini) {
            activeAi = new GoogleGenAI({ apiKey: pk.gemini });
          }
          selectedModel = ticketData.selectedModel || DEFAULT_MODEL;
          selectedPersona = ticketData.selectedPersona || selectedPersona;
          customPersonaText = ticketData.customPersonaText || customPersonaText;
        }
        if (!activeAi && !ticketData) {
          return interaction.editReply('❌ Chưa có GEMINI_API_KEY.');
        }
        if (!(ticketData && (ticketData.userApiKey || (ticketData.providerKeys && Object.values(ticketData.providerKeys).some(Boolean))))) {
          const lock = getGeminiLockStatus();
          if (lock.locked) return interaction.editReply(lock.message);
        }
        const q = checkQuota(interaction.user.id, 'chat');
        if (!q.allowed) return interaction.editReply(q.message);

        let systemInstruction = getSystemInstructionForPersona(
          SYSTEM_INSTRUCTION,
          selectedPersona,
          customPersonaText,
          resolveAiDisplayName(ticketData || getTicketByChannel(interaction.channelId), getUserPrefs(interaction.user.id))
        );
        if (up.replyMode === 'strict') {
          systemInstruction += '\n\n' + getStrictModeBlock();
        }
        if (ticketData?.contextNote) {
          systemInstruction += `\n\n[Ghi chú ngữ cảnh ticket]\n${ticketData.contextNote}`;
        }
        systemInstruction += getMemorySystemBlock(interaction.user.id);
        systemInstruction += getKnowledgeSystemBlock(interaction.user.id, interaction.guildId || null);

        const personaKeyPart =
          selectedPersona === 'custom'
            ? `custom_${(customPersonaText || '').slice(0, 40).replace(/\s+/g, '_')}`
            : selectedPersona;
        const sessionKey = `${interaction.user.id}_${interaction.channelId}_${selectedModel}_${personaKeyPart}`;
        if (!activeAi) {
          return interaction.editReply('❌ Regenerate hiện hỗ trợ phiên Gemini.');
        }
        if (!userSessions.has(sessionKey)) {
          const restoredHistory = getSavedHistory(sessionKey);
          const chatSession = activeAi.chats.create({
            model: selectedModel,
            history: restoredHistory,
            config: {
              systemInstruction,
              maxOutputTokens: 8192,
              thinkingConfig: { thinkingLevel: 'medium' },
            },
          });
          userSessions.set(sessionKey, chatSession);
        }
        const chat = userSessions.get(sessionKey);
        const result = await chat.sendMessage({
          message: '[Người dùng yêu cầu TRẢ LỜI LẠI với cách diễn đạt khác, cùng ý]\n\n' + fakeContent,
        });
        consumeQuota(interaction.user.id, 'chat');
        clearGeminiLock().catch(() => {});
        let replyText = result?.text || 'Không tạo lại được.';
        replyText = sanitizeDiscordMath(replyText);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`nexus_regen:${key}`)
            .setLabel('Trả lời lại')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
        );
        return interaction.editReply({ content: replyText.slice(0, 2000), components: [row] });
      } catch (e) {
        console.error('regen error', e);
        const qi = parseGeminiQuotaError(e, DEFAULT_MODEL);
        if (qi.isQuota) {
          if (!(ticketData && ticketData.userApiKey)) {
            await lockGeminiQuota({
              retryAfterSec: qi.retryAfterSec,
              isDailyQuota: qi.isDailyQuota,
              model: qi.model || DEFAULT_MODEL,
            });
            return interaction.editReply(getGeminiLockStatus().message);
          }
          return interaction.editReply(
            '⏳ Key ticket hết quota. Đổi model hoặc dán `key:` project khác.'
          );
        }
        return interaction.editReply('❌ Lỗi khi tạo lại câu trả lời.');
      }
    }

    if (interaction.isModalSubmit && interaction.customId && interaction.customId.startsWith('modal_api_key')) {
      const handledModal = await handleTicketInteraction(interaction);
      if (handledModal) return;
    }

    const handledByTicket = await handleTicketInteraction(interaction);
    if (handledByTicket) {
      // Log tạo ticket / đóng — best effort qua customId
      if (interaction.isButton?.() && interaction.customId?.startsWith('open_ticket')) {
        adminLog({
          title: '🎫 Ticket tạo',
          description: `User: ${interaction.user.tag} (\`${interaction.user.id}\`)`,
          color: 0x57f287,
        }).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, guildId, channelId } = interaction;


    if (commandName === 'help') {
      return interaction.reply({ embeds: [buildHelpEmbed()], ephemeral: true });
    }

    if (commandName === 'ping') {
      const sent = await interaction.reply({ content: '🏓 Ping...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      return interaction.editReply(`🏓 **Pong!**\n⚡ Độ trễ Bot: \`${latency}ms\`\n🌐 WebSocket: \`${client.ws.ping}ms\``);
    }

    if (commandName === 'reset') {
      for (const key of userSessions.keys()) {
        if (key.startsWith(user.id)) userSessions.delete(key);
      }
      // Xoá luôn lịch sử đã lưu trên đĩa cho user này, không chỉ bộ nhớ RAM.
      clearSessionsByPrefix(user.id);
      return interaction.reply('🔄 Đã xóa bộ nhớ lịch sử trò chuyện của bạn! Chúng ta có thể bắt đầu chủ đề mới.');
    }

    if (commandName === 'setchannel') {
      if (!guildId) {
        return interaction.reply({ content: '❌ Lệnh này chỉ có thể dùng trong server.', ephemeral: true });
      }
      allowedChannels.set(guildId, channelId);
      scheduleSaveAllowedChannels();
      return interaction.reply(`✅ Đã thiết lập <#${channelId}> làm kênh trò chuyện duy nhất cho Nexus AI!`);
    }

    if (commandName === 'unsetchannel') {
      if (!guildId) {
        return interaction.reply({ content: '❌ Lệnh này chỉ có thể dùng trong server.', ephemeral: true });
      }
      if (allowedChannels.has(guildId)) {
        allowedChannels.delete(guildId);
        scheduleSaveAllowedChannels();
        return interaction.reply(`✅ Đã bỏ thiết lập kênh duy nhất cho server này. Nexus AI sẽ phản hồi khi được mention hoặc trong DM.`);
      } else {
        return interaction.reply({ content: 'ℹ️ Server này chưa thiết lập kênh duy nhất.', ephemeral: true });
      }
    }

    if (commandName === 'ainame') {
      const raw = interaction.options.getString('name');
      const inTicket = !!getTicketByChannel(interaction.channelId);
      if (raw === null || raw === undefined) {
        const ticket = getTicketByChannel(interaction.channelId);
        const up = getUserPrefs(interaction.user.id);
        const current = (ticket && ticket.aiName) || up.aiName || resolveAiDisplayName(ticket, up);
        return interaction.reply({
          content:
            `🏷️ Tên AI hiện tại: **${current}**\n` +
            `Đặt mới: \`/ainame name:Luna\` · reset: \`/ainame name:reset\`\n` +
            (inTicket
              ? 'Trong **ticket** tên lưu theo kênh ticket.'
              : 'Ngoài ticket tên lưu theo **user** (mọi kênh AI).'),
          ephemeral: true,
        });
      }
      const n = String(raw).trim();
      if (!n || /^reset|default|mặc định|mac dinh$/i.test(n)) {
        if (inTicket) await setTicketAiName(interaction.channelId, null);
        else setUserAiName(interaction.user.id, null);
        return interaction.reply({
          content: `✅ Đã reset tên AI về **tên bot Discord** (${resolveAiDisplayName(null, {})}).`,
          ephemeral: true,
        });
      }
      if (inTicket) await setTicketAiName(interaction.channelId, n);
      else setUserAiName(interaction.user.id, n);
      return interaction.reply({
        content:
          `✅ AI sẽ xưng / được gọi là **${n.slice(0, 40)}**.\n` +
          `Tin nhắn sau dùng tên này (persona + model giữ nguyên).`,
        ephemeral: true,
      });
    }

    if (commandName === 'kb') {
      const sub = interaction.options.getSubcommand();
      const scopeOpt = interaction.options.getString('phamvi') || 'user';
      const member = interaction.member;
      const isAdmin =
        member &&
        member.permissions &&
        typeof member.permissions.has === 'function' &&
        member.permissions.has(PermissionFlagsBits.Administrator);
      const owner = isBotOwner(interaction.user.id);

      const guardScope = (scope) => {
        if (scope === 'guild') {
          if (!interaction.guildId) return '❌ KB server chỉ dùng trong server.';
          if (!isAdmin) return '❌ Chỉ **Admin server** mới sửa KB server.';
        }
        if (scope === 'global' && !owner) {
          return '❌ Chỉ **chủ bot** (`ADMIN_USER_IDS`) mới sửa KB global.';
        }
        return null;
      };

      if (sub === 'help') {
        return interaction.reply({ content: helpKnowledgeText(), ephemeral: true });
      }
      if (sub === 'list') {
        const text = listKnowledge({
          scope: 'all',
          guildId: interaction.guildId,
          userId: interaction.user.id,
        }).slice(0, 1900);
        return interaction.reply({ content: text, ephemeral: true });
      }
      if (sub === 'add') {
        const noidung = interaction.options.getString('noidung');
        const err = guardScope(scopeOpt);
        if (err) return interaction.reply({ content: err, ephemeral: true });
        const r = addKnowledge({
          scope: scopeOpt,
          text: noidung,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          by: interaction.user.id,
        });
        return interaction.reply({ content: r.message, ephemeral: true });
      }
      if (sub === 'del') {
        const tukhoa = interaction.options.getString('tukhoa');
        const err = guardScope(scopeOpt);
        if (err) return interaction.reply({ content: err, ephemeral: true });
        const r = deleteKnowledge({
          scope: scopeOpt,
          keyword: tukhoa,
          guildId: interaction.guildId,
          userId: interaction.user.id,
        });
        return interaction.reply({ content: r.message, ephemeral: true });
      }
      if (sub === 'clear') {
        const err = guardScope(scopeOpt);
        if (err) return interaction.reply({ content: err, ephemeral: true });
        const r = clearKnowledge({
          scope: scopeOpt,
          guildId: interaction.guildId,
          userId: interaction.user.id,
        });
        return interaction.reply({ content: r.message, ephemeral: true });
      }
      return interaction.reply({ content: helpKnowledgeText(), ephemeral: true });
    }

    if (commandName === 'feedback') {
      const msg = interaction.options.getString('message') || '';
      await adminLog({
        title: '💬 Feedback từ user',
        description: msg.slice(0, 1500),
        color: 0xfee75c,
        fields: [
          { name: 'User', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
          {
            name: 'Kênh',
            value: interaction.channelId ? `<#${interaction.channelId}>` : 'DM',
            inline: true,
          },
          {
            name: 'Server',
            value: interaction.guild ? interaction.guild.name : 'DM',
            inline: true,
          },
        ],
      });
      return interaction.reply({
        content:
          '✅ Đã gửi góp ý tới admin.\n' +
          (process.env.ADMIN_LOG_CHANNEL_ID
            ? 'Cảm ơn bạn!'
            : '⚠️ Admin chưa cấu hình `ADMIN_LOG_CHANNEL_ID` — góp ý có thể chưa tới kênh log.'),
        ephemeral: true,
      });
    }

    if (commandName === 'moderation') {
      if (!interaction.guildId) {
        return interaction.reply({ content: '❌ Chỉ dùng trong server.', ephemeral: true });
      }
      const mode = interaction.options.getString('mode');
      const on = mode === 'on';
      setModEnabled(interaction.guildId, on);
      return interaction.reply({
        content: on
          ? '🛡️ **Moderation BẬT** — lọc spam lặp + link đáng ngờ trong **kênh AI / ticket**.\nAdmin Manage Messages được bỏ qua.'
          : '🛡️ Moderation **TẮT**.',
        ephemeral: true,
      });
    }

    if (commandName === 'adminpanel') {
      const lock = getGeminiLockStatus();
      const ticketN = typeof getTicketCount === 'function' ? getTicketCount() : 0;
      const guildId = interaction.guildId;
      const aiCh = guildId ? allowedChannels.get(guildId) : null;
      const mod = guildId ? getModSettings(guildId) : { enabled: false };
      const embed = new EmbedBuilder()
        .setTitle('🛠️ Nexus AI — Admin Panel')
        .setColor(0x5865f2)
        .setDescription('Tổng quan nhanh server / bot')
        .addFields(
          {
            name: 'Bot',
            value:
              `• Online: **${client.user?.tag || '—'}**\n` +
              `• Sessions RAM: **${userSessions.size}**\n` +
              `• Tickets (data): **${ticketN}**`,
            inline: true,
          },
          {
            name: 'Gemini lock',
            value: lock.locked
              ? `🔒 **Đang khóa**\nMở ~**${lock.unlockAtLabel}**\n(~${lock.remainingLabel})`
              : '✅ Sẵn sàng',
            inline: true,
          },
          {
            name: 'Server này',
            value:
              `• Kênh AI: ${aiCh ? `<#${aiCh}>` : '*chưa /setchannel*'}\n` +
              `• Moderation: **${mod.enabled ? 'Bật' : 'Tắt'}**\n` +
              `• Admin log: ${process.env.ADMIN_LOG_CHANNEL_ID ? '✅' : '❌ chưa set'}`,
            inline: false,
          },
          {
            name: 'Lệnh nhanh',
            value:
              '`/setchannel` · `/setup_ticketai` · `/moderation`\n' +
              '`/clear` · `/clear24h` · `/status` · `/quota`\n' +
              'Góp ý user: `/feedback`',
            inline: false,
          }
        )
        .setTimestamp(new Date())
        .setFooter({ text: 'Nexus AI Admin' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (commandName === 'status') {
      const activeSessions = userSessions.size;
      const up = getUserPrefs(user.id);
      const personaLine = personaDisplayName(up.selectedPersona || 'default', up.customPersonaText);
      const ttsLine = up.ttsEnabled ? 'Bật' : 'Tắt';
      if (!guildId) {
        return interaction.reply({
          content:
            `📡 Nexus AI Status (DM):\n` +
            `- Active sessions: **${activeSessions}**\n` +
            `- Default Model: **${DEFAULT_MODEL}**\n` +
            `- Persona của bạn: **${personaLine}**\n` +
            `- TTS: **${ttsLine}**\n` +
            getQuotaStatusText(user.id),
          ephemeral: true,
        });
      } else {
        const tgt = allowedChannels.get(guildId);
        const channelInfo = tgt ? `<#${tgt}> (\`${tgt}\`)` : 'Chưa thiết lập (bot phản hồi khi được mention hoặc trong DM)';
        return interaction.reply({
          content:
            `📡 Nexus AI Status (Server):\n` +
            `- Kênh hiện tại: ${channelInfo}\n` +
            `- Active sessions tổng: **${activeSessions}**\n` +
            `- Default Model: **${DEFAULT_MODEL}**\n` +
            `- Persona của bạn: **${personaLine}**\n` +
            `- TTS: **${ttsLine}**\n` +
            getQuotaStatusText(user.id),
          ephemeral: true,
        });
      }
    }

    if (commandName === 'clear') {
      const amount = interaction.options.getInteger('amount') ?? 100;
      await interaction.deferReply({ ephemeral: true });
      try {
        const { bulkDeleted, individuallyDeleted } = await clearRecentMessages(interaction.channel, amount);
        const total = bulkDeleted + individuallyDeleted;
        return interaction.editReply(
          `🧹 Đã xoá **${total}** tin nhắn trong kênh này (nhanh: ${bulkDeleted}, tin >14 ngày xoá riêng: ${individuallyDeleted}).`
        );
      } catch (err) {
        console.error('❌ Lỗi khi xử lý /clear:', err);
        return interaction.editReply('❌ Không thể xoá tin nhắn. Kiểm tra xem bot có quyền "Manage Messages" trong kênh này không.');
      }
    }

    if (commandName === 'clear24h') {
      if (isAutoClearEnabled(channelId)) {
        return interaction.reply({
          content: 'ℹ️ Kênh này đã bật tự động xoá tin >24h từ trước rồi.',
          ephemeral: true,
        });
      }
      enableAutoClear(channelId);
      return interaction.reply({
        content: '✅ Đã bật tự động xoá tin nhắn cũ hơn 24h trong kênh này. Bot sẽ quét và dọn dẹp định kỳ mỗi giờ.',
        ephemeral: true,
      });
    }

    if (commandName === 'unclear24h') {
      const had = disableAutoClear(channelId);
      return interaction.reply({
        content: had ? '✅ Đã tắt tự động xoá tin nhắn 24h cho kênh này.' : 'ℹ️ Kênh này chưa bật tự động xoá 24h.',
        ephemeral: true,
      });
    }

    if (commandName === 'setup_ticketai') {
      return handleSetupTicketCommand(interaction);
    }

    if (commandName === 'imagine') {
      const gem = resolveGeminiClient(interaction);
      if (!gem.ok) {
        return interaction.reply({ content: gem.message, ephemeral: true });
      }

      const q = checkQuota(user.id, 'image');
      if (!q.allowed) {
        return interaction.reply({ content: q.message, ephemeral: true });
      }

      const cooldown = checkMediaCooldown(user.id, 'image');
      if (!cooldown.allowed) {
        return interaction.reply({
          content: `⏳ Từ từ đã nào! Hãy đợi thêm **${Math.ceil(cooldown.remainingMs / 1000)}s** nữa để tiếp tục tạo ảnh nha.`,
          ephemeral: true,
        });
      }

      const promptStr = interaction.options.getString('prompt');
      await interaction.deferReply();

      try {
        const { buffer, mimeType } = await generateImage(gem.ai, promptStr);
        consumeQuota(user.id, 'image');
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const attachment = new AttachmentBuilder(buffer, { name: `nexus_image.${ext}` });
        const warn = maybeWarn(user.id, 'image');
        return interaction.editReply({
          content: `🎨 Ảnh tạo theo yêu cầu: "${promptStr}"${warn ? `\n${warn}` : ''}`,
          files: [attachment],
        });
      } catch (err) {
        console.error('❌ Lỗi tạo ảnh:', err);
        const { status, rawMsg, friendly } = formatApiError(err, IMAGE_MODEL_NAME);
        return interaction.editReply(friendly || `❌ Không thể tạo ảnh. [\`${status}\`] ${rawMsg}`);
      }
    }

    if (commandName === 'video') {
      const gem = resolveGeminiClient(interaction);
      if (!gem.ok) {
        return interaction.reply({ content: gem.message, ephemeral: true });
      }

      const q = checkQuota(user.id, 'video');
      if (!q.allowed) {
        return interaction.reply({ content: q.message, ephemeral: true });
      }

      const cooldown = checkMediaCooldown(user.id, 'video');
      if (!cooldown.allowed) {
        return interaction.reply({
          content: `⏳ Lệnh tạo video tốn nhiều tài nguyên! Vui lòng chờ **${Math.ceil(cooldown.remainingMs / 1000)}s** nữa nha.`,
          ephemeral: true,
        });
      }

      const promptStr = interaction.options.getString('prompt');
      await interaction.deferReply();
      await interaction.editReply(
        '🎬 Đang dựng video bằng Veo... (1–6 phút)\n' +
          (gem.usingUserKey
            ? '_(Dùng **key Gemini của bạn** trong ticket/DM — không tốn quota bot)_'
            : '_(Dùng key bot — kênh server)_')
      );

      let videoPath;
      try {
        videoPath = await generateVideo(gem.ai, promptStr, {
          onProgress: (s) => console.log(`⏳ Đang tạo video cho ${user.tag}... [${s}s]`),
        });
        consumeQuota(user.id, 'video');
        const attachment = new AttachmentBuilder(videoPath, { name: 'nexus_video.mp4' });
        const warn = maybeWarn(user.id, 'video');
        await interaction.editReply({
          content: `🎬 Video tạo theo yêu cầu: "${promptStr}"${warn ? `\n${warn}` : ''}`,
          files: [attachment],
        });
      } catch (err) {
        console.error('❌ Lỗi tạo video:', err);
        const { status, rawMsg, friendly } = formatApiError(err, VIDEO_MODEL_NAME);
        await interaction.editReply(friendly || `❌ Không thể tạo video. [\`${status}\`] ${rawMsg}`);
      } finally {
        if (videoPath) cleanupTempFile(videoPath);
      }
    }

    if (commandName === 'persona') {
      const style = interaction.options.getString('style');
      const custom = interaction.options.getString('custom');
      if (style === 'custom' && (!custom || custom.trim().length < 5)) {
        return interaction.reply({
          content:
            '❌ Khi chọn **Tùy chỉnh**, hãy điền thêm option `custom` (mô tả ≥ 5 ký tự).\n' +
            'VD: `/persona style:Tùy chỉnh custom:Nói kiểu Gen Z, thích anime, trả lời ngắn`',
          ephemeral: true,
        });
      }
      if (style !== 'custom' && !PERSONA_PRESETS[style]) {
        return interaction.reply({ content: '❌ Persona không hợp lệ.', ephemeral: true });
      }
      setUserPersona(user.id, style, style === 'custom' ? custom.trim() : null);
      // Xóa session RAM để tin nhắn sau dùng persona mới
      for (const key of userSessions.keys()) {
        if (key.startsWith(user.id)) userSessions.delete(key);
      }
      const label = personaDisplayName(style, style === 'custom' ? custom : null);
      return interaction.reply({
        content:
          `🎭 Đã đặt persona (ngoài ticket) thành **${label}**.\n` +
          `• Trong **ticket** vẫn dùng menu chọn riêng của kênh ticket.\n` +
          `• Session chat đã được làm mới cho persona mới.`,
        ephemeral: true,
      });
    }

    if (commandName === 'quota') {
      return interaction.reply({ content: getQuotaStatusText(user.id), ephemeral: true });
    }

    if (commandName === 'tts' || commandName === 'auto-speech') {
      const mode = interaction.options.getString('mode');
      const enabled = mode === 'on';
      setUserTts(user.id, enabled);
      return interaction.reply({
        content: enabled
          ? '🔊 **Auto-speech ON** — mỗi câu trả lời chat sẽ kèm file MP3 (tiếng Việt).\nTắt: `/auto-speech mode:off` hoặc `/tts mode:off`'
          : '🔇 **Auto-speech OFF** — bot không còn đính MP3 mỗi tin.\nBật lại: `/auto-speech mode:on`',
        ephemeral: true,
      });
    }

    if (commandName === 'speak') {
      const text = interaction.options.getString('text');
      await interaction.deferReply();
      try {
        const buf = await synthesizeSpeech(text, 'vi');
        if (!buf) {
          return interaction.editReply('❌ Không tạo được giọng nói. Thử đoạn ngắn hơn hoặc lại sau.');
        }
        const attachment = new AttachmentBuilder(buf, { name: 'nexus_speak.mp3' });
        return interaction.editReply({ content: `🗣️ "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}"`, files: [attachment] });
      } catch (err) {
        console.error('speak error', err);
        return interaction.editReply('❌ Lỗi khi tạo TTS.');
      }
    }

    if (commandName === 'mode') {
      const type = interaction.options.getString('type');
      setUserReplyMode(user.id, type);
      for (const key of userSessions.keys()) {
        if (key.startsWith(user.id)) userSessions.delete(key);
      }
      return interaction.reply({
        content:
          type === 'strict'
            ? '📎 Đã bật **strict**: trả lời ngắn, ít emoji, đúng trọng tâm.'
            : '💬 Đã về **normal**: trả lời thân thiện như mặc định.',
        ephemeral: true,
      });
    }

    if (commandName === 'quiz') {
      const question = startQuiz(channelId, user.id);
      return interaction.reply({
        content: `🧩 **Câu đố** (2 phút):\n> ${question}\n\nTrả lời bằng tin nhắn thường trong kênh này!`,
      });
    }

    if (commandName === 'voicechat') {
      const mode = interaction.options.getString('mode');
      const on = mode === 'on';
      setUserVoiceChat(interaction.user.id, on);
      return interaction.reply({
        content: on
          ? '🎙️ **Chat thoại BẬT**\n1. Vào voice → `/voice action:join`\n2. Nhắn text hoặc **tin nhắn thoại** trong kênh AI/ticket\n3. Bot trả lời + cố đọc to (host free có thể gửi MP3)'
          : '🔇 Đã tắt chat thoại.',
        ephemeral: true,
      });
    }

    if (commandName === 'voice') {
      const action = interaction.options.getString('action');

      // defer ngay với join/speak (join có thể >3s → tránh "Ứng dụng không phản hồi")
      if (action === 'join' || action === 'speak') {
        await interaction.deferReply({ ephemeral: true });
      }

      if (action === 'join') {
        const member = interaction.member;
        const ch = member?.voice?.channel;
        if (!ch) {
          return interaction.editReply(
            '❌ Vào một kênh **voice** trước, rồi chạy `/voice action:join`.'
          );
        }
        const r = await joinVoiceChannel(ch);
        return interaction.editReply(r.message);
      }
      if (action === 'chat_on' || action === 'chat_off') {
        const on = action === 'chat_on';
        setUserVoiceChat(interaction.user.id, on);
        return interaction.reply({
          content: on
            ? '🎙️ **Chat thoại BẬT** — khi bot đang trong voice, câu trả lời AI sẽ được **đọc to**.\n' +
              'Cách dùng: `/voice join` → nhắn text hoặc **tin nhắn thoại** trong kênh AI/ticket.\n' +
              '_(Host free có thể chỉ gửi file MP3 nếu UDP voice lỗi)_'
            : '🔇 Đã tắt chat thoại.',
          ephemeral: true,
        });
      }

      if (action === 'leave') {
        if (!guildId) {
          return interaction.reply({ content: '❌ Chỉ dùng trong server.', ephemeral: true });
        }
        const r = leaveVoice(guildId);
        return interaction.reply({ content: r.message, ephemeral: true });
      }
      if (action === 'speak') {
        const text = interaction.options.getString('text');
        if (!text || !text.trim()) {
          return interaction.editReply('❌ Cần điền `text` khi speak.');
        }
        if (!guildId) {
          return interaction.editReply('❌ Speak voice chỉ trong server.');
        }
        const member = interaction.member;
        const r = await speakInGuild(guildId, text.trim(), {
          guild: interaction.guild,
          clientUserId: client.user.id,
          userVoiceChannel: member?.voice?.channel || null,
        });
        // Fallback MP3 khi voice UDP không Ready (Render free, v.v.)
        if (r.mp3Buffer) {
          const attachment = new AttachmentBuilder(r.mp3Buffer, {
            name: 'nexus_voice_fallback.mp3',
          });
          return interaction.editReply({ content: r.message, files: [attachment] });
        }
        return interaction.editReply(r.message);
      }
    }


    if (commandName === 'ask') {
      const question = interaction.options.getString('question');
      if (!aiInstance) {
        return interaction.reply({ content: '❌ Bot chưa có GEMINI_API_KEY.', ephemeral: true });
      }
      const q = checkQuota(interaction.user.id, 'chat');
      if (!q.allowed) return interaction.reply({ content: q.message, ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      try {
        let systemInstruction = getSystemInstructionForPersona(
          SYSTEM_INSTRUCTION,
          getUserPrefs(interaction.user.id).selectedPersona || DEFAULT_PERSONA_ID,
          getUserPrefs(interaction.user.id).customPersonaText || null
        );
        systemInstruction += getMemorySystemBlock(interaction.user.id);
        systemInstruction += getKnowledgeSystemBlock(interaction.user.id, interaction.guildId || null);
        const chat = aiInstance.chats.create({
          model: DEFAULT_MODEL,
          config: { systemInstruction, maxOutputTokens: 768 },
        });
        const result = await chat.sendMessage({ message: question });
        consumeQuota(interaction.user.id, 'chat');
        const warn = maybeWarn(interaction.user.id, 'chat');
        let text = (result?.text || '…').slice(0, 1900);
        if (warn) text += '\n\n' + warn;
        return interaction.editReply(text);
      } catch (e) {
        console.error('ask error', e);
        return interaction.editReply('❌ Không trả lời được.');
      }
    }

    if (commandName === 'export') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const msgs = await interaction.channel.messages.fetch({ limit: 50 });
        const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const lines = sorted.map((m) => {
          const ts = new Date(m.createdTimestamp).toISOString();
          const who = m.author.bot ? `[BOT] ${m.author.username}` : m.author.username;
          return `[${ts}] ${who}: ${m.content || '(embed/file)'}`;
        });
        const body = lines.join('\n').slice(0, 180000);
        const buf = Buffer.from(body || '(trống)', 'utf8');
        const attachment = new AttachmentBuilder(buf, {
          name: `nexus-export-${interaction.channelId}.txt`,
        });
        return interaction.editReply({
          content: `📤 Đã xuất **${sorted.length}** tin nhắn gần nhất.`,
          files: [attachment],
        });
      } catch (e) {
        console.error('export error', e);
        return interaction.editReply('❌ Không xuất được hội thoại.');
      }
    }

    if (commandName === 'summary') {
      if (!aiInstance) {
        return interaction.reply({ content: '❌ Bot chưa có GEMINI_API_KEY.', ephemeral: true });
      }
      await interaction.deferReply();
      try {
        const msgs = await interaction.channel.messages.fetch({ limit: 25 });
        const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const lines = sorted
          .map((m) => {
            const who = m.author.bot ? 'Bot' : m.author.username;
            const t = (m.content || '').replace(/\s+/g, ' ').trim();
            return t ? `${who}: ${t.slice(0, 280)}` : null;
          })
          .filter(Boolean)
          .slice(-20);
        if (lines.length < 2) {
          return interaction.editReply('ℹ️ Chưa đủ tin nhắn để tóm tắt.');
        }
        const promptSum =
          'Tóm tắt cuộc trò chuyện sau bằng tiếng Việt, ngắn gọn (5–10 gạch đầu dòng), nêu chủ đề chính và kết luận nếu có:\n\n' +
          lines.join('\n');
        const chat = aiInstance.chats.create({
          model: DEFAULT_MODEL,
          config: { maxOutputTokens: 512, systemInstruction: 'Bạn là trợ lý tóm tắt hội thoại Discord, súc tích.' },
        });
        const result = await chat.sendMessage({ message: promptSum });
        const text = result?.text || 'Không tóm tắt được.';
        return interaction.editReply(`📋 **Tóm tắt hội thoại**\n${text.slice(0, 1900)}`);
      } catch (e) {
        console.error('summary error', e);
        return interaction.editReply('❌ Lỗi khi tóm tắt (có thể hết quota Gemini).');
      }
    }

    if (commandName === 'dich') {
      if (!aiInstance) {
        return interaction.reply({ content: '❌ Bot chưa có GEMINI_API_KEY.', ephemeral: true });
      }
      const text = interaction.options.getString('text');
      await interaction.deferReply();
      try {
        const translated = await translateTextFull(aiInstance, text);
        return await sendLongTranslation(interaction, translated, { ephemeral: false });
      } catch (e) {
        console.error('dich error', e);
        return interaction.editReply('❌ Không dịch được (quota/API).');
      }
    }

    if (commandName === 'remind') {
      const minutes = interaction.options.getInteger('minutes');
      const note = interaction.options.getString('note');
      const ms = minutes * 60 * 1000;
      const id = `${user.id}_${Date.now()}`;
      const channel = interaction.channel;
      const timeout = setTimeout(async () => {
        pendingReminders.delete(id);
        try {
          await channel.send({
            content: `⏰ <@${user.id}> **Nhắc nhở:** ${note.slice(0, 500)}`,
          });
        } catch (_) {}
      }, ms);
      pendingReminders.set(id, timeout);
      return interaction.reply({
        content: `✅ Sẽ nhắc bạn sau **${minutes} phút**: _${note.slice(0, 200)}_`,
        ephemeral: true,
      });
    }

    if (commandName === 'ship') {
      const u1 = interaction.options.getUser('user1');
      const u2 = interaction.options.getUser('user2');
      const seed = [...`${u1.id}${u2.id}`].reduce((a, c) => a + c.charCodeAt(0), 0);
      const score = seed % 101;
      let label = '陌生人 😅';
      if (score >= 90) label = 'Định mệnh 💍';
      else if (score >= 75) label = 'Rất hợp 🔥';
      else if (score >= 55) label = 'Khá ok ✨';
      else if (score >= 35) label = 'Hơi lệch 👀';
      else if (score >= 15) label = 'Khó đó 🫠';
      else label = 'Xung khắc cosmic 💥';
      const barFilled = Math.round(score / 10);
      const bar = '█'.repeat(barFilled) + '░'.repeat(10 - barFilled);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('💘 Ship meter')
            .setDescription(
              `**${u1.username}** × **${u2.username}**\n\n` +
                `\`${bar}\` **${score}%**\n` +
                `→ ${label}`
            )
            .setColor(score >= 70 ? 0xff69b4 : 0x5865f2),
        ],
      });
    }
  } catch (err) {
    console.error('❌ Lỗi khi xử lý interaction:', err);
    if (interaction.replied || interaction.deferred) {
      try { await interaction.editReply('❌ Có lỗi xảy ra khi xử lý lệnh.'); } catch (e) {}
    } else {
      try { await interaction.reply('❌ Có lỗi xảy ra khi xử lý lệnh.'); } catch (e) {}
    }
  }
});

// ==========================================
// XỬ LÝ TIN NHẮN (AUTO-CHAT & TICKET ENGINE)
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  let ticketData = getTicketByChannel(message.channel.id);
  if (!ticketData && message.channel && ensureTicketRecord) {
    ticketData = ensureTicketRecord(message.channel);
  }

  // Bật/tắt chat thoại bằng tin nhắn
  {
    const raw = message.content.replace(/<@!?\d+>/g, '').trim();
    if (/^(?:!)?voicechat\s+on$/i.test(raw)) {
      setUserVoiceChat(message.author.id, true);
      return message
        .reply(
          '🎙️ **Chat thoại BẬT** — `/voice join` rồi nhắn text hoặc tin nhắn thoại.'
        )
        .catch(() => {});
    }
    if (/^(?:!)?voicechat\s+off$/i.test(raw)) {
      setUserVoiceChat(message.author.id, false);
      return message.reply('🔇 Đã tắt chat thoại.').catch(() => {});
    }
  }

  // Help dạng tin nhắn (không cần slash menu)
  const helpText = message.content.replace(/<@!?\d+>/g, '').trim();
  if (/^(?:!\/?|\/)?help$/i.test(helpText) || /^(?:trợ giúp|huong dan|hướng dẫn)$/i.test(helpText)) {
    return message.reply({ embeds: [buildHelpEmbed()] }).catch(() => {});
  }

  // Auto-speech / TTS từ tin nhắn tự do
  // /auto-speech mode: on|off  |  auto-speech: on  |  auto speech mode off  |  /tts on
  {
    const rawAs = message.content.replace(/<@!?\d+>/g, '').trim();
    const mAs = rawAs.match(
      /^(?:\/)?(?:auto[\s_-]?speech|tts|tự\s*đọc|tu\s*doc)\s*(?:mode\s*)?[:\s]+\s*(on|off|bật|bat|tắt|tat|mở|mo|đóng|dong)\s*$/i
    );
    if (mAs) {
      const v = mAs[1].toLowerCase();
      const enabled = /^(on|bật|bat|mở|mo)$/i.test(v);
      setUserTts(message.author.id, enabled);
      return message
        .reply(
          enabled
            ? '🔊 **Auto-speech ON** — mỗi câu trả lời sẽ kèm file MP3.\nTắt: `auto-speech mode: off` hoặc `/auto-speech mode:off`'
            : '🔇 **Auto-speech OFF**.\nBật lại: `auto-speech mode: on` hoặc `/auto-speech mode:on`'
        )
        .catch(() => {});
    }
  }

  // Nhập key — ticket (đa provider) hoặc DM (chỉ Gemini)
  {
    const parsedKey = parseKeyMessage(message.content);
    if (parsedKey && parsedKey.apiKey) {
      if (parsedKey.apiKey.length < 12) {
        return message.reply('❌ Key quá ngắn — kiểm tra lại.');
      }
      const prov = parsedKey.provider || 'gemini';
      const label = PROVIDER_META[prov]?.label || prov;
      const isDMMsg = !message.guild;

      if (ticketData) {
        await setTicketApiKey(message.channel.id, parsedKey.apiKey, prov);
        await message.delete().catch(() => {});
        return message.channel.send(
          `🔑 **Đã lưu key ${label}** cho ticket này.\n` +
            `Persona **${prov}** sẽ ưu tiên key này. Gõ \`keys\` để xem đã nhập provider nào.\n` +
            `_(Tin nhắn chứa key đã xóa)_`
        );
      }

      // DM: chỉ nhận Gemini, lưu theo user
      if (isDMMsg) {
        if (prov !== 'gemini') {
          return message.reply(
            'ℹ️ **Chat DM chỉ dùng Gemini.**\n' +
              'Gửi: `key gemini: AIza...`\n' +
              'Lấy key: https://aistudio.google.com\n' +
              '_(Model mặc định gemini flash — không cần chọn model)_'
          );
        }
        setUserGeminiKey(message.author.id, parsedKey.apiKey);
        await message.delete().catch(() => {});
        return message.channel.send(
          '🔑 **Đã lưu key Gemini** cho chat DM của bạn.\n' +
            'Model: **mặc định** (không cần chọn).\n' +
            'Gõ tin nhắn bình thường để chat.\n' +
            'Xóa key: `key gemini: xóa`\n' +
            '_(Tin nhắn chứa key đã xóa)_'
        );
      }
    }

    // DM: xóa key
    if (!message.guild && /^key\s*gemini\s*:\s*(xóa|xoá|xoa|clear|reset|delete)\s*$/i.test(message.content.trim())) {
      setUserGeminiKey(message.author.id, null);
      return message.reply('🗑️ Đã xóa key Gemini DM. Nhập lại `key gemini: AIza...` khi cần chat.').catch(() => {});
    }

    if (ticketData && /^keys?$/i.test(message.content.trim())) {
      const tk = getTicketByChannel(message.channel.id) || ticketData;
      const pk = tk.providerKeys || {};
      if (tk.userApiKey && !pk.gemini) pk.gemini = tk.userApiKey;
      const lines = Object.keys(PROVIDER_META).map((id) => {
        const has = !!(pk[id] || (id === 'gemini' && tk.userApiKey));
        return `${has ? '✅' : '⬜'} **${PROVIDER_META[id].label}** — \`key ${id}: ${PROVIDER_META[id].keyHint}\``;
      });
      return message.reply('🔑 **Key trong ticket:**\n' + lines.join('\n') + '\n\n' + helpKeyText()).catch(() => {});
    }

    if (!message.guild && /^keys?$/i.test(message.content.trim())) {
      const has = !!getUserGeminiKey(message.author.id);
      return message
        .reply(
          `🔑 **Key DM:** ${has ? '✅ đã lưu Gemini' : '⬜ chưa có'}\n` +
            'Nhập: `key gemini: AIza...`\n' +
            'Model mặc định — **không cần chọn model**.'
        )
        .catch(() => {});
    }
  }


  // Ghi nhớ dài hạn
  const rawContent = message.content.trim();
  if (/^remember\s*:/i.test(rawContent)) {
    const body = rawContent.replace(/^remember\s*:/i, '').trim();
    const r = addMemory(message.author.id, body);
    return message.reply(r.message).catch(() => {});
  }
  if (/^forget\s*:/i.test(rawContent)) {
    const body = rawContent.replace(/^forget\s*:/i, '').trim();
    const r = forgetMemory(message.author.id, body);
    return message.reply(r.message).catch(() => {});
  }
  if (/^(memory|memories|bộ nhớ|bo nho)\s*$/i.test(rawContent)) {
    return message.reply(formatMemoryList(message.author.id)).catch(() => {});
  }

  // ===== Training / Knowledge Base (tự chỉnh) =====
  {
    const rawKb = message.content.replace(/<@!?\d+>/g, '').trim();
    // help
    if (/^(?:kb|knowledge|training)\s*(?:help|\?)?\s*$/i.test(rawKb) || /^train\s*help\s*$/i.test(rawKb)) {
      return message.reply(helpKnowledgeText()).catch(() => {});
    }
    // list
    if (/^(?:kb|knowledge|training)\s+list\s*$/i.test(rawKb) || /^train\s+list\s*$/i.test(rawKb)) {
      return message.reply(listKnowledge({ scope: 'all', guildId: message.guildId, userId: message.author.id }).slice(0, 1900)).catch(() => {});
    }
    // clear personal
    if (/^(?:kb|train(?:ing)?)\s+clear\s*$/i.test(rawKb)) {
      const r = clearKnowledge({ scope: 'user', userId: message.author.id });
      return message.reply(r.message).catch(() => {});
    }
    // del personal
    const delM = rawKb.match(/^(?:kb|train(?:ing)?)\s+(?:del|delete|remove|xóa|xoá)\s*:?\s*(.+)$/i);
    if (delM) {
      const r = deleteKnowledge({ scope: 'user', keyword: delM[1].trim(), userId: message.author.id });
      return message.reply(r.message).catch(() => {});
    }
    // add personal: kb add: | train: | training:
    const addM = rawKb.match(/^(?:kb\s+add|train(?:ing)?)\s*:\s*(.+)$/i);
    if (addM) {
      const r = addKnowledge({
        scope: 'user',
        text: addM[1],
        userId: message.author.id,
        by: message.author.id,
      });
      return message.reply(r.message).catch(() => {});
    }
    // guild admin
    const gAdd = rawKb.match(/^kb\s+guild\s+add\s*:\s*(.+)$/i);
    if (gAdd) {
      if (!message.guild || !message.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Chỉ **admin server** mới thêm KB guild.').catch(() => {});
      }
      const r = addKnowledge({
        scope: 'guild',
        text: gAdd[1],
        guildId: message.guildId,
        by: message.author.id,
      });
      return message.reply(r.message).catch(() => {});
    }
    if (/^kb\s+guild\s+list\s*$/i.test(rawKb)) {
      return message.reply(listKnowledge({ scope: 'guild', guildId: message.guildId, userId: message.author.id }).slice(0, 1900)).catch(() => {});
    }
    const gDel = rawKb.match(/^kb\s+guild\s+(?:del|delete|xóa|xoá)\s*:?\s*(.+)$/i);
    if (gDel) {
      if (!message.guild || !message.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Chỉ **admin server**.').catch(() => {});
      }
      const r = deleteKnowledge({ scope: 'guild', keyword: gDel[1].trim(), guildId: message.guildId });
      return message.reply(r.message).catch(() => {});
    }
    if (/^kb\s+guild\s+clear\s*$/i.test(rawKb)) {
      if (!message.guild || !message.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Chỉ **admin server**.').catch(() => {});
      }
      const r = clearKnowledge({ scope: 'guild', guildId: message.guildId });
      return message.reply(r.message).catch(() => {});
    }
    // global owner
    const glAdd = rawKb.match(/^kb\s+global\s+add\s*:\s*(.+)$/i);
    if (glAdd) {
      if (!isBotOwner(message.author.id)) {
        return message.reply('❌ Chỉ **chủ bot** (`ADMIN_USER_IDS`) mới thêm KB global.').catch(() => {});
      }
      const r = addKnowledge({ scope: 'global', text: glAdd[1], by: message.author.id });
      return message.reply(r.message).catch(() => {});
    }
    if (/^kb\s+global\s+list\s*$/i.test(rawKb)) {
      return message.reply(listKnowledge({ scope: 'global', userId: message.author.id }).slice(0, 1900)).catch(() => {});
    }
    const glDel = rawKb.match(/^kb\s+global\s+(?:del|delete|xóa|xoá)\s*:?\s*(.+)$/i);
    if (glDel) {
      if (!isBotOwner(message.author.id)) {
        return message.reply('❌ Chỉ **chủ bot**.').catch(() => {});
      }
      const r = deleteKnowledge({ scope: 'global', keyword: glDel[1].trim() });
      return message.reply(r.message).catch(() => {});
    }
    if (/^kb\s+global\s+clear\s*$/i.test(rawKb)) {
      if (!isBotOwner(message.author.id)) {
        return message.reply('❌ Chỉ **chủ bot**.').catch(() => {});
      }
      const r = clearKnowledge({ scope: 'global' });
      return message.reply(r.message).catch(() => {});
    }
  }

  // Ghim ngữ cảnh ticket: note: ...
  // Đặt tên AI: name: Luna  |  tên ai: Mây
  const nameMatch = message.content.trim().match(/^(?:name|tên(?:\s*ai)?)\s*:\s*(.+)$/i);
  if (nameMatch) {
    const n = nameMatch[1].trim().slice(0, 40);
    if (!n || /^reset|default|mặc định|mac dinh$/i.test(n)) {
      if (ticketData) await setTicketAiName(message.channel.id, null);
      else setUserAiName(message.author.id, null);
      return message.reply(`✅ Đã reset tên AI về **tên bot Discord** (${resolveAiDisplayName(null, {})}).`).catch(() => {});
    }
    if (ticketData) await setTicketAiName(message.channel.id, n);
    else setUserAiName(message.author.id, n);
    return message
      .reply(`✅ Từ giờ AI xưng / được gọi là **${n}** (không bắt buộc giống Nexus AI).`)
      .catch(() => {});
  }

  if (ticketData && /^note\s*:/i.test(message.content.trim())) {
    const noteText = message.content.replace(/^note\s*:/i, '').trim();
    if (!noteText) {
      return message.reply('ℹ️ Dùng: `note: nội dung cần nhớ trong ticket này`');
    }
    await setTicketNote(message.channel.id, noteText);
    return message.reply(`📌 Đã ghim ngữ cảnh ticket:\n> ${noteText.slice(0, 500)}${noteText.length > 500 ? '…' : ''}`);
  }

  // Dịch nhanh: dịch: ... / dich: ...
  if (/^(dịch|dich)\s*:/i.test(message.content.trim())) {
    if (!aiInstance) {
      return message.reply('❌ Bot chưa có GEMINI_API_KEY.').catch(() => {});
    }
    const text = message.content.replace(/^(dịch|dich)\s*:/i, '').trim();
    if (!text) {
      return message.reply('ℹ️ Dùng: `dịch: đoạn cần dịch`').catch(() => {});
    }
    try {
      await message.channel.sendTyping().catch(() => {});
      const translated = await translateTextFull(aiInstance, text);
      const chunks = splitLongMessage(`🌐 **Bản dịch**\n${translated}`, 1900);
      await message.reply({ content: chunks[0] }).catch(() => {});
      for (let i = 1; i < chunks.length; i++) {
        await message.channel.send({ content: chunks[i] }).catch(() => {});
      }
      return;
    } catch (e) {
      return message.reply('❌ Không dịch được.').catch(() => {});
    }
  }

  // Trả lời quiz nếu đang có câu đố trong kênh
  if (hasActiveQuiz(message.channel.id)) {
    const quizResult = tryAnswer(message.channel.id, message.author.id, message.content);
    if (quizResult && quizResult.message) {
      return message.reply(quizResult.message).catch(() => {});
    }
  }

  const isDM = !message.guild;
  const guildId = message.guildId;
  const targetChannel = guildId ? allowedChannels.get(guildId) : null;
  const isMentioned = message.mentions.has(client.user);

  // DM: luôn cho chat (dùng GEMINI_API_KEY bot + model mặc định) — không cần ticket / chọn model
  // Server: ticket HOẶC setchannel HOẶC mention
  if (!isDM && !ticketData && targetChannel && message.channel.id !== targetChannel) return;
  if (!isDM && !ticketData && !targetChannel && !isMentioned) return;

  // Moderation (kênh AI / ticket)
  try {
    const isAiCh =
      !!ticketData ||
      (message.guildId && allowedChannels.get(message.guildId) === message.channel.id);
    const modHit = checkMessageModeration(message, { isAiChannel: isAiCh });
    if (modHit) {
      adminLog({
        title: '🛡️ Moderation',
        description: modHit.reason,
        color: 0xed4245,
        fields: [
          { name: 'User', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
          { name: 'Kênh', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Nội dung', value: (message.content || '').slice(0, 200) || '(trống)', inline: false },
        ],
      }).catch(() => {});
      if (modHit.action === 'delete') {
        await message.delete().catch(() => {});
        await message.channel
          .send({ content: `⚠️ <@${message.author.id}> ${modHit.reason}` })
          .then((m) => setTimeout(() => m.delete().catch(() => {}), 8000))
          .catch(() => {});
        return;
      }
      await message.reply(`⚠️ ${modHit.reason}`).catch(() => {});
    }
  } catch (modErr) {
    console.warn('moderation', modErr && modErr.message);
  }


  const now = Date.now();
  const cooldownAmount = CHAT_COOLDOWN_SECONDS * 1000;
  if (userCooldowns.has(message.author.id)) {
    const expirationTime = userCooldowns.get(message.author.id) + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
      return message
        .reply(`⏱️ Bạn gửi tin nhắn quá nhanh! Vui lòng chờ **${timeLeft}s** nữa để tiếp tục chat.`)
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 3000));
    }
  }
  userCooldowns.set(message.author.id, now);

  // Hạn mức chat / ngày (giới hạn bot tự quản)
  const chatQuota = checkQuota(message.author.id, 'chat');
  if (!chatQuota.allowed) {
    return message.reply(chatQuota.message).catch(() => {});
  }

  // Khóa Gemini chỉ khi dùng KEY BOT — ticket/DM có key riêng vẫn chat được
  const earlyTicket = ticketData || getTicketByChannel(message.channel.id);
  const isDMEarly = !message.guild;
  const usingOwnTicketKey = !!(
    (earlyTicket &&
      (earlyTicket.userApiKey ||
        (earlyTicket.providerKeys && Object.keys(earlyTicket.providerKeys).length > 0))) ||
    (isDMEarly && getUserGeminiKey(message.author.id))
  );
  if (!usingOwnTicketKey) {
    const geminiLock = getGeminiLockStatus();
    if (geminiLock.locked) {
      return message.reply(geminiLock.message).catch(() => {});
    }
  }

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();

  // Ảnh đính kèm (vision) — png/jpg/webp/gif
  const imageAtts = Array.from(message.attachments?.values?.() || []).filter((a) => {
    const ct = (a.contentType || '').toLowerCase();
    const name = (a.name || '').toLowerCase();
    return ct.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(name);
  });
  // Tin nhắn thoại Discord / file audio (webm có thể là video — ưu tiên video nếu contentType video)
  const audioAtts = Array.from(message.attachments?.values?.() || []).filter((a) => {
    const ct = (a.contentType || '').toLowerCase();
    const name = (a.name || '').toLowerCase();
    if (ct.startsWith('video/')) return false;
    if (/\.(mp4|mov|mkv|avi)$/i.test(name)) return false;
    return (
      ct.startsWith('audio/') ||
      ct.includes('ogg') ||
      ct.includes('voice') ||
      /\.(ogg|mp3|wav|m4a|opus)$/i.test(name) ||
      (/\.webm$/i.test(name) && !ct.startsWith('video/'))
    );
  });
  // Video đính kèm (Gemini multimodal)
  const videoAtts = Array.from(message.attachments?.values?.() || []).filter((a) => {
    const ct = (a.contentType || '').toLowerCase();
    const name = (a.name || '').toLowerCase();
    return (
      ct.startsWith('video/') ||
      /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(name)
    );
  });

  if (!prompt && imageAtts.length === 0 && audioAtts.length === 0 && videoAtts.length === 0) {
    try {
      if (isDM) {
        {
          const hasK = !!getUserGeminiKey(message.author.id);
          await message.reply(
            '👋 **Chat DM với Nexus AI** (không cần ticket)\n' +
              (hasK
                ? '✅ Đã có key Gemini — gửi câu hỏi để chat.\nModel **mặc định** — không cần chọn model.\n'
                : '🔑 Trước hết gửi:\n```\nkey gemini: AIza...\n```\nLấy key: https://aistudio.google.com\n') +
              '• `keys` — xem đã lưu key chưa\n' +
              '• `key gemini: xóa` — xóa key\n' +
              '• `help` / `/reset` — hướng dẫn / xóa lịch sử'
          );
        }
      } else {
        await message.reply('Bạn cần Nexus AI hỗ trợ gì nào? (gửi **chữ**, **ảnh**, **video** hoặc **tin nhắn thoại**)');
      }
    } catch (err) {}
    return;
  }

  // Toxic shield — chặn lời lẽ xúc phạm trước khi gọi API
    const jail = detectJailbreakPrompt(prompt);
  if (jail && jail.blocked) {
    try {
      adminLog({
        title:
          jail.reason === 'harmful_cyber'
            ? '🛡️ Prompt Shield — chặn tấn công mạng'
            : '🛡️ Prompt Shield — chặn jailbreak',
        description: (prompt || '').slice(0, 500),
        color: 0xed4245,
        fields: [
          { name: 'User', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
          { name: 'Kênh', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Mức', value: `${jail.severity}${jail.reason ? ' · ' + jail.reason : ''}`, inline: true },
        ],
      }).catch(() => {});
    } catch (_) {}
    return message.reply(jail.reply).catch(() => {});
  }

const toxicReply = handleToxicBehavior(prompt);
  if (toxicReply) {
    adminLog({
      title: '⚠️ Toxic blocked',
      description: prompt.slice(0, 300),
      color: 0xed4245,
      fields: [
        { name: 'User', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
      ],
    }).catch(() => {});
    return message.reply(toxicReply).catch(() => {});
  }

  // Phát hiện cảm xúc user (dùng cho tone + GIF + quick reply)
  const { id: userEmotion } = detectUserEmotion(prompt);

  // Phản hồi nhanh cho chào / cảm ơn rất ngắn — tiết kiệm API
  const quickReply = tryQuickEmotionalReply(prompt, userEmotion);
  if (quickReply) {
    let gifUrl = null;
    try {
      gifUrl = await resolveEmotionalGif({
        userEmotion,
        replyText: quickReply,
        getGifForEmotion,
        getGifByKeyword,
        channelId: message.channel.id,
      });
    } catch (_) {}
    const embeds = gifUrl ? [new EmbedBuilder().setImage(gifUrl).setColor(0x5865f2)] : [];
    return message.reply({ content: quickReply, embeds }).catch(() => message.reply(quickReply).catch(() => {}));
  }

  // Không khóa @everyone khi đang trả lời — dễ kẹt kênh nếu bot lỗi/restart
  try {
    try { await message.channel.sendTyping(); } catch (err) {}

    // Không gán key bot sẵn — tránh DM/ticket lách qua
    let activeAi = null;
    let selectedModel = DEFAULT_MODEL;
    let usingTicketKey = false;
    let selectedPersona = DEFAULT_PERSONA_ID;
    let customPersonaText = null;

    // Persona ngoài ticket lấy từ UserPrefs (/persona)
    const userPrefs = getUserPrefs(message.author.id);
    selectedPersona = userPrefs.selectedPersona || DEFAULT_PERSONA_ID;
    customPersonaText = userPrefs.customPersonaText || null;

    let externalProvider = null; // chatgpt|claude|grok|deepseek
    let externalApiKey = null;

    // DM: chặn sớm nếu chưa có key Gemini user
    if (isDM) {
      const userKeyEarly = getUserGeminiKey(message.author.id);
      if (!userKeyEarly) {
        return message.reply(
          '🔑 **Chat DM cần key Gemini của bạn** (không dùng ticket, không dùng key bot).\n\n' +
            'Gửi một tin:\n' +
            '```\nkey gemini: AIza...\n```\n' +
            'Lấy key: https://aistudio.google.com\n' +
            'Model **mặc định** — không cần chọn model.\n' +
            'Gõ `keys` để kiểm tra.'
        );
      }
      activeAi = new GoogleGenAI({ apiKey: userKeyEarly });
      selectedModel = DEFAULT_MODEL;
      usingTicketKey = true;
    }

    if (ticketData) {
      selectedPersona = ticketData.selectedPersona || DEFAULT_PERSONA_ID;
      customPersonaText = ticketData.customPersonaText || null;
      selectedModel = ticketData.selectedModel || DEFAULT_MODEL;

      let wantProv = providerFromModel(selectedModel) || providerForPersona(selectedPersona);
      const pk = { ...(ticketData.providerKeys || {}) };
      if (ticketData.userApiKey && !pk.gemini) pk.gemini = ticketData.userApiKey;

      const pickKey = (prov) => pk[prov] || null;

      // 1) Đúng provider của model đã chọn
      let keyForWant = pickKey(wantProv);
      // 2) Nếu không có key đúng provider nhưng có key khác → chuyển sang provider đó
      if (!keyForWant) {
        const order = ['gemini', 'chatgpt', 'deepseek', 'claude', 'grok'];
        for (const p of order) {
          if (pickKey(p)) {
            wantProv = p;
            keyForWant = pickKey(p);
            // Đổi model mặc định cho provider nếu model hiện tại lệch nhà
            if (providerFromModel(selectedModel) !== p) {
              const defaults = {
                gemini: 'gemini-3.6-flash',
                chatgpt: 'gpt-5-mini',
                claude: 'claude-sonnet-5-20250514',
                grok: 'grok-4.6',
                deepseek: 'deepseek-chat',
              };
              selectedModel = defaults[p] || selectedModel;
            }
            break;
          }
        }
      }

      if (!keyForWant) {
        // Ticket BẮT BUỘC có key user — không dùng key bot (tránh chat free ngoài ý muốn)
        return message.reply(
          '🔑 **Ticket chưa có API key** — nhập key trước rồi chat nhé.\n\n' +
            helpKeyText() +
            '\n\nVí dụ: `key gemini: AIza...` hoặc `key chatgpt: sk-...`'
        );
      } else if (wantProv !== 'gemini') {
        externalProvider = wantProv;
        externalApiKey = keyForWant;
        usingTicketKey = true;
        activeAi = null;
      } else {
        activeAi = new GoogleGenAI({ apiKey: keyForWant });
        usingTicketKey = true;
      }
    }

    if (!externalProvider && !activeAi) {
      if (isDM) {
        // DM: BẮT BUỘC key Gemini của user — model mặc định, không chọn model
        const userKey = getUserGeminiKey(message.author.id);
        if (!userKey) {
          return message.reply(
            '🔑 **Chat DM cần key Gemini của bạn** (không dùng ticket).\n\n' +
              'Gửi một tin:\n' +
              '```\nkey gemini: AIza...\n```\n' +
              'Lấy key free: https://aistudio.google.com\n' +
              'Model: **mặc định** — không cần chọn model.'
          );
        }
        activeAi = new GoogleGenAI({ apiKey: userKey });
        selectedModel = DEFAULT_MODEL;
        usingTicketKey = true; // coi như key riêng → không dính lock key bot
        externalProvider = null;
      } else if (aiInstance) {
        activeAi = aiInstance;
      } else {
        return message.reply('❌ Bot chưa được cài đặt GEMINI_API_KEY!');
      }
    }

    // DM: luôn khóa model mặc định + chỉ key user
    if (isDM) {
      selectedModel = DEFAULT_MODEL;
      externalProvider = null;
      const userKey = getUserGeminiKey(message.author.id);
      if (!userKey) {
        return message.reply(
          '🔑 **Chat DM cần key Gemini.** Gửi: `key gemini: AIza...`'
        );
      }
      activeAi = new GoogleGenAI({ apiKey: userKey });
      usingTicketKey = true;
    }


    // Session tách theo model + persona để đổi tính cách không dính lịch sử cũ
    const personaKeyPart =
      selectedPersona === 'custom'
        ? `custom_${(customPersonaText || '').slice(0, 40).replace(/\s+/g, '_')}`
        : selectedPersona;
    const sessionKey = `${message.author.id}_${message.channel.id}_${selectedModel}_${personaKeyPart}`;

    const aiNameResolved = resolveAiDisplayName(ticketData, userPrefs);
    let systemInstruction = getSystemInstructionForPersona(
      SYSTEM_INSTRUCTION,
      selectedPersona,
      customPersonaText,
      aiNameResolved
    );
    systemInstruction += '\n\n' + getPromptShieldBlock();
    if (userPrefs.replyMode === 'strict') {
      systemInstruction += '\n\n' + getStrictModeBlock();
    }
    if (ticketData?.contextNote) {
      systemInstruction += `\n\n[Ghi chú ngữ cảnh ticket do user đặt]\n${ticketData.contextNote}`;
    }
    systemInstruction += getMemorySystemBlock(message.author.id);
    systemInstruction += getKnowledgeSystemBlock(message.author.id, message.guildId || null);
    systemInstruction +=
      '\n\n[Code policy] Khi user xin code dài/full project: (1) tóm tắt cấu trúc ngắn, (2) mỗi file bọc trong code fence ```lang — hệ thống đổi thành LINK paste.';

    if (!userSessions.has(sessionKey)) {
      const restoredHistory = getSavedHistory(sessionKey);
      // legacy block kept minimal — systemInstruction đã có ở trên
      if (!externalProvider && activeAi) {
        const chatSession = activeAi.chats.create({
          model: selectedModel,
          history: restoredHistory,
          config: {
            systemInstruction,
            maxOutputTokens: 8192,
            thinkingConfig: { thinkingLevel: 'medium' },
          },
        });
        userSessions.set(sessionKey, chatSession);
        if (restoredHistory.length > 0) {
          console.log(`♻️ Đã khôi phục ${restoredHistory.length} tin nhắn lịch sử cho session ${sessionKey}`);
        }
      }
    }

    const chat = externalProvider ? null : userSessions.get(sessionKey);
    // Gắn gợi ý cảm xúc vào tin nhắn (không đổi systemInstruction cố định của session)
    let textPart =
      prompt ||
      (imageAtts.length
        ? 'Hãy xem (các) ảnh đính kèm: mô tả nội dung, chữ trong ảnh (nếu có), và trả lời / hỗ trợ phù hợp bằng tiếng Việt.'
        : '');
    if (userEmotion && userEmotion !== 'neutral' && prompt) {
      const toneLine =
        userEmotion === 'sad' || userEmotion === 'lonely' || userEmotion === 'anxious'
          ? `[Cảm xúc user: ${userEmotion} — hãy đồng cảm nhẹ, giọng trấn an, vẫn trả lời đúng trọng tâm]`
          : userEmotion === 'angry'
            ? `[Cảm xúc user: angry — giữ bình tĩnh, không đáp trả gay gắt, tập trung giải quyết]`
            : userEmotion === 'tired'
              ? `[Cảm xúc user: tired — trả lời ngắn gọn, dễ đọc]`
              : userEmotion === 'confused'
                ? `[Cảm xúc user: confused — giải thích rõ, đơn giản]`
                : `[Cảm xúc user: ${userEmotion} — điều chỉnh giọng cho phù hợp]`;
      textPart = `${toneLine}\n\n${prompt}`;
    }

    // Tải ảnh → base64 cho Gemini vision (tối đa 3 ảnh, mỗi ảnh ≤ 4MB)
    const visionParts = [];
    if (imageAtts.length > 0) {
      const fetchFn =
        typeof globalThis.fetch === 'function'
          ? globalThis.fetch
          : (() => {
              try {
                return require('node-fetch');
              } catch {
                return null;
              }
            })();
      const maxImages = Math.min(3, imageAtts.length);
      for (let i = 0; i < maxImages; i++) {
        const att = imageAtts[i];
        if (att.size && att.size > 4 * 1024 * 1024) {
          console.warn('Bỏ ảnh quá lớn', att.name, att.size);
          continue;
        }
        try {
          if (!fetchFn) break;
          const res = await fetchFn(att.url, {
            headers: { 'User-Agent': 'NexusAI-DiscordBot/1.0' },
          });
          if (!res.ok) continue;
          const arr = await res.arrayBuffer();
          if (!arr || arr.byteLength < 32 || arr.byteLength > 4 * 1024 * 1024) continue;
          const b64 = Buffer.from(arr).toString('base64');
          let mime = (att.contentType || 'image/png').split(';')[0].trim();
          if (!mime.startsWith('image/')) {
            if (/\.png$/i.test(att.name || '')) mime = 'image/png';
            else if (/\.webp$/i.test(att.name || '')) mime = 'image/webp';
            else if (/\.gif$/i.test(att.name || '')) mime = 'image/gif';
            else mime = 'image/jpeg';
          }
          visionParts.push({ inlineData: { mimeType: mime, data: b64 } });
        } catch (imgErr) {
          console.warn('Tải ảnh vision lỗi:', imgErr && imgErr.message);
        }
      }
    }

    // Tải audio / tin nhắn thoại (tối đa 1 file ≤ 8MB)
    if (audioAtts.length > 0) {
      const fetchFn =
        typeof globalThis.fetch === 'function'
          ? globalThis.fetch
          : (() => {
              try {
                return require('node-fetch');
              } catch {
                return null;
              }
            })();
      const att = audioAtts[0];
      if (fetchFn && (!att.size || att.size <= 8 * 1024 * 1024)) {
        try {
          const res = await fetchFn(att.url, {
            headers: { 'User-Agent': 'NexusAI-DiscordBot/1.0' },
          });
          if (res.ok) {
            const arr = await res.arrayBuffer();
            if (arr && arr.byteLength >= 64 && arr.byteLength <= 8 * 1024 * 1024) {
              const b64 = Buffer.from(arr).toString('base64');
              let mime = (att.contentType || 'audio/ogg').split(';')[0].trim();
              if (!mime.startsWith('audio/')) {
                if (/\.mp3$/i.test(att.name || '')) mime = 'audio/mpeg';
                else if (/\.wav$/i.test(att.name || '')) mime = 'audio/wav';
                else if (/\.webm$/i.test(att.name || '')) mime = 'audio/webm';
                else mime = 'audio/ogg';
              }
              visionParts.push({ inlineData: { mimeType: mime, data: b64 } });
              if (!String(textPart).trim() || textPart === prompt) {
                textPart =
                  (prompt && prompt.trim()) ||
                  '[User gửi tin nhắn thoại / file audio. Hãy nghe, hiểu nội dung, trả lời tiếng Việt tự nhiên như đang trò chuyện.]';
              }
            }
          }
        } catch (auErr) {
          console.warn('Tải audio lỗi:', auErr && auErr.message);
        }
      }
    }

    // Tải video đính kèm (tối đa 1 file, ≤ 15MB — inline Gemini)
    let videoTooLarge = false;
    if (videoAtts.length > 0) {
      const fetchFn =
        typeof globalThis.fetch === 'function'
          ? globalThis.fetch
          : (() => {
              try {
                return require('node-fetch');
              } catch {
                return null;
              }
            })();
      const att = videoAtts[0];
      const maxVid = 15 * 1024 * 1024;
      if (att.size && att.size > maxVid) {
        videoTooLarge = true;
      } else if (fetchFn) {
        try {
          const res = await fetchFn(att.url, {
            headers: { 'User-Agent': 'NexusAI-DiscordBot/1.0' },
          });
          if (res.ok) {
            const arr = await res.arrayBuffer();
            if (arr && arr.byteLength > maxVid) {
              videoTooLarge = true;
            } else if (arr && arr.byteLength >= 256) {
              const b64 = Buffer.from(arr).toString('base64');
              let mime = (att.contentType || 'video/mp4').split(';')[0].trim();
              if (!mime.startsWith('video/')) {
                if (/\.webm$/i.test(att.name || '')) mime = 'video/webm';
                else if (/\.mov$/i.test(att.name || '')) mime = 'video/quicktime';
                else mime = 'video/mp4';
              }
              visionParts.push({ inlineData: { mimeType: mime, data: b64 } });
              if (!String(textPart).trim() || textPart === prompt) {
                textPart =
                  (prompt && prompt.trim()) ||
                  '[User gửi file video. Hãy xem video, mô tả nội dung chính, nhân vật/hành động, và trả lời tiếng Việt rõ ràng. Nếu user hỏi gì thì trả lời đúng câu hỏi.]';
              }
            }
          }
        } catch (vidErr) {
          console.warn('Tải video lỗi:', vidErr && vidErr.message);
        }
      }
      if (videoTooLarge) {
        return message.reply(
          '🎬 Video hơi nặng (giới hạn xem ~**15MB**).\n' +
            'Thử: nén video, cắt ngắn hơn, hoặc gửi **ảnh** / mô tả bằng chữ.'
        ).catch(() => {});
      }
      if (videoAtts.length && !visionParts.some((p) => p.inlineData && String(p.inlineData.mimeType || '').startsWith('video/'))) {
        // tải fail
        if (!prompt && imageAtts.length === 0 && audioAtts.length === 0) {
          return message.reply('❌ Không tải được video. Thử gửi lại hoặc dùng file nhỏ hơn.').catch(() => {});
        }
      }
    }

    // Payload multimodal: text + ảnh/audio/video
    let messagePayload;
    if (visionParts.length > 0) {
      messagePayload = [{ text: textPart }, ...visionParts];
    } else {
      messagePayload = textPart;
    }

    let result;
    try {
      // Ảnh / video / audio multimodal → ưu tiên Gemini (provider ngoài không nhận đủ file)
      const hasVisionMedia = visionParts.some(
        (p) => p && p.inlineData && p.inlineData.mimeType
      );
      if (hasVisionMedia && externalProvider) {
        if (activeAi) {
          externalProvider = null;
          externalApiKey = null;
        } else {
          return message.reply(
            '📎 File media (ảnh/video/audio) cần **key Gemini** trong ticket.\n' +
              'Gửi: `key gemini: AIza...` rồi gửi lại file.\n' +
              '_(ChatGPT/Claude/Grok/DeepSeek chưa xem được video trong bot này)_'
          ).catch(() => {});
        }
      }
      if (externalProvider && externalApiKey) {
        // ChatGPT / Claude / Grok / DeepSeek — text only
        let history = [];
        try {
          history = getSavedHistory(sessionKey) || [];
        } catch (_) {}
        const textOut = await chatExternal({
          provider: externalProvider,
          apiKey: externalApiKey,
          model: selectedModel,
          systemInstruction,
          history,
          userMessage: typeof textPart === 'string' ? textPart : prompt,
        });
        result = { text: textOut };
        // Lưu history đơn giản
        try {
          const nh = [
            ...(history || []).slice(-18),
            { role: 'user', content: prompt },
            { role: 'assistant', content: textOut },
          ];
          updateSessionHistory(sessionKey, nh, selectedModel);
        } catch (_) {}
      } else {
        result = await chat.sendMessage({ message: messagePayload });
      }
    } catch (apiErr) {
      console.error('❌ Lỗi khi gọi AI API:', apiErr);
      userSessions.delete(sessionKey);

      // Quota Gemini — chỉ khi đang gọi Gemini (không áp cho GPT/Claude/Grok/DeepSeek)
      if (!externalProvider) {
        const quotaInfo = parseGeminiQuotaError(apiErr, selectedModel);
        if (quotaInfo.isQuota) {
          if (!usingTicketKey) {
            const lock = await lockGeminiQuota({
              retryAfterSec: quotaInfo.retryAfterSec,
              isDailyQuota: quotaInfo.isDailyQuota,
              model: quotaInfo.model || selectedModel,
              reason: 'gemini_429',
            });
            return message.reply(lock.message || getGeminiLockStatus().message).catch(() => {});
          }
          return message
            .reply(
              `⏳ **Key Gemini trong ticket đã hết quota (free tier).**\n` +
                `> Model: \`${selectedModel}\`\n` +
                `• Đổi model Gemini (flash-lite / 3.5…)\n` +
                `• Hoặc \`key gemini: AIza...\` project khác\n` +
                `• Hoặc Billing / đợi reset trên AI Studio.`
            )
            .catch(() => {});
        }
      } else {
        // Quota / billing provider khác
        const st = String(apiErr?.status || apiErr?.code || '');
        const msg = String(apiErr?.message || '');
        if (st.includes('429') || /quota|rate limit|insufficient|billing|credit|balance/i.test(msg)) {
          const label = PROVIDER_META[externalProvider]?.label || externalProvider;
          return message
            .reply(
              `⏳ **${label}** — hết hạn mức / cần thanh toán (hoặc rate limit).\n` +
                `> Model: \`${selectedModel}\`\n` +
                `> Chi tiết: ${msg.slice(0, 200)}\n` +
                `• Kiểm tra billing trên dashboard ${label}\n` +
                `• Hoặc đổi model / dán key khác: \`key ${externalProvider}: ...\``
            )
            .catch(() => {});
        }
      }

      const { status, rawMsg, hint, friendly } = formatApiError(apiErr, selectedModel);
      const keySource = usingTicketKey ? 'Key riêng của Ticket này' : 'Key mặc định của Bot';
      const apiLabel = externalProvider
        ? (PROVIDER_META[externalProvider]?.label || externalProvider)
        : 'Gemini';

      const detailMsg = friendly
        ? friendly
        : `❌ **Lỗi liên lạc ${apiLabel} API**\n` +
          `> Model: \`${selectedModel}\`\n` +
          `> Nguồn Key: ${keySource}\n` +
          `> Mã lỗi: \`${status}\`\n` +
          `> Chi tiết: ${rawMsg}\n` +
          (hint ? `\n${hint}` : '');

      return message.reply(detailMsg.slice(0, 1900));
    }

    let replyText = result?.text || '🤖 Nexus AI không trả lời được nội dung này.';
    replyText = sanitizeDiscordMath(replyText);
    replyText = stripMediaUrls(replyText);
    // Nếu model chỉ trả URL gif, giữ câu ngắn
    if (!replyText) replyText = 'Đây nhé!';

    // API OK → bỏ khóa Gemini nếu còn (ví dụ vừa sang ngày mới / đổi key)
    clearGeminiLock().catch(() => {});

    // Trừ hạn mức chat sau khi API thành công
    consumeQuota(message.author.id, 'chat');
    const quotaWarn = maybeWarn(message.author.id, 'chat');

    // Lưu lại lịch sử hội thoại xuống đĩa (debounced, tối đa 20 tin gần nhất,
    // tự động hết hạn sau 7 ngày không hoạt động - xem SessionManager.js).
    try {
      if (typeof chat.getHistory === 'function') {
        const currentHistory = chat.getHistory();
        updateSessionHistory(sessionKey, currentHistory, selectedModel);
      } else {
        console.warn('⚠️ chat.getHistory() không khả dụng trong SDK hiện tại — bỏ qua lưu lịch sử cho session này.');
      }
    } catch (histErr) {
      console.warn('⚠️ Không thể lưu lịch sử session:', histErr);
    }

    let gifUrl = null;
    try {
      const gifReq = parseGifRequest(prompt || message.content || '');
      gifUrl = await resolveEmotionalGif({
        userEmotion,
        replyText,
        getGifForEmotion,
        getGifByKeyword,
        channelId: message.channel.id,
        forceKeyword: gifReq || null,
      });
    } catch (e) {
      console.warn('❌ Lỗi khi tìm GIF cảm xúc:', e);
      gifUrl = null;
    }
    const askedGif = parseGifRequest(prompt || message.content || '');
    if (askedGif && !gifUrl) {
      const noKey = !(process.env.GIPHY_API_KEY || '').trim();
      replyText +=
        '\n\n' +
        (noKey
          ? '⚠️ Chưa cấu hình **GIPHY_API_KEY** trên host — admin bot cần thêm key tại https://developers.giphy.com'
          : '⚠️ Không lấy được GIF lúc này (Giphy lỗi / cooldown 30s). Thử lại hoặc `gif: cat` / `gif: funny`.');
    }

    // TTS / auto-speech (nếu user bật /tts hoặc /auto-speech on)
    let ttsAttachment = null;
    if (userPrefs.ttsEnabled) {
      try {
        const audioBuf = await synthesizeSpeech(replyText, 'vi');
        if (audioBuf) {
          ttsAttachment = new AttachmentBuilder(audioBuf, { name: 'nexus_reply.mp3' });
        }
      } catch (ttsErr) {
        console.warn('TTS reply error:', ttsErr && ttsErr.message);
      }
    }

    // Code dài → file đính kèm (Discord CDN = link tải)
    const codePack = await extractLongCodeToFiles(replyText, message.channel?.name?.startsWith('ticket') ? 700 : 900);
    replyText = codePack.text;

    const DISCORD_MAX = 2000;
    const gifEmbed = gifUrl ? [new EmbedBuilder().setImage(gifUrl).setColor(0x5865f2)] : [];
    const files = [];
    if (ttsAttachment) files.push(ttsAttachment);
    if (codePack.files && codePack.files.length) files.push(...codePack.files);

    // Lưu prompt + nút Regenerate
    const regenKey = `${message.author.id}_${message.channel.id}`;
    lastPrompts.set(regenKey, { prompt, userId: message.author.id, at: Date.now() });
    lastReplies.set(regenKey, { text: replyText, userId: message.author.id, at: Date.now() });
    const regenRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`nexus_regen:${regenKey}`)
        .setLabel('Trả lời lại')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄'),
      new ButtonBuilder()
        .setCustomId(`nexus_tr:${regenKey}`)
        .setLabel('Dịch')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🌐'),
      new ButtonBuilder()
        .setCustomId(`nexus_fb:up:${regenKey}`)
        .setLabel('Tốt')
        .setStyle(ButtonStyle.Success)
        .setEmoji('👍'),
      new ButtonBuilder()
        .setCustomId(`nexus_fb:down:${regenKey}`)
        .setLabel('Chưa ổn')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('👎')
    );

    let textOut = replyText;
    if (quotaWarn) textOut = `${replyText}\n\n${quotaWarn}`;

    const chunks = splitLongMessage(textOut, 1900);
    let firstSent = null;
    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      const prefix = chunks.length > 1 ? `**(${i + 1}/${chunks.length})**\n` : '';
      const payload = {
        content: (prefix + chunks[i]).slice(0, 2000),
        embeds: isLast ? gifEmbed : [],
        files: isLast ? files : [],
        components: isLast ? [regenRow] : [],
      };
      try {
        if (isFirst) {
          firstSent = await message.reply(payload);
        } else {
          await message.channel.send(payload);
        }
      } catch (sendErr) {
        console.warn('split send', sendErr && sendErr.message);
        try {
          if (isFirst) firstSent = await message.reply({ content: payload.content });
          else await message.channel.send({ content: payload.content });
        } catch (_) {}
      }
    }
    try {
      const reactEmoji = EMOTION_REACTIONS[userEmotion];
      if (reactEmoji && firstSent && typeof firstSent.react === 'function') {
        await firstSent.react(reactEmoji).catch(() => {});
      }
    } catch (_) {}
    // Chat thoại: đọc câu trả lời nếu user bật + bot có thể speak trong guild
    try {
      const prefsVc = getUserPrefs(message.author.id);
      if (prefsVc.voiceChat && message.guild && replyText) {
        const speakText = String(replyText).replace(/https?:\/\/\S+/g, '').slice(0, 400);
        if (speakText.length > 2) {
          const r = await speakInGuild(message.guild.id, speakText, {
            userVoiceChannel: message.member?.voice?.channel || null,
          });
          if (r && r.fallback && r.mp3Buffer) {
            await message.channel
              .send({
                content: r.message || '🔊 *(Voice UDP lỗi — gửi MP3)*',
                files: [new AttachmentBuilder(r.mp3Buffer, { name: 'nexus_voice.mp3' })],
              })
              .catch(() => {});
          }
        }
      }
    } catch (vcErr) {
      console.warn('voicechat speak', vcErr && vcErr.message);
    }

  } catch (error) {
    console.error('❌ Lỗi khi xử lý messageCreate:', error);
    await message
      .reply('❌ Đã có lỗi khi xử lý. Thử lại, gõ `help`, hoặc `/reset` nếu chat bị lệch.')
      .catch(() => {});
  }
});

// ==========================================
// KHỞI TẠO BOT & CHỐNG SẬP APP
// ==========================================
(async () => {
  try {
    const dataDir = DATA_DIR;
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});

    await loadAllowedChannelsFromFile().catch((e) => console.error('Lỗi load allowedChannels:', e));
    await loadAutoClearChannels().catch((e) => console.error('Lỗi load autoClear:', e));
    await loadTickets().catch((e) => console.error('Lỗi load tickets:', e));
    await loadSessionsFromFile().catch((e) => console.error('Lỗi load sessions:', e));
    await loadQuota().catch((e) => console.error('Lỗi load quota:', e));
    await loadModeration().catch((e) => console.error('Lỗi load moderation:', e));
    await loadGeminiLock().catch((e) => console.error('Lỗi load geminiLock:', e));
    await loadUserPrefs().catch((e) => console.error('Lỗi load userPrefs:', e));
    await loadMemory().catch((e) => console.error('Lỗi load memory:', e));
    await loadKnowledgeBase().catch((e) => console.error('Lỗi load knowledgeBase:', e));

    if (DISCORD_TOKEN) {
      await client.login(DISCORD_TOKEN);
      console.log('🔐 Đã gọi client.login() thành công!');
    } else {
      console.error('⚠️ Không thể đăng nhập Discord vì chưa cấu hình DISCORD_TOKEN.');
    }
  } catch (err) {
    console.error('❌ Lỗi khởi động nghiêm trọng:', err);
  }
})();

process.on('uncaughtException', (err) => {
  console.error('❌ Phát hiện lỗi Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Phát hiện Unhandled Rejection tại:', promise, 'Lý do:', reason);
});

process.on('beforeExit', () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  saveAllowedChannelsToFile().catch((err) => console.error('❌ Lỗi khi lưu trước khi thoát:', err));
  flushSessionsNow().catch((err) => console.error('❌ Lỗi khi lưu sessions trước khi thoát:', err));
});

process.on('SIGINT', async () => {
  try { await saveAllowedChannelsToFile(); } catch (err) {}
  try { await flushSessionsNow(); } catch (err) {}
  process.exit();
});

process.on('SIGTERM', async () => {
  try { await saveAllowedChannelsToFile(); } catch (err) {}
  try { await flushSessionsNow(); } catch (err) {}
  process.exit();
});
