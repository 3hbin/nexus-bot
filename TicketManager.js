// TicketManager.js
// Quản lý Ticket channels: lưu tickets, tạo kênh ticket đúng danh mục, xử lý chọn model & đóng ticket.
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
  try {
    if (!client) return;
    for (const [channelId] of tickets.entries()) {
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch) {
          console.log(`TicketManager: Channel ${channelId} không tồn tại nữa, xoá ticket local.`);
          tickets.delete(channelId);
        }
      } catch (err) {}
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
    const category = interaction.options?.getChannel('category') || null;
    const customId = category ? `open_ticket_${category.id}` : 'open_ticket';

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket Chat AI')
      .setDescription(
        'Nhấn nút **Tạo Ticket** bên dưới để mở kênh trò chuyện AI riêng biệt.\n' +
        '• Trong kênh ticket, bạn có thể chọn Model Gemini mong muốn.\n' +
        '• Nếu server yêu cầu Key riêng, hãy nhắn `key: <GEMINI_API_KEY_CỦA_BẠN>` vào kênh đó.'
      )
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel('Tạo Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫')
    );

    const target = interaction.channel;
    await target.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Đã gửi embed thiết lập Ticket vào kênh này.', ephemeral: true });
  } catch (err) {
    console.error('TicketManager: handleSetupTicketCommand error:', err);
    try {
      return interaction.reply({ content: '❌ Không thể gửi embed Ticket.', ephemeral: true });
    } catch (e) {}
  }
}

async function handleTicketInteraction(interaction) {
  try {
    // 1. XỬ LÝ NÚT BẤM "TẠO TICKET"
    if (interaction.isButton() && interaction.customId.startsWith('open_ticket')) {
      if (!interaction.guild) {
        await interaction.reply({ content: '❌ Chỉ có thể tạo Ticket trong server.', ephemeral: true });
        return true;
      }

      const guild = interaction.guild;
      const member = interaction.member;

      // Xác định Parent Category (Danh mục chứa kênh Ticket mới)
      let parentId = undefined;

      // Ưu tiên 1: Lấy category ID đính kèm từ CustomID (ví dụ: open_ticket_123456789)
      if (interaction.customId.startsWith('open_ticket_')) {
        parentId = interaction.customId.replace('open_ticket_', '');
      }

      // Ưu tiên 2: Tìm category có tên chứa "CHAT ROOM AI" trong server (không phân biệt hoa/thường)
      if (!parentId) {
        const aiCategory = guild.channels.cache.find(
          (c) =>
            c.type === ChannelType.GuildCategory &&
            c.name.toLowerCase().includes('chat room ai')
        );
        if (aiCategory) {
          parentId = aiCategory.id;
        }
      }

      // Ưu tiên 3: Lấy chính category của kênh hiện tại nơi đặt nút bấm
      if (!parentId && interaction.channel && interaction.channel.parentId) {
        parentId = interaction.channel.parentId;
      }

      // Đặt tên kênh ticket theo username
      const cleanUsername = member.user.username.toLowerCase().replace(/[^a-z0-9\-]/g, '');
      const baseName = `ticket-${cleanUsername}`.slice(0, 80) || 'ticket-ai';
      let finalName = baseName;
      let count = 1;
      while (guild.channels.cache.find((c) => c.name === finalName)) {
        finalName = `${baseName}-${count++}`;
      }

      // Tạo kênh Ticket
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
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'],
          },
        ],
      }).catch((e) => {
        console.error('TicketManager: Lỗi khi tạo kênh ticket:', e);
        return null;
      });

      if (!created) {
        await interaction.reply({
          content: '❌ Không thể tạo kênh Ticket. Hãy kiểm tra lại quyền tạo kênh của Bot.',
          ephemeral: true,
        });
        return true;
      }

      // Lưu thông tin ticket
      tickets.set(String(created.id), {
        channelId: String(created.id),
        userApiKey: null,
        selectedModel: 'gemini-3.6-flash',
      });
      await saveTickets();

      // Tạo Menu chọn Model AI
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_model')
        .setPlaceholder('Chọn Model Gemini để trò chuyện...')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.6 Flash (Mặc định)')
            .setDescription('Tốc độ & Mới nhất 2026')
            .setValue('gemini-3.6-flash')
            .setDefault(true),
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.5 Flash')
            .setDescription('Hiệu suất cao & Đa phương thức')
            .setValue('gemini-3.5-flash'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.1 Pro')
            .setDescription('Tư duy cao cấp & Lập trình chuyên sâu')
            .setValue('gemini-3.1-pro')
        );

      const row1 = new ActionRowBuilder().addComponents(selectMenu);
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('close_ticket')
          .setLabel('Đóng Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒')
      );

      // Gửi giao diện điều khiển vào kênh Ticket mới tạo
      await created.send({
        content: `👋 Xin chào ${member}! Kênh trò chuyện riêng của bạn đã sẵn sàng.\n\n` +
                 `• **Model hiện tại**: \`gemini-3.6-flash\`\n` +
                 `• Bạn có thể đổi Model bên dưới hoặc nhập API Key bằng cú pháp \`key: <API_KEY>\`.`,
        components: [row1, row2],
      }).catch(() => {});

      await interaction.reply({
        content: `✅ Đã tạo kênh Ticket thành công tại: <#${created.id}>`,
        ephemeral: true,
      }).catch(() => {});

      return true;
    }

    // 2. XỬ LÝ ĐỔI MODEL TRONG SELECT MENU
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_model') {
      const selectedModel = interaction.values[0];
      const ticketInfo = getTicketByChannel(interaction.channelId);

      if (!ticketInfo) {
        await interaction.reply({ content: '❌ Kênh này không phải là Ticket hợp lệ.', ephemeral: true });
        return true;
      }

      ticketInfo.selectedModel = selectedModel;
      tickets.set(String(interaction.channelId), ticketInfo);
      await saveTickets();

      await interaction.reply({
        content: `🤖 Đã chuyển Model AI sang **\`${selectedModel}\`** cho kênh này!`,
      });
      return true;
    }

    // 3. XỬ LÝ NÚT "ĐÓNG TICKET"
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      await interaction.reply('🔒 Kênh này sẽ tự động xóa sau 3 giây...');
      tickets.delete(String(interaction.channelId));
      await saveTickets();

      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (err) {
          console.error('TicketManager: Lỗi khi xóa kênh ticket:', err);
        }
      }, 3000);
      return true;
    }

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
