// TicketManager.js
// Module quản lý hệ thống Ticket (chat riêng với AI / hỗ trợ) cho Nexus AI Discord Bot.
// Phong cách thiết kế đồng bộ với ClearManager.js / Interest.js: persistence ra JSON,
// export các hàm xử lý riêng biệt để index.js chỉ cần gọi, không cần biết chi tiết bên trong.

const fs = require('fs').promises;
const path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

// ==========================================
// CẤU HÌNH & HẰNG SỐ
// ==========================================
const TICKETS_FILE =
  process.env.TICKETS_FILE || path.join(__dirname, 'data', 'tickets.json');

// (Tuỳ chọn) ID category muốn nhóm các kênh ticket vào — để trống nếu không dùng.
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || null;

// (Tuỳ chọn) ID role hỗ trợ/admin muốn CHẮC CHẮN nhìn thấy ticket, ngoài quyền Administrator
// (user có quyền Administrator trong server MẶC ĐỊNH đã bypass mọi permission overwrite của
// kênh, nên không bắt buộc phải khai báo thêm role này).
const TICKET_SUPPORT_ROLE_ID = process.env.TICKET_SUPPORT_ROLE_ID || null;

const CLOSE_COUNTDOWN_SECONDS = 5;

// Custom ID của 2 nút bấm — dùng string cố định để bot vẫn nhận diện được nút
// ngay cả sau khi bot restart (Discord lưu nút trong tin nhắn cũ, không mất khi bot tắt/bật lại).
const BUTTON_ID_CREATE_TICKET = 'ticket_create_ai';
const BUTTON_ID_CLOSE_TICKET = 'ticket_close';

// ==========================================
// TRẠNG THÁI TRONG BỘ NHỚ (đồng bộ 2 chiều với file JSON)
// ==========================================
// ticketsByChannel: channelId -> { userId, guildId, createdAt }
const ticketsByChannel = new Map();
// ticketsByUser: userId -> channelId  (để kiểm tra nhanh "user này đã có ticket mở chưa")
const ticketsByUser = new Map();

// ==========================================
// PERSISTENCE
// ==========================================
async function ensureDataDir() {
  const dir = path.dirname(TICKETS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error('❌ Lỗi khi tạo thư mục data (TicketManager):', err);
  }
}

async function saveTicketsToFile() {
  try {
    await ensureDataDir();
    const arr = [...ticketsByChannel.entries()].map(([channelId, data]) => ({
      channelId,
      ...data,
    }));
    await fs.writeFile(TICKETS_FILE, JSON.stringify(arr, null, 2), 'utf8');
    console.log(`💾 Saved tickets to ${TICKETS_FILE} (${arr.length} ticket)`);
  } catch (err) {
    console.error('❌ Error saving tickets:', err);
  }
}

let saveTimeout = null;
function scheduleSave(delay = 200) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTicketsToFile().catch((err) => console.error('❌ Lỗi scheduleSave (TicketManager):', err));
    saveTimeout = null;
  }, delay);
}

/**
 * Load danh sách ticket đang mở từ file khi bot khởi động.
 * Gọi hàm này TRƯỚC client.login() trong index.js.
 */
async function loadTickets() {
  try {
    const content = await fs.readFile(TICKETS_FILE, 'utf8');
    const arr = JSON.parse(content);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!item?.channelId || !item?.userId) continue;
        const { channelId, userId, guildId, createdAt } = item;
        ticketsByChannel.set(channelId, { userId, guildId, createdAt });
        ticketsByUser.set(userId, channelId);
      }
    }
    console.log(`📂 Loaded tickets from ${TICKETS_FILE} (${ticketsByChannel.size} ticket đang mở)`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('📂 Không tìm thấy file tickets, bắt đầu với danh sách trống.');
    } else {
      console.error('❌ Error loading tickets:', err);
    }
  }
}

/**
 * Đồng bộ lại danh sách ticket với thực tế trên Discord khi bot khởi động
 * (ví dụ: channel đã bị admin xoá thủ công lúc bot offline).
 * Gọi hàm này SAU khi client 'ready'.
 * @param {import('discord.js').Client} client
 */
