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
} = require('discord.js');

const { GoogleGenAI } = require('@google/genai');

// ==========================================
// CONFIG & INIT
// ==========================================
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ALLOWED_CHANNELS_FILE = process.env.ALLOWED_CHANNELS_FILE ||
  path.join(__dirname, 'data', 'allowedChannels.json');

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
// GOOGLE GEMINI: khởi tạo client + model
// ==========================================
// QUAN TRỌNG: "systemInstruction" được truyền qua config: { systemInstruction } khi tạo chat
// bằng ai.chats.create() (chuẩn của SDK @google/genai), không nhét vào history dạng
// role:"user"/"model" nữa -> tránh lỗi INVALID_ARGUMENT.
// SDK mới @google/genai (thay thế @google/generative-ai đã bị Google khai tử,
// kho GitHub cũ đã archive từ 16/12/2025 và không còn hỗ trợ đầy đủ các model Gemini 2.0+).
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SYSTEM_INSTRUCTION =
  'Bạn là Nexus AI — một trợ lý Discord thân thiện, dí dỏm. ' +
  'Hãy tự động thêm emoji phù hợp ngữ cảnh khi trả lời. ' +
  'Trả lời ngắn gọn, rõ ràng.';

// LƯU Ý QUAN TRỌNG:
// - 'gemini-1.5-flash' và 'gemini-2.0-flash' ĐÃ SHUTDOWN HOÀN TOÀN -> luôn trả 404.
// - 'gemini-2.5-flash' vẫn hoạt động cho user/project CŨ, nhưng Google đã NGỪNG CẤP quyền
//   dùng model này cho API key/project MỚI TẠO (lỗi: "no longer available to new users").
// -> Dùng 'gemini-3.5-flash' (bản mới nhất, hiện đang mở cho mọi user, chưa có lịch shutdown).
const MODEL_NAME = 'gemini-3.5-flash';

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

const GIFS = {
  hello: [
    'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
    'https://media.giphy.com/media/ASd0Ukj0y3qMM/giphy.gif',
  ],
  happy: [
    'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
    'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
  ],
  sorry: [
    'https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif',
    'https://media.giphy.com/media/xUPGcguWZHRC2HyBRS/giphy.gif',
  ],
  thanks: [
    'https://media.giphy.com/media/l4FGwHEUCGILg3g0A/giphy.gif',
    'https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif',
  ],
  thinking: [
    'https://media.giphy.com/media/l0HlQ7LRal2p7x1Wc/giphy.gif',
    'https://media.giphy.com/media/3o6ZtaO9BZHcOjmErm/giphy.gif',
  ],
};

// Chọn ngẫu nhiên 1 GIF ứng với cảm xúc
function pickGifForEmotion(emotion) {
  const list = GIFS[emotion];
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

// Phân tích cảm xúc đơn giản dựa trên nội dung text (regex keyword)
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
// Persistence: load & save allowedChannels
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

// Debounce việc ghi file để tránh ghi liên tục khi có nhiều thay đổi gần nhau
let saveTimeout = null;
function scheduleSaveAllowedChannels(delay = 200) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveAllowedChannelsToFile().catch(err => console.error('❌ Lỗi scheduleSave:', err));
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
].map(cmd => cmd.toJSON());

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
});

// ==========================================
// XỬ LÝ SLASH COMMANDS
// ==========================================
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, user, guildId, channelId } = interaction;

    if (commandName === 'ping') {
      const sent = await interaction.reply({ content: '🏓 Ping...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      return interaction.editReply(`🏓 **Pong!**\n⚡ Độ trễ Bot: \`${latency}ms\`\n🌐 WebSocket: \`${client.ws.ping}ms\``);
    }

    if (commandName === 'reset') {
      userSessions.delete(user.id);
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
          content: `📡 Nexus AI Status (DM):\n- Active sessions: **${activeSessions}**\n- Model: **${MODEL_NAME}**`,
          ephemeral: true,
        });
      } else {
        const tgt = allowedChannels.get(guildId);
        const channelInfo = tgt ? `<#${tgt}> (\`${tgt}\`)` : 'Chưa thiết lập (bot phản hồi khi được mention hoặc trong DM)';
        return interaction.reply({
          content:
            `📡 Nexus AI Status (Server):\n- Kênh hiện tại: ${channelInfo}\n- Active sessions tổng: **${activeSessions}**\n- Model: **${MODEL_NAME}**`,
          ephemeral: true,
        });
      }
    }
  } catch (err) {
    console.error('❌ Lỗi khi xử lý interaction:', err);
    if (interaction.replied || interaction.deferred) {
      try { await interaction.editReply('❌ Có lỗi xảy ra khi xử lý lệnh.'); } catch (e) { console.error('❌ Lỗi editReply:', e); }
    } else {
      try { await interaction.reply('❌ Có lỗi xảy ra khi xử lý lệnh.'); } catch (e) { console.error('❌ Lỗi reply:', e); }
    }
  }
});

