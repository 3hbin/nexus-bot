// index.js
// Nexus AI Discord Bot (Node.js, discord.js v14)
// Tích hợp Google Gemini, Interest.js (Shield anti-toxic/spam), MediaGen & GifSearch
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
  AttachmentBuilder,
} = require('discord.js');

const { GoogleGenAI } = require('@google/genai');

// Import các module nội bộ
const { getGifForEmotion } = require('./GifSearch.js');
const {
  getEnhancedSystemInstruction,
  handleInterestQuery,
  handleToxicBehavior,
  checkCooldown,
} = require('./Interest.js');
const {
  generateImage,
  generateVideo,
  cleanupTempFile,
  checkMediaCooldown,
} = require('./MediaGen.js');

// ==========================================
// CONFIG & INIT
// ==========================================
const PORT = process.env.PORT || 3000;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ALLOWED_CHANNELS_FILE =
  process.env.ALLOWED_CHANNELS_FILE ||
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
// GOOGLE GEMINI: Khởi tạo client & Prompt
// ==========================================
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const BASE_INSTRUCTION =
  'Bạn là Nexus AI — một trợ lý Discord thân thiện, dí dỏm. ' +
  'Hãy tự động thêm emoji phù hợp ngữ cảnh khi trả lời. Trả lời ngắn gọn, rõ ràng.';