async function syncTicketsOnStartup(client) {
  for (const [channelId, data] of [...ticketsByChannel.entries()]) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        ticketsByChannel.delete(channelId);
        ticketsByUser.delete(data.userId);
        scheduleSave();
        console.log(`🧹 Ticket kênh ${channelId} không còn tồn tại -> đã dọn khỏi danh sách.`);
      }
    } catch (err) {
      console.error(`❌ Lỗi khi sync ticket kênh ${channelId}:`, err);
    }
  }
}

// ==========================================
// TRUY VẤN TRẠNG THÁI TICKET
// ==========================================
function hasOpenTicket(userId) {
  return ticketsByUser.has(userId);
}

function getTicketChannelId(userId) {
  return ticketsByUser.get(userId) || null;
}

function getTicketByChannel(channelId) {
  return ticketsByChannel.get(channelId) || null;
}

function registerTicket(channelId, userId, guildId) {
  const data = { userId, guildId, createdAt: Date.now() };
  ticketsByChannel.set(channelId, data);
  ticketsByUser.set(userId, channelId);
  scheduleSave();
}

function removeTicket(channelId) {
  const data = ticketsByChannel.get(channelId);
  if (!data) return false;
  ticketsByChannel.delete(channelId);
  ticketsByUser.delete(data.userId);
  scheduleSave();
  return true;
}

// ==========================================
// HÀM TIỆN ÍCH: TẠO TÊN KÊNH HỢP LỆ
// ==========================================
/**
 * Discord yêu cầu tên kênh: chữ thường, không dấu cách/ký tự đặc biệt (dùng dấu gạch ngang),
 * tối đa 100 ký tự. Hàm này chuẩn hoá username của user thành tên kênh hợp lệ.
 */
function buildTicketChannelName(username) {
  const normalized = username
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ dấu tiếng Việt
    .replace(/[^a-z0-9]+/g, '-') // ký tự lạ -> gạch ngang
    .replace(/^-+|-+$/g, '') // bỏ gạch ngang thừa ở đầu/cuối
    .slice(0, 80);
  return `ticket-${normalized || 'user'}`;
}

