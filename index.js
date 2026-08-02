require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
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

// Bộ nhớ đệm
const userSessions = new Map();
const allowedChannels = new Map();

// ==========================================
// 3. ĐĂNG KÝ SLASH COMMANDS VỚI DISCORD
// ==========================================
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Kiểm tra độ trễ kết nối của Bot'),
  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Xóa lịch sử trò chuyện cá nhân với Nexus AI'),
  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Cài đặt kênh duy nhất cho phép Nexus AI hoạt động (Chỉ Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
  console.log(`✅ Bot ${client.user.tag} đã online!`);
  
  try {
    console.log('🔄 Đang đăng ký Slash Commands lên Discord...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('🎉 Đã đăng ký Slash Commands thành công!');
  } catch (error) {
    console.error('❌ Lỗi khi đăng ký Slash Commands:', error);
  }
});

// ==========================================
// 4. XỬ LÝ SLASH COMMANDS (Menu gõ /)
// ==========================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, guildId, channelId } = interaction;

  // Lệnh /ping
  if (commandName === 'ping') {
    const sent = await interaction.reply({ content: '🏓 Ping...', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    return interaction.editReply(`🏓 **Pong!**\n⚡ Độ trễ Bot: \`${latency}ms\`\n🌐 WebSocket: \`${client.ws.ping}ms\``);
  }

  // Lệnh /reset
  if (commandName === 'reset') {
    userSessions.delete(user.id);
    return interaction.reply('🔄 Đã xóa bộ nhớ lịch sử trò chuyện của bạn! Chúng ta có thể bắt đầu chủ đề mới.');
  }

  // Lệnh /setchannel
  if (commandName === 'setchannel') {
    allowedChannels.set(guildId, channelId);
    return interaction.reply(`✅ Đã thiết lập <#${channelId}> làm kênh trò chuyện duy nhất cho Nexus AI!`);
  }
});

// ==========================================
// 5. XỬ LÝ TRÒ CHUYỆN AI TỰ ĐỘNG
// ==========================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const guildId = message.guildId;
  const userId = message.author.id;

  const targetChannel = allowedChannels.get(guildId);
  const isMentioned = message.mentions.has(client.user);

  // Lọc kênh và tag
  if (targetChannel && message.channel.id !== targetChannel) return;
  if (!targetChannel && !isMentioned) return;

  const prompt = content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) return message.reply('Bạn cần Nexus AI hỗ trợ gì nào?');

  await message.channel.sendTyping();

  try {
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
    message.reply('❌ Rất tiếc, có lỗi xảy ra. Hãy thử dùng lệnh `/reset` trên menu xem sao nhé.');
  }
});

// ==========================================
// 6. ĐĂNG NHẬP BOT
// ==========================================
client.login(process.env.DISCORD_TOKEN);
