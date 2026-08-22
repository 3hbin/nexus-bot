// Tts.js — Text-to-Speech
// Ưu tiên Microsoft Edge TTS (nam/nữ tiếng Việt), fallback Google Translate TTS.
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

/**
 * Giọng Edge TTS tiếng Việt (Azure Neural)
 * Nam: NamMinh — hạ pitch nhẹ để rõ giọng nam hơn
 * Nữ: HoaiMy
 */
const VOICES = {
  nu: 'vi-VN-HoaiMyNeural',
  nam: 'vi-VN-NamMinhNeural',
  female: 'vi-VN-HoaiMyNeural',
  male: 'vi-VN-NamMinhNeural',
};

const MAX_CHARS = 180;

function resolveVoiceId(gender) {
  const g = String(gender || 'nu')
    .toLowerCase()
    .trim()
    .normalize('NFC');
  if (g === 'nam' || g === 'male' || g === 'm' || g === 'boy') return VOICES.nam;
  if (g === 'nu' || g === 'nữ' || g === 'female' || g === 'f' || g === 'girl') return VOICES.nu;
  if (VOICES[g]) return VOICES[g];
  if (/^vi-VN-/i.test(g)) return g;
  return VOICES.nu;
}

function isMaleVoice(voiceId) {
  return /NamMinh|male|nam/i.test(String(voiceId || ''));
}

/** Thoát XML cho SSML */
function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Gói text thành SSML — giọng nam: pitch thấp hơn, rate hơi chậm
 * để nghe rõ nam hơn so với mặc định NamMinh
 */
