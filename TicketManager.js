// TicketManager.js
// Quản lý Ticket channels (đơn giản): lưu tickets, tạo kênh ticket, lưu API key riêng cho ticket
const fs = require('fs').promises;
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');

const TICKETS_FILE = path.join(__dirname, 'data', 'tickets.json');

let tickets = new Map(); // key: channelId, value: { channelId, userApiKey?, selectedModel? }

async function ensureDataDir() {
  const dir = path.dirname(TICKETS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error('TicketManager: Lỗi khi tạo thư mục data:', err);
  }
}

async function loadTickets() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(TICKETS_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!content) {
      tickets = new Map();
      console.log('TicketManager: Không tìm thấy file tickets, khởi tạo mới.');
      return;
    }
    const obj = JSON.parse(content || '{}');
    tickets = new Map(Object.entries(obj));
    // normalize values (they might be saved as objects)
    for (const [k, v] of tickets.entries()) {
      try {
        const parsed = typeof v === 'string' ? JSON.parse(v) : v;
        tickets.set(k, parsed || { channelId: k });
      } catch {
        tickets.set(k, v || { channelId: k });
      }
    }
    console.log(`TicketManager: Loaded ${tickets.size} tickets.`);
  } catch (err) {
    console.error('TicketManager: Lỗi loadTickets:', err);
    tickets = new Map();
  }
}

async function saveTickets() {
  try {
    await ensureDataDir();
    const obj = Object.fromEntries(tickets);
    await fs.writeFile(TICKETS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('TicketManager: Lỗi saveTickets:', err);
  }
}

async function syncTicketsOnStartup(client) {
  // Optional: ensure that stored channelIds still exist
  try {
    if (!client) return;
    for (const [channelId, info] of tickets.entries()) {
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch) {
          console.log(`TicketManager: Channel ${channelId} không tồn tại nữa, xoá ticket local.`);
          tickets.delete(channelId);
        }
      } catch (err) {
        // ignore per-channel errors
      }
    }
    await saveTickets();
  } catch (err) {
    console.error('TicketManager: syncTicketsOnStartup error:', err);
  }
}

function getTicketByChannel(channelId) {
  return tickets.get(String(channelId)) || null;
}

async function setTicketApiKey(channelId, apiKey) {
  try {
    const key = String(channelId);
    const existing = tickets.get(key) || { channelId: key, userApiKey: null, selectedModel: null };
    existing.userApiKey = apiKey;
    tickets.set(key, existing);
    await saveTickets();
    return true;
  } catch (err) {
    console.error('TicketManager: setTicketApiKey error:', err);
    return false;
  }
}

async function handleSetupTicketCommand(interaction) {
  try {
    // create an embed + button and send to the channel the command was invoked in
    const category = interaction.options?.getChannel('category') || null;
    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket AI')
      .setDescription('Nhấn nút dưới đây để tạo một kênh Ticket Chat AI. Mỗi kênh Ticket có thể cài API Key riêng bằng tin nhắn `key: <YOUR_KEY>`.')
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_ticket').setLabel('Tạo Ticket').setStyle(ButtonStyle.Primary)
    );

    const target = interaction.channel;
    await target.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Đã gửi embed thiết lập Ticket vào kênh này.', ephemeral: true });
  } catch (err) {
    console.error('TicketManager: handleSetupTicketCommand error:', err);
    try { return interaction.reply({ content: '❌ Không thể gửi embed Ticket.', ephemeral: true }); } catch (e) {}
  }
}

async function handleTicketInteraction(interaction) {
  try {
    // Handle button clicks for opening tickets
    if (interaction.isButton() && interaction.customId === 'open_ticket') {
      if (!interaction.guild) {
        await interaction.reply({ content: '❌ Chỉ có thể tạo Ticket trong server.', ephemeral: true });
        return true;
      }
      const guild = interaction.guild;
      const member = interaction.member;
      const baseName = `ticket-${member.user.username}`.toLowerCase().replace(/[^a-z0-9\-]/g, '-').slice(0, 80);
      // ensure unique name by adding suffix if exists
      let finalName = baseName;
      let count = 1;
      while (guild.channels.cache.find((c) => c.name === finalName)) {
        finalName = `${baseName}-${count++}`;
      }

      // Determine the parent category for the new ticket channel
      // Priority: category named 'CHAT ROOM AI' (case-insensitive), then the parent of the interaction channel, else undefined
      let parentId = undefined;
      try {
        const category = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name && c.name.toLowerCase() === 'chat room ai'
        );
        if (category) parentId = category.id;
        else if (interaction.channel && interaction.channel.parent && interaction.channel.parent.id) parentId = interaction.channel.parent.id;
      } catch (e) {
        parentId = undefined;
      }

      const created = await guild.channels.create({
        name: finalName,
        type: ChannelType.GuildText,
        parent: parentId,
        permissionOverwrites: [
          {
            id: guild.roles.everyone,
            deny: ['ViewChannel'],
          },
          {
            id: member.user.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
          },
        ],
      }).catch((e) => {
        console.error('TicketManager: tạo kênh ticket lỗi:', e);
        return null;
      });

      if (!created) {
        await interaction.reply({ content: '❌ Không thể tạo kênh Ticket. Kiểm tra quyền của bot.', ephemeral: true });
        return true;
      }

      // save ticket info
      tickets.set(String(created.id), { channelId: String(created.id), userApiKey: null, selectedModel: 'gemini-3.6-flash' });
      await saveTickets();

      // Build components: Select menu for model selection + Close Ticket button
      const select = new StringSelectMenuBuilder()
        .setCustomId('select_model')
        .setPlaceholder('Chọn model AI...')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('gemini-3.6-flash (Tốc độ & Mới nhất - Mặc định)')
            .setDescription('Tốc độ & Mới nhất - Mặc định')
            .setValue('gemini-3.6-flash'),
          new StringSelectMenuOptionBuilder()
            .setLabel('gemini-3.5-flash (Hiệu suất cao)')
            .setDescription('Hiệu suất cao')
            .setValue('gemini-3.5-flash'),
          new StringSelectMenuOptionBuilder()
            .setLabel('gemini-3.1-pro (Tư duy & Lập trình)')
            .setDescription('Tư duy & Lập trình')
            .setValue('gemini-3.1-pro')
        )
        .setMinValues(1)
        .setMaxValues(1)
        .setDefaultValue(['gemini-3.6-flash']);

      const row1 = new ActionRowBuilder().addComponents(select);
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setStyle(ButtonStyle.Secondary)
      );

      await created.send({
        content: `👋 Xin chào ${member.user}. Đây là kênh Ticket của bạn. Nếu kênh yêu cầu API Key để chat với Gemini riêng, hãy nhắn \`key: <GEMINI_API_KEY_CỦA_BẠN>\` tại đây.`,
        components: [row1, row2],
      }).catch(() => {});

      await interaction.reply({ content: `✅ Đã tạo kênh Ticket: <#${created.id}>`, ephemeral: true }).catch(() => {});
      return true;
    }

    // Handle other ticket-specific interactions in future
    return false;
  } catch (err) {
    console.error('TicketManager: handleTicketInteraction error:', err);
    return false;
  }
}

module.exports = {
  loadTickets,
  syncTicketsOnStartup,
  handleSetupTicketCommand,
  handleTicketInteraction,
  getTicketByChannel,
  setTicketApiKey,
};