// ==========================================
// 1. LỆNH /setup_ticketai — GỬI EMBED + NÚT TẠO TICKET
// ==========================================
/**
 * Xử lý slash command setup_ticketai: gửi embed + nút "Tạo Ticket Chat AI" vào kênh hiện tại.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSetupTicketCommand(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Hỗ trợ & Chat riêng với Nexus AI')
    .setDescription(
      'Bấm nút bên dưới để mở một kênh **riêng tư** chỉ bạn và đội ngũ hỗ trợ nhìn thấy.\n' +
        'Ở đó bạn có thể chat thoải mái với Nexus AI hoặc chờ hỗ trợ từ admin.'
    )
    .setFooter({ text: 'Nexus AI Support System' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_ID_CREATE_TICKET)
      .setLabel('Tạo Ticket Chat AI')
      .setEmoji('📩')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({ embeds: [embed], components: [row] });
}

// ==========================================
// 2. XỬ LÝ BẤM NÚT "TẠO TICKET"
// ==========================================
/**
 * Xử lý khi user bấm nút "📩 Tạo Ticket Chat AI".
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleCreateTicketButton(interaction) {
  const { guild, user } = interaction;

  if (!guild) {
    return interaction.reply({
      content: '❌ Tính năng ticket chỉ dùng được trong server.',
      ephemeral: true,
    });
  }

  // Chặn user tạo nhiều ticket cùng lúc.
  const existingChannelId = getTicketChannelId(user.id);
  if (existingChannelId) {
    const existingChannel = await guild.channels.fetch(existingChannelId).catch(() => null);
    if (existingChannel) {
      return interaction.reply({
        content: `⚠️ Bạn đang có 1 ticket mở rồi: <#${existingChannelId}>`,
        ephemeral: true,
      });
    }
    // Channel đã bị xoá thủ công nhưng data cũ chưa dọn -> dọn luôn rồi cho tạo mới.
    removeTicket(existingChannelId);
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const permissionOverwrites = [
      {
        // @everyone -> KHÔNG được xem kênh.
        // Lưu ý: user có quyền Administrator trong server sẽ TỰ ĐỘNG bypass overwrite này
        // (đây là hành vi mặc định của Discord), nên Admin luôn nhìn thấy ticket dù không
        // được khai báo riêng ở đây.
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      {
        // Chủ ticket -> được xem + chat.
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        // Bot -> cần quyền để gửi tin nhắn + xoá kênh lúc đóng ticket.
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ];

    // (Tuỳ chọn) thêm role hỗ trợ riêng nếu có cấu hình TICKET_SUPPORT_ROLE_ID.
    if (TICKET_SUPPORT_ROLE_ID) {
      permissionOverwrites.push({
        id: TICKET_SUPPORT_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const channelOptions = {
      name: buildTicketChannelName(user.username),
      type: ChannelType.GuildText,
      permissionOverwrites,
    };
    if (TICKET_CATEGORY_ID) {
      channelOptions.parent = TICKET_CATEGORY_ID;
    }

    const ticketChannel = await guild.channels.create(channelOptions);

    registerTicket(ticketChannel.id, user.id, guild.id);

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('👋 Chào mừng tới kênh Ticket của bạn!')
      .setDescription(
        `Xin chào <@${user.id}>! Đây là kênh riêng tư của bạn.\n` +
          'Nhắn tin thoải mái để chat với Nexus AI hoặc chờ đội ngũ hỗ trợ phản hồi.\n\n' +
          'Bấm nút bên dưới khi bạn muốn đóng ticket này.'
      )
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_ID_CLOSE_TICKET)
        .setLabel('Đóng Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `<@${user.id}>`,
      embeds: [welcomeEmbed],
      components: [closeRow],
    });

    await interaction.editReply({
      content: `✅ Ticket của bạn đã được tạo: <#${ticketChannel.id}>`,
    });
  } catch (err) {
    console.error('❌ Lỗi khi tạo ticket:', err);
    await interaction.editReply({
      content:
        '❌ Không thể tạo ticket lúc này. Kiểm tra xem bot có quyền "Manage Channels" trong server không.',
    });
  }
}

// ==========================================
// 3. XỬ LÝ BẤM NÚT "ĐÓNG TICKET"
// ==========================================
/**
 * Xử lý khi user/admin bấm nút "🔒 Đóng Ticket". Đếm ngược 5s rồi xoá kênh.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleCloseTicketButton(interaction) {
  const channel = interaction.channel;
  const ticketData = getTicketByChannel(channel.id);

  if (!ticketData) {
    return interaction.reply({
      content: '⚠️ Kênh này không được ghi nhận là ticket đang mở (có thể dữ liệu đã bị lệch).',
      ephemeral: true,
    });
  }

  // Vô hiệu hoá nút để tránh bị bấm nhiều lần trong lúc đếm ngược.
  try {
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_ID_CLOSE_TICKET)
        .setLabel('Đang đóng...')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );
    await interaction.update({ components: [disabledRow] });
  } catch (err) {
    console.error('❌ Lỗi khi vô hiệu hoá nút đóng ticket:', err);
  }

  await channel.send(
    `🔒 Ticket sẽ được đóng và xoá sau **${CLOSE_COUNTDOWN_SECONDS} giây**...`
  );

  setTimeout(async () => {
    try {
      removeTicket(channel.id);
      await channel.delete('Ticket được đóng bởi user/admin.');
    } catch (err) {
      console.error(`❌ Lỗi khi xoá kênh ticket ${channel.id}:`, err);
    }
  }, CLOSE_COUNTDOWN_SECONDS * 1000);
}

// ==========================================
// 4. ROUTER CHUNG CHO MỌI BUTTON INTERACTION LIÊN QUAN TICKET
// ==========================================
/**
 * Gọi hàm này trong client.on('interactionCreate', ...) TRƯỚC khi xử lý slash command,
 * để bắt các nút bấm liên quan tới ticket. Trả về true nếu đã xử lý (để index.js return sớm).
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>}
 */
