// ClearManager.js
// Module quản lý xoá tin nhắn (Manual + Auto Clear) cho Nexus AI Discord Bot.
// Xử lý đúng giới hạn của Discord: bulkDelete() CHỈ xoá được tin nhắn mới hơn 14 ngày,
// tin cũ hơn phải xoá lẻ từng cái (message.delete()) — chậm hơn nhưng vẫn hoạt động.

const fs = require('fs').promises;
const path = require('path');

// ==========================================
// CẤU HÌNH & HẰNG SỐ
// ==========================================
const AUTO_CLEAR_FILE =
  process.env.AUTO_CLEAR_CHANNELS_FILE ||
  path.join(__dirname, 'data', 'autoClearChannels.json');

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
// Trừ hao 10 phút cho an toàn, tránh sát vạch 14 ngày bị Discord từ chối bulkDelete.
const BULK_DELETE_SAFE_MS = FOURTEEN_DAYS_MS - 10 * 60 * 1000;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Delay giữa các lượt xoá lẻ (tin >14 ngày) để tránh dính rate limit của Discord.
const INDIVIDUAL_DELETE_DELAY_MS = 350;

// Danh sách channelId đang bật auto-clear 24h, lưu trong bộ nhớ + đồng bộ ra file.
const autoClearChannels = new Set();

// ==========================================
// PERSISTENCE (giống pattern allowedChannels trong index.js)
// ==========================================
async function ensureDataDir() {
  const dir = path.dirname(AUTO_CLEAR_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error('❌ Lỗi khi tạo thư mục data (ClearManager):', err);
  }
}

async function saveAutoClearChannels() {
  try {
    await ensureDataDir();
    const arr = [...autoClearChannels];
    await fs.writeFile(AUTO_CLEAR_FILE, JSON.stringify(arr, null, 2), 'utf8');
    console.log(`💾 Saved autoClearChannels to ${AUTO_CLEAR_FILE}`);
  } catch (err) {
    console.error('❌ Error saving autoClearChannels:', err);
  }
}

let saveTimeout = null;
function scheduleSave(delay = 200) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveAutoClearChannels().catch((err) => console.error('❌ Lỗi scheduleSave (ClearManager):', err));
    saveTimeout = null;
  }, delay);
}

/**
 * Load danh sách kênh auto-clear từ file khi bot khởi động.
 * Gọi hàm này TRƯỚC client.login() trong index.js.
 */
async function loadAutoClearChannels() {
  try {
    const content = await fs.readFile(AUTO_CLEAR_FILE, 'utf8');
    const arr = JSON.parse(content);
    if (Array.isArray(arr)) {
      arr.forEach((id) => autoClearChannels.add(id));
    }
    console.log(`📂 Loaded autoClearChannels from ${AUTO_CLEAR_FILE} (${autoClearChannels.size} kênh)`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('📂 Không tìm thấy file autoClearChannels, bắt đầu với cấu hình trống.');
    } else {
      console.error('❌ Error loading autoClearChannels:', err);
    }
  }
}

// ==========================================
// QUẢN LÝ TRẠNG THÁI AUTO-CLEAR THEO KÊNH
// ==========================================
function enableAutoClear(channelId) {
  const alreadyEnabled = autoClearChannels.has(channelId);
  autoClearChannels.add(channelId);
  if (!alreadyEnabled) scheduleSave();
  return !alreadyEnabled; // true nếu vừa mới bật (chưa từng bật trước đó)
}

function disableAutoClear(channelId) {
  const had = autoClearChannels.delete(channelId);
  if (had) scheduleSave();
  return had; // true nếu trước đó có bật (và vừa tắt thành công)
}

function isAutoClearEnabled(channelId) {
  return autoClearChannels.has(channelId);
}

function getAutoClearChannelIds() {
  return [...autoClearChannels];
}

// ==========================================
// LOGIC XOÁ TIN NHẮN (dùng chung cho cả Manual & Auto)
// ==========================================
/**
 * Xoá N tin nhắn GẦN NHẤT trong kênh (dùng cho /clear).
 * Tự động tách tin >14 ngày để xoá lẻ, tin <14 ngày xoá hàng loạt (bulkDelete).
 * @param {import('discord.js').TextChannel} channel
 * @param {number} amount - số lượng tin muốn xoá.
 * @returns {Promise<{ bulkDeleted: number, individuallyDeleted: number }>}
 */
