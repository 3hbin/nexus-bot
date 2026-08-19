// VoiceListener.js — Nghe real-time từ voice channel (chat thoại 2 chiều)
// User nói trong voice → Opus → PCM → WAV → Gemini (audio) → speakInGuild
// Mỗi câu nói = 1 lần gọi Gemini (tốn quota nhanh hơn chat chữ).

const prism = require('prism-media');
const { EndBehaviorType } = require('@discordjs/voice');
const { getVoiceConnectionFor, speakInGuild } = require('./VoiceManager.js');

/** @type {Map<string, { speakingHandler: Function, connection: any, textChannel: any, opts: object, processing: boolean, activeStreams: Set }>} */
const listeners = new Map();

const SILENCE_MS = 900; // im lặng ~900ms → hết câu
const MIN_DURATION_MS = 350; // bỏ đoạn quá ngắn (tiếng ồn)
const MAX_DURATION_MS = 20000; // giới hạn 1 đoạn nói ~20s
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // 16-bit
const BYTES_PER_MS = (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE) / 1000; // ~192

/**
 * Tạo WAV header chuẩn 44 byte + ghép PCM (16-bit LE, stereo, 48kHz)
 */
function pcmToWav(pcmBuffer, sampleRate = SAMPLE_RATE, channels = CHANNELS, bitDepth = 16) {
  const dataSize = pcmBuffer.length;
  const byteRate = (sampleRate * channels * bitDepth) / 8;
  const blockAlign = (channels * bitDepth) / 8;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);
  return buffer;
}

function isListening(guildId) {
  return listeners.has(String(guildId));
}

/**
 * Bắt đầu nghe trong guild (cần bot đã join voice trước).
 * @param {string} guildId
 * @param {object} opts
 * @param {import('discord.js').Client} opts.client
 * @param {import('@google/genai').GoogleGenAI} opts.ai
 * @param {string} [opts.model]
 * @param {string} [opts.systemInstruction]
 * @param {import('discord.js').TextBasedChannel} [opts.textChannel] — gửi transcript/reply text (tuỳ chọn)
 * @param {string} [opts.gender] — giọng TTS nam/nu
 * @param {function} [opts.onError]
 */
