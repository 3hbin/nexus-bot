// VoiceManager.js — join voice + phát TTS
// Cần: @discordjs/voice, opusscript, (tuỳ chọn) ffmpeg-static
const { synthesizeSpeech, writeTempMp3, cleanupTemp } = require('./Tts.js');

let voiceLib = null;
try {
  voiceLib = require('@discordjs/voice');
} catch {
  console.warn('⚠️ VoiceManager: chưa cài @discordjs/voice — /voice sẽ báo hướng dẫn cài.');
}

// Ưu tiên ffmpeg-static nếu có (Render-friendly)
try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath && voiceLib) {
    process.env.FFMPEG_PATH = ffmpegPath;
    try {
      const { generateDependencyReport } = voiceLib;
      // optional: log report once
    } catch (_) {}
    console.log('✅ VoiceManager: dùng ffmpeg-static');
  }
} catch {
  console.warn('⚠️ VoiceManager: không có ffmpeg-static — speak có thể cần ffmpeg hệ thống.');
}

/** guildId -> { connection, channelId } */
const connections = new Map();

function isVoiceAvailable() {
  return !!voiceLib;
}

/**
 * Join voice channel của member.
 * @param {import('discord.js').VoiceChannel|import('discord.js').StageChannel} channel
 */
async function joinVoiceChannel(channel) {
  if (!voiceLib) {
    return {
      ok: false,
      message:
        '❌ Voice chưa sẵn sàng. Thêm vào package.json rồi redeploy:\n' +
        '`@discordjs/voice` · `opusscript` · `ffmpeg-static`',
    };
  }
  if (!channel || !channel.isVoiceBased?.()) {
    return {
      ok: false,
      message: '❌ Bạn cần vào một kênh **voice** trước, rồi dùng `/voice action:join`.',
    };
  }

  const { joinVoiceChannel: join, VoiceConnectionStatus, entersState } = voiceLib;
  try {
    const old = connections.get(channel.guild.id);
    if (old?.connection) {
      try {
        old.connection.destroy();
      } catch (_) {}
    }

    const connection = join({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    // Timeout 12s — caller đã deferReply
    await entersState(connection, VoiceConnectionStatus.Ready, 12_000);
    connections.set(channel.guild.id, { connection, channelId: channel.id });
    return {
      ok: true,
      message: `🔊 Đã vào <#${channel.id}>. Dùng \`/voice action:speak text:...\` để đọc.`,
    };
  } catch (e) {
    console.error('joinVoice error', e);
    const msg = e && e.message ? String(e.message) : String(e);
    return {
      ok: false,
      message:
        `❌ Không join được voice: ${msg.slice(0, 200)}\n` +
        `• Kiểm tra quyền **Connect + Speak** của bot\n` +
        `• Render free đôi khi chặn UDP voice — thử lại hoặc dùng \`/speak\` (MP3)`,
    };
  }
}

function leaveVoice(guildId) {
  const entry = connections.get(String(guildId));
  if (!entry) return { ok: false, message: 'ℹ️ Bot không nằm trong voice nào.' };
  try {
    entry.connection.destroy();
  } catch (_) {}
  connections.delete(String(guildId));
  return { ok: true, message: '👋 Đã rời kênh voice.' };
}

/**
 * Đọc text trong voice hiện tại (TTS → mp3 → play).
 */
async function speakInGuild(guildId, text) {
  if (!voiceLib) {
    return { ok: false, message: '❌ Chưa cài @discordjs/voice.' };
  }
  const entry = connections.get(String(guildId));
  if (!entry?.connection) {
    return {
      ok: false,
      message: '❌ Bot chưa join voice. Vào kênh voice rồi `/voice action:join`.',
    };
  }

  const buf = await synthesizeSpeech(text, 'vi');
  if (!buf) return { ok: false, message: '❌ Không tạo được audio TTS.' };

  let filePath = null;
  try {
    filePath = await writeTempMp3(buf);
    const { createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState } = voiceLib;

    // Nếu có ffmpeg-static, createAudioResource dùng được mp3
    const resource = createAudioResource(filePath);
    const player = createAudioPlayer();
    entry.connection.subscribe(player);
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 8_000);
    player.on('error', (err) => console.warn('Audio player error', err));
    return { ok: true, message: '🗣️ Đang phát trong voice…' };
  } catch (e) {
    console.error('speakInGuild', e);
    return {
      ok: false,
      message:
        `❌ Phát voice lỗi: ${(e && e.message) || e}\n` +
        `Thử \`/speak\` để nhận file MP3 thay thế.`,
    };
  } finally {
    if (filePath) {
      setTimeout(() => cleanupTemp(filePath), 60_000);
    }
  }
}

module.exports = {
  isVoiceAvailable,
  joinVoiceChannel,
  leaveVoice,
  speakInGuild,
};
