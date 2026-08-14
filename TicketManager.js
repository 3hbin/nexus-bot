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
const { allModelSelectOptions, providerFromModel, PROVIDER_META, helpKeyText } = require('./Providers.js');

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

function getTicketCount() {
  return tickets.size;
}


/**
 * Sau redeploy file tickets.json mất — kênh ticket-... vẫn tồn tại trên Discord.
 * Tự tạo lại record tối thiểu để bot nhận tin (dùng GEMINI_API_KEY server nếu có).
 */
function ensureTicketRecord(channel) {
  if (!channel || !channel.id) return null;
  const id = String(channel.id);
  let t = tickets.get(id);
  if (t) return t;
  const name = String(channel.name || '');
  if (!/^ticket-/i.test(name)) return null;
  t = {
    channelId: id,
    userApiKey: null,
    selectedModel: null,
    selectedPersona: DEFAULT_PERSONA_ID,
    customPersonaText: null,
    providerKeys: {},
    activeProvider: 'gemini',
  };
  tickets.set(id, t);
  saveTickets().catch(() => {});
  console.log('TicketManager: rehydrate ticket channel', name, id);
  return t;
}


async function setTicketApiKey(channelId, apiKey, provider = 'gemini') {
  try {
    const key = String(channelId);
    const existing = tickets.get(key) || {
      channelId: key,
      userApiKey: null,
      selectedModel: null,
      selectedPersona: DEFAULT_PERSONA_ID,
      customPersonaText: null,
      providerKeys: {},
      activeProvider: 'gemini',
    };
    if (!existing.providerKeys) existing.providerKeys = {};
    const prov = provider || 'gemini';
    existing.providerKeys[prov] = apiKey;
    existing.activeProvider = prov;
    // Tương thích cũ: gemini key cũng ghi userApiKey
    if (prov === 'gemini') existing.userApiKey = apiKey;
    tickets.set(key, existing);
    await saveTickets();
    return true;
  } catch (err) {
    console.error('TicketManager: setTicketApiKey error:', err);
    return false;
  }
}

