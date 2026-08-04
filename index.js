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
  ],
  partials: ['CHANNEL'],
});

// ==========================================
// BỘ NHỚ & CẤU HÌNH GIF
// ==========================================
const userSessions = new Map();
const allowedChannels = new Map();

function detectEmotion(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  if (/\b(hello|hi|hey|chào|xin chào|chào bạn|chào mọi người)\b/.test(t)) return 'hello';
  if (/\b(thanks|thank you|cảm ơn|cảm ơn bạn|thank)\b/.test(t)) return 'thanks';
  if (/\b(sorry|xin lỗi|rất tiếc|xin lỗi bạn)\b/.test(t)) return 'sorry';
  if (/\b(maybe|hmm|hmm...|đang suy nghĩ|suy nghĩ|có thể|let me think|i think)\b/.test(t)) return 'thinking';
  if (/\b(haha|lol|😂|vui|tuyệt|tuyệt vời|tôi rất vui|thích|yay|hooray|excited|great)\b/.test(t)) return 'happy';
  return null;
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
].map((cmd) => cmd.toJSON());

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
  await syncTicketsOnStartup(client).catch((e) => console.error('Lỗi syncTickets:', e));
});

// ==========================================
// XỬ LÝ SLASH COMMANDS & TICKET INTERACTIONS
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isModalSubmit && interaction.customId && interaction.customId.startsWith('modal_api_key')) {
      const handledModal = await handleTicketInteraction(interaction);
      if (handledModal) return;
    }

    const handledByTicket = await handleTicketInteraction(interaction);
    if (handledByTicket) return;

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
      if (!guildId) {
        return interaction.reply({
          content: `📡 Nexus AI Status (DM):\n- Active sessions: **${activeSessions}**\n- Default Model: **${DEFAULT_MODEL}**`,
          ephemeral: true,
        });
      } else {
        const tgt = allowedChannels.get(guildId);
        const channelInfo = tgt ? `<#${tgt}> (\`${tgt}\`)` : 'Chưa thiết lập (bot phản hồi khi được mention hoặc trong DM)';
        return interaction.reply({
          content: `📡 Nexus AI Status (Server):\n- Kênh hiện tại: ${channelInfo}\n- Active sessions tổng: **${activeSessions}**\n- Default Model: **${DEFAULT_MODEL}**`,
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
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const attachment = new AttachmentBuilder(buffer, { name: `nexus_image.${ext}` });
        return interaction.editReply({ content: `🎨 Ảnh tạo theo yêu cầu: "${promptStr}"`, files: [attachment] });
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
        const attachment = new AttachmentBuilder(videoPath, { name: 'nexus_video.mp4' });
        await interaction.editReply({ content: `🎬 Video tạo theo yêu cầu: "${promptStr}"`, files: [attachment] });
      } catch (err) {
        console.error('❌ Lỗi tạo video:', err);
        const { status, rawMsg, friendly } = formatApiError(err, VIDEO_MODEL_NAME);
        await interaction.editReply(friendly || `❌ Không thể tạo video. [\`${status}\`] ${rawMsg}`);
      } finally {
        if (videoPath) cleanupTempFile(videoPath);
      }
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

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) {
    try { await message.reply('Bạn cần Nexus AI hỗ trợ gì nào?'); } catch (err) {}
    return;
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

    if (ticketData) {
      if (!ticketData.userApiKey) {
        return message.reply(
          '⚠️ **Kênh Ticket yêu cầu API Key riêng!**\nVui lòng nhắn `key: <GEMINI_API_KEY_CỦA_BẠN>` vào đây trước khi trò chuyện.'
        );
      }
      activeAi = new GoogleGenAI({ apiKey: ticketData.userApiKey });
      selectedModel = ticketData.selectedModel || DEFAULT_MODEL;
      usingTicketKey = true;
    }

    if (!activeAi) {
      return message.reply('❌ Bot chưa được cài đặt GEMINI_API_KEY!');
    }

    const sessionKey = `${message.author.id}_${message.channel.id}_${selectedModel}`;
    if (!userSessions.has(sessionKey)) {
      // Khôi phục lịch sử đã lưu trên đĩa (nếu có) thay vì luôn bắt đầu trống,
      // để bộ nhớ hội thoại sống sót qua các lần restart/redeploy.
      const restoredHistory = getSavedHistory(sessionKey);
      const chatSession = activeAi.chats.create({
        model: selectedModel,
        history: restoredHistory,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
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
    let result;
    try {
      result = await chat.sendMessage({ message: prompt });
    } catch (apiErr) {
      console.error('❌ Lỗi khi gọi Gemini API (sendMessage):', apiErr);
      userSessions.delete(sessionKey);

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

    function extractKeywordsEnglish(text) {
      if (!text) return null;
      const words = text
        .replace(/[^A-Za-z0-9\s]/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      const unique = Array.from(new Set(words));
      return unique.slice(0, 2).join(' ');
    }

    let gifUrl = null;
    try {
      const keywords = extractKeywordsEnglish(replyText);
      if (keywords) {
        gifUrl = await getGifByKeyword(keywords);
      }
    } catch (e) {
      console.warn('❌ Lỗi khi tìm GIF bằng từ khoá:', e);
      gifUrl = null;
    }

    if (!gifUrl) {
      const emotion = detectEmotion(replyText);
      if (emotion) gifUrl = await getGifForEmotion(emotion);
    }

    const DISCORD_MAX = 2000;
    const gifEmbed = gifUrl ? [new EmbedBuilder().setImage(gifUrl).setColor(0x5865f2)] : [];

    if (replyText.length > DISCORD_MAX) {
      const safeChunkSize = 1900;
      const chunks = replyText.match(new RegExp(`([\\s\\S]{1,${safeChunkSize}})`, 'g')) || [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isLast = i === chunks.length - 1;
        await message.reply({ content: chunk, embeds: isLast ? gifEmbed : [] }).catch(() => {});
      }
    } else {
      await message.reply({ content: replyText, embeds: gifEmbed }).catch(async () => {
        await message.reply(replyText).catch(() => {});
      });
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
