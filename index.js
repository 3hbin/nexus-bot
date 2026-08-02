require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// ==========================================
// 1. TẠO WEB SERVER ĐỂ RENDER KEEP-ALIVE
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
// 2. CẤU HÌNH GEMINI AI & DISCORD BOT
// ==========================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  systemInstruction: "Bạn là Nexus AI, một trợ lý Discord thân thiện, thông minh và hỗ trợ nhiệt tình."
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`✅ Bot ${client.user.tag} đã kết nối thành công và sẵn sàng hoạt động!`);
});

// ==========================================
// 3. XỬ LÝ TIN NHẮN TỪ DISCORD
// ==========================================
client.on('messageCreate', async (message) => {
  // Bỏ qua tin nhắn từ bot hoặc không tag bot
  if (message.author.bot || !message.mentions.has(client.user)) return;

  // Lấy nội dung câu hỏi (xóa phần tag bot)
  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  
  if (!prompt) {
    return message.reply('Chào bạn! Bạn cần Nexus AI hỗ trợ gì nào?');
  }

  // Bật trạng thái "Đang gõ..." trên Discord
  await message.channel.sendTyping();

  try {
    // Gửi câu hỏi sang Gemini API
    const result = await model.generateContent(prompt);
    const replyText = result.response.text();

    // Giới hạn 2000 ký tự của Discord
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
    message.reply('❌ Rất tiếc, đã có lỗi xảy ra khi xử lý phản hồi từ AI.');
  }
});

// ==========================================
// 4. ĐĂNG NHẬP BOT
// ==========================================
client.login(process.env.DISCORD_TOKEN);
