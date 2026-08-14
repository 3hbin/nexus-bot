// ClearManager.js
// Quản lý auto-clear channels và chức năng xoá tin nhắn
const fs = require('fs').promises;
const path = require('path');
const { dataFile } = require('./paths.js');

const AUTO_CLEAR_FILE = dataFile('autoClearChannels.json');

let autoClearSet = new Set();
let schedulerInterval = null;

async function ensureDataDir() {
  const dir = path.dirname(AUTO_CLEAR_FILE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error('ClearManager: Lỗi khi tạo thư mục data:', err);
  }
}

async function loadAutoClearChannels() {
  try {
    await ensureDataDir();
    const content = await fs.readFile(AUTO_CLEAR_FILE, 'utf8').catch((e) => {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    });
    if (!content) {
      autoClearSet = new Set();
      console.log(
        'ClearManager: Chưa có autoClearChannels trong DATA_DIR — tạo mới (gắn Volume để không mất khi deploy).'
      );
      return;
    }
    const arr = JSON.parse(content || '[]');
    autoClearSet = new Set(Array.isArray(arr) ? arr : []);
    console.log(`ClearManager: Loaded ${autoClearSet.size} autoClear channels từ ${AUTO_CLEAR_FILE}`);
  } catch (err) {
    console.error('ClearManager: Lỗi loadAutoClearChannels:', err);
    autoClearSet = new Set();
  }
}

async function saveAutoClearChannels() {
  try {
    await ensureDataDir();
    await fs.writeFile(AUTO_CLEAR_FILE, JSON.stringify(Array.from(autoClearSet), null, 2), 'utf8');
  } catch (err) {
    console.error('ClearManager: Lỗi saveAutoClearChannels:', err);
  }
}

function enableAutoClear(channelId) {
  try {
    autoClearSet.add(channelId);
    saveAutoClearChannels();
    return true;
  } catch (err) {
    console.error('ClearManager: enableAutoClear error:', err);
    return false;
  }
}

function disableAutoClear(channelId) {
  try {
    const had = autoClearSet.delete(channelId);
    saveAutoClearChannels();
    return had;
  } catch (err) {
    console.error('ClearManager: disableAutoClear error:', err);
    return false;
  }
}

function isAutoClearEnabled(channelId) {
  return autoClearSet.has(channelId);
}

async function clearRecentMessages(channel, amount = 100) {
  try {
    if (!channel || !channel.messages) {
      throw new Error('Channel không hợp lệ cho clearRecentMessages');
    }

    let toFetch = amount;
    let totalBulk = 0;
    let totalIndividual = 0;

    while (toFetch > 0) {
      const fetchLimit = Math.min(100, toFetch);
      const messages = await channel.messages.fetch({ limit: fetchLimit }).catch((e) => {
        throw e;
      });
      if (!messages || messages.size === 0) break;

      const now = Date.now();
      const deletable = [];
      const old = [];

      messages.forEach((m) => {
        const age = now - m.createdTimestamp;
        if (age <= 14 * 24 * 60 * 60 * 1000) deletable.push(m);
        else old.push(m);
      });

      if (deletable.length > 0) {
        try {
          const res = await channel.bulkDelete(deletable, true);
          totalBulk += res.size || 0;
        } catch (err) {
          for (const m of deletable) {
            try {
              await m.delete().catch(() => {});
              totalIndividual++;
            } catch (e) {}
          }
        }
      }

      for (const m of old) {
        try {
          await m.delete().catch(() => {});
          totalIndividual++;
        } catch (e) {}
      }

      toFetch -= messages.size;
      if (messages.size < fetchLimit) break;
    }

    return { bulkDeleted: totalBulk, individuallyDeleted: totalIndividual };
  } catch (err) {
    console.error('ClearManager: clearRecentMessages error:', err);
    return { bulkDeleted: 0, individuallyDeleted: 0 };
  }
}

function startAutoClearScheduler(client, intervalMs = 1000 * 60 * 60) {
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = setInterval(async () => {
    try {
      if (!client) return;
      const now = Date.now();
      for (const channelId of Array.from(autoClearSet)) {
        try {
          const ch = await client.channels.fetch(channelId).catch(() => null);
          if (!ch || !ch.isTextBased?.()) continue;
          const messages = await ch.messages.fetch({ limit: 100 }).catch(() => null);
          if (!messages) continue;
          const toDelete = messages.filter((m) => now - m.createdTimestamp > 24 * 60 * 60 * 1000);
          if (toDelete.size === 0) continue;
          const deletable = toDelete.filter(
            (m) => now - m.createdTimestamp <= 14 * 24 * 60 * 60 * 1000
          );
          const old = toDelete.filter((m) => now - m.createdTimestamp > 14 * 24 * 60 * 60 * 1000);

          if (deletable.size > 0) {
            try {
              await ch.bulkDelete(deletable, true).catch(() => {});
            } catch (e) {}
          }
          for (const m of old.values()) {
            try {
              await m.delete().catch(() => {});
            } catch (e) {}
          }
        } catch (err) {
          console.error('ClearManager: Error auto-clearing channel', channelId, err);
        }
      }
    } catch (err) {
      console.error('ClearManager: scheduler top-level error:', err);
    }
  }, intervalMs);
  console.log('ClearManager: Auto-clear scheduler started.');
}

module.exports = {
  loadAutoClearChannels,
  enableAutoClear,
  disableAutoClear,
  isAutoClearEnabled,
  clearRecentMessages,
  startAutoClearScheduler,
};
