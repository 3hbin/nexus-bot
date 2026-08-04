// Tts.js
// Text-to-Speech đơn giản (Google Translate TTS endpoint công khai)
// Trả về Buffer mp3 để gửi Attachment Discord — không cần API key.
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const fetch =
  typeof globalThis.fetch === 'function'
    ? globalThis.fetch
    : (() => {
        try {
          return require('node-fetch');
        } catch {
          return null;
        }
      })();

const MAX_CHARS = 180; // Google TTS limit ~200/segment; giữ ngắn cho Discord

function splitText(text, max = MAX_CHARS) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[*_~`|#]/g, '')
    .trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const parts = [];
  let rest = clean;
  while (rest.length > 0) {
    if (rest.length <= max) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  // Giới hạn 3 đoạn (~540 ký tự) để tránh spam file
  return parts.slice(0, 3);
}

/**
 * Tạo audio Buffer (mp3) từ text tiếng Việt.
 * @param {string} text
 * @param {string} [lang='vi']
 * @returns {Promise<Buffer|null>}
 */
async function synthesizeSpeech(text, lang = 'vi') {
  if (!fetch) {
    console.warn('Tts: fetch không khả dụng');
    return null;
  }
  const chunks = splitText(text);
  if (chunks.length === 0) return null;

  const buffers = [];
  for (const chunk of chunks) {
    const url =
      `https://translate.google.com/translate_tts?ie=UTF-8` +
      `&q=${encodeURIComponent(chunk)}` +
      `&tl=${encodeURIComponent(lang)}` +
      `&client=tw-ob`;

    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
      let res;
      try {
        res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://translate.google.com/',
          },
          signal: controller ? controller.signal : undefined,
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      if (!res || !res.ok) {
        console.warn('Tts: HTTP', res && res.status);
        continue;
      }
      const arr = await res.arrayBuffer();
      if (arr && arr.byteLength > 100) {
        buffers.push(Buffer.from(arr));
      }
    } catch (e) {
      console.warn('Tts: fetch chunk error', e && e.message);
    }
  }

  if (buffers.length === 0) return null;
  return Buffer.concat(buffers);
}

/**
 * Ghi buffer ra file tạm, trả path (caller nên xóa sau khi gửi).
 * @param {Buffer} buffer
 * @returns {Promise<string|null>}
 */
async function writeTempMp3(buffer) {
  if (!buffer || !buffer.length) return null;
  const filePath = path.join(os.tmpdir(), `nexus_tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function cleanupTemp(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (_) {}
}

module.exports = {
  synthesizeSpeech,
  writeTempMp3,
  cleanupTemp,
  MAX_CHARS,
};
