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
  findOpenTicketByUser,
  closeTicketChannel,
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
  setUserVoiceGender,
  setUserLanguage,
  getUserLanguage,
  getLanguageSystemBlock,
  languageDisplay,
  LANGUAGE_PRESETS,
  resolveLanguageForUser,
  localeToLanguage,
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
  getVoiceConnectionFor,
} = require('./VoiceManager.js');
const {
  startListening,
  stopListening,
  isListening,
} = require('./VoiceListener.js');

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
          '`/ping` · `/reset` · `/feedback`\n' +
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
  let rawMsg =
    apiErr?.message ||
    apiErr?.error?.message ||
    apiErr?.response?.data?.error?.message ||
    '';

  // Bóc message dễ đọc từ JSON Google
  try {
    const m = String(rawMsg).match(/"message"\s*:\s*"([^"]+)"/);
    if (m) rawMsg = m[1];
  } catch (_) {}
  rawMsg = String(rawMsg || 'Không rõ chi tiết.')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

  const s = String(status);
  const modelLine = modelId ? '`' + modelId + '`' : 'đang dùng';
  let title = '⚠️ **AI tạm thời không trả lời được**';
  let explain = '';
  let action = '• Thử gửi lại sau vài giây.\n• Hoặc `/reset` rồi chat lại.';

  const isQuota =
    s.includes('429') || /quota|rate limit|limit:\s*0|resource_exhausted/i.test(rawMsg);
  const isBilling =
    /billing|payment|credit|insufficient|enable billing/i.test(rawMsg);

  if (isQuota || isBilling) {
    title = '⏳ **Hết hạn mức (quota) hoặc cần thanh toán**';
    explain =
      'Key Gemini đang dùng đã hết lượt free trong ngày, hoặc cần bật Billing.';
    action =
      '• Đợi quota reset (thường theo ngày) rồi thử lại.\n' +
      '• Ticket: dán key khác — `key gemini: AIza...`\n' +
      '• Admin: kiểm tra https://aistudio.google.com';
  } else if (s.includes('401') || /api key not valid|invalid.*key|unauthenticated/i.test(rawMsg)) {
    title = '🔑 **API key không hợp lệ**';
    explain = 'Key sai, hết hạn, hoặc đã bị thu hồi.';
    action =
      '• Admin bot: tạo key mới tại https://aistudio.google.com\n' +
      '• Ticket/DM: gửi lại `key gemini: AIza...`';
  } else if (s.includes('403') || /permission|forbidden|not authorized/i.test(rawMsg)) {
    title = '🚫 **Không có quyền dùng model này**';
    explain = 'Key chưa bật Gemini API hoặc không được phép gọi model.';
    action =
      '• Bật Gemini API trên Google AI Studio / Cloud.\n' +
      '• Thử model khác hoặc key khác.';
  } else if (s.includes('404') || /not found|does not exist|not supported/i.test(rawMsg)) {
    title = '📦 **Model không khả dụng**';
    explain =
      'Model ' +
      modelLine +
      ' có thể đã đổi tên, ngừng hỗ trợ, hoặc key không truy cập được.';
    action =
      '• Đổi model (vd flash) trong ticket.\n• Admin kiểm tra tên model còn đúng không.';
  } else if (s.includes('400') || /invalid argument|invalid request/i.test(rawMsg)) {
    title = '❓ **Yêu cầu không hợp lệ**';
    explain = 'Nội dung gửi lên AI bị lỗi định dạng, hoặc model không nhận request này.';
    action =
      '• Thử câu ngắn hơn / bỏ file đính kèm nặng.\n' +
      '• `/reset` rồi hỏi lại.\n' +
      '• (Mã 400 ≠ hết tiền; hết tiền thường 429/403.)';
  } else if (
    s.includes('500') ||
    s.includes('503') ||
    s.includes('504') ||
    /internal error|unavailable|overloaded|deadline exceeded/i.test(rawMsg)
  ) {
    title = '☁️ **Máy chủ AI đang lỗi tạm thời**';
    explain =
      'Lỗi phía Google (server Gemini), **không phải** do bạn chat sai hay key bot hỏng.';
    action =
      '• Đợi **1–5 phút** rồi nhắn lại.\n' +
      '• Có thể `/reset` nếu vẫn lỗi.\n' +
      '• Nếu kéo dài: thử lại sau hoặc báo admin.';
  } else if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(rawMsg)) {
    title = '🌐 **Mất kết nối tới AI**';
    explain = 'Mạng host bot hoặc Google bị timeout.';
    action = '• Thử lại sau vài giây.\n• Nếu lặp lại: admin kiểm tra mạng / Railway.';
  } else {
    title = '⚠️ **AI không trả lời được lúc này**';
    explain =
      rawMsg && rawMsg !== 'Không rõ chi tiết.'
        ? 'Chi tiết ngắn: ' + rawMsg
        : 'Lỗi không xác định khi gọi AI.';
    action = '• Thử lại.\n• `/reset` rồi chat lại.\n• Vẫn lỗi → báo admin kèm giờ xảy ra.';
  }

  const friendly =
    title +
    '\n' +
    explain +
    '\n\n**Bạn có thể:**\n' +
    action +
    '\n\n_(Mã kỹ thuật: `' +
    s +
    '` · Model: ' +
    modelLine +
    ')_';

  return { status: s, rawMsg, hint: action, friendly };
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
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Help / Hướng dẫn lệnh & tính năng Nexus AI')
    .setDescriptionLocalizations({
      'en-US': 'View commands and features',
      vi: 'Xem hướng dẫn lệnh và tính năng',
    }),
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
          { name: 'Trẻ trâu 🐃 (không chửi)', value: 'tretrau' },
          { name: 'Trẻ trâu 💀 (chửi mạnh)', value: 'tretrau_toxic' },
          { name: 'Nhẹ nhàng 🍀', value: 'nhe_nhang' },
          { name: 'Ngầu 😎', value: 'ngau' },
          { name: 'Phân tích 📚', value: 'phan_tich' },
          { name: 'ChatGPT (Luna)', value: 'chatgpt' },
          { name: 'Gemini', value: 'gemini' },
          { name: 'Claude (Nam)', value: 'claude' },
          { name: 'Grok', value: 'grok' },
          { name: 'Dola', value: 'dola' },
          { name: 'Copilot', value: 'copilot' },
          { name: 'DeepSeek (Mây)', value: 'deepseek' },
          { name: 'Delta (Roblox Lua)', value: 'delta' },
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
    .setDescription('TTS on/off / Bật tắt đọc text')
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
    .setDescription('Speak text / Đọc một câu')
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
    .setName('voicechat')
    .setDescription('Voice chat — toggle speaking replies / Bật tắt đọc to')
    .setDescriptionLocalizations({
      'en-US': 'Toggle bot speaking replies in voice',
      vi: 'Bật/tắt bot đọc to câu trả lời trong voice',
    })
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('on hoặc off')
        .setRequired(true)
        .addChoices({ name: 'Bật', value: 'on' }, { name: 'Tắt', value: 'off' })
    ),
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Bot joins your current voice channel'),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Bot leaves the voice channel'),
  new SlashCommandBuilder()
    .setName('listen')
    .setDescription('Bật/tắt bot NGHE và trả lời trực tiếp bằng giọng nói trong voice (chat thoại 2 chiều)')
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
    .setDescription('Translate VI ↔ EN / Dịch Việt ↔ Anh')
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
    .setName('languages')
    .setDescription('Languages — set AI reply language / Chọn ngôn ngữ AI')
    .setDescriptionLocalizations({
      'en-US': 'Set AI reply language (ticket / channel / DM)',
      vi: 'Chọn ngôn ngữ AI trả lời (ticket / kênh / DM)',
    })
    .addStringOption((opt) =>
      opt
        .setName('language')
        .setDescription('Language / Ngôn ngữ')
        .setDescriptionLocalizations({
          'en-US': 'Reply language',
          vi: 'Ngôn ngữ trả lời',
        })
        .setRequired(true)
        .addChoices(
          { name: '🌐 Auto (theo Discord locale / vùng app)', value: 'auto' },
          { name: '🇻🇳 Tiếng Việt', value: 'vi' },
          { name: '🇬🇧 English', value: 'en' },
          { name: '🇰🇷 한국어 (Korean)', value: 'ko' },
          { name: '🇯🇵 日本語 (Japanese)', value: 'ja' },
          { name: '🇨🇳 中文 (Chinese)', value: 'zh' },
          { name: '🇹🇭 ไทย (Thai)', value: 'th' },
          { name: '🇫🇷 Français', value: 'fr' },
          { name: '🇪🇸 Español', value: 'es' },
          { name: '🇩🇪 Deutsch', value: 'de' },
          { name: '🇷🇺 Русский', value: 'ru' },
          { name: '🇮🇩 Bahasa Indonesia', value: 'id' }
        )
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
    .setDescription('AI name / Đặt tên gọi AI (e.g. Luna)')
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
        systemInstruction += '\n\n' + getLanguageSystemBlock(resolveLanguageForUser(interaction.user.id, interaction.locale));
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
        const buf = await synthesizeSpeech(text, getUserPrefs(user.id).voiceGender || 'nu');
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

    if (commandName === 'voice-gender') {
      const gender = interaction.options.getString('gender') || 'nu';
      setUserVoiceGender(user.id, gender);
      const label = gender === 'nam' ? 'Nam (Nam Minh)' : 'Nữ (Hoài My)';
      return interaction.reply({
        content:
          `🎤 Giọng đọc TTS: **${label}**\n` +
          `Dùng với \`/tts mode:on\`, \`/speak\`, \`/voicechat\` hoặc tin nhắn thoại.\n` +
          `Đổi nhanh: \`giọng: nam\` / \`giọng: nữ\``,
        ephemeral: true,
      });
    }

    if (commandName === 'languages') {
      const code = interaction.options.getString('language');
      setUserLanguage(interaction.user.id, code);
      for (const key of [...userSessions.keys()]) {
        if (key.startsWith(String(interaction.user.id))) userSessions.delete(key);
      }
      try { clearSessionsByPrefix(String(interaction.user.id)); } catch (_) {}
      const effective = resolveLanguageForUser(interaction.user.id, interaction.locale);
      const label =
        code === 'auto'
          ? `🌐 Auto → ${languageDisplay(effective)} (Discord locale: \`${interaction.locale || 'n/a'}\`)`
          : languageDisplay(code);
      return interaction.reply({
        content:
          `🌐 **Language:** ${label}\n` +
          `• Ticket / AI channel / DM: AI replies in this language.\n` +
          `• Quick: \`lang: en\` · \`lang: ko\` · \`lang: vi\` · \`lang: auto\`\n` +
          `• Session cleared — send a new message to test.`,
        ephemeral: true,
      });
    }

if (commandName === 'join') {
      if (!interaction.guildId) {
        return interaction.reply({ content: '❌ Chỉ dùng trong server.', ephemeral: true });
      }
      const ch = interaction.member?.voice?.channel;
      if (!ch) {
        return interaction.reply({
          content: '❌ Vào **voice channel** trước, rồi `/join`.',
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const r = await joinVoiceChannel(ch);
        if (r && r.ok) {
          setUserVoiceChat(interaction.user.id, true);
          return interaction.editReply(
            `🎙️ Đã **join** **${ch.name}**.
` +
              `• Chat thoại: **ON** (bot sẽ cố đọc câu trả lời trong voice)\n` +
              `• Gửi tin nhắn thoại hoặc text trong ticket/kênh AI\n` +
              `• Rời: \`/leave\` · Tắt đọc: \`/voicechat mode:off\`\n` +
              `• Giọng: \`giọng: nam\` / \`giọng: nữ\``
          );
        }
        return interaction.editReply(
          '⚠️ ' + (r && r.message ? r.message : 'Không join được voice.') +
            '\nVẫn có thể dùng `/speak` để nhận MP3.'
        );
      } catch (e) {
        console.warn('join cmd', e && e.message);
        return interaction.editReply('❌ ' + (e.message || String(e)));
      }
    }

    if (commandName === 'listen') {
      if (!interaction.guildId) {
        return interaction.reply({ content: '❌ Chỉ dùng trong server.', ephemeral: true });
      }
      const mode = interaction.options.getString('mode');
      const on = mode === 'on';

      if (!on) {
        const r = stopListening(interaction.guildId);
        return interaction.reply({ content: r.message, ephemeral: true });
      }

      const ch = interaction.member?.voice?.channel;
      if (!ch) {
        return interaction.reply({
          content: '❌ Vào **voice channel** trước, rồi `/listen mode:on`.',
          ephemeral: true,
        });
      }
      await interaction.deferReply({ ephemeral: true });

      // Đảm bảo bot đã join & Ready trước khi bật listener
      let connection = getVoiceConnectionFor(interaction.guildId);
      if (!connection) {
        const jr = await joinVoiceChannel(ch);
        if (!jr || !jr.ok) {
          return interaction.editReply('⚠️ ' + (jr && jr.message ? jr.message : 'Không join được voice.'));
        }
        connection = getVoiceConnectionFor(interaction.guildId);
      }
      if (!connection) {
        return interaction.editReply('❌ Không lấy được voice connection — thử `/join` trước rồi `/listen mode:on`.');
      }

      // Chuẩn bị Gemini instance + hàm speak để listener dùng
      const userKey = getUserGeminiKey(interaction.user.id);
      const aiForListen = userKey ? new GoogleGenAI({ apiKey: userKey }) : aiInstance;
      if (!aiForListen) {
        return interaction.editReply(
          '❌ Chưa có Gemini key khả dụng. DM cần `key gemini: ...` riêng, hoặc bot cần GEMINI_API_KEY.'
        );
      }

      const r = startListening({
        guildId: interaction.guildId,
        connection,
        ai: aiForListen,
        model: DEFAULT_MODEL,
        shouldListenTo: (userId) => userId !== client.user.id,
        speak: async (text) => {
          try {
            await speakInGuild(interaction.guildId, text, {
              userVoiceChannel: ch,
              gender: getUserPrefs(interaction.user.id).voiceGender || 'nu',
            });
          } catch (e) {
            console.warn('[listen] speak-back error', e && e.message);
          }
        },
      });

      if (!r.ok) {
        return interaction.editReply('⚠️ ' + r.message);
      }
      return interaction.editReply(
        '👂 **Chat thoại 2 chiều: BẬT**\n' +
          '• Cứ nói chuyện bình thường trong voice, bot sẽ tự nghe và trả lời bằng giọng.\n' +
          '• Im lặng khoảng ~1s sau khi bạn dứt câu thì bot mới xử lý (tránh cắt ngang).\n' +
          '• Tắt: `/listen mode:off`\n' +
          '_(Trên host free, UDP có thể không ổn định — nếu bot không phản hồi, thử lại hoặc dùng chat chữ.)_'
      );
    }

    if (commandName === 'leave') {
      if (!interaction.guildId) {
        return interaction.reply({ content: '❌ Chỉ dùng trong server.', ephemeral: true });
      }
      try {
        stopListening(interaction.guildId);
      } catch (e) {}
      try {
        leaveVoice(interaction.guildId);
      } catch (e) {
        console.warn('leave cmd', e && e.message);
      }
      return interaction.reply({
        content: '👋 Bot đã **leave** voice channel.',
        ephemeral: true,
      });
    }

    if (commandName === 'voicechat') {
      const mode = interaction.options.getString('mode');
      const on = mode === 'on';
      setUserVoiceChat(interaction.user.id, on);
      if (!on) {
        return interaction.reply({ content: '🔇 Đã tắt chat thoại.', ephemeral: true });
      }
      // Bật: tự join kênh voice của user nếu đang ở trong voice
      let joinNote = '';
      try {
        const ch = interaction.member?.voice?.channel;
        if (ch && interaction.guildId) {
          await interaction.deferReply({ ephemeral: true });
          const r = await joinVoiceChannel(ch);
          joinNote = r && r.ok
            ? '\n✅ Bot đã **vào voice** cùng bạn.'
            : ('\n⚠️ ' + (r && r.message ? r.message : 'Chưa join được voice — vẫn đọc bằng MP3.'));
          return interaction.editReply(
            '🎙️ **Chat thoại BẬT**' + joinNote + '\n' +
              '• Gửi **tin nhắn thoại** hoặc nhắn text trong ticket/kênh AI\n' +
              '• Bot trả lời chữ + cố **đọc to** trong voice\n' +
              '• Giọng: `giọng: nam` / `giọng: nữ` · `/voice-gender`\n' +
              '• Tắt: `/voicechat mode:off`\n' +
              '_(Host free có thể chỉ gửi file MP3 nếu UDP lỗi)_'
          );
        }
      } catch (e) {
        console.warn('voicechat auto-join', e && e.message);
      }
      return interaction.reply({
        content:
          '🎙️ **Chat thoại BẬT**\n' +
          '1. Vào kênh **voice** Discord\n' +
          '2. Chạy lại `/voicechat mode:on` (bot sẽ tự join)\n' +
          '3. Gửi **tin nhắn thoại** hoặc text trong ticket/kênh AI\n' +
          'Giọng: `giọng: nam` / `giọng: nữ`',
        ephemeral: true,
      });
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
        systemInstruction += '\n\n' + getLanguageSystemBlock(resolveLanguageForUser(interaction.user.id, interaction.locale));
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
    if (/^(?:!)?join$/i.test(raw)) {
      const ch = message.member?.voice?.channel;
      if (!ch) return message.reply('❌ Vào voice trước, rồi `!join` hoặc `/join`.').catch(() => {});
      try {
        const r = await joinVoiceChannel(ch);
        if (r && r.ok) {
          setUserVoiceChat(message.author.id, true);
          return message.reply(`🎙️ Đã join **${ch.name}**. Rời: \`/leave\` hoặc \`!leave\``).catch(() => {});
        }
        return message.reply('⚠️ ' + (r && r.message ? r.message : 'Không join được.')).catch(() => {});
      } catch (e) {
        return message.reply('❌ ' + (e.message || e)).catch(() => {});
      }
    }
    if (/^(?:!)?leave$/i.test(raw)) {
      if (!message.guild) return;
      try { leaveVoice(message.guild.id); } catch (_) {}
      return message.reply('👋 Đã leave voice.').catch(() => {});
    }
    if (/^(?:!)?voicechat\s+on$/i.test(raw)) {
      setUserVoiceChat(message.author.id, true);
      return message
        .reply(
          '🎙️ **Chat thoại BẬT** — `/voicechat mode:on` rồi nhắn text hoặc tin nhắn thoại.'
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

  // User bảo đóng / xóa ticket → xóa kênh
  if (ticketData) {
    const closeCmd = message.content.replace(/<@!?\d+>/g, '').trim();
    if (
      /^(?:đóng|dong|xoá|xóa|xoa|close|delete|remove)\s*(?:ticket|vé|ve)?\s*[!.]?$/i.test(closeCmd) ||
      /^(?:ticket\s*)?(?:đóng|dong|xoá|xóa|close)\s*(?:lại|di|đi|ticket)?\s*[!.]?$/i.test(closeCmd) ||
      /^(?:xóa|xoá|xoa|delete)\s*kênh\s*[!.]?$/i.test(closeCmd)
    ) {
      const ownerId = String(ticketData.ownerId || ticketData.userId || '');
      const isOwner = ownerId && ownerId === String(message.author.id);
      const isAdmin =
        message.member &&
        message.member.permissions &&
        typeof message.member.permissions.has === 'function' &&
        message.member.permissions.has(PermissionFlagsBits.Administrator);
      if (!isOwner && !isAdmin) {
        return message.reply('❌ Chỉ **chủ ticket** hoặc **Admin** mới đóng được.').catch(() => {});
      }
      await message.reply('🔒 Ok, đang **đóng & xóa** ticket...').catch(() => {});
      const r = await closeTicketChannel(message.channel, message.author, message.client);
      return;
    }
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
  const isMentioned = message.mentions.has(clien
