// TicketManager.js
// Quản lý hệ thống Ticket Chat AI riêng biệt cho server Discord
const fs = require('fs').promises;
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const TICKETS_FILE = path.join(__dirname, 'data', 'tickets.json');
const activeTickets = new Map(); // channelId -> ticketData

async function ensureDataDir() {
  const dir = path.dirname(TICKETS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {}
}

async function loadTickets() {
  try {
    const data = await fs.readFile(TICKETS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    for (const [chId, info] of Object.entries(parsed || {})) {
      activeTickets.set(chId, info);
    }
    console.log(`📂 Loaded ${activeTickets.size} tickets from storage.`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('❌ Lỗi đọc file tickets.json:', err);
    }
  }
}

async function saveTickets() {
  try {
    await ensureDataDir();
    const obj = Object.fromEntries(activeTickets);
    await fs.writeFile(TICKETS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Lỗi ghi file tickets.json:', err);
  }
}

async function syncTicketsOnStartup(client) {
  for (const [channelId, data] of activeTickets.entries()) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        activeTickets.delete(channelId);
      }
    } catch (e) {
      activeTickets.delete(channelId);
    }
  }
  await saveTickets();
}

function getTicketByChannel(channelId) {
  return activeTickets.get(channelId) || null;
}

function setTicketApiKey(channelId, apiKey) {
  const ticket = activeTickets.get(channelId);
  if (ticket) {
    ticket.userApiKey = apiKey;
    activeTickets.set(channelId, ticket);
    saveTickets();
  }
}

async function handleSetupTicketCommand(interaction) {
  const category = interaction.options.getChannel('category');

  const embed = new EmbedBuilder()
    .setTitle('🤖 Dịch Vụ Chat AI Trực Tiếp (Nexus Ticket)')
    .setDescription(
      'Bấm nút bên dưới để mở một kênh Chat riêng tư với AI!\n\n' +
      '• Trò chuyện bảo mật riêng tư 1-1 với Bot.\n' +
      '• Hỗ trợ cấu hình API Key Gemini cá nhân.\n' +
      '• Tùy chọn chuyển đổi linh hoạt các phiên bản Model AI.'
    )
    .setColor('#5865F2')
    .setFooter({ text: 'Nexus AI Ticket System' });

  const btn = new ButtonBuilder()
    .setCustomId(`create_ticket_${category ? category.id : 'none'}`)
    .setLabel('📩 Tạo Kênh Chat AI')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(btn);

  await interaction.reply({
    content: '✅ Đã tạo bảng Ticket AI trong kênh!',
    ephemeral: true,
  });

  await interaction.channel.send({ embeds: [embed], components: [row] });
}

async function handleTicketInteraction(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('create_ticket_')) {
      await interaction.deferReply({ ephemeral: true });

      const categoryId = interaction.customId.replace('create_ticket_', '');
      const guild = interaction.guild;
      const user = interaction.user;

      const channelName = `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

      try {
        const channelOptions = {
          name: channelName,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: guild.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
            {
              id: interaction.client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels,
              ],
            },
          ],
        };

        if (categoryId !== 'none') {
          channelOptions.parent = categoryId;
        }

        const ticketChannel = await guild.channels.create(channelOptions);

        const ticketInfo = {
          channelId: ticketChannel.id,
          userId: user.id,
          createdAt: Date.now(),
          userApiKey: null,
          selectedModel: 'gemini-2.5-flash',
        };

        activeTickets.set(ticketChannel.id, ticketInfo);
        await saveTickets();

        const embed = new EmbedBuilder()
          .setTitle(`🎉 Chào mừng ${user.username} đến với Kênh AI Ticket!`)
          .setDescription(
            '🔑 **Bước 1:** Nhập API Key Gemini của bạn bằng cú pháp:\n`key: <GEMINI_API_KEY_CỦA_BẠN>`\n*(Tin nhắn chứa key sẽ tự xóa để bảo mật)*\n\n' +
            '⚙️ **Bước 2:** Bạn có thể chọn Model AI bằng menu phía dưới.'
          )
          .setColor('#57F287');

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('select_ticket_model')
          .setPlaceholder('Chọn phiên bản Gemini Model...')
          .addOptions([
            { label: 'Gemini 2.5 Flash (Nhanh & Mặc định)', value: 'gemini-2.5-flash' },
            { label: 'Gemini 2.5 Pro (Thông minh cao cấp)', value: 'gemini-2.5-pro' },
            { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
          ]);

        const closeBtn = new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('🔒 Đóng Ticket')
          .setStyle(ButtonStyle.Danger);

        const rowMenu = new ActionRowBuilder().addComponents(selectMenu);
        const rowClose = new ActionRowBuilder().addComponents(closeBtn);

        await ticketChannel.send({
          content: `<@${user.id}>`,
          embeds: [embed],
          components: [rowMenu, rowClose],
        });

        await interaction.editReply(`✅ Đã tạo kênh Ticket riêng cho bạn: <#${ticketChannel.id}>`);
      } catch (err) {
        console.error('❌ Lỗi khi tạo ticket channel:', err);
        await interaction.editReply('❌ Không thể tạo kênh Ticket. Hãy kiểm tra lại quyền Bot!');
      }
      return true;
    }

    if (interaction.customId === 'close_ticket') {
      const ticket = activeTickets.get(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: '❌ Kênh này không phải Ticket AI hợp lệ.', ephemeral: true });
        return true;
      }

      await interaction.reply('🔒 Kênh Ticket sẽ tự động xoá sau 5 giây...');
      activeTickets.delete(interaction.channelId);
      await saveTickets();

      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (e) {
          console.error('❌ Lỗi xoá kênh Ticket:', e);
        }
      }, 5000);
      return true;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_ticket_model') {
      const ticket = activeTickets.get(interaction.channelId);
      if (!ticket) {
        await interaction.reply({ content: '❌ Ticket không tồn tại hoặc đã đóng.', ephemeral: true });
        return true;
      }

      const selected = interaction.values[0];
      ticket.selectedModel = selected;
      activeTickets.set(interaction.channelId, ticket);
      await saveTickets();

      await interaction.reply({
        content: `✅ Đã chuyển đổi model sang: **${selected}**`,
        ephemeral: true,
      });
      return true;
    }
  }

  return false;
}

module.exports = {
  loadTickets,
  saveTickets,
  syncTicketsOnStartup,
  getTicketByChannel,
  setTicketApiKey,
  handleSetupTicketCommand,
  handleTicketInteraction,
};
