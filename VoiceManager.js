// VoiceManager.js — Discord voice (join + TTS speak)
// deps: @discordjs/voice, opusscript, ffmpeg-static, libsodium-wrappers (khuyến nghị)
const { synthesizeSpeech, writeTempMp3, cleanupTemp } = require('./Tts.js');

// Nạp encryption lib trước voice (Discord yêu cầu)
try {
  require('libsodium-wrappers');
} catch (_) {
  try {
    require('tweetnacl');
  } catch (_) {
    console.warn('⚠️ Voice: nên cài libsodium-wrappers để mã hóa voice ổn định hơn');
  }
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
    console.log('✅ VoiceManager: ffmpeg-static =', ffmpegPath);
  }
} catch {
  console.warn('⚠️ VoiceManager: không có ffmpeg-static');
}

/** @type {Map<string, { connection: any, channelId: string, guild: any }>} */
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

/**
 * Chờ connection sẵn sàng phát (Ready hoặc Connecting ổn định).
 */
async function waitUntilPlayable(connection, ms) {
  const { VoiceConnectionStatus, entersState } = voiceLib;
  const deadline = Date.now() + (ms || 25000);
  let lastErr = null;

  while (Date.now() < deadline) {
    const st = connection.state && connection.state.status;
    if (st === VoiceConnectionStatus.Ready) return true;
    if (st === VoiceConnectionStatus.Destroyed || st === VoiceConnectionStatus.Disconnected) {
      throw new Error('Connection destroyed/disconnected (status=' + st + ')');
    }
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, Math.min(8000, deadline - Date.now()));
      return true;
    } catch (e) {
      lastErr = e;
      // thử lại nếu vẫn Connecting / Signalling
      await new Promise(function (r) {
        setTimeout(r, 800);
      });
    }
  }
  throw lastErr || new Error('Timeout chờ Ready');
}

