// index.js
// Nexus AI Discord Bot (Node.js, discord.js v14) tích hợp Google Gemini + Express (keep-alive)
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs').promises;

const {
  Client,
  GatewayIntentBits,
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
  setTicketApiKey,
  setTicketNote,
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
  DEFAULT_PERSONA_ID,
} = require('./Interest.js');
const {
  detectUserEmotion,
  detectEmotion,
  appendEmotionToInstruction,
  tryQuickEmotionalReply,
  resolveEmotionalGif,
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
  personaDisplayName,
  getStrictModeBlock,
} = require('./UserPrefs.js');
const { synthesizeSpeech, writeTempMp3, cleanupTemp } = require('./Tts.js');
const { PERSONA_PRESETS } = require('./Interest.js');
const { setAdminLogClient, adminLog } = require('./AdminLog.js');
const { startQuiz, tryAnswer, hasActiveQuiz } = require('./Quiz.js');
const {
  isVoiceAvailable,
  joinVoiceChannel,
  leaveVoice,
  speakInGuild,
} = require('./VoiceManager.js');

/** Lưu prompt gần nhất để nút Regenerate — key: userId_channelId */
const lastPrompts = new Map();

// ==========================================
// CONFIG & INIT
// ==========================================
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ALLOWED_CHANNELS_FILE =
  process.env.ALLOWED_CHANNELS_FILE || path.join(__dirname, 'data', 'allowedChannels.json');

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

const SYSTEM_INSTRUCTION =
  'Bạn là Nexus AI — một trợ lý Discord thân thiện, dí dỏm. ' +
  'Hãy tự động thêm emoji phù hợp ngữ cảnh khi trả lời. ' +
  'Trả lời ngắn gọn, rõ ràng.';

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
  ],
  partials: ['CHANNEL'],
});

// ==========================================
// BỘ NHỚ
// ==========================================
const userSessions = new Map();
const allowedChannels = new Map();

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
    hint = '👉 Yêu cầu gửi lên không hợp lệ (có thể do tham số model không còn hỗ trợ).';
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
      console.log('📂 Khởi tạo file allowedChannels mới.');
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
          { name: 'Tính trẻ trâu Việt', value: 'tre_trau' },
          { name: 'Tính nói nhẹ nhàng', value: 'nhe_nhang' },
          { name: 'Thích chơi Roblox', value: 'roblox' },
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
          { name: 'Speak (đọc text)', value: 'speak' }
        )
    )
    .addStringOption((opt) =>
      opt.setName('text').setDescription('Nội dung khi action=speak').setRequired(false)
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
    .setName('ship')
    .setDescription('Chấm “độ hợp” vibe giữa 2 người (meme)')
    .addUserOption((opt) => opt.setName('user1').setDescription('Người 1').setRequired(true))
    .addUserOption((opt) => opt.setName('user2').setDescription('Người 2').setRequired(true)),
].map((cmd) => cmd.toJSON());

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
  try {
    console.log('🔄 Đang đăng ký Slash Commands lên Discord...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('🎉 Đã đăng ký Slash Commands thành công!');
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
  await adminLog({
    title: '🟢 Nexus AI online',
    description: `Logged in as **${client.user.tag}**`,
    color: 0x57f287,
  });
});

