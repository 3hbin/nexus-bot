// TicketManager.js
// Quản lý Ticket channels: lưu tickets, tạo kênh ticket đúng danh mục,
// xử lý chọn model, chọn persona/sở thích AI, modal API key & đóng ticket.
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

const { PERSONA_PRESETS, DEFAULT_PERSONA_ID } = require('./Interest.js');

const TICKETS_FILE = path.join(__dirname, 'data', 'tickets.json');

/** @type {Map<string, { channelId: string, userApiKey?: string|null, selectedModel?: string|null, selectedPersona?: string|null, customPersonaText?: string|null }>} */
let tickets = new Map();

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
        tickets.set(k, {
          channelId: k,
          userApiKey: null,
          selectedModel: null,
          selectedPersona: DEFAULT_PERSONA_ID,
          customPersonaText: null,
          ...(parsed || {}),
        });
      } catch {
        tickets.set(k, v || { channelId: k, selectedPersona: DEFAULT_PERSONA_ID });
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
    const existing = tickets.get(key) || {
      channelId: key,
      userApiKey: null,
      selectedModel: null,
      selectedPersona: DEFAULT_PERSONA_ID,
      customPersonaText: null,
    };
    existing.userApiKey = apiKey;
    tickets.set(key, existing);
    await saveTickets();
    return true;
  } catch (err) {
    console.error('TicketManager: setTicketApiKey error:', err);
    return false;
  }
}

async function setTicketPersona(channelId, personaId, customText = null) {
  try {
    const key = String(channelId);
    const existing = tickets.get(key) || {
      channelId: key,
      userApiKey: null,
      selectedModel: null,
      selectedPersona: DEFAULT_PERSONA_ID,
      customPersonaText: null,
    };
    existing.selectedPersona = personaId || DEFAULT_PERSONA_ID;
    existing.customPersonaText = personaId === 'custom' ? (customText || null) : null;
    tickets.set(key, existing);
    await saveTickets();
    return true;
  } catch (err) {
    console.error('TicketManager: setTicketPersona error:', err);
    return false;
  }
}

function buildPersonaSelectMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('select_persona')
    .setPlaceholder('Chọn tính cách / sở thích AI...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(PERSONA_PRESETS.default.label)
        .setDescription(PERSONA_PRESETS.default.description.slice(0, 100))
        .setValue('default')
        .setEmoji('🤖'),
      new StringSelectMenuOptionBuilder()
        .setLabel(PERSONA_PRESETS.tre_trau.label)
        .setDescription(PERSONA_PRESETS.tre_trau.description.slice(0, 100))
        .setValue('tre_trau')
        .setEmoji('🔥'),
      new StringSelectMenuOptionBuilder()
        .setLabel(PERSONA_PRESETS.nhe_nhang.label)
        .setDescription(PERSONA_PRESETS.nhe_nhang.description.slice(0, 100))
        .setValue('nhe_nhang')
        .setEmoji('🌿'),
      new StringSelectMenuOptionBuilder()
        .setLabel(PERSONA_PRESETS.roblox.label)
        .setDescription(PERSONA_PRESETS.roblox.description.slice(0, 100))
        .setValue('roblox')
        .setEmoji('🎮'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Tùy chỉnh sở thích AI')
        .setDescription('Tự viết mô tả tính cách / sở thích cho AI')
        .setValue('custom')
        .setEmoji('✨')
    );
  return menu;
}

function personaLabel(personaId, customText) {
  if (personaId === 'custom') {
    const t = (customText || '').trim();
    return t ? `Tùy chỉnh: ${t.slice(0, 60)}${t.length > 60 ? '…' : ''}` : 'Tùy chỉnh (chưa nhập)';
  }
  return PERSONA_PRESETS[personaId]?.label || PERSONA_PRESETS.default.label;
}

