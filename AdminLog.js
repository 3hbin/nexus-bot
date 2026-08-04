// AdminLog.js — gửi log sự kiện vào kênh admin (nếu cấu hình)
const { EmbedBuilder } = require('discord.js');

const ADMIN_LOG_CHANNEL_ID = (process.env.ADMIN_LOG_CHANNEL_ID || '').trim();

/** @type {import('discord.js').Client|null} */
let clientRef = null;

function setAdminLogClient(client) {
  clientRef = client;
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {number} [opts.color]
 * @param {{name:string,value:string,inline?:boolean}[]} [opts.fields]
 */
async function adminLog({ title, description = '', color = 0x5865f2, fields = [] }) {
  if (!ADMIN_LOG_CHANNEL_ID || !clientRef) return;
  try {
    const ch = await clientRef.channels.fetch(ADMIN_LOG_CHANNEL_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle(title.slice(0, 256))
      .setDescription((description || '').slice(0, 4000))
      .setColor(color)
      .setTimestamp(new Date());
    if (fields.length) {
      embed.addFields(
        fields.slice(0, 20).map((f) => ({
          name: String(f.name).slice(0, 256),
          value: String(f.value).slice(0, 1024),
          inline: !!f.inline,
        }))
      );
    }
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {
    console.warn('AdminLog error:', e && e.message);
  }
}

module.exports = {
  setAdminLogClient,
  adminLog,
  ADMIN_LOG_CHANNEL_ID,
};
