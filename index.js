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
} = require('discord.js');

const { GoogleGenAI } = require('@google/genai');
const { getGifForEmotion } = require('./GifSearch.js');
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

// ==========================================
// CONFIG & INIT
// ==========================================
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ALLOWED_CHANNELS_FILE =
  process.env.ALLOWED_CHANNELS_FILE || path.join(__dirname, 'data', 'allowedChannels.json');

// GIỚI HẠN THỜI GIAN GỬI TIN NHẮN (Rate Limit - Cooldown tính theo giây)
const CHAT_COOLDOWN_SECONDS = 5;
const userCooldowns = new Map();

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN in environment variables.');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('❌ Missing GEMINI_API_KEY in environment variables.');
  process.exit(1);
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
const defaultAi = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SYSTEM_INSTRUCTION =
  'Bạn là Nexus AI — một trợ lý Discord thân thiện, dí dỏm. ' +
  'Hãy tự động thêm emoji phù hợp ngữ cảnh khi trả lời. ' +
  'Trả lời ngắn gọn, rõ ràng.';

const DEFAULT_MODEL = 'gemini-3.6-flash';

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
      console.log('📂 Không tìm thấy file allowedChannels, bắt đầu với cấu hình trống.');
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
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

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
  await syncTicketsOnStartup(client);
});

// ==========================================
// XỬ LÝ SLASH COMMANDS & TICKET INTERACTIONS
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
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

  // 1. Nhận Gemini API Key riêng trong kênh Ticket
  if (ticketData && message.content.trim().toLowerCase().startsWith('key:')) {
    const apiKey = message.content.replace(/key:/i, '').trim();
    if (apiKey.length < 20) {
      return message.reply('❌ Key Gemini không hợp lệ. Vui lòng kiểm tra lại!');
    }
    setTicketApiKey(message.channel.id, apiKey);
    await message.delete().catch(() => {}); // Thu hồi tin nhắn để bảo mật Key
    return message.channel.send('🔑 **Đã lưu Key Gemini thành công!** (Tin nhắn chứa Key đã được bảo mật xóa đi).');
  }

  const isDM = !message.guild;
  const guildId = message.guildId;
  const targetChannel = guildId ? allowedChannels.get(guildId) : null;
  const isMentioned = message.mentions.has(client.user);

  if (!isDM && !ticketData && targetChannel && message.channel.id !== targetChannel) return;
  if (!isDM && !ticketData && !targetChannel && !isMentioned) return;

  // 2. Kiếm tra Cooldown Rate Limit Chat (Chống spam)
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

  try { await message.channel.sendTyping(); } catch (err) {}

  try {
    let activeAi = defaultAi;
    let selectedModel = DEFAULT_MODEL;

    // Thiết lập riêng nếu tin nhắn gửi từ Kênh Ticket
    if (ticketData) {
      if (!ticketData.userApiKey) {
        return message.reply(
          '⚠️ **Kênh Ticket yêu cầu API Key riêng!**\nVui lòng nhắn `key: <GEMINI_API_KEY_CỦA_BẠN>` vào đây trước khi trò chuyện.'
        );
      }
      activeAi = new GoogleGenAI({ apiKey: ticketData.userApiKey });
      selectedModel = ticketData.selectedModel || DEFAULT_MODEL;
    }

    const sessionKey = `${message.author.id}_${message.channel.id}`;
    if (!userSessions.has(sessionKey)) {
      const chatSession = activeAi.chats.create({
        model: selectedModel,
        history: [],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: 1024,
        },
      });
      userSessions.set(sessionKey, chatSession);
    }

    const chat = userSessions.get(sessionKey);
    let result;
    try {
      result = await chat.sendMessage({ message: prompt });
    } catch (apiErr) {
      console.error('❌ Lỗi khi gọi Gemini API (sendMessage):', apiErr);
      return message.reply('❌ Lỗi liên lạc Gemini API. Hãy kiểm tra lại API Key hoặc đổi Model AI bằng menu Ticket.');
    }

    let replyText = result?.text || '🤖 Nexus AI không trả lời được nội dung này.';

    const emotion = detectEmotion(replyText);
    const gifUrl = emotion ? await getGifForEmotion(emotion) : null;

    const DISCORD_MAX = 2000;
    if (replyText.length > DISCORD_MAX) {
      const safeChunkSize = 1900;
      const chunks = replyText.match(new RegExp(`([\\s\\S]{1,${safeChunkSize}})`, 'g')) || [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (i === chunks.length - 1 && gifUrl) {
          await message.reply(`${chunk}\n\n${gifUrl}`).catch(() => {});
        } else {
          await message.reply(chunk).catch(() => {});
        }
      }
    } else {
      if (gifUrl) await message.reply(`${replyText}\n\n${gifUrl}`).catch(() => {});
      else await message.reply(replyText).catch(() => {});
    }
  } catch (error) {
    console.error('❌ Lỗi khi xử lý messageCreate:', error);
    await message.reply('❌ Đã có lỗi xảy ra khi xử lý yêu cầu của bạn. Hãy thử lại hoặc dùng `/reset`.').catch(() => {});
  }
});

// ==========================================
// KHỞI TẠO BOT
// ==========================================
(async () => {
  try {
    await loadAllowedChannelsFromFile();
    await loadAutoClearChannels();
    await loadTickets();
    await client.login(DISCORD_TOKEN);
    console.log('🔐 Đã gọi client.login()');
  } catch (err) {
    console.error('❌ Lỗi khi khởi động bot:', err);
    process.exit(1);
  }
})();

process.on('beforeExit', () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  saveAllowedChannelsToFile().catch((err) => console.error('❌ Lỗi khi lưu trước khi thoát:', err));
});

process.on('SIGINT', async () => {
  try { await saveAllowedChannelsToFile(); } catch (err) {}
  process.exit();
});

process.on('SIGTERM', async () => {
  try { await saveAllowedChannelsToFile(); } catch (err) {}
  process.exit();
});