// ==========================================
// XỬ LÝ SLASH COMMANDS & TICKET INTERACTIONS
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    // Nút xóa memory ticket
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
        if (ticketData?.userApiKey) {
          activeAi = new GoogleGenAI({ apiKey: ticketData.userApiKey });
          selectedModel = ticketData.selectedModel || DEFAULT_MODEL;
          selectedPersona = ticketData.selectedPersona || selectedPersona;
          customPersonaText = ticketData.customPersonaText || customPersonaText;
        }
        if (!activeAi) {
          return interaction.editReply('❌ Chưa có GEMINI_API_KEY.');
        }
        // Regenerate: chỉ check lock bot khi không dùng key ticket
        if (!(ticketData && ticketData.userApiKey)) {
          const lock = getGeminiLockStatus();
          if (lock.locked) return interaction.editReply(lock.message);
        }
        const q = checkQuota(interaction.user.id, 'chat');
        if (!q.allowed) return interaction.editReply(q.message);

        let systemInstruction = getSystemInstructionForPersona(
          SYSTEM_INSTRUCTION,
          selectedPersona,
          customPersonaText
        );
        if (up.replyMode === 'strict') {
          systemInstruction += '\n\n' + getStrictModeBlock();
        }
        if (ticketData?.contextNote) {
          systemInstruction += `\n\n[Ghi chú ngữ cảnh ticket]\n${ticketData.contextNote}`;
        }

        const personaKeyPart =
          selectedPersona === 'custom'
            ? `custom_${(customPersonaText || '').slice(0, 40).replace(/\s+/g, '_')}`
            : selectedPersona;
        const sessionKey = `${interaction.user.id}_${interaction.channelId}_${selectedModel}_${personaKeyPart}`;
        if (!userSessions.has(sessionKey)) {
          const restoredHistory = getSavedHistory(sessionKey);
          const chatSession = activeAi.chats.create({
            model: selectedModel,
            history: restoredHistory,
            config: {
              systemInstruction,
              maxOutputTokens: 1024,
              thinkingConfig: { thinkingLevel: 'medium' },
            },
          });
          userSessions.set(sessionKey, chatSession);
        }
        const chat = userSessions.get(sessionKey);
        const result = await chat.sendMessage({
          message: `[Người dùng yêu cầu TRẢ LỜI LẠI với cách diễn đạt khác, cùng ý]\n\n${fakeContent}`,
        });
        consumeQuota(interaction.user.id, 'chat');
        clearGeminiLock().catch(() => {});
        const replyText = result?.text || 'Không tạo lại được.';
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
      if (!aiInstance) {
        return interaction.reply({ content: '❌ Bot chưa được cấu hình GEMINI_API_KEY trên server!', ephemeral: true });
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
        const { buffer, mimeType } = await generateImage(aiInstance, promptStr);
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
      if (!aiInstance) {
        return interaction.reply({ content: '❌ Bot chưa được cấu hình GEMINI_API_KEY trên server!', ephemeral: true });
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
      await interaction.editReply('🎬 Đang tiến hành dựng video bằng Veo 3.1... Quá trình này có thể mất từ 1 đến 6 phút, vui lòng chờ xíu nhé!');

      let videoPath;
      try {
        videoPath = await generateVideo(aiInstance, promptStr, {
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

    if (commandName === 'tts') {
      const mode = interaction.options.getString('mode');
      const enabled = mode === 'on';
      setUserTts(user.id, enabled);
      return interaction.reply({
        content: enabled
          ? '🔊 Đã **bật TTS**: mỗi câu trả lời chat sẽ kèm file MP3 (đoạn đầu, tiếng Việt).'
          : '🔇 Đã **tắt TTS**.',
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
        const r = await speakInGuild(guildId, text.trim());
        return interaction.editReply(r.message);
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
        const chat = aiInstance.chats.create({
          model: DEFAULT_MODEL,
          config: {
            maxOutputTokens: 512,
            systemInstruction:
              'Bạn là dịch giả. Nếu input chủ yếu tiếng Việt → dịch sang English. Nếu chủ yếu English → dịch sang tiếng Việt. Chỉ trả bản dịch, không giải thích.',
          },
        });
        const result = await chat.sendMessage({ message: text });
        return interaction.editReply(`🌐 **Bản dịch**\n${(result?.text || '…').slice(0, 1900)}`);
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

  const ticketData = getTicketByChannel(message.channel.id);

  if (ticketData && message.content.trim().toLowerCase().startsWith('key:')) {
    const apiKey = message.content.replace(/key:/i, '').trim();
    if (apiKey.length < 20) {
      return message.reply('❌ Key Gemini không hợp lệ. Vui lòng kiểm tra lại!');
    }
    setTicketApiKey(message.channel.id, apiKey);
    await message.delete().catch(() => {});
    return message.channel.send('🔑 **Đã lưu Key Gemini thành công!** (Tin nhắn chứa Key đã được tự động xóa).');
  }

  // Ghim ngữ cảnh ticket: note: ...
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
      const chat = aiInstance.chats.create({
        model: DEFAULT_MODEL,
        config: {
          maxOutputTokens: 512,
          systemInstruction:
            'Bạn là dịch giả. Input tiếng Việt → English. Input English → tiếng Việt. Chỉ trả bản dịch.',
        },
      });
      const result = await chat.sendMessage({ message: text });
      return message.reply(`🌐 ${(result?.text || '…').slice(0, 1900)}`).catch(() => {});
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

  if (!isDM && !ticketData && targetChannel && message.channel.id !== targetChannel) return;
  if (!isDM && !ticketData && !targetChannel && !isMentioned) return;

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

  // Khóa Gemini chỉ khi dùng KEY BOT — ticket có key riêng vẫn chat được
  const earlyTicket = getTicketByChannel(message.channel.id);
  const usingOwnTicketKey = !!(earlyTicket && earlyTicket.userApiKey);
  if (!usingOwnTicketKey) {
    const geminiLock = getGeminiLockStatus();
    if (geminiLock.locked) {
      return message.reply(geminiLock.message).catch(() => {});
    }
  }

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) {
    try { await message.reply('Bạn cần Nexus AI hỗ trợ gì nào?'); } catch (err) {}
    return;
  }

  // Toxic shield — chặn lời lẽ xúc phạm trước khi gọi API
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
      });
    } catch (_) {}
    const embeds = gifUrl ? [new EmbedBuilder().setImage(gifUrl).setColor(0x5865f2)] : [];
    return message.reply({ content: quickReply, embeds }).catch(() => message.reply(quickReply).catch(() => {}));
  }

  let isChannelLocked = false;
  if (!isDM && message.guild) {
    try {
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: false,
      });
      isChannelLocked = true;
    } catch (lockErr) {
      console.error('❌ Không thể khóa kênh (Cần quyền Manage Channels hoặc Manage Roles):', lockErr);
    }
  }

  try {
    try { await message.channel.sendTyping(); } catch (err) {}

    let activeAi = aiInstance;
    let selectedModel = DEFAULT_MODEL;
    let usingTicketKey = false;
    let selectedPersona = DEFAULT_PERSONA_ID;
    let customPersonaText = null;

    // Persona ngoài ticket lấy từ UserPrefs (/persona)
    const userPrefs = getUserPrefs(message.author.id);
    selectedPersona = userPrefs.selectedPersona || DEFAULT_PERSONA_ID;
    customPersonaText = userPrefs.customPersonaText || null;

    if (ticketData) {
      if (!ticketData.userApiKey) {
        return message.reply(
          '⚠️ **Kênh Ticket yêu cầu API Key riêng!**\nVui lòng nhắn `key: <GEMINI_API_KEY_CỦA_BẠN>` vào đây trước khi trò chuyện.'
        );
      }
      activeAi = new GoogleGenAI({ apiKey: ticketData.userApiKey });
      selectedModel = ticketData.selectedModel || DEFAULT_MODEL;
      // Trong ticket: ưu tiên persona đã chọn trên kênh ticket
      selectedPersona = ticketData.selectedPersona || DEFAULT_PERSONA_ID;
      customPersonaText = ticketData.customPersonaText || null;
      usingTicketKey = true;
    }

    if (!activeAi) {
      return message.reply('❌ Bot chưa được cài đặt GEMINI_API_KEY!');
    }

    // Session tách theo model + persona để đổi tính cách không dính lịch sử cũ
    const personaKeyPart =
      selectedPersona === 'custom'
        ? `custom_${(customPersonaText || '').slice(0, 40).replace(/\s+/g, '_')}`
        : selectedPersona;
    const sessionKey = `${message.author.id}_${message.channel.id}_${selectedModel}_${personaKeyPart}`;

    if (!userSessions.has(sessionKey)) {
      // Khôi phục lịch sử đã lưu trên đĩa (nếu có) thay vì luôn bắt đầu trống,
      // để bộ nhớ hội thoại sống sót qua các lần restart/redeploy.
      const restoredHistory = getSavedHistory(sessionKey);
      let systemInstruction = getSystemInstructionForPersona(
        SYSTEM_INSTRUCTION,
        selectedPersona,
        customPersonaText
      );
      if (userPrefs.replyMode === 'strict') {
        systemInstruction += '\n\n' + getStrictModeBlock();
      }
      if (ticketData?.contextNote) {
        systemInstruction += `\n\n[Ghi chú ngữ cảnh ticket do user đặt]\n${ticketData.contextNote}`;
      }
      const chatSession = activeAi.chats.create({
        model: selectedModel,
        history: restoredHistory,
        config: {
          systemInstruction,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingLevel: 'medium' },
        },
      });
      userSessions.set(sessionKey, chatSession);
      if (restoredHistory.length > 0) {
        console.log(`♻️ Đã khôi phục ${restoredHistory.length} tin nhắn lịch sử cho session ${sessionKey}`);
      }
    }

    const chat = userSessions.get(sessionKey);
    // Gắn gợi ý cảm xúc vào tin nhắn (không đổi systemInstruction cố định của session)
    let messageForModel = prompt;
    if (userEmotion && userEmotion !== 'neutral') {
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
      messageForModel = `${toneLine}\n\n${prompt}`;
    }

    let result;
    try {
      result = await chat.sendMessage({ message: messageForModel });
    } catch (apiErr) {
      console.error('❌ Lỗi khi gọi Gemini API (sendMessage):', apiErr);
      userSessions.delete(sessionKey);

      // Hết quota Gemini
      const quotaInfo = parseGeminiQuotaError(apiErr, selectedModel);
      if (quotaInfo.isQuota) {
        // Chỉ khóa TOÀN BOT khi lỗi từ key mặc định — ticket key riêng không khóa server
        if (!usingTicketKey) {
          const lock = await lockGeminiQuota({
            retryAfterSec: quotaInfo.retryAfterSec,
            isDailyQuota: quotaInfo.isDailyQuota,
            model: quotaInfo.model || selectedModel,
            reason: 'gemini_429',
          });
          return message.reply(lock.message || getGeminiLockStatus().message).catch(() => {});
        }
        // Ticket + key user: báo lỗi tại chỗ, gợi ý đổi model / key
        return message
          .reply(
            `⏳ **Key Gemini trong ticket này đã hết quota (free tier).**\n` +
              `> Model: \`${selectedModel}\`\n` +
              `• Đổi model trong menu ticket (flash-lite / 3.5…)\n` +
              `• Hoặc dán key project khác: \`key: AIza...\`\n` +
              `• Hoặc bật Billing / đợi reset quota trên AI Studio.`
          )
          .catch(() => {});
      }

      const { status, rawMsg, hint, friendly } = formatApiError(apiErr, selectedModel);
      const keySource = usingTicketKey ? 'Key riêng của Ticket này' : 'Key mặc định của Bot';

      const detailMsg = friendly
        ? friendly
        : `❌ **Lỗi liên lạc Gemini API**\n` +
          `> Model: \`${selectedModel}\`\n` +
          `> Nguồn Key: ${keySource}\n` +
          `> Mã lỗi: \`${status}\`\n` +
          `> Chi tiết: ${rawMsg}\n` +
          (hint ? `\n${hint}` : '');

      return message.reply(detailMsg.slice(0, 1900));
    }

    let replyText = result?.text || '🤖 Nexus AI không trả lời được nội dung này.';

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
      gifUrl = await resolveEmotionalGif({
        userEmotion,
        replyText,
        getGifForEmotion,
        getGifByKeyword,
      });
    } catch (e) {
      console.warn('❌ Lỗi khi tìm GIF cảm xúc:', e);
      gifUrl = null;
    }

    // TTS (nếu user bật /tts on) — file MP3 đoạn đầu câu trả lời
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

    const DISCORD_MAX = 2000;
    const gifEmbed = gifUrl ? [new EmbedBuilder().setImage(gifUrl).setColor(0x5865f2)] : [];
    const files = ttsAttachment ? [ttsAttachment] : [];

    // Lưu prompt + nút Regenerate
    const regenKey = `${message.author.id}_${message.channel.id}`;
    lastPrompts.set(regenKey, { prompt, userId: message.author.id, at: Date.now() });
    const regenRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`nexus_regen:${regenKey}`)
        .setLabel('Trả lời lại')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄')
    );

    let textOut = replyText;
    if (quotaWarn) textOut = `${replyText}\n\n${quotaWarn}`;

    if (textOut.length > DISCORD_MAX) {
      const safeChunkSize = 1900;
      const chunks = textOut.match(new RegExp(`([\\s\\S]{1,${safeChunkSize}})`, 'g')) || [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isLast = i === chunks.length - 1;
        await message
          .reply({
            content: chunk,
            embeds: isLast ? gifEmbed : [],
            files: isLast ? files : [],
            components: isLast ? [regenRow] : [],
          })
          .catch(() => {});
      }
    } else {
      const sent = await message
        .reply({ content: textOut, embeds: gifEmbed, files, components: [regenRow] })
        .catch(async () => {
          return message.reply(textOut).catch(() => null);
        });
      // Reaction theo emotion (9)
      try {
        const reactEmoji = EMOTION_REACTIONS[userEmotion];
        if (reactEmoji && sent && typeof sent.react === 'function') {
          await sent.react(reactEmoji).catch(() => {});
        }
      } catch (_) {}
    }
  } catch (error) {
    console.error('❌ Lỗi khi xử lý messageCreate:', error);
    await message.reply('❌ Đã có lỗi xảy ra khi xử lý yêu cầu của bạn. Hãy thử lại hoặc dùng `/reset`.').catch(() => {});
  } finally {
    if (isChannelLocked && !isDM && message.guild) {
      try {
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
          SendMessages: null,
        });
      } catch (unlockErr) {
        console.error('❌ Không thể mở lại kênh chat:', unlockErr);
      }
    }
  }
});

// ==========================================
// KHỞI TẠO BOT & CHỐNG SẬP APP
// ==========================================
(async () => {
  try {
    const dataDir = path.join(__dirname, 'data');
    await fs.mkdir(dataDir, { recursive: true }).catch(() => {});

    await loadAllowedChannelsFromFile().catch((e) => console.error('Lỗi load allowedChannels:', e));
    await loadAutoClearChannels().catch((e) => console.error('Lỗi load autoClear:', e));
    await loadTickets().catch((e) => console.error('Lỗi load tickets:', e));
    await loadSessionsFromFile().catch((e) => console.error('Lỗi load sessions:', e));
    await loadQuota().catch((e) => console.error('Lỗi load quota:', e));
    await loadGeminiLock().catch((e) => console.error('Lỗi load geminiLock:', e));
    await loadUserPrefs().catch((e) => console.error('Lỗi load userPrefs:', e));

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