function getTicketProviderKey(ticket, provider) {
  if (!ticket) return null;
  const prov = provider || ticket.activeProvider || 'gemini';
  if (ticket.providerKeys && ticket.providerKeys[prov]) return ticket.providerKeys[prov];
  if (prov === 'gemini' && ticket.userApiKey) return ticket.userApiKey;
  return null;
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
  // Không dùng emoji unicode — Discord option không hiện logo URL.
  // Nếu server có custom emoji logo, gán PERSONA_PRESETS[id].emojiId = '123...'
  const options = Object.values(PERSONA_PRESETS).map((p) => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(p.label.slice(0, 100))
      .setDescription((p.description || p.id).slice(0, 100))
      .setValue(p.id);
    if (p.emojiId) {
      opt.setEmoji({ id: String(p.emojiId) });
    }
    return opt;
  });
  const customOpt = new StringSelectMenuOptionBuilder()
    .setLabel('Tùy chỉnh sở thích AI')
    .setDescription('Tự viết mô tả tính cách / sở thích')
    .setValue('custom')
    .setEmoji({ id: '1536310039210364978' });
  options.push(customOpt);
  return new StringSelectMenuBuilder()
    .setCustomId('select_persona')
    .setPlaceholder('Chọn sở thích AI (ChatGPT, Gemini, Grok…)')
    .addOptions(options);
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
          '• Trong ticket: chọn **Model** (Gemini/ChatGPT/Claude/Grok/DeepSeek) + **persona** + nhập **Key** tương ứng.\n' +
          '• Nếu server yêu cầu Key riêng, hãy nhắn `key gemini: ... | key chatgpt: ... | key claude: ...` vào kênh đó hoặc dùng nút nhập Key.'
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
        .setPlaceholder('Chọn Model (Gemini / ChatGPT / Claude / Grok / DeepSeek)...')
        .addOptions(
          allModelSelectOptions().map((o) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(o.label)
              .setDescription(o.description)
              .setValue(o.value)
          )
        );

      const selectPersona = buildPersonaSelectMenu();

      const row1 = new ActionRowBuilder().addComponents(selectModel);
      const row2 = new ActionRowBuilder().addComponents(selectPersona);
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('input_api_key_gemini').setLabel('Key Gemini').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('input_api_key_chatgpt').setLabel('Key ChatGPT').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('input_api_key_claude').setLabel('Key Claude').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('input_api_key_grok').setLabel('Key Grok').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('input_api_key_deepseek').setLabel('Key DeepSeek').setStyle(ButtonStyle.Secondary)
      );
      const row4 = new ActionRowBuilder().addComponents(
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
            '1. Chọn **Model** (Gemini / ChatGPT / Claude / Grok / DeepSeek)\n' +
            '2. Nhấn nút **Key …** tương ứng **hoặc** nhắn:\n' +
            '`key gemini: …` · `key chatgpt: …` · `key claude: …` · `key grok: …` · `key deepseek: …`\n' +
            '3. Chọn **Tính cách AI** → nhắn bình thường\n' +
            'Gõ `keys` để xem đã lưu key provider nào.\n\n' +
            '**Lệnh & mẹo**\n' +
            '• `note: ...` — ghim ngữ cảnh\n' +
            '• `/quiz` · `/summary` · `/dich` hoặc `dịch: ...`\n' +
            '• Nút **🧹 Xóa memory** · **🔄 Trả lời lại**\n\n' +
            '**Lấy API Key (link chính thức)**\n' +
            '• **Gemini:** https://aistudio.google.com → Get API key\n' +
            '• **ChatGPT (OpenAI):** https://platform.openai.com/api-keys\n' +
            '• **Claude (Anthropic):** https://console.anthropic.com/settings/keys\n' +
            '• **Grok (xAI):** https://console.x.ai → API keys\n' +
            '• **DeepSeek:** https://platform.deepseek.com/api_keys\n\n' +
            '⚠️ Nhiều model/API có free hạn chế hoặc cần Billing.\n' +
            '💡 Model + key phải **cùng nhà cung cấp** (vd. model GPT + key ChatGPT).'
        )
        .setColor(0x57f287)
        .setFooter({ text: 'Nexus AI Ticket • Đóng ticket = xóa kênh + dữ liệu' });

      await created.send({ embeds: [welcomeEmbed], components: [row1, row2, row3, row4] }).catch(() => {});

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
      ticketInfo.activeProvider = providerFromModel(selectedModel);
      tickets.set(String(interaction.channelId), ticketInfo);
      await saveTickets();

      await interaction.reply({
        content: `🤖 Model **\`${selectedModel}\`** · provider **${ticketInfo.activeProvider}** cho ticket này.
Nhớ nhập key đúng nhà cung cấp (nút Key… hoặc \`key ${ticketInfo.activeProvider}: ...\`).`,
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
      const preset = PERSONA_PRESETS[selected];
      const embed = new EmbedBuilder()
        .setTitle(`Đã chọn: ${label}`)
        .setDescription(
          (preset?.description || '') +
            '\n\nTin nhắn tiếp theo dùng persona này (session tách theo model + persona).'
        )
        .setColor(0x5865f2);
      if (preset?.logoUrl) {
        embed.setThumbnail(preset.logoUrl);
      }
      await interaction.reply({
        embeds: [embed],
        ephemeral: true,
      });
      return true;
    }

    // 3. XỬ LÝ NÚT "NHẬP KEY" -> hiện modal
        // Nút nhập key đa provider (giữ Gemini + thêm ChatGPT/Claude/Grok/DeepSeek)
    if (interaction.isButton() && String(interaction.customId || '').startsWith('input_api_key')) {
      try {
        let prov = 'gemini';
        const cid = String(interaction.customId);
        if (cid.startsWith('input_api_key_')) {
          prov = cid.slice('input_api_key_'.length) || 'gemini';
        } else if (cid === 'input_api_key') {
          prov = 'gemini';
        }
        if (!PROVIDER_META[prov]) prov = 'gemini';
        const meta = PROVIDER_META[prov];
        const modal = new ModalBuilder()
          .setCustomId('modal_api_key_' + prov)
          .setTitle(('Key ' + meta.label).slice(0, 45));
        const input = new TextInputBuilder()
          .setCustomId('text_api_key')
          .setLabel(('Dán ' + meta.label + ' API Key').slice(0, 45))
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(meta.keyHint || '...')
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
      } catch (e) {
        console.error('TicketManager: show modal error', e);
        try {
          await interaction.reply({ content: '❌ Không thể mở modal.', ephemeral: true });
        } catch (e2) {}
      }
      return true;
    }

    // Modal submit API key (modal_api_key hoặc modal_api_key_<provider>)
    if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('modal_api_key')) {
      try {
        const channelId = interaction.channelId || (interaction.channel && interaction.channel.id);
        const apiKey = interaction.fields?.getTextInputValue('text_api_key')?.trim() || null;
        let prov = 'gemini';
        const mid = String(interaction.customId);
        if (mid.startsWith('modal_api_key_')) prov = mid.slice('modal_api_key_'.length) || 'gemini';
        if (!PROVIDER_META[prov]) prov = 'gemini';
        if (!channelId) {
          await interaction.reply({ content: '❌ Không xác định được kênh để lưu Key.', ephemeral: true });
          return true;
        }
        if (!apiKey || apiKey.length < 10) {
          await interaction.reply({ content: '❌ Key không hợp lệ.', ephemeral: true });
          return true;
        }
        const ok = await setTicketApiKey(channelId, apiKey, prov);
        if (ok) {
          await interaction.reply({
            content:
              '🔑 Đã lưu key **' +
              (PROVIDER_META[prov]?.label || prov) +
              '** cho ticket (ẩn).\n' +
              'Chọn **model** đúng provider + persona phù hợp rồi chat.\n' +
              'Gõ `keys` để xem provider nào đã có key.\n' +
              (prov === 'gemini'
                ? 'Gemini: https://aistudio.google.com'
                : ''),
            ephemeral: true,
          });
        } else {
          await interaction.reply({ content: '❌ Không thể lưu API Key.', ephemeral: true });
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
    // Reply ngay trước việc nặng — tránh DiscordAPIError 10062 Unknown interaction
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const channel = interaction.channel;
      const channelId = String(interaction.channelId);
      const channelName = channel?.name || channelId;
      const closedBy = interaction.user;

      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '🔒 Đang đóng ticket — kênh sẽ xóa sau vài giây...',
            ephemeral: true,
          });
        }
      } catch (replyErr) {
        console.warn('TicketManager: close reply failed', replyErr && replyErr.message);
      }

      tickets.delete(channelId);
      try {
        await saveTickets();
      } catch (e) {
        console.error('TicketManager: saveTickets on close', e);
      }

      // Background: transcript + admin log (không block interaction)
      setImmediate(async () => {
        let transcript = '';
        try {
          if (channel && typeof channel.messages?.fetch === 'function') {
            const msgs = await channel.messages.fetch({ limit: 30 });
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
          }
        } catch (_) {}

        if (typeof global.__nexusOnTicketClose === 'function') {
          try {
            await global.__nexusOnTicketClose({
              channelId,
              channelName,
              closedBy,
              transcript,
            });
          } catch (cbErr) {
            console.warn('onTicketClose callback', cbErr && cbErr.message);
          }
        }
      });

      setTimeout(async () => {
        try {
          if (channel && typeof channel.delete === 'function') {
            await channel.delete();
          }
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

async function setTicketAiName(channelId, name) {
  try {
    const key = String(channelId);
    const existing = tickets.get(key) || {
      channelId: key,
      userApiKey: null,
      selectedModel: null,
      selectedPersona: DEFAULT_PERSONA_ID,
      customPersonaText: null,
      aiName: null,
    };
    const n = String(name || '').trim().slice(0, 40);
    existing.aiName = n || null;
    tickets.set(key, existing);
    await saveTickets();
    return true;
  } catch (err) {
    console.error('TicketManager: setTicketAiName error', err);
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
  getTicketCount,
  ensureTicketRecord,
  setTicketApiKey,
  getTicketProviderKey,
  setTicketPersona,
  setTicketNote,
  setTicketAiName,
};
