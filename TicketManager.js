// TicketManager.js
// Module quản lý Ticket Chat AI riêng tư
// Yêu cầu Key Gemini riêng từ user & Cho phép chọn Model AI trực tiếp

const fs = require('fs').promises;
const path = path = require('path');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const TICKETS_FILE = process.env.TICKETS_FILE || path.join(__dirname, 'data', 'tickets.json');
const CLOSE_COUNTDOWN_SECONDS = 5;

const BUTTON_PREFIX = 'ticket_create_ai_cat_';
const BUTTON_ID_CLOSE_TICKET = 'ticket_close';
const SELECT_ID_MODEL = 'ticket_select_model';

// Quản lý bộ nhớ ticket: channelId -> { userId, guildId, createdAt, userApiKey, selectedModel }
const ticketsByChannel = new Map();
const ticketsByUser = new Map();

async function ensureDataDir() {
  const dir = path.dirname(TICKETS_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {}
}

async function saveTicketsToFile() {
  try {
    await ensureDataDir();
    const arr = [...ticketsByChannel.entries()].map(([channelId, data]) => ({
      channelId,
      ...data,
    }));
    await fs.writeFile(TICKETS_FILE, JSON.stringify(arr, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Lỗi khi lưu file tickets.json:', err);
  }
}

let saveTimeout = null;
function scheduleSave(delay = 200) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTicketsToFile();
    saveTimeout = null;
  }, delay);
}

async function loadTickets() {
  try {
    const content = await fs.readFile(TICKETS_FILE, 'utf8');
    const arr = JSON.parse(content);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!item?.channelId || !item?.userId) continue;
        ticketsByChannel.set(item.channelId, {
          userId: item.userId,
          guildId: item.guildId,
          createdAt: item.createdAt,
          userApiKey: item.userApiKey || null,
          selectedModel: item.selectedModel || 'gemini-3.6-flash',
        });
        ticketsByUser.set(item.userId, item.channelId);
      }
    }
    console.log(`📂 Loaded tickets from ${TICKETS_FILE} (${ticketsByChannel.size} ticket)`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('❌ Lỗi load tickets:', err);
  }
}

async function syncTicketsOnStartup(client) {
  for (const [channelId, data] of [...ticketsByChannel.entries()]) {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        ticketsByChannel.delete(channelId);
        ticketsByUser.delete(data.userId);
        scheduleSave();
      }
    } catch (err) {}
  }
}

function getTicketChannelId(userId) {
  return ticketsByUser.get(userId) || null;
}

function getTicketByChannel(channelId) {
  return ticketsByChannel.get(channelId) || null;
}

