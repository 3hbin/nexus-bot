// VoiceManager.js — join voice + phát TTS (cần @discordjs/voice + ffmpeg trên server)
const fs = require('fs');
const path = require('path');
const { synthesizeSpeech, writeTempMp3, cleanupTemp } = require('./Tts.js');

let voiceLib = null;
try {
  voiceLib = require('@discordjs/voice');
} catch {
  console.warn('⚠️ VoiceManager: chưa cài @discordjs/voice — /voice sẽ báo hướng dẫn cài.');
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
        '❌ Voice chưa sẵn sàng. Trên server bot chạy:\n' +
        '`npm i @discordjs/voice opusscript`\n' +
        'và cài **ffmpeg** (apt/yum/binary).',
    };
  }
  if (!channel || !channel.isVoiceBased()) {
    return { ok: false, message: '❌ Bạn cần vào một kênh voice trước, rồi dùng `/voice action:join`.' };
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

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    connections.set(channel.guild.id, { connection, channelId: channel.id });
    return { ok: true, message: `🔊 Đã vào <#${channel.id}>. Dùng \`/voice action:speak\` để đọc text.` };
  } catch (e) {
    console.error('joinVoice error', e);
    return { ok: false, message: `❌ Không join được voice: ${e.message || e}` };
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
    return { ok: false, message: '❌ Bot chưa join voice. Vào kênh voice rồi `/voice action:join`.' };
  }

  const buf = await synthesizeSpeech(text, 'vi');
  if (!buf) return { ok: false, message: '❌ Không tạo được audio TTS.' };

  let filePath = null;
  try {
    filePath = await writeTempMp3(buf);
    const { createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState } = voiceLib;
    const player = createAudioPlayer();
    const resource = createAudioResource(filePath);
    entry.connection.subscribe(player);
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 5_000);
    // Không block đến hết bài — Discord giữ player
    player.on('error', (err) => console.warn('Audio player error', err));
    return { ok: true, message: '🗣️ Đang phát trong voice…' };
  } catch (e) {
    console.error('speakInGuild', e);
    return { ok: false, message: `❌ Phát voice lỗi: ${e.message || e}` };
  } finally {
    // Xóa file sau vài giây
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