function startListening(guildId, opts = {}) {
  const id = String(guildId);
  if (listeners.has(id)) {
    return { ok: true, message: '🎙️ Đã đang nghe trong guild này rồi.' };
  }

  const connection = getVoiceConnectionFor(id);
  if (!connection) {
    return {
      ok: false,
      message:
        '❌ Bot chưa vào voice channel.\n' +
        'Vào kênh voice → `/join` hoặc `/listen mode:on` (bot sẽ tự join).',
    };
  }

  if (!opts.ai) {
    return { ok: false, message: '❌ Chưa có Gemini client (thiếu GEMINI_API_KEY).' };
  }

  const client = opts.client;
  const model = opts.model || 'gemini-2.0-flash' || process.env.DEFAULT_MODEL || 'gemini-2.0-flash';
  const systemInstruction =
    opts.systemInstruction ||
    'Bạn đang trong cuộc gọi thoại Discord với người dùng. ' +
      'Nghe audio, hiểu nội dung, trả lời NGẮN GỌN (1–3 câu), tự nhiên như đang nói chuyện. ' +
      'Không dùng markdown, không list dài, không code trừ khi bị hỏi rõ. ' +
      'Trả lời bằng cùng ngôn ngữ người dùng đang nói (thường tiếng Việt). ' +
      'Thêm emoji nhẹ nếu phù hợp.';

  const entry = {
    speakingHandler: null,
    connection,
    textChannel: opts.textChannel || null,
    opts: { ...opts, model, systemInstruction },
    processing: false,
    activeStreams: new Set(),
  };

  const speakingHandler = (userId) => {
    if (!client || !client.user) return;
    // Bỏ qua chính bot (không tự nghe mình)
    if (String(userId) === String(client.user.id)) return;
    // Đang xử lý câu trước → bỏ qua chồng chéo
    if (entry.processing) return;

    let opusStream;
    try {
      opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SILENCE_MS,
        },
      });
    } catch (e) {
      console.warn('[VoiceListener] subscribe fail', e && e.message);
      return;
    }

    entry.activeStreams.add(opusStream);

    const decoder = new prism.opus.Decoder({
      rate: SAMPLE_RATE,
      channels: CHANNELS,
      frameSize: 960,
    });

    const pcmChunks = [];
    let totalBytes = 0;
    let forceEnded = false;

    const maxTimer = setTimeout(() => {
      forceEnded = true;
      try {
        opusStream.destroy();
      } catch (_) {}
    }, MAX_DURATION_MS);

    decoder.on('data', (chunk) => {
      if (chunk && chunk.length) {
        pcmChunks.push(chunk);
        totalBytes += chunk.length;
      }
    });

    const cleanupStream = () => {
      clearTimeout(maxTimer);
      entry.activeStreams.delete(opusStream);
      try {
        opusStream.unpipe(decoder);
      } catch (_) {}
      try {
        decoder.destroy();
      } catch (_) {}
      try {
        opusStream.destroy();
      } catch (_) {}
    };

    opusStream.on('error', (err) => {
      console.warn('[VoiceListener] opus stream error', err && err.message);
      cleanupStream();
    });

    decoder.on('error', (err) => {
      console.warn('[VoiceListener] decoder error', err && err.message);
      cleanupStream();
    });

    opusStream.once('end', async () => {
      cleanupStream();
      if (forceEnded) {
        console.log('[VoiceListener] cắt đoạn >20s');
      }

      const durationMs = totalBytes / BYTES_PER_MS;
      if (durationMs < MIN_DURATION_MS || totalBytes < 2000) {
        // Quá ngắn / tiếng ồn
        return;
      }

      if (entry.processing) return;
      entry.processing = true;

      try {
        const pcm = Buffer.concat(pcmChunks);
        const wav = pcmToWav(pcm);
        const base64 = wav.toString('base64');

        // Gọi Gemini 1 lần: STT + trả lời (audio → text)
        // Lưu ý: mỗi câu nói = 1 request → tốn quota nhanh hơn chat chữ.
        const result = await opts.ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/wav',
                    data: base64,
                  },
                },
                {
                  text:
                    'Đây là tin nhắn thoại từ người dùng trong Discord voice. ' +
                    'Hãy nghe, hiểu, và trả lời ngắn gọn như đang gọi điện.',
                },
              ],
            },
          ],
          config: {
            systemInstruction,
            maxOutputTokens: 512,
          },
        });

        let replyText =
          (result && result.text) ||
          (result?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ')) ||
          '';
        replyText = String(replyText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 800);

        if (!replyText) {
          replyText = 'Mình chưa nghe rõ lắm, bạn nói lại được không?';
        }

        // Gửi text feedback (nếu có kênh)
        if (entry.textChannel && typeof entry.textChannel.send === 'function') {
          try {
            await entry.textChannel
              .send({
                content: `🎙️ **Nghe được:** _(voice)_\n💬 ${replyText.slice(0, 1500)}`,
              })
              .catch(() => {});
          } catch (_) {}
        }

        // Đọc to trong voice (tái sử dụng speakInGuild)
        const gender = opts.gender || 'nu';
        const speakResult = await speakInGuild(id, replyText, {
          gender,
          userVoiceChannel: null,
        });

        if (speakResult && speakResult.fallback && speakResult.mp3Buffer && entry.textChannel) {
          try {
            const { AttachmentBuilder } = require('discord.js');
            await entry.textChannel
              .send({
                content: '📎 Voice UDP chưa Ready — gửi MP3 thay thế.',
                files: [new AttachmentBuilder(speakResult.mp3Buffer, { name: 'nexus_voice_reply.mp3' })],
              })
              .catch(() => {});
          } catch (_) {}
        }
      } catch (err) {
        console.error('[VoiceListener] Gemini / speak error:', err && err.message);
        if (typeof opts.onError === 'function') {
          try {
            opts.onError(err);
          } catch (_) {}
        }
        if (entry.textChannel) {
          const msg = String(err && err.message || err).slice(0, 180);
          entry.textChannel
            .send({
              content:
                '⚠️ **Lỗi khi xử lý thoại** (Gemini / quota / mạng):\n' +
                '`' +
                msg +
                '`\n' +
                'Thử nói lại hoặc `/listen mode:off` rồi bật lại.',
            })
            .catch(() => {});
        }
      } finally {
        entry.processing = false;
      }
    });

    // Pipe Opus → Decoder
    try {
      opusStream.pipe(decoder);
    } catch (e) {
      console.warn('[VoiceListener] pipe fail', e && e.message);
      cleanupStream();
    }
  };

  entry.speakingHandler = speakingHandler;
  connection.receiver.speaking.on('start', speakingHandler);

  // Dọn khi connection bị destroy
  const onState = (oldState, newState) => {
    try {
      const { VoiceConnectionStatus } = require('@discordjs/voice');
      if (
        newState.status === VoiceConnectionStatus.Destroyed ||
        newState.status === VoiceConnectionStatus.Disconnected
      ) {
        stopListening(id);
      }
    } catch (_) {}
  };
  connection.on('stateChange', onState);
  entry._onState = onState;

  listeners.set(id, entry);

  return {
    ok: true,
    message:
      '🎙️ **Đã bật nghe thoại 2 chiều**\n' +
      '• Nói trong voice channel → bot nghe → trả lời bằng giọng\n' +
      '• Im lặng ~1 giây = hết câu\n' +
      '• Tắt: `/listen mode:off` hoặc `/leave`\n\n' +
      '⚠️ **Lưu ý host free (Render/Railway/Replit):** UDP voice 2 chiều (vừa nhận vừa gửi) thường **không ổn định**. ' +
      'Nếu bot không nghe/không nói được, thử VPS hoặc chỉ dùng `/speak` + tin nhắn thoại.\n' +
      '💡 Mỗi câu nói = 1 lần gọi Gemini → tốn quota nhanh hơn chat chữ.',
  };
}

/**
 * Dừng nghe + dọn stream/listener (tránh rò rỉ bộ nhớ)
 */
function stopListening(guildId) {
  const id = String(guildId);
  const entry = listeners.get(id);
  if (!entry) {
    return { ok: true, message: 'ℹ️ Không có phiên nghe nào đang chạy.' };
  }

  try {
    if (entry.connection && entry.speakingHandler) {
      entry.connection.receiver.speaking.off('start', entry.speakingHandler);
    }
  } catch (_) {}

  try {
    if (entry.connection && entry._onState) {
      entry.connection.off('stateChange', entry._onState);
    }
  } catch (_) {}

  if (entry.activeStreams) {
    for (const s of entry.activeStreams) {
      try {
        s.destroy();
      } catch (_) {}
    }
    entry.activeStreams.clear();
  }

  listeners.delete(id);
  return { ok: true, message: '🔇 Đã tắt nghe thoại 2 chiều.' };
}

module.exports = {
  startListening,
  stopListening,
  isListening,
  pcmToWav, // export nếu cần test
};
