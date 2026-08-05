// VoiceManager.js — join voice + phát TTS
// Cần: @discordjs/voice, opusscript, (tuỳ chọn) ffmpeg-static
const { synthesizeSpeech, writeTempMp3, cleanupTemp } = require('./Tts.js');

let voiceLib = null;
try {
  voiceLib = require('@discordjs/voice');
} catch {
  console.warn('⚠️ VoiceManager: chưa cài @discordjs/voice');
}

try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    console.log('✅ VoiceManager: ffmpeg-static OK');
  }
} catch {
  console.warn('⚠️ VoiceManager: không có ffmpeg-static');
}

/** guildId -> { connection, channelId } */
const connections = new Map();

function isVoiceAvailable() {
  return !!voiceLib;
}

function getConnection(guildId) {
  return connections.get(String(guildId)) || null;
}

/**
 * Join voice. Lưu connection ngay khi join() — dù Ready chậm vẫn track được.
 */
async function joinVoiceChannel(channel) {
  if (!voiceLib) {
    return {
      ok: false,
      message:
        '❌ Voice chưa sẵn sàng. Cần: `@discordjs/voice` · `opusscript` · `ffmpeg-static` rồi redeploy.',
    };
  }
  if (!channel || typeof channel.isVoiceBased !== 'function' || !channel.isVoiceBased()) {
    return {
      ok: false,
      message: '❌ Vào kênh **voice** trước, rồi `/voice action:join`.',
    };
  }

  const { joinVoiceChannel: join, VoiceConnectionStatus, entersState } = voiceLib;
  const guildId = channel.guild.id;

  const old = connections.get(guildId);
  if (old && old.connection) {
    try {
      old.connection.destroy();
    } catch (_) {}
    connections.delete(guildId);
  }

  let connection;
  try {
    connection = join({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    // Lưu NGAY — tránh bot đã vào voice mà Map trống khi Ready timeout
    connections.set(guildId, { connection: connection, channelId: channel.id });

    connection.on('stateChange', function (oldState, newState) {
      console.log('Voice state ' + guildId + ': ' + oldState.status + ' -> ' + newState.status);
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        const cur = connections.get(guildId);
        if (cur && cur.connection === connection) connections.delete(guildId);
      }
    });

    connection.on('error', function (err) {
      console.error('Voice connection error', err);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (waitErr) {
      const status = connection.state && connection.state.status;
      console.warn('entersState Ready timeout, status=', status, waitErr && waitErr.message);
      if (
        status === VoiceConnectionStatus.Destroyed ||
        status === VoiceConnectionStatus.Disconnected
      ) {
        try {
          connection.destroy();
        } catch (_) {}
        connections.delete(guildId);
        return {
          ok: false,
          message:
            '❌ Join voice thất bại (timeout/disconnect).\n' +
            '• Kiểm tra quyền **Connect + Speak**\n' +
            '• Render free hay lỗi UDP — thử lại hoặc dùng `/speak` (MP3)',
        };
      }
    }

    return {
      ok: true,
      message:
        '🔊 Đã vào <#' +
        channel.id +
        '>.\nDùng `/voice action:speak text:Xin chào` để đọc.',
    };
  } catch (e) {
    console.error('joinVoice error', e);
    if (connection) {
      try {
        connection.destroy();
      } catch (_) {}
    }
    connections.delete(guildId);
    return {
      ok: false,
      message: '❌ Không join được: ' + String(e.message || e).slice(0, 180),
    };
  }
}

function leaveVoice(guildId) {
  const id = String(guildId);
  const entry = connections.get(id);
  if (!entry || !entry.connection) {
    return {
      ok: false,
      message:
        'ℹ️ Code không còn track connection (bot có thể vẫn hiện trong voice vài giây).\n' +
        'Thử `/voice action:join` lại rồi `leave`, hoặc kick bot khỏi voice bằng tay.',
    };
  }
  try {
    entry.connection.destroy();
  } catch (_) {}
  connections.delete(id);
  return { ok: true, message: '👋 Đã rời kênh voice.' };
}

async function speakInGuild(guildId, text) {
  if (!voiceLib) {
    return { ok: false, message: '❌ Chưa cài @discordjs/voice.' };
  }

  const id = String(guildId);
  const entry = connections.get(id);

  if (!entry || !entry.connection) {
    return {
      ok: false,
      message:
        '❌ Bot chưa được track trong voice.\n' +
        '1. Vào kênh voice\n' +
        '2. `/voice action:join` (đợi báo thành công)\n' +
        '3. Rồi `/voice action:speak text:...`\n' +
        'Hoặc dùng `/speak text:...` để nhận file MP3.',
    };
  }

  try {
    const { VoiceConnectionStatus, entersState } = voiceLib;
    if (entry.connection.state && entry.connection.state.status !== VoiceConnectionStatus.Ready) {
      await entersState(entry.connection, VoiceConnectionStatus.Ready, 10_000);
    }
  } catch (e) {
    return {
      ok: false,
      message:
        '❌ Connection voice chưa Ready. Gọi lại `/voice action:join` rồi speak.\n' +
        '(' +
        String(e.message || e).slice(0, 120) +
        ')',
    };
  }

  const buf = await synthesizeSpeech(text, 'vi');
  if (!buf) return { ok: false, message: '❌ Không tạo được audio TTS.' };

  let filePath = null;
  try {
    filePath = await writeTempMp3(buf);
    const { createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState } = voiceLib;
    const resource = createAudioResource(filePath);
    const player = createAudioPlayer();
    entry.connection.subscribe(player);
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 10_000);
    player.on('error', function (err) {
      console.warn('Audio player error', err);
    });
    return { ok: true, message: '🗣️ Đang phát trong voice…' };
  } catch (e) {
    console.error('speakInGuild', e);
    return {
      ok: false,
      message:
        '❌ Phát lỗi: ' +
        String(e.message || e).slice(0, 150) +
        '\nThử `/speak` (file MP3) — ổn định hơn trên Render.',
    };
  } finally {
    if (filePath) {
      setTimeout(function () {
        cleanupTemp(filePath);
      }, 90_000);
    }
  }
}

module.exports = {
  isVoiceAvailable: isVoiceAvailable,
  joinVoiceChannel: joinVoiceChannel,
  leaveVoice: leaveVoice,
  speakInGuild: speakInGuild,
  getConnection: getConnection,
};