// ==========================================
// XỬ LÝ TIN NHẮN (AUTO-CHAT)
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const isDM = !message.guild;
  const guildId = message.guildId;
  const userId = message.author.id;
  const targetChannel = guildId ? allowedChannels.get(guildId) : null;
  const isMentioned = message.mentions.has(client.user);

  // Nếu server đã setchannel -> chỉ phản hồi trong kênh đó
  if (!isDM && targetChannel && message.channel.id !== targetChannel) return;
  // Nếu chưa setchannel -> chỉ phản hồi khi được mention (hoặc trong DM)
  if (!isDM && !targetChannel && !isMentioned) return;

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();

  if (!prompt) {
    try {
      await message.reply('Bạn cần Nexus AI hỗ trợ gì nào?');
    } catch (err) {
      console.error('❌ Lỗi khi gửi phản hồi cho tin nhắn rỗng:', err);
    }
    return;
  }

  try {
    await message.channel.sendTyping();
  } catch (err) {
    console.warn('⚠️ Lỗi khi gửi typing indicator:', err);
  }

  try {
    // Tạo session chat mới cho user nếu chưa có.
    // SDK mới: ai.chats.create({ model, config: { systemInstruction } }).
    // History bắt đầu trống -> không cần giả lập role "system" nữa.
    if (!userSessions.has(userId)) {
      const chatSession = ai.chats.create({
        model: MODEL_NAME,
        history: [],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          maxOutputTokens: 1024,
        },
      });
      userSessions.set(userId, chatSession);
    }

    const chat = userSessions.get(userId);

    let result;
    try {
      // SDK mới nhận message dạng object { message: "..." } thay vì truyền string trực tiếp.
      result = await chat.sendMessage({ message: prompt });
    } catch (apiErr) {
      console.error('❌ Lỗi khi gọi Gemini API (sendMessage):', apiErr);
      try {
        await message.reply('❌ Rất tiếc, không thể liên lạc với Gemini API ngay lúc này. Hãy thử lại sau hoặc dùng `/reset`.');
      } catch (replyErr) {
        console.error('❌ Lỗi khi gửi phản hồi lỗi tới user:', replyErr);
      }
      return;
    }

    let replyText = '';
    try {
      // SDK mới trả text trực tiếp qua thuộc tính .text (không phải hàm .text()).
      if (result && typeof result.text === 'string') {
        replyText = result.text;
      } else {
        replyText = '🤖 Nexus AI đã trả về nội dung không xác định.';
      }
    } catch (err) {
      console.error('❌ Lỗi khi lấy text từ kết quả Gemini:', err);
      replyText = '❌ Rất tiếc, có lỗi khi xử lý phản hồi từ Gemini.';
    }

    if (!replyText) replyText = '🤖 Nexus AI không trả lời được nội dung này.';

    const emotion = detectEmotion(replyText);
    const gifUrl = emotion ? pickGifForEmotion(emotion) : null;

    const DISCORD_MAX = 2000;
    if (replyText.length > DISCORD_MAX) {
      const safeChunkSize = 1900;
      const chunks = replyText.match(new RegExp(`([\\s\\S]{1,${safeChunkSize}})`, 'g')) || [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (i === chunks.length - 1 && gifUrl) {
          try {
            await message.reply(`${chunk}\n\n${gifUrl}`);
          } catch (sendErr) {
            console.error('❌ Lỗi khi gửi chunk cuối với GIF:', sendErr);
          }
        } else {
          try {
            await message.reply(chunk);
          } catch (sendErr) {
            console.error('❌ Lỗi khi gửi chunk tới Discord:', sendErr);
          }
        }
      }
    } else {
      try {
        if (gifUrl) {
          await message.reply(`${replyText}\n\n${gifUrl}`);
        } else {
          await message.reply(replyText);
        }
      } catch (sendErr) {
        console.error('❌ Lỗi khi gửi phản hồi tới Discord:', sendErr);
      }
    }
  } catch (error) {
    console.error('❌ Lỗi khi xử lý messageCreate:', error);
    try {
      await message.reply('❌ Đã có lỗi xảy ra khi xử lý yêu cầu của bạn. Hãy thử lại hoặc dùng `/reset`.');
    } catch (replyErr) {
      console.error('❌ Lỗi khi gửi thông báo lỗi tới user:', replyErr);
    }
  }
});

// ==========================================
// KHỞI TẠO
// ==========================================
(async () => {
  try {
    await loadAllowedChannelsFromFile();
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
  saveAllowedChannelsToFile().catch(err => console.error('❌ Lỗi khi lưu trước khi thoát:', err));
});

process.on('SIGINT', async () => {
  try { await saveAllowedChannelsToFile(); } catch (err) { console.error('❌ Lỗi SIGINT save:', err); }
  process.exit();
});

process.on('SIGTERM', async () => {
  try { await saveAllowedChannelsToFile(); } catch (err) { console.error('❌ Lỗi SIGTERM save:', err); }
  process.exit();
});
