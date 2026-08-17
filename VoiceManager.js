// VoiceManager.js — Discord voice + fallback MP3 khi Ready/UDP fail
const { synthesizeSpeech, writeTempMp3, cleanupTemp } = require('./Tts.js');

try {
  require('libsodium-wrappers');
} catch (_) {
  try {
    require('tweetnacl');
  } catch (_) {}
}

let voiceLib = null;
try {
  voiceLib = require('@discordjs/voice');
} catch {
  console.warn('⚠️ VoiceManager: chưa cài @discordjs/voice');
}

let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFMPEG_BIN = ffmpegPath;
  }
} catch (_) {}

/** @type {Map<string, { connection: any, channelId: string }>} */
const connections = new Map();

function isVoiceAvailable() {
  return !!voiceLib;
}

function destroyGuild(guildId) {
  const id = String(guildId);
  const entry = connections.get(id);
  if (entry && entry.connection) {
    try {
      entry.connection.destroy();
    } catch (_) {}
  }
  connections.delete(id);
}

async function waitUntilPlayable(connection, ms) {
  const { VoiceConnectionStatus, entersState } = voiceLib;
  const deadline = Date.now() + (ms || 20000);
  let lastErr = null;
  while (Date.now() < deadline) {
    const st = connection.state && connection.state.status;
    if (st === VoiceConnectionStatus.Ready) return true;
    if (st === VoiceConnectionStatus.Destroyed || st === VoiceConnectionStatus.Disconnected) {
      throw new Error('Connection ' + st);
    }
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, Math.min(6000, deadline - Date.now()));
      return true;
    } catch (e) {
      lastErr = e;
      await new Promise(function (r) {
        setTimeout(r, 600);
      });
    }
  }
  throw lastErr || new Error('Timeout Ready');
}