function buildSsml(text, voiceId) {
  const body = escapeXml(text);
  const male = isMaleVoice(voiceId);
  const prosody = male
    ? 'pitch="-8%" rate="-8%" volume="+5%"'
    : 'pitch="+0%" rate="+0%"';
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="vi-VN">` +
    `<voice name="${voiceId}">` +
    `<prosody ${prosody}>${body}</prosody>` +
    `</voice></speak>`
  );
}

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
  return parts.slice(0, 4);
}

/** Edge TTS qua msedge-tts / node-edge-tts nếu có */
async function synthesizeEdge(text, voiceId) {
  const ssml = buildSsml(text, voiceId);
  const plain = String(text || '').trim();

  // 1) msedge-tts — thử SSML trước, fallback plain
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
    const tts = new MsEdgeTTS();
    const fmt =
      (OUTPUT_FORMAT && OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3) ||
      'audio-24khz-48kbitrate-mono-mp3';
    await tts.setMetadata(voiceId, fmt);
    const outPath = path.join(
      os.tmpdir(),
      `nexus_edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`
    );
    if (typeof tts.toFile === 'function') {
      for (const payload of [ssml, plain]) {
        try {
          await tts.toFile(outPath, payload);
          const buf = await fs.readFile(outPath);
          await fs.unlink(outPath).catch(() => {});
          if (buf && buf.length > 100) {
            console.log(`[TTS] Edge OK voice=${voiceId} ssml=${payload === ssml}`);
            return buf;
          }
        } catch (inner) {
          console.warn('Tts edge toFile:', inner && inner.message);
        }
      }
    }
  } catch (e) {
    if (!/Cannot find module/.test(String(e && e.message))) {
      console.warn('Tts edge msedge-tts:', e && e.message);
    }
  }

  // 2) node-edge-tts
  try {
    const { EdgeTTS } = require('node-edge-tts');
    const outPath = path.join(
      os.tmpdir(),
      `nexus_edge2_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`
    );
    const tts = new EdgeTTS({
      voice: voiceId,
      lang: 'vi-VN',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
      timeout: 15000,
      pitch: isMaleVoice(voiceId) ? '-8%' : '+0%',
      rate: isMaleVoice(voiceId) ? '-8%' : '+0%',
    });
    await tts.ttsPromise(plain, outPath);
    const buf = await fs.readFile(outPath);
    await fs.unlink(outPath).catch(() => {});
    if (buf && buf.length > 100) {
      console.log(`[TTS] node-edge-tts OK voice=${voiceId}`);
      return buf;
    }
  } catch (e) {
    if (!/Cannot find module/.test(String(e && e.message))) {
      console.warn('Tts edge node-edge-tts:', e && e.message);
    }
  }

  // 3) @andresaya/edge-tts
  try {
    const mod = require('@andresaya/edge-tts');
    const EdgeTTS = mod.EdgeTTS || mod.default;
    if (EdgeTTS) {
      const tts = new EdgeTTS();
      if (typeof tts.synthesize === 'function') {
        const result = await tts.synthesize(plain, { voice: voiceId });
        if (Buffer.isBuffer(result)) return result;
        if (result && result.audio) return Buffer.from(result.audio);
      }
    }
  } catch (e) {
    if (!/Cannot find module/.test(String(e && e.message))) {
      console.warn('Tts edge andresaya:', e && e.message);
    }
  }

  return null;
}

/** Google Translate TTS (1 giọng, không chọn nam/nữ) */
async function synthesizeGoogle(text, lang = 'vi') {
  if (!fetch) return null;
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
      if (!res || !res.ok) continue;
      const arr = await res.arrayBuffer();
      if (arr && arr.byteLength > 100) buffers.push(Buffer.from(arr));
    } catch (e) {
      console.warn('Tts google chunk', e && e.message);
    }
  }
  if (buffers.length === 0) return null;
  return Buffer.concat(buffers);
}

/**
 * VoiceRSS — CHỈ tiếng Việt (hl=vi-vn).
 * Giọng có sẵn theo docs: Chi (Male, default). Không dùng hl nước ngoài.
 * Env: VOICERSS_API_KEY
 */
async function synthesizeVoiceRss(text, gender = 'nam') {
  const key = String(process.env.VOICERSS_API_KEY || '').trim();
  if (!key || !fetch) return null;

  const full = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[*_~`|#]/g, '')
    .trim()
    .slice(0, 1000);
  if (!full) return null;

  // VoiceRSS tiếng Việt: chỉ có giọng Chi (Male). Luôn hl=vi-vn.
  const voice = 'Chi';
  const params = new URLSearchParams({
    key,
    hl: 'vi-vn',
    v: voice,
    src: full,
    c: 'MP3',
    f: '44khz_16bit_mono',
    r: '0',
  });

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 12000) : null;
    let res;
    try {
      res = await fetch(`https://api.voicerss.org/?${params.toString()}`, {
        method: 'GET',
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (!res || !res.ok) {
      console.warn('[TTS] VoiceRSS HTTP', res && res.status);
      return null;
    }
    const ct = String(res.headers.get('content-type') || '');
    // Lỗi API thường trả text/plain hoặc JSON
    if (ct.includes('text') || ct.includes('json')) {
      const errText = await res.text();
      console.warn('[TTS] VoiceRSS lỗi:', String(errText).slice(0, 120));
      return null;
    }
    const arr = await res.arrayBuffer();
    if (arr && arr.byteLength > 100) {
      console.log(`[TTS] VoiceRSS OK vi-vn voice=${voice}`);
      return Buffer.from(arr);
    }
  } catch (e) {
    console.warn('[TTS] VoiceRSS fail', e && e.message);
  }
  return null;
}

/**
 * @param {string} text
 * @param {string} [langOrGender='vi'] — 'vi' | 'nam' | 'nu' | voice id
 * @param {{ gender?: string }} [opts]
 * @returns {Promise<Buffer|null>}
 */
async function synthesizeSpeech(text, langOrGender = 'vi', opts = {}) {
  const gender = opts.gender || langOrGender;
  const voiceId = resolveVoiceId(gender);
  const full = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[*_~`|#]/g, '')
    .trim()
    .slice(0, 800);
  if (!full) return null;

  // 1) Edge (nam/nữ neural tiếng Việt)
  try {
    const edgeBuf = await synthesizeEdge(full, voiceId);
    if (edgeBuf && edgeBuf.length > 100) return edgeBuf;
  } catch (e) {
    console.warn('Tts edge fail', e && e.message);
  }

  // 2) VoiceRSS — chỉ vi-vn (giọng Chi)
  try {
    const rssBuf = await synthesizeVoiceRss(full, gender);
    if (rssBuf && rssBuf.length > 100) return rssBuf;
  } catch (e) {
    console.warn('Tts VoiceRSS fail', e && e.message);
  }

  // 3) Google Translate TTS — chỉ tl=vi
  console.warn(
    `[TTS] Edge + VoiceRSS thất bại → fallback Google vi. voice yêu cầu=${voiceId}`
  );
  return synthesizeGoogle(full, 'vi');
}

async function writeTempMp3(buffer) {
  if (!buffer || !buffer.length) return null;
  const filePath = path.join(
    os.tmpdir(),
    `nexus_tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`
  );
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
  resolveVoiceId,
  synthesizeVoiceRss,
  VOICES,
  splitText,
};