const SYSTEM_INSTRUCTION = getEnhancedSystemInstruction(BASE_INSTRUCTION);

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
// BỘ NHỚ & PHÁT HIỆN CẢM XÚC
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
// PERSISTENCE (Lưu allowedChannels)
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
// SLASH COMMANDS DEFINITION
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

  // Media Generation Commands
  new SlashCommandBuilder()
    .setName('imagine')
    .setDescription('Tạo ảnh bằng AI (Nano Banana)')
    .addStringOption((opt) => opt.setName('prompt').setDescription('Mô tả ảnh bạn muốn tạo').setRequired(true)),
  new SlashCommandBuilder()
    .setName('video')
    .setDescription('Tạo video ngắn bằng AI (Veo 3.1, có thể mất tới vài phút)')
    .addStringOption((opt) => opt.setName('prompt').setDescription('Mô tả video bạn muốn tạo').setRequired(true)),
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
      if (!guildId) return interaction.reply({ content: '❌ Lệnh này chỉ có thể dùng trong server.', ephemeral: true });
      allowedChannels.set(guildId, channelId);
      scheduleSaveAllowedChannels();
      return interaction.reply(`✅ Đã thiết lập <#${channelId}> làm kênh trò chuyện duy nhất cho Nexus AI!`);
    }

    if (commandName === 'unsetchannel') {
      if (!guildId) return interaction.reply({ content: '❌ Lệnh này chỉ có thể dùng trong server.', ephemeral: true });
      if (allowedChannels.has(guildId)) {
        allowedChannels.delete(guildId);
        scheduleSaveAllowedChannels();
        return interaction.reply(`✅ Đã bỏ thiết lập kênh duy nhất cho server này.`);
      }
      return interaction.reply({ content: 'ℹ️ Server này chưa thiết lập kênh duy nhất.', ephemeral: true });
    }

    if (commandName === 'status') {
      const activeSessions = userSessions.size;
      const tgt = guildId ? allowedChannels.get(guildId) : null;
      const channelInfo = tgt ? `<#${tgt}> (\`${tgt}\`)` : 'Chưa thiết lập (phản hồi khi được mention hoặc trong DM)';
      return interaction.reply({
        content: `📡 **Nexus AI Status**:\n- Kênh hiện tại: ${channelInfo}\n- Active sessions: **${activeSessions}**\n- Model: **${MODEL_NAME}**`,
        ephemeral: true,
      });
    }

    // --- Slash Commands Media Generation ---
    if (commandName === 'imagine') {
      const cooldown = checkMediaCooldown(user.id, 'image');
      if (!cooldown.allowed) {
        return interaction.reply({
          content: `⏳ Từ từ đã bạn ơi, chờ ${Math.ceil(cooldown.remainingMs / 1000)}s nữa nha!`,
          ephemeral: true,
        });
      }
      const prompt = interaction.options.getString('prompt');
      await interaction.deferReply();
      try {
        const { buffer, mimeType } = await generateImage(ai, prompt);
        const ext = mimeType.includes('png') ? 'png' : 'jpg';
        const attachment = new AttachmentBuilder(buffer, { name: `nexus_image.${ext}` });
        return interaction.editReply({ content: `🎨 Đây rồi: "${prompt}"`, files: [attachment] });
      } catch (err) {
        console.error('❌ Lỗi tạo ảnh:', err);
        return interaction.editReply('❌ Rất tiếc, không tạo được ảnh lúc này. Thử lại sau nha!');
      }
    }

    if (commandName === 'video') {
      const cooldown = checkMediaCooldown(user.id, 'video');
      if (!cooldown.allowed) {
        return interaction.reply({
          content: `⏳ Video tốn tài nguyên lắm, chờ ${Math.ceil(cooldown.remainingMs / 1000)}s nữa nha!`,
          ephemeral: true,
        });
      }
      const prompt = interaction.options.getString('prompt');
      await interaction.deferReply();
      await interaction.editReply('🎬 Đang dựng video, có thể mất 1-6 phút, chờ tớ xíu nha...');
      let videoPath;
      try {
        videoPath = await generateVideo(ai, prompt, {
          onProgress: (s) => console.log(`⏳ Đang tạo video... ${s}s`),
        });
        const attachment = new AttachmentBuilder(videoPath, { name: 'nexus_video.mp4' });
        await interaction.editReply({ content: `🎬 Video của bạn đây: "${prompt}"`, files: [attachment] });
      } catch (err) {
        console.error('❌ Lỗi tạo video:', err);
        await interaction.editReply('❌ Rất tiếc, không tạo được video lúc này. Thử lại sau nha!');
      } finally {
        if (videoPath) cleanupTempFile(videoPath);
      }
    }
  } catch (err) {
    console.error('❌ Lỗi xử lý interaction:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Có lỗi xảy ra khi xử lý lệnh!', ephemeral: true }).catch(() => {});
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

  // Lọc kênh trò chuyện
  if (!isDM && targetChannel && message.channel.id !== targetChannel) return;
  if (!isDM && !targetChannel && !isMentioned) return;

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();

  if (!prompt) {
    return message.reply('Bạn cần Nexus AI hỗ trợ gì nào?').catch(console.error);
  }

  // 1. Kiểm tra Cooldown chống spam
  const cooldown = checkCooldown(userId);
  if (!cooldown.allowed) {
    const seconds = Math.ceil(cooldown.remainingMs / 1000);
    return message.reply(`⏳ Từ từ đã bạn ơi, đợi ${seconds}s nữa rồi nhắn tiếp nha!`);
  }

  // 2. Chặn Trẻ trâu / Toxic offline (Không tiêu tốn Gemini API Token)
  const toxicReply = handleToxicBehavior(prompt);
  if (toxicReply) {
    return message.reply(toxicReply);
  }

  // 3. Trả lời nhanh sở thích offline (Không tiêu tốn API)
  const interestReply = handleInterestQuery(prompt);
  if (interestReply) {
    return message.reply(interestReply);
  }

  // 4. Gọi Gemini AI
  try {
    await message.channel.sendTyping();
  } catch (e) {}

  try {
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
    const result = await chat.sendMessage({ message: prompt });
    const replyText = result?.text || '🤖 Nexus AI không trả lời được nội dung này.';

    // Phát hiện cảm xúc & Lấy GIF từ Giphy API
    const emotion = detectEmotion(replyText);
    const gifUrl = emotion ? await getGifForEmotion(emotion) : null;

    // Xử lý gửi tin nhắn Discord (Chia chunk nếu >2000 ký tự)
    const DISCORD_MAX = 2000;
    if (replyText.length > DISCORD_MAX) {
      const safeChunkSize = 1900;
      const chunks = replyText.match(new RegExp(`([\\s\\S]{1,${safeChunkSize}})`, 'g')) || [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (i === chunks.length - 1 && gifUrl) {
          await message.reply(`${chunk}\n\n${gifUrl}`);
        } else {
          await message.reply(chunk);
        }
      }
    } else {
      if (gifUrl) {
        await message.reply(`${replyText}\n\n${gifUrl}`);
      } else {
        await message.reply(replyText);
      }
    }
  } catch (error) {
    console.error('❌ Lỗi khi xử lý messageCreate với Gemini API:', error);
    if (error.status === 429) {
      message.reply('Hệ thống đang bận tí xíu do quá nhiều lượt hỏi, chờ tớ 1 phút nhé! 😅');
    } else {
      message.reply('❌ Rất tiếc, có chút trục trặc kĩ thuật. Thử lại sau hoặc dùng `/reset` nhé!');
    }
  }
});

// ==========================================
// KHỞI TẠO BOT
// ==========================================
(async () => {
  try {
    await loadAllowedChannelsFromFile();
    await client.login(DISCORD_TOKEN);
    console.log('🔐 Đã đăng nhập Discord thành công!');
  } catch (err) {
    console.error('❌ Lỗi khởi động bot:', err);
    process.exit(1);
  }
})();

// Xử lý lưu trước khi dừng app trên Render
process.on('beforeExit', () => {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveAllowedChannelsToFile().catch((err) => console.error('❌ Lỗi lưu trước khi thoát:', err));
});

process.on('SIGINT', async () => {
  await saveAllowedChannelsToFile().catch(() => {});
  process.exit();
});

process.on('SIGTERM', async () => {
  await saveAllowedChannelsToFile().catch(() => {});
  process.exit();
});