async function joinVoiceChannel(channel) {
  if (!voiceLib) {
    return {
      ok: false,
      message:
        '❌ Chưa có @discordjs/voice. Cần deps voice trong package.json.\n' +
        'Tạm dùng `/speak text:...` để nhận MP3.',
    };
  }
  if (!channel || typeof channel.isVoiceBased !== 'function' || !channel.isVoiceBased()) {
    return { ok: false, message: '❌ Vào kênh voice trước, rồi /voice action:join' };
  }

  const { joinVoiceChannel: join, VoiceConnectionStatus } = voiceLib;
  const guildId = channel.guild.id;
  destroyGuild(guildId);

  let connection;
  try {
    connection = join({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    connections.set(guildId, { connection: connection, channelId: channel.id });

    connection.on('stateChange', function (oldS, newS) {
      console.log('[voice] ' + guildId + ' ' + oldS.status + ' -> ' + newS.status);
      if (newS.status === VoiceConnectionStatus.Destroyed) {
        const cur = connections.get(guildId);
        if (cur && cur.connection === connection) connections.delete(guildId);
      }
    });
    connection.on('error', function (err) {
      console.error('[voice] error', err);
    });

    try {
      await waitUntilPlayable(connection, 18000);
      return {
        ok: true,
        message: '🔊 Đã vào <#' + channel.id + '> (Ready).\n`/voice action:speak text:...`',
      };
    } catch (e) {
      const st = connection.state && connection.state.status;
      console.warn('[voice] Ready fail', st, e && e.message);
      // Giữ connection phòng speak retry; báo rõ có fallback MP3
      return {
        ok: true,
        partial: true,
        message:
          '⚠️ Bot đã vào <#' +
          channel.id +
          '> nhưng voice **chưa Ready** (host/UDP).\n' +
          'Thử `/voice action:speak` — nếu fail sẽ **tự gửi file MP3**.\n' +
          'Hoặc dùng `/speak text:...` luôn.',
      };
    }
  } catch (e) {
    destroyGuild(guildId);
    return {
      ok: false,
      message:
        '❌ Join lỗi: ' +
        String(e.message || e).slice(0, 150) +
        '\nDùng `/speak text:...` (MP3).',
    };
  }
}

function leaveVoice(guildId) {
  const entry = connections.get(String(guildId));
  if (!entry || !entry.connection) {
    return { ok: false, message: 'ℹ️ Không track connection. Kick bot khỏi voice nếu còn treo.' };
  }
  destroyGuild(guildId);
  return { ok: true, message: '👋 Đã rời kênh voice.' };
}

/**
 * @returns {Promise<{ ok: boolean, message: string, mp3Buffer?: Buffer }>}
 */
async function speakInGuild(guildId, text, opts) {
  opts = opts || {};
  const id = String(guildId);

  // Luôn tạo TTS trước — dùng cho voice hoặc fallback MP3
  let audioBuf = null;
  try {
    const gender = opts.gender || opts.voiceGender || 'nu';
    audioBuf = await synthesizeSpeech(text, gender);
  } catch (e) {
    console.warn('TTS fail', e && e.message);
  }
  if (!audioBuf) {
    return { ok: false, message: '❌ Không tạo được audio TTS.' };
  }

  async function fallbackMp3(reason) {
    console.warn('[voice] fallback MP3:', reason);
    return {
      ok: true,
      fallback: true,
      mp3Buffer: audioBuf,
      message:
        '📎 **Voice UDP không Ready trên host** — gửi file MP3 thay thế.\n' +
        '_(Trên VPS voice trong kênh sẽ ổn hơn)_\n' +
        'Lý do: ' +
        String(reason || '').slice(0, 100),
    };
  }

  if (!voiceLib) {
    return fallbackMp3('chưa cài @discordjs/voice');
  }

  // Join kênh user nếu chưa có connection
  if (opts.userVoiceChannel) {
    const entry0 = connections.get(id);
    if (!entry0 || !entry0.connection) {
      await joinVoiceChannel(opts.userVoiceChannel);
    }
  }

  let entry = connections.get(id);
  if (!entry || !entry.connection) {
    return fallbackMp3('bot chưa trong voice');
  }

  try {
    await waitUntilPlayable(entry.connection, 15000);
  } catch (e) {
    // Thử rejoin 1 lần
    if (opts.userVoiceChannel) {
      try {
        await joinVoiceChannel(opts.userVoiceChannel);
        entry = connections.get(id);
        if (entry && entry.connection) {
          await waitUntilPlayable(entry.connection, 12000);
        } else {
          return fallbackMp3(e.message || 'rejoin fail');
        }
      } catch (e2) {
        return fallbackMp3(e2.message || e.message || 'Ready aborted');
      }
    } else {
      return fallbackMp3(e.message || 'Ready aborted');
    }
  }

  entry = connections.get(id);
  if (!entry || !entry.connection) {
    return fallbackMp3('mất connection');
  }

  let filePath = null;
  try {
    filePath = await writeTempMp3(audioBuf);
    const { createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, StreamType } =
      voiceLib;

    const resource = createAudioResource(filePath, {
      inputType: StreamType ? StreamType.Arbitrary : undefined,
      inlineVolume: true,
    });
    const player = createAudioPlayer();
    const sub = entry.connection.subscribe(player);
    if (!sub) return fallbackMp3('subscribe fail');

    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 12000);
    player.on('error', function (err) {
      console.warn('[voice] player', err);
    });
    return { ok: true, message: '🗣️ Đang phát trong voice…' };
  } catch (e) {
    console.error('speak play error', e);
    return fallbackMp3(e.message || 'play aborted');
  } finally {
    if (filePath) {
      setTimeout(function () {
        cleanupTemp(filePath);
      }, 120000);
    }
  }
}

module.exports = {
  isVoiceAvailable: isVoiceAvailable,
  joinVoiceChannel: joinVoiceChannel,
  leaveVoice: leaveVoice,
  speakInGuild: speakInGuild,
};
