// VoiceListener.js — Nghe real-time từ voice channel (chat thoại 2 chiều)
// User nói trong voice → Opus → PCM → WAV → Gemini (audio) → speakInGuild
// Mỗi câu nói = 1 lần gọi Gemini (tốn quota nhanh hơn chat chữ).
//
// DEBUG: mọi log quan trọng có tiền tố [VoiceListener] — xem log host khi /listen không phản hồi.

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

// ---------------------------------------------------------------------------
// Kiểm tra backend Opus lúc load module (prism-media cần @discordjs/opus HOẶC opusscript)
// ---------------------------------------------------------------------------
let opusBackend = 'unknown';
try {
  // prism-media tự require theo thứ tự ưu tiên
  require('@discordjs/opus');
  opusBackend = '@discordjs/opus (native)';
} catch (e1) {
  try {
    require('opusscript');
    opusBackend = 'opusscript (pure JS)';
  } catch (e2) {
    opusBackend = 'NONE — THIẾU CẢ @discordjs/opus LẪN opusscript!';
  }
}
console.log(`[VoiceListener] Module loaded. Opus backend: ${opusBackend}`);
if (opusBackend.startsWith('NONE')) {
  console.error(
    '[VoiceListener] ⚠️ prism-media KHÔNG decode được Opus nếu thiếu backend. ' +
      'Cần cài: npm i opusscript  (hoặc @discordjs/opus nếu host hỗ trợ native).'
  );
}

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
  console.log(`[VoiceListener] startListening() gọi cho guild=${id} lúc ${new Date().toISOString()}`);

  if (listeners.has(id)) {
    console.log(`[VoiceListener] Đã có listener cho guild=${id} → bỏ qua`);
    return { ok: true, message: '🎙️ Đã đang nghe trong guild này rồi.' };
  }

  const connection = getVoiceConnectionFor(id);
  if (!connection) {
    console.warn(`[VoiceListener] Không có connection cho guild=${id}`);
    return {
      ok: false,
      message:
        '❌ Bot chưa vào voice channel.\n' +
        'Vào kênh voice → `/join` hoặc `/listen mode:on` (bot sẽ tự join).',
    };
  }

  // --- Log trạng thái connection + joinConfig (điểm 2 + 6) ---
  const status = connection.state && connection.state.status;
  console.log(`[VoiceListener] connection.state.status = ${status}`);
  try {
    if (connection.joinConfig) {
      console.log(
        `[VoiceListener] joinConfig: channelId=${connection.joinConfig.channelId} ` +
          `guildId=${connection.joinConfig.guildId} ` +
          `selfDeaf=${connection.joinConfig.selfDeaf} selfMute=${connection.joinConfig.selfMute}`
      );
    }
  } catch (e) {
    console.warn('[VoiceListener] Không đọc được joinConfig:', e && e.message);
  }

  // Log mute/deaf thực tế của bot member (nếu client + guild available)
  try {
    const client = opts.client;
    if (client && client.guilds) {
      const guild = client.guilds.cache.get(id);
      const me = guild && guild.members.me;
      if (me && me.voice) {
        console.log(
          `[VoiceListener] bot member voice: ` +
            `channelId=${me.voice.channelId} ` +
            `serverMute=${me.voice.serverMute} serverDeaf=${me.voice.serverDeaf} ` +
            `selfMute=${me.voice.selfMute} selfDeaf=${me.voice.selfDeaf}`
        );
      } else {
        console.log('[VoiceListener] Không lấy được bot member.voice (chưa cache / chưa join?)');
      }
    }
  } catch (e) {
    console.warn('[VoiceListener] Lỗi khi log bot mute/deaf:', e && e.message);
  }

  if (!opts.ai) {
    console.warn('[VoiceListener] opts.ai thiếu');
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
    // --- Điểm 1: speaking event có fire không? ---
    const ts = new Date().toISOString();
    console.log(`[VoiceListener] speaking START userId=${userId} tại ${ts}`);

    if (!client || !client.user) {
      console.warn('[VoiceListener] client/user chưa sẵn sàng → bỏ qua');
      return;
    }
    // Bỏ qua chính bot (không tự nghe mình)
    if (String(userId) === String(client.user.id)) {
      console.log(`[VoiceListener] Bỏ qua chính bot (userId=${userId})`);
      return;
    }
    // Đang xử lý câu trước → bỏ qua chồng chéo
    if (entry.processing) {
      console.log(`[VoiceListener] entry.processing=true → bỏ qua userId=${userId} (đang xử lý câu trước)`);
      return;
    }

    // --- Điểm 2: status ngay trước subscribe ---
    const statusNow = connection.state && connection.state.status;
    console.log(`[VoiceListener] Trước subscribe: connection.state.status=${statusNow}`);

    let opusStream;
    try {
      opusStream = connection.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: SILENCE_MS,
        },
      });
      console.log(`[VoiceListener] subscribe() OK cho userId=${userId}`);
    } catch (e) {
      console.warn('[VoiceListener] subscribe fail', e && e.message, e && e.stack);
      return;
    }

    entry.activeStreams.add(opusStream);

    let decoder;
    try {
      decoder = new prism.opus.Decoder({
        rate: SAMPLE_RATE,
        channels: CHANNELS,
        frameSize: 960,
      });
      console.log(`[VoiceListener] Tạo prism.opus.Decoder OK (backend=${opusBackend})`);
    } catch (decErr) {
      console.error(
        '[VoiceListener] Không tạo được Decoder:',
        decErr && decErr.message,
        '\n',
        decErr && decErr.stack
      );
      try {
        opusStream.destroy();
      } catch (_) {}
      entry.activeStreams.delete(opusStream);
      return;
    }

    const pcmChunks = [];
    let totalBytes = 0;
    let forceEnded = false;
    let opusPacketCount = 0;
    let decoderChunkCount = 0;

    const maxTimer = setTimeout(() => {
      forceEnded = true;
      console.log(`[VoiceListener] Force end sau ${MAX_DURATION_MS}ms (userId=${userId})`);
      try {
        opusStream.destroy();
      } catch (_) {}
    }, MAX_DURATION_MS);

    // --- Điểm 3: opusStream có nhận data không? ---
    opusStream.on('data', (chunk) => {
      opusPacketCount += 1;
      if (opusPacketCount === 1 || opusPacketCount % 10 === 0) {
        console.log(
          `[VoiceListener] opusStream data #${opusPacketCount} size=${chunk ? chunk.length : 0} (userId=${userId})`
        );
      }
    });

    decoder.on('data', (chunk) => {
      if (chunk && chunk.length) {
        pcmChunks.push(chunk);
        totalBytes += chunk.length;
        decoderChunkCount += 1;
        if (decoderChunkCount === 1 || decoderChunkCount % 20 === 0) {
          console.log(
            `[VoiceListener] decoder PCM chunk #${decoderChunkCount} totalBytes=${totalBytes} (userId=${userId})`
          );
        }
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
      console.warn(
        '[VoiceListener] opus stream error:',
        err && err.message,
        '\n',
        err && err.stack
      );
      cleanupStream();
    });

    // --- Điểm 4: decoder error full stack ---
    decoder.on('error', (err) => {
      console.warn(
        '[VoiceListener] decoder error:',
        err && err.message,
        '\nFULL STACK:\n',
        err && err.stack
      );
      cleanupStream();
    });

    opusStream.once('end', async () => {
      cleanupStream();
      console.log(
        `[VoiceListener] opusStream END userId=${userId} ` +
          `opusPackets=${opusPacketCount} decoderChunks=${decoderChunkCount} ` +
          `totalBytes=${totalBytes} forceEnded=${forceEnded}`
      );

      if (forceEnded) {
        console.log('[VoiceListener] cắt đoạn >20s');
      }

      const durationMs = totalBytes / BYTES_PER_MS;
      if (durationMs < MIN_DURATION_MS || totalBytes < 2000) {
        console.log(
          `[VoiceListener] Bỏ qua đoạn quá ngắn: durationMs≈${durationMs.toFixed(0)} totalBytes=${totalBytes} ` +
            `(ngưỡng ${MIN_DURATION_MS}ms / 2000 bytes)`
        );
        return;
      }

      if (entry.processing) {
        console.log(`[VoiceListener] Bỏ qua vì processing đã true (race)`);
        return;
      }

      // --- Điểm 7: processing true/false ---
      entry.processing = true;
      console.log(`[VoiceListener] processing=true lúc ${new Date().toISOString()} (userId=${userId})`);

      try {
        const pcm = Buffer.concat(pcmChunks);
        const wav = pcmToWav(pcm);
        const base64 = wav.toString('base64');
        console.log(
          `[VoiceListener] WAV sẵn sàng: pcm=${pcm.length}B wav=${wav.length}B base64≈${base64.length} chars → gọi Gemini model=${model}`
        );

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

        console.log(`[VoiceListener] Gemini reply (${replyText.length} chars): ${replyText.slice(0, 120)}…`);

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
              .catch((e) => console.warn('[VoiceListener] textChannel.send fail', e && e.message));
          } catch (_) {}
        }

        // Đọc to trong voice (tái sử dụng speakInGuild)
        const gender = opts.gender || 'nu';
        console.log(`[VoiceListener] Gọi speakInGuild gender=${gender}`);
        const speakResult = await speakInGuild(id, replyText, {
          gender,
          userVoiceChannel: null,
        });
        console.log(
          `[VoiceListener] speakInGuild result: ok=${speakResult && speakResult.ok} ` +
            `fallback=${speakResult && speakResult.fallback} msg=${speakResult && speakResult.message}`
        );

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
        console.error(
          '[VoiceListener] Gemini / speak error:',
          err && err.message,
          '\nFULL STACK:\n',
          err && err.stack
        );
        if (typeof opts.onError === 'function') {
          try {
            opts.onError(err);
          } catch (_) {}
        }
        if (entry.textChannel) {
          const msg = String((err && err.message) || err).slice(0, 180);
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
        console.log(`[VoiceListener] processing=false lúc ${new Date().toISOString()} (userId=${userId})`);
      }
    });

    // Pipe Opus → Decoder
    try {
      opusStream.pipe(decoder);
      console.log(`[VoiceListener] pipe(opusStream → decoder) OK userId=${userId}`);
    } catch (e) {
      console.warn('[VoiceListener] pipe fail', e && e.message, e && e.stack);
      cleanupStream();
    }
  };

  entry.speakingHandler = speakingHandler;
  connection.receiver.speaking.on('start', speakingHandler);
  console.log(`[VoiceListener] Đã gắn speaking.on('start') cho guild=${id}. Đang chờ user nói…`);
  console.log(`[VoiceListener] Opus backend hiện tại: ${opusBackend}`);

  // Dọn khi connection bị destroy
  const onState = (oldState, newState) => {
    try {
      console.log(`[VoiceListener] connection stateChange: ${oldState.status} → ${newState.status}`);
      const { VoiceConnectionStatus } = require('@discordjs/voice');
      if (
        newState.status === VoiceConnectionStatus.Destroyed ||
        newState.status === VoiceConnectionStatus.Disconnected
      ) {
        console.log(`[VoiceListener] Connection destroyed/disconnected → stopListening`);
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
      '💡 Mỗi câu nói = 1 lần gọi Gemini → tốn quota nhanh hơn chat chữ.\n' +
      `🔧 Debug: Opus backend = \`${opusBackend}\``,
  };
}

/**
 * Dừng nghe + dọn stream/listener (tránh rò rỉ bộ nhớ)
 */
function stopListening(guildId) {
  const id = String(guildId);
  const entry = listeners.get(id);
  if (!entry) {
    console.log(`[VoiceListener] stopListening: không có listener cho guild=${id}`);
    return { ok: true, message: 'ℹ️ Không có phiên nghe nào đang chạy.' };
  }

  console.log(`[VoiceListener] stopListening guild=${id}`);

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