async function joinVoiceChannel(channel) {
  if (!voiceLib) {
    return {
      ok: false,
      message:
        '❌ Chưa có @discordjs/voice. package.json cần:\n' +
        '`@discordjs/voice` `opusscript` `ffmpeg-static` `libsodium-wrappers`',
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

    connections.set(guildId, {
      connection: connection,
      channelId: channel.id,
      guild: channel.guild,
    });

    connection.on('stateChange', function (oldS, newS) {
      console.log('[voice] ' + guildId + ' ' + oldS.status + ' -> ' + newS.status);
      if (newS.status === VoiceConnectionStatus.Destroyed) {
        const cur = connections.get(guildId);
        if (cur && cur.connection === connection) connections.delete(guildId);
      }
      // Tự rejoin nhẹ khi bị disconnect bất ngờ (một lần)
      if (
        newS.status === VoiceConnectionStatus.Disconnected &&
        oldS.status !== VoiceConnectionStatus.Destroyed
      ) {
        try {
          const { entersState, VoiceConnectionStatus: VCS } = voiceLib;
          Promise.race([
            entersState(connection, VCS.Signalling, 5000),
            entersState(connection, VCS.Connecting, 5000),
          ]).catch(function () {
            try {
              connection.destroy();
            } catch (_) {}
          });
        } catch (_) {}
      }
    });

    connection.on('error', function (err) {
      console.error('[voice] connection error', err);
    });

    try {
      await waitUntilPlayable(connection, 25000);
    } catch (e) {
      console.warn('[voice] wait Ready failed', e && e.message);
      // Vẫn giữ connection nếu chưa Destroyed — speak có thể retry
      const st = connection.state && connection.state.status;
      if (st === VoiceConnectionStatus.Destroyed) {
        destroyGuild(guildId);
        return {
          ok: false,
          message:
            '❌ Join fail (Destroyed). Kiểm tra quyền Connect+Speak.\n' +
            'Chi tiết: ' +
            String(e.message || e).slice(0, 120),
        };
      }
      return {
        ok: true,
        message:
          '⚠️ Đã vào <#' +
          channel.id +
          '> nhưng Ready chậm (' +
          st +
          ').\n' +
          'Thử `/voice action:speak text:test` — bot sẽ tự đợi/rejoin.',
      };
    }

    return {
      ok: true,
      message:
        '🔊 Đã vào <#' +
        channel.id +
        '> (Ready).\n`/voice action:speak text:Xin chào`',
    };
  } catch (e) {
    console.error('joinVoice error', e);
    destroyGuild(guildId);
    return { ok: false, message: '❌ Join lỗi: ' + String(e.message || e).slice(0, 180) };
  }
}

function leaveVoice(guildId) {
  const entry = connections.get(String(guildId));
  if (!entry || !entry.connection) {
    return {
      ok: false,
      message: 'ℹ️ Không track connection. Kick bot khỏi voice thủ công nếu còn treo.',
    };
  }
  destroyGuild(guildId);
  return { ok: true, message: '👋 Đã rời kênh voice.' };
}

/**
 * Tìm voice channel bot đang đứng (theo guild cache) — fallback khi Map lệch.
 */
function findBotVoiceChannel(guild, clientUserId) {
  if (!guild || !guild.channels) return null;
  try {
    const chans = guild.channels.cache.filter(function (c) {
      return typeof c.isVoiceBased === 'function' && c.isVoiceBased();
    });
    for (const [, ch] of chans) {
      if (ch.members && ch.members.has(clientUserId)) return ch;
    }
  } catch (_) {}
  return null;
}

async function ensureConnection(guildId, guild, clientUserId) {
  let entry = connections.get(String(guildId));
  if (entry && entry.connection) {
    try {
      await waitUntilPlayable(entry.connection, 12000);
      return entry;
    } catch (_) {
      // fall through → rejoin
    }
  }

  // Rejoin vào kênh bot đang có mặt, hoặc kênh user
  let channel = null;
  if (guild) {
    channel = findBotVoiceChannel(guild, clientUserId);
  }
  if (!channel) {
    throw new Error('NO_CHANNEL');
  }
  const r = await joinVoiceChannel(channel);
  if (!r.ok && !connections.has(String(guildId))) {
    throw new Error(r.message || 'rejoin failed');
  }
  entry = connections.get(String(guildId));
  if (!entry) throw new Error('rejoin no connection');
  await waitUntilPlayable(entry.connection, 20000);
  return entry;
}

async function speakInGuild(guildId, text, opts) {
  opts = opts || {};
  if (!voiceLib) return { ok: false, message: '❌ Chưa cài @discordjs/voice.' };

  const id = String(guildId);
  const guild = opts.guild || null;
  const clientUserId = opts.clientUserId || null;
  const userVoiceChannel = opts.userVoiceChannel || null;

  try {
    let entry = connections.get(id);

    // Nếu user đang trong voice mà bot chưa track → join kênh user
    if ((!entry || !entry.connection) && userVoiceChannel) {
      const jr = await joinVoiceChannel(userVoiceChannel);
      if (!jr.ok && !connections.has(id)) {
        return { ok: false, message: jr.message };
      }
      entry = connections.get(id);
    }

    if (!entry || !entry.connection) {
      try {
        entry = await ensureConnection(id, guild, clientUserId);
      } catch (e) {
        if (String(e.message) === 'NO_CHANNEL') {
          return {
            ok: false,
            message:
              '❌ Bot chưa trong voice.\n1. Bạn vào voice\n2. `/voice action:join`\n3. Rồi speak\nHoặc `/speak` lấy MP3.',
          };
        }
        return { ok: false, message: '❌ ' + String(e.message || e).slice(0, 200) };
      }
    }

    // Đợi Ready (retry)
    try {
      await waitUntilPlayable(entry.connection, 20000);
    } catch (e) {
      // Thử join lại kênh user
      if (userVoiceChannel) {
        const jr = await joinVoiceChannel(userVoiceChannel);
        entry = connections.get(id);
        if (!entry) {
          return {
            ok: false,
            message:
              '❌ Voice không Ready sau rejoin.\n' +
              String(e.message || e).slice(0, 100) +
              '\nDùng `/speak` nếu host chặn UDP.',
          };
        }
        await waitUntilPlayable(entry.connection, 20000);
      } else {
        return {
          ok: false,
          message:
            '❌ Connection chưa Ready: ' +
            String(e.message || e).slice(0, 120) +
            '\nThử join lại hoặc `/speak`.',
        };
      }
    }

    const buf = await synthesizeSpeech(text, 'vi');
    if (!buf) return { ok: false, message: '❌ TTS không tạo được audio.' };

    let filePath = null;
    try {
      filePath = await writeTempMp3(buf);
      const {
        createAudioPlayer,
        createAudioResource,
        AudioPlayerStatus,
        entersState,
        StreamType,
      } = voiceLib;

      const resource = createAudioResource(filePath, {
        inputType: StreamType ? StreamType.Arbitrary : undefined,
        inlineVolume: true,
      });
      if (resource.volume) {
        try {
          resource.volume.setVolume(1.0);
        } catch (_) {}
      }

      const player = createAudioPlayer();
      const sub = entry.connection.subscribe(player);
      if (!sub) {
        return { ok: false, message: '❌ Subscribe player thất bại (connection chết). Join lại.' };
      }

      player.play(resource);
      await entersState(player, AudioPlayerStatus.Playing, 15000);
      player.on('error', function (err) {
        console.warn('[voice] player error', err);
      });
      return { ok: true, message: '🗣️ Đang phát trong voice…' };
    } catch (e) {
      console.error('speakInGuild play', e);
      return {
        ok: false,
        message: '❌ Phát lỗi: ' + String(e.message || e).slice(0, 160),
      };
    } finally {
      if (filePath) {
        setTimeout(function () {
          cleanupTemp(filePath);
        }, 120000);
      }
    }
  } catch (e) {
    console.error('speakInGuild', e);
    return { ok: false, message: '❌ ' + String(e.message || e).slice(0, 200) };
  }
}

module.exports = {
  isVoiceAvailable: isVoiceAvailable,
  joinVoiceChannel: joinVoiceChannel,
  leaveVoice: leaveVoice,
  speakInGuild: speakInGuild,
  getConnection: function (gid) {
    return connections.get(String(gid)) || null;
  },
};