async function handleTicketButtonInteraction(interaction) {
  if (!interaction.isButton()) return false;

  if (interaction.customId === BUTTON_ID_CREATE_TICKET) {
    await handleCreateTicketButton(interaction);
    return true;
  }

  if (interaction.customId === BUTTON_ID_CLOSE_TICKET) {
    await handleCloseTicketButton(interaction);
    return true;
  }

  return false; // không phải nút của module này -> để index.js xử lý tiếp nếu có nút khác
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  loadTickets,
  syncTicketsOnStartup,
  handleSetupTicketCommand,
  handleTicketButtonInteraction,
  hasOpenTicket,
  getTicketChannelId,
  BUTTON_ID_CREATE_TICKET,
  BUTTON_ID_CLOSE_TICKET,
};

/*
==========================================================================
HƯỚNG DẪN TÍCH HỢP VÀO index.js
==========================================================================

1) Import module ở đầu file index.js:

   const {
     loadTickets,
     syncTicketsOnStartup,
     handleSetupTicketCommand,
     handleTicketButtonInteraction,
   } = require('./TicketManager.js');

2) Thêm slash command mới vào mảng `commands`:

   LƯU Ý: Discord bắt buộc tên slash command phải viết THƯỜNG (không được có chữ hoa),
   nên "setup_ticketAI" không hợp lệ -> đã đổi thành "setup_ticketai".

   new SlashCommandBuilder()
     .setName('setup_ticketai')
     .setDescription('Gửi embed + nút tạo Ticket Chat AI vào kênh này (chỉ Admin)')
     .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

3) Trong client.on('interactionCreate', async (interaction) => { ... }), CHÈN đoạn sau
   NGAY ĐẦU HÀM, trước dòng `if (!interaction.isChatInputCommand()) return;`:

   // Ưu tiên xử lý các nút bấm liên quan tới ticket trước.
   const handledByTicket = await handleTicketButtonInteraction(interaction);
   if (handledByTicket) return;

4) Vẫn trong client.on('interactionCreate', ...), thêm nhánh xử lý slash command mới
   (đặt cùng chỗ với /clear, /clear24h...):

   if (commandName === 'setup_ticketai') {
     return handleSetupTicketCommand(interaction);
   }

5) Trong hàm khởi tạo IIFE cuối file, thêm bước load + sync ticket:

   (async () => {
     try {
       await loadAllowedChannelsFromFile();
       await loadAutoClearChannels();
       await loadTickets();               // <-- thêm dòng này
       await client.login(DISCORD_TOKEN);
       console.log('🔐 Đã gọi client.login()');
     } catch (err) {
       console.error('❌ Lỗi khi khởi động bot:', err);
       process.exit(1);
     }
   })();

6) Trong client.once('ready', async () => { ... }), sau khi đăng ký slash command xong,
   thêm bước đồng bộ ticket với thực tế trên Discord:

   startAutoClearScheduler(client);
   await syncTicketsOnStartup(client);   // <-- thêm dòng này

7) (Tuỳ chọn) Nếu muốn nhóm các kênh ticket vào 1 category, hoặc thêm role hỗ trợ riêng
   ngoài quyền Administrator, set biến môi trường trên Render:

   TICKET_CATEGORY_ID=id_category_muon_dung
   TICKET_SUPPORT_ROLE_ID=id_role_ho_tro

   Không set thì bot vẫn hoạt động bình thường — kênh ticket sẽ được tạo ở ngoài category,
   và chỉ chủ ticket + user có quyền Administrator nhìn thấy được.

LƯU Ý QUAN TRỌNG:
- Bot CẦN quyền "Manage Channels" trong server để tạo/xoá được kênh ticket.
- Nút bấm dùng customId cố định ('ticket_create_ai', 'ticket_close') nên vẫn hoạt động
  bình thường ngay cả sau khi bot restart/redeploy — không cần gửi lại embed setup.
==========================================================================
*/