async function handleSetupTicketCommand(interaction) {
  try {
    const category = interaction.options?.getChannel('category') || null;
    const customId = category ? `open_ticket_${category.id}` : 'open_ticket';

    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket Chat AI')
      .setDescription(
        'Nhấn nút **Tạo Ticket** bên dưới để mở kênh trò chuyện AI riêng biệt.\n' +
          '• Trong kênh ticket, bạn có thể chọn **Model Gemini** và **tính cách / sở thích AI**.\n' +
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

      let parentId = undefined;

      if (interaction.customId.startsWith('open_ticket_')) {
        parentId = interaction.customId.replace('open_ticket_', '');
      }

      if (!parentId) {
        const aiCategory = guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name && c.name.toLowerCase().includes('chat room ai')
        );
        if (aiCategory) {
          parentId = aiCategory.id;
        }
      }

      if (!parentId && interaction.channel && interaction.channel.parentId) {
        parentId = interaction.channel.parentId;
      }

      const cleanUsername = member.user.username.toLowerCase().replace(/[^a-z0-9\-]/g, '');
      const baseName = `ticket-${cleanUsername}`.slice(0, 80) || 'ticket-ai';
      let finalName = baseName;
      let count = 1;
      while (guild.channels.cache.find((c) => c.name === finalName)) {
        finalName = `${baseName}-${count++}`;
      }

      const created = await guild.channels
        .create({
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
        })
        .catch((e) => {
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

      tickets.set(String(created.id), {
        channelId: String(created.id),
        userApiKey: null,
        selectedModel: 'gemini-3.6-flash',
        selectedPersona: DEFAULT_PERSONA_ID,
        customPersonaText: null,
      });
      await saveTickets();

      const selectModel = new StringSelectMenuBuilder()
        .setCustomId('select_model')
        .setPlaceholder('Chọn Model Gemini để trò chuyện...')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.6 Flash (Mặc định)')
            .setDescription('Flagship hiện tại, hỗ trợ tư duy động')
            .setValue('gemini-3.6-flash'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.5 Flash')
            .setDescription('Cân bằng tốc độ & chất lượng')
            .setValue('gemini-3.5-flash'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.5 Flash-Lite')
            .setDescription('Rẻ nhất, nhanh nhất')
            .setValue('gemini-3.5-flash-lite'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.1 Pro')
            .setDescription('Suy luận sâu, lập trình (cần Key có billing)')
            .setValue('gemini-3.1-pro'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Gemini 3.1 Flash-Lite')
            .setDescription('Siêu nhẹ, phản hồi cực nhanh')
            .setValue('gemini-3.1-flash-lite')
        );

      const selectPersona = buildPersonaSelectMenu();

      const row1 = new ActionRowBuilder().addComponents(selectModel);
      const row2 = new ActionRowBuilder().addComponents(selectPersona);
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('input_api_key').setLabel('🔑 Nhập Key Gemini').setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('nexus_clear_memory')
          .setLabel('Xóa memory')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🧹'),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Đóng Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
      );

      const welcomeEmbed = new EmbedBuilder()
        .setTitle('👋 Ticket AI của bạn đã sẵn sàng')
        .setDescription(
          '**Bắt đầu nhanh**\n' +
            '1. Nhấn **🔑 Nhập Key Gemini** (hoặc gửi `key: AIza...`)\n' +
            '2. Chọn **Model** + **Tính cách AI** ở menu dưới\n' +
            '3. Nhắn bất kỳ — bot sẽ trả lời theo persona đã chọn\n\n' +
            '**Lệnh & mẹo hữu ích**\n' +
            '• `note: ...` — ghim ngữ cảnh (môn học, style trả lời…)\n' +
            '• `/quiz` — đố vui trong ticket\n' +
            '• `/summary` — tóm tắt hội thoại gần đây\n' +
            '• `/dich` hoặc `dịch: ...` — dịch Việt ↔ Anh\n' +
            '• Nút **🧹 Xóa memory** — xóa lịch sử chat ticket (không đóng kênh)\n' +
            '• Nút **🔄 Trả lời lại** dưới mỗi câu AI\n\n' +
            '**Lấy API Key**\n' +
            '1) https://aistudio.google.com → Get API key\n' +
            '2) Dán vào modal hoặc `key: <API_KEY>`\n\n' +
            '⚠️ Model **Pro** thường cần Billing. Free tier có giới hạn request/ngày.\n' +
            '💡 Đổi persona/model → tin nhắn tiếp theo dùng cấu hình mới.'
        )
        .setColor(0x57f287)
        .setFooter({ text: 'Nexus AI Ticket • Đóng ticket = xóa kênh + dữ liệu' });

      await created.send({ embeds: [welcomeEmbed], components: [row1, row2, row3] }).catch(() => {});

      await interaction
        .reply({ content: `✅ Đã tạo kênh Ticket thành công tại: <#${created.id}>`, ephemeral: true })
        .catch(() => {});
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
        ephemeral: true,
      });
      return true;
    }

    // 2b. XỬ LÝ CHỌN PERSONA
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_persona') {
      const selected = interaction.values[0];
      const ticketInfo = getTicketByChannel(interaction.channelId);

      if (!ticketInfo) {
        await interaction.reply({ content: '❌ Kênh này không phải là Ticket hợp lệ.', ephemeral: true });
        return true;
      }

      if (selected === 'custom') {
        // Mở modal nhập mô tả tùy chỉnh
        try {
          const modal = new ModalBuilder().setCustomId('modal_custom_persona').setTitle('Tùy chỉnh sở thích / tính cách AI');
          const input = new TextInputBuilder()
            .setCustomId('text_custom_persona')
            .setLabel('Mô tả tính cách / sở thích AI')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder(
              'VD: Nói kiểu Gen Z Việt, thích anime, hơi lầy nhưng vẫn trả lời đúng trọng tâm...'
            )
            .setRequired(true)
            .setMaxLength(1000);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
        } catch (e) {
          console.error('TicketManager: show custom persona modal error', e);
          try {
            await interaction.reply({ content: '❌ Không thể mở form tùy chỉnh.', ephemeral: true });
          } catch (e2) {}
        }
        return true;
      }

      await setTicketPersona(interaction.channelId, selected, null);
      const label = personaLabel(selected, null);
      await interaction.reply({
        content:
          `🎭 Đã đổi tính cách AI sang **${label}**!\n` +
          `Tin nhắn tiếp theo sẽ dùng persona này (bộ nhớ chat theo model+persona được tách riêng).`,
        ephemeral: true,
      });
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
          .setPlaceholder('AIzaSy...')
          .setRequired(true);
        const row = new ActionRowBuilder().addComponents(input);
        modal.addComponents(row);

        await interaction.showModal(modal);

        try {
          await interaction.user
            .send(
              'Hướng dẫn nhanh: Để lấy Gemini API Key, truy cập https://aistudio.google.com → Get API key → Create API key. Sau đó quay lại kênh Ticket và dán vào modal.'
            )
            .catch(() => {});
        } catch (e) {}
      } catch (e) {
        console.error('TicketManager: show modal error', e);
        try {
          await interaction.reply({ content: '❌ Không thể mở modal.', ephemeral: true });
        } catch (e2) {}
      }
      return true;
    }

    // 4. XỬ LÝ MODAL SUBMIT (API key)
    if (interaction.isModalSubmit() && interaction.customId === 'modal_api_key') {
      try {
        const channelId = interaction.channelId || (interaction.channel && interaction.channel.id);
        const apiKey = interaction.fields?.getTextInputValue('text_api_key')?.trim() || null;
        if (!channelId) {
          await interaction.reply({ content: '❌ Không xác định được kênh để lưu Key.', ephemeral: true });
          return true;
        }
        if (!apiKey || apiKey.length < 10) {
          await interaction.reply({ content: '❌ Key không hợp lệ.', ephemeral: true });
          return true;
        }
        const ok = await setTicketApiKey(channelId, apiKey);
        if (ok) {
          await interaction.reply({
            content:
              '🔑 Đã lưu API Key cho kênh này (ẩn).\n' +
              'Bạn có thể chat ngay bây giờ. Nếu vẫn gặp lỗi liên lạc API, hãy kiểm tra Key còn hiệu lực và đã bật Gemini API cho project trên https://aistudio.google.com',
            ephemeral: true,
          });
        } else {
          await interaction.reply({ content: '❌ Không thể lưu API Key. Hãy thử lại sau.', ephemeral: true });
        }
      } catch (e) {
        console.error('TicketManager: modal submit handler error', e);
        try {
          await interaction.reply({ content: '❌ Lỗi khi lưu API Key.', ephemeral: true });
        } catch (e2) {}
      }
      return true;
    }

    // 4b. XỬ LÝ MODAL CUSTOM PERSONA
    if (interaction.isModalSubmit() && interaction.customId === 'modal_custom_persona') {
      try {
        const channelId = interaction.channelId || (interaction.channel && interaction.channel.id);
        const text = interaction.fields?.getTextInputValue('text_custom_persona')?.trim() || '';
        if (!channelId) {
          await interaction.reply({ content: '❌ Không xác định được kênh.', ephemeral: true });
          return true;
        }
        if (!text || text.length < 5) {
          await interaction.reply({
            content: '❌ Mô tả quá ngắn. Hãy viết rõ hơn một chút (tối thiểu ~5 ký tự).',
            ephemeral: true,
          });
          return true;
        }
        const ok = await setTicketPersona(channelId, 'custom', text);
        if (ok) {
          await interaction.reply({
            content:
              `✨ Đã lưu **tính cách / sở thích tùy chỉnh** cho kênh này!\n` +
              `> ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}\n` +
              `Tin nhắn tiếp theo sẽ dùng persona này.`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({ content: '❌ Không thể lưu. Hãy thử lại sau.', ephemeral: true });
        }
      } catch (e) {
        console.error('TicketManager: custom persona modal error', e);
        try {
          await interaction.reply({ content: '❌ Lỗi khi lưu persona tùy chỉnh.', ephemeral: true });
        } catch (e2) {}
      }
      return true;
    }

    // 5. XỬ LÝ NÚT "ĐÓNG TICKET"
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      try {
        // Snapshot tin nhắn trước khi xóa (cho admin log / summary)
        let transcript = '';
        try {
          const msgs = await interaction.channel.messages.fetch({ limit: 30 });
          const sorted = [...msgs.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          transcript = sorted
            .filter((m) => !m.author.bot || m.author.id === interaction.client.user.id)
            .map((m) => {
              const who = m.author.bot ? 'Nexus' : m.author.username;
              return `${who}: ${(m.content || '').slice(0, 200)}`;
            })
            .filter((l) => l.length > 8)
            .slice(-20)
            .join('\n');
        } catch (_) {}

        // Callback optional từ index.js
        if (typeof global.__nexusOnTicketClose === 'function') {
          try {
            await global.__nexusOnTicketClose({
              channelId: interaction.channelId,
              channelName: interaction.channel.name,
              closedBy: interaction.user,
              transcript,
            });
          } catch (cbErr) {
            console.warn('onTicketClose callback', cbErr && cbErr.message);
          }
        }

        await interaction.reply({
          content: '🔒 Kênh này sẽ được xóa và dữ liệu liên quan sẽ bị xoá hoàn toàn trong 3s...',
          ephemeral: true,
        });
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
        try {
          await interaction.reply({ content: '❌ Không thể đóng kênh.', ephemeral: true });
        } catch (e2) {}
      }
      return true;
    }

    return false;
  } catch (err) {
    console.error('TicketManager: handleTicketInteraction error:', err);
    return false;
  }
}

async function setTicketNote(channelId, noteText) {
  try {
    const key = String(channelId);
    const existing = tickets.get(key) || {
      channelId: key,
      userApiKey: null,
      selectedModel: null,
      selectedPersona: DEFAULT_PERSONA_ID,
      customPersonaText: null,
      contextNote: null,
    };
    const t = (noteText || '').trim();
    existing.contextNote = t ? t.slice(0, 1500) : null;
    tickets.set(key, existing);
    await saveTickets();
    return true;
  } catch (err) {
    console.error('TicketManager: setTicketNote error', err);
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
  setTicketPersona,
  setTicketNote,
};
