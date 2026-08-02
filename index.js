require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenAI } = require('@google/genai');
const express = require('express');

// 1. Tạo Web Server nhỏ để Render kiểm tra health-check
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Nexus AI Bot is running 24/7!');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server đang chạy tại port ${PORT}`);
});

// 2. Cấu hình Gemini & Discord Bot
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`🤖 Bot ${client.user.tag} đã online!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.mentions.has(client.user)) return;

  const prompt = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!prompt) return message.reply('Bạn cần hỏi gì nào?');

  await message.channel.sendTyping();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: "Bạn là Nexus AI, một trợ lý Discord thân thiện và thông minh.",
      }
    });

    const replyText = response.text;
    if (replyText.length > 2000) {
      const chunks = replyText.match(/[\s\S]{1,1900}/g);
      for (const chunk of chunks) await message.reply(chunk);
    } else {
      await message.reply(replyText);
    }
  } catch (error) {
    console.error(error);
    message.reply('❌ Có lỗi xảy ra khi kết nối Gemini API.');
  }
});

client.login(process.env.DISCORD_TOKEN);