async function clearRecentMessages(channel, amount) {
  let remaining = amount;
  let bulkDeleted = 0;
  let individuallyDeleted = 0;
  const bulkDeleteCutoff = Date.now() - BULK_DELETE_SAFE_MS;

  while (remaining > 0) {
    const fetchLimit = Math.min(remaining, 100); // Discord giới hạn fetch tối đa 100/lần
    const messages = await channel.messages.fetch({ limit: fetchLimit });
    if (messages.size === 0) break;

    const bulkable = messages.filter((m) => m.createdTimestamp > bulkDeleteCutoff);
    const tooOld = messages.filter((m) => m.createdTimestamp <= bulkDeleteCutoff);

    if (bulkable.size > 0) {
      try {
        const result = await channel.bulkDelete(bulkable, true);
        bulkDeleted += result.size;
      } catch (err) {
        console.error(`❌ Lỗi bulkDelete kênh ${channel.id}:`, err);
      }
    }

    for (const msg of tooOld.values()) {
      try {
        await msg.delete();
        individuallyDeleted++;
        await new Promise((r) => setTimeout(r, INDIVIDUAL_DELETE_DELAY_MS));
      } catch (err) {
        // Tin có thể đã bị xoá bởi người khác trước đó -> bỏ qua lỗi này.
      }
    }

    remaining -= messages.size;
    if (messages.size < fetchLimit) break; // đã quét hết tin nhắn trong kênh
  }

  return { bulkDeleted, individuallyDeleted };
}

/**
 * Xoá TẤT CẢ tin nhắn CŨ HƠN `maxAgeMs` trong kênh (dùng cho auto-clear 24h).
 * Quét toàn bộ lịch sử kênh theo từng trang 100 tin, dừng khi hết tin hoặc kênh không còn tin cũ.
 * @param {import('discord.js').TextChannel} channel
 * @param {number} maxAgeMs - ngưỡng tuổi tin nhắn (vd: 24 giờ tính bằng ms).
 * @returns {Promise<{ bulkDeleted: number, individuallyDeleted: number, errors: number }>}
 */
async function clearOldMessages(channel, maxAgeMs) {
  let bulkDeleted = 0;
  let individuallyDeleted = 0;
  let errors = 0;

  const cutoff = Date.now() - maxAgeMs;
  const bulkDeleteCutoff = Date.now() - BULK_DELETE_SAFE_MS;

  let lastId;
  let emptyRounds = 0;

  // Lặp quét lùi dần theo lịch sử kênh (mới -> cũ) cho tới khi hết tin.
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;
    lastId = messages.last().id;

    const oldMessages = messages.filter((m) => m.createdTimestamp < cutoff);

    if (oldMessages.size === 0) {
      // Batch này chưa có tin đủ cũ (có thể do tin trôi không liên tục) -> thử batch tiếp theo.
      emptyRounds++;
      if (messages.size < 100 || emptyRounds > 3) break;
      continue;
    }
    emptyRounds = 0;

    const bulkable = oldMessages.filter((m) => m.createdTimestamp > bulkDeleteCutoff);
    const tooOld = oldMessages.filter((m) => m.createdTimestamp <= bulkDeleteCutoff);

    if (bulkable.size > 0) {
      try {
        const result = await channel.bulkDelete(bulkable, true);
        bulkDeleted += result.size;
      } catch (err) {
        console.error(`❌ Lỗi bulkDelete (auto) kênh ${channel.id}:`, err);
        errors++;
      }
    }

    for (const msg of tooOld.values()) {
      try {
        await msg.delete();
        individuallyDeleted++;
        await new Promise((r) => setTimeout(r, INDIVIDUAL_DELETE_DELAY_MS));
      } catch (err) {
        errors++;
      }
    }

    if (messages.size < 100) break;
  }

  return { bulkDeleted, individuallyDeleted, errors };
}

// ==========================================
// SCHEDULER: quét định kỳ các kênh đã bật auto-clear
// ==========================================
/**
 * Khởi động vòng lặp quét định kỳ toàn bộ kênh đã bật /clear24h.
 * Gọi hàm này 1 LẦN duy nhất, sau khi client đã 'ready' trong index.js.
 * @param {import('discord.js').Client} client
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=3600000] - chu kỳ quét (mặc định 1 giờ/lần).
 */
function startAutoClearScheduler(client, opts = {}) {
  const intervalMs = opts.intervalMs || 60 * 60 * 1000; // mặc định quét mỗi 1 giờ

  setInterval(async () => {
    for (const channelId of autoClearChannels) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
          // Kênh không còn tồn tại (đã bị xoá) -> tự dọn config luôn.
          disableAutoClear(channelId);
          continue;
        }

        const { bulkDeleted, individuallyDeleted, errors } = await clearOldMessages(
          channel,
          TWENTY_FOUR_HOURS_MS
        );
        const total = bulkDeleted + individuallyDeleted;
        if (total > 0 || errors > 0) {
          console.log(
            `🧹 Auto-clear #${channel.name || channelId}: xoá ${total} tin ` +
              `(nhanh: ${bulkDeleted}, lẻ: ${individuallyDeleted}, lỗi: ${errors})`
          );
        }
      } catch (err) {
        console.error(`❌ Lỗi auto-clear kênh ${channelId}:`, err);
      }
    }
  }, intervalMs);

  console.log(`⏰ Auto-clear scheduler đã khởi động (quét mỗi ${Math.round(intervalMs / 60000)} phút).`);
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  loadAutoClearChannels,
  enableAutoClear,
  disableAutoClear,
  isAutoClearEnabled,
  getAutoClearChannelIds,
  clearRecentMessages,
  clearOldMessages,
  startAutoClearScheduler,
  TWENTY_FOUR_HOURS_MS,
};