function registerTicket(channelId, userId, guildId) {
  const data = {
    userId,
    guildId,
    createdAt: Date.now(),
    userApiKey: null,
    selectedModel: 'gemini-3.6-flash',
  };
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

function setTicketApiKey(channelId, apiKey) {
  const data = ticketsByChannel.get(channelId);
  if (data) {
    data.userApiKey = apiKey;
    scheduleSave();
  }
}

function setTicketModel(channelId, model) {
  const data = ticketsByChannel.get(channelId);
  if (data) {
    data.selectedModel = model;
    scheduleSave();
  }
}

function buildTicketChannelName(username) {
  const normalized = username
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `ticket-${normalized || 'user'}`;
}

async function handleSetupTicketCommand(interaction) {
  const categoryOption = interaction.options.getChannel('category');
  const categoryId = categoryOption ? categoryOption.id : 'none';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Hỗ trợ & Chat riêng với Gemini AI')
    .setDescription(
      'Bấm nút bên dưới để mở kênh Chat AI riêng tư.\n\n' +
        '• Trò chuyện bảo mật 1-1 không sợ bị loãng tin nhắn.\n' +
        '• Tùy chọn sử dụng Gemini API Key cá nhân.\n' +
        '• Tùy chỉnh các phiên bản Model Gemini mới nhất.'
    )
    .setFooter({ text: 'Nexus AI Ticket System' })
    .setTimestamp();

  const customId = `${BUTTON_PREFIX}${categoryId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('Tạo Ticket Chat AI')
      .setEmoji('📩')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({
    content: categoryOption
      ? `✅ Đã thiết lập bảng Ticket trong danh mục: **${categoryOption.name}**`
      : '✅ Đã thiết lập bảng Ticket.',
    embeds: [embed],
    components: [row],
  });
}

async function handleCreateTicketButton(interaction, categoryId) {
  const { guild, user } = interaction;
  if (!guild) {
    return interaction.reply({ content: '❌ Tính năng này chỉ dùng trong server.', ephemeral: true });
  }

  const existingChannelId = getTicketChannelId(user.id);
  if (existingChannelId) {
    const existingChannel = await guild.channels.fetch(existingChannelId).catch(() => null);
    if (existingChannel) {
      return interaction.reply({
        content: `⚠️ Bạn đang có 1 ticket đang mở tại: <#${existingChannelId}>`,
        ephemeral: true,
      });
    }
    removeTicket(existingChannelId);
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const channelOptions = {
      name: buildTicketChannelName(user.username),
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: interaction.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ],
    };

    if (categoryId && categoryId !== 'none') {
      channelOptions.parent = categoryId;
    }

    const ticketChannel = await guild.channels.create(channelOptions);
    registerTicket(ticketChannel.id, user.id, guild.id);

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('⚙️ Cấu hình Chat Ticket AI')
      .setDescription(
        `Chào mừng <@${user.id}> đến với kênh chat riêng tư!\n\n` +
          '🔑 **Nhập Key Gemini:** Hãy gửi tin nhắn cú pháp `key: AIzaSy...` để kết nối API Key cá nhân của bạn.\n' +
          '🤖 **Chọn Model AI:** Sử dụng menu phía dưới để chọn Model Gemini bạn muốn chat.\n\n' +
          '*Lưu ý: Bạn bắt đầu chat sau khi đã nhập thành công API Key.*'
      )
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(SELECT_ID_MODEL)
      .setPlaceholder('Chọn Model Gemini...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Gemini 3.6 Flash')
          .setDescription('Model Flash mới nhất hiệu suất cao (07/2026)')
          .setValue('gemini-3.6-flash')
          .setDefault(true),
        new StringSelectMenuOptionBuilder()
          .setLabel('Gemini 3.5 Flash')
          .setDescription('Bản Flash cân bằng và ổn định (05/2026)')
          .setValue('gemini-3.5-flash'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Gemini 3.1 Pro')
          .setDescription('Bản cao cấp phục vụ phân tích, lập trình chuyên sâu')
          .setValue('gemini-3.1-pro'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Gemini 3.1 Flash-Lite')
          .setDescription('Dòng tối ưu cho tác vụ nhẹ, chi phí thấp')
          .setValue('gemini-3.1-flash-lite')
      );

    const rowSelect = new ActionRowBuilder().addComponents(selectMenu);
    const rowClose = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_ID_CLOSE_TICKET)
        .setLabel('Đóng Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `<@${user.id}>`,
      embeds: [welcomeEmbed],
      components: [rowSelect, rowClose],
    });

    await interaction.editReply({
      content: `✅ Đã tạo kênh Ticket riêng cho bạn: <#${ticketChannel.id}>`,
    });
  } catch (err) {
    console.error('❌ Lỗi tạo ticket:', err);
    await interaction.editReply({
      content: '❌ Không thể tạo Ticket. Vui lòng kiểm tra quyền Manage Channels của Bot.',
    });
  }
}

async function handleCloseTicketButton(interaction) {
  const channel = interaction.channel;
  if (!getTicketByChannel(channel.id)) {
    return interaction.reply({ content: '⚠️ Ticket không tồn tại hoặc đã đóng.', ephemeral: true });
  }

  await channel.send(`🔒 Ticket sẽ bị đóng và dọn dẹp sau **${CLOSE_COUNTDOWN_SECONDS} giây**...`);
  setTimeout(async () => {
    removeTicket(channel.id);
    await channel.delete().catch(() => {});
  }, CLOSE_COUNTDOWN_SECONDS * 1000);
}

async function handleTicketInteraction(interaction) {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith(BUTTON_PREFIX)) {
      const categoryId = interaction.customId.replace(BUTTON_PREFIX, '');
      await handleCreateTicketButton(interaction, categoryId);
      return true;
    }
    if (interaction.customId === BUTTON_ID_CLOSE_TICKET) {
      await handleCloseTicketButton(interaction);
      return true;
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === SELECT_ID_MODEL) {
    const selectedModel = interaction.values[0];
    setTicketModel(interaction.channelId, selectedModel);
    await interaction.reply({
      content: `🎯 Đã đổi Model AI thành: **${selectedModel}**`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}

module.exports = {
  loadTickets,
  syncTicketsOnStartup,
  handleSetupTicketCommand,
  handleTicketInteraction,
  getTicketByChannel,
  setTicketApiKey,
};
