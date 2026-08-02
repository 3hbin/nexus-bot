require('dotenv').config();
const { Client, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// ==========================================
// 1. WEB SERVER DÙNG ĐỂ KEEP-ALIVE RENDER
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🤖 Nexus AI Bot is running 24/7!');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server đang chạy tại port ${PORT}`);
});

// ==========================================
// 2. KHỞI TẠO BOT & GEMINI AI
// ==========================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Bộ nhớ đệm lưu Chat History và Kênh được chỉ định
const userSessions = new Map(); // Lưu lịch sử chat cá nhân
const allowedChannels = new Map(); // Lưu kênh được phép chat của từng Server

client.once('ready', () => {
  console.log(`✅ Bot ${client.user.tag} đã online thành công!`);
});

// ==========================================
// 3. XỬ LÝ LỆNH VÀ TIN NHẮN
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const guildId = message.guildId;
  const userId = message.author.id;

  // --- LỆNH 1: /ping (Mọi người dùng) ---
  if (content === '/ping') {
    const pingMsg = await message.reply('🏓 Ping...');
    const latency = pingMsg.createdTimestamp - message.createdTimestamp;
    return pingMsg.edit(`🏓 **Pong!**\n⚡ Độ trễ Bot: \`${latency}ms\`\n🌐 WebSocket: \`${client.ws.ping}ms\``);
  }

  // --- LỆNH 2: /setchannel (Chỉ Admin) ---
  if (content === '/setchannel') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('❌ Bạn cần có quyền **Administrator** (Quản trị viên) để sử dụng lệnh này!');
    }
    allowedChannels.set(guildId, message.channel.id);
    return message.reply(`✅ Đã thiết lập <#${message.channel.id}> làm kênh trò chuyện duy nhất cho Nexus AI!`);
  }

  // --- LỆNH 3: /reset (Mọi người dùng - Chỉ xóa bộ nhớ cá nhân) ---
  if (content === '/reset') {
    userSessions.delete(userId);
    return message.reply('🔄 Đã xóa bộ nhớ lịch sử trò chuyện của riêng bạn! Bạn có thể bắt đầu chủ đề mới.');
  }

  // --- XỬ LÝ TRÒ CHUYỆN AI GIỮA BOT VÀ USER ---
  const targetChannel = allowedChannels.get(guildId);
  const isMentioned = message.mentions.has(client.user);

  // Nếu đã setchannel mà nhắn ở kênh khác -> Bỏ qua
  if (targetChannel && message.channel.id !== targetChannel) return;
  // Nếu chưa setchannel, phải tag bot mới trả lời
  if (!targetChannel && !isMentioned) return;

  // Lọc lấy nội dung câu hỏi (xóa tag bot và khoảng trắng thừa)
  const prompt = content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) return message.reply('Bạn cần Nexus AI hỗ trợ gì nào?');

  await message.channel.sendTyping();

  try {
    // Tải hoặc tạo Session Chat riêng cho từng User
    if (!userSessions.has(userId)) {
      const chatSession = model.startChat({
        history: [
          {
            role: "user",
            parts: [{ text: "Hãy đóng vai Nexus AI, một trợ lý Discord thông minh, vui tính và thân thiện." }],
          },
          {
            role: "model",
            parts: [{ text: "Chào bạn! Mình là Nexus AI. Rất vui được hỗ trợ bạn!" }],
          },
        ],
      });
      userSessions.set(userId, chatSession);
    }

    const chat = userSessions.get(userId);
    const result = await chat.sendMessage(prompt);
    const replyText = result.response.text();

    // Chia nhỏ tin nhắn nếu dài hơn 2000 ký tự
    if (replyText.length > 2000) {
      const chunks = replyText.match(/[\s\S]{1,1900}/g);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(replyText);
    }
  } catch (error) {
    console.error('Lỗi Gemini API:', error);
    message.reply('❌ Rất tiếc, đã có lỗi xảy ra khi kết nối với AI. Hãy thử gõ `/reset` để xóa bộ nhớ hội thoại xem sao nhé.');
  }
});

// ==========================================
// 4. ĐĂNG NHẬP BOT
// ==========================================
client.login(process.env.DISCORD_TOKEN);
