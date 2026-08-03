// TicketManager.js
// Quản lý Ticket channels: lưu tickets, tạo kênh ticket đúng danh mục, xử lý chọn model, modal API key & đóng ticket.
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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
    // Do not log the API key for security
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
          '• Nếu server yêu cầu Key riêng, hãy nhắn `key: <GEMINI_API_KEY_CỦA_BẠN>` vào kênh đó hoặc dùng nút nhập Key.'
      )
      .setColor(0x5865f2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(customId).setLabel('Tạo Ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
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
        const aiCategory = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name && c.name.toLowerCase().includes('chat room ai'));
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

      // Tạo Menu chọn Model AI (chỉ danh sách model hiện tại, loại bỏ model cũ)
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_model')
        .setPlaceholder('Chọn Model Gemini để trò chuyện...')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Gemini 3.6 Flash (Mặc định)').setDescription('Tốc độ & Mới nhất').setValue('gemini-3.6-flash'),
          new StringSelectMenuOptionBuilder().setLabel('Gemini 3.5 Flash').setDescription('Hiệu suất cao').setValue('gemini-3.5-flash'),
          new StringSelectMenuOptionBuilder().setLabel('Gemini 2.5 Flash').setDescription('Phiên bản ổn định nhẹ').setValue('gemini-2.5-flash'),
          new StringSelectMenuOptionBuilder().setLabel('Gemini 3.1 Pro').setDescription('Tư duy & Lập trình').setValue('gemini-3.1-pro')
        );

      const row1 = new ActionRowBuilder().addComponents(selectMenu);
      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('input_api_key').setLabel('🔑 Nhập Key Gemini').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
      );

      // Build welcome embed with detailed guidance for obtaining API key
      const welcomeEmbed = new EmbedBuilder()
        .setTitle('👋 Xin chào! Đây là kênh Ticket của bạn')
        .setDescription(
          '• **Model mặc định**: `gemini-3.6-flash`\n' +
          '• Bạn có thể đổi Model bằng menu phía dưới.\n\n' +
          '**Hướng dẫn lấy Gemini API Key**:\n' +
          '1) Truy cập: https://aistudio.google.com\n' +
          '2) Chọn Project của bạn → Credentials → Create API key\n' +
          '3) Quay lại kênh này, nhấn **🔑 Nhập Key Gemini** và dán API Key vào modal, hoặc gửi `key: <API_KEY>`.'
        )
        .setColor(0x57f287);

      // Gửi giao diện điều khiển & embed vào kênh Ticket mới tạo
      await created.send({ embeds: [welcomeEmbed], components: [row1, row2] }).catch(() => {});

      await interaction.reply({ content: `✅ Đã tạo kênh Ticket thành công tại: <#${created.id}>`, ephemeral: true }).catch(() => {});
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

      await interaction.reply({ content: `🤖 Đã chuyển Model AI sang **\`${selectedModel}\`** cho kênh này!`, ephemeral: true });
      return true;
    }

    // 3. XỬ LÝ NÚT "NHẬP KEY" -> hiện modal
    if (interaction.isButton() && interaction.customId === 'input_api_key') {
      try {
        const modal = new ModalBuilder().setCustomId('modal_api_key').setTitle('Nhập Gemini API Key');
        const input = new TextInputBuilder()
          .setCustomId('text_api_key')
          .setLabel('Dán Gemini API Key vào đây')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('AIzaSy... hoặc AQ...')
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);

        await interaction.showModal(modal);

        // Additionally try to DM the user a clickable link with short guidance (best-effort)
        try {
          await interaction.user.send(
            'Hướng dẫn nhanh: Để lấy Gemini API Key, truy cập https://aistudio.google.com → Project của bạn → Credentials → Tạo API Key. Sau đó quay lại kênh Ticket và dán vào modal.'
          ).catch(() => {});
        } catch (e) {
          // ignore DM errors
        }
      } catch (e) {
        console.error('TicketManager: show modal error', e);
        try { await interaction.reply({ content: '❌ Không thể mở modal.', ephemeral: true }); } catch (e) {}
      }
      return true;
    }

    // 4. XỬ LÝ MODAL SUBMIT
    if (interaction.isModalSubmit() && interaction.customId === 'modal_api_key') {
      try {
        const channelId = interaction.channelId || (interaction.channel && interaction.channel.id);
        const apiKey = interaction.fields?.getTextInputValue('text_api_key') || null;
        if (!channelId) {
          await interaction.reply({ content: '❌ Không xác định được kênh để lưu Key.', ephemeral: true });
          return true;
        }
        if (!apiKey || apiKey.length < 10) {
          await interaction.reply({ content: '❌ Key không hợp lệ.', ephemeral: true });
          return true;
        }
        const ok = await setTicketApiKey(channelId, apiKey);
        if (ok) await interaction.reply({ content: '🔑 Đã lưu API Key cho kênh này (ẩn).', ephemeral: true });
        else await interaction.reply({ content: '❌ Không thể lưu API Key. Hãy thử lại sau.', ephemeral: true });
      } catch (e) {
        console.error('TicketManager: modal submit handler error', e);
        try { await interaction.reply({ content: '❌ Lỗi khi lưu API Key.', ephemeral: true }); } catch (e) {}
      }
      return true;
    }

    // 5. XỬ LÝ NÚT "ĐÓNG TICKET"
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      try {
        await interaction.reply({ content: '🔒 Kênh này sẽ được xóa và dữ liệu liên quan sẽ bị xoá hoàn toàn trong 3s...', ephemeral: true });
        // remove ticket data immediately
        tickets.delete(String(interaction.channelId));
        await saveTickets();
        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (err) {
            console.error('TicketManager: Lỗi khi xóa kênh ticket:', err);
          }
        }, 3000);
      } catch (e) {
        console.error('TicketManager: error closing ticket', e);
        try { await interaction.reply({ content: '❌ Không thể đóng kênh.', ephemeral: true }); } catch (e) {}
      }
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
