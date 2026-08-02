// MediaGen.js
// Wrapper cho tạo ảnh / video bằng AI (safety: bọc try/catch), và cooldown cho media
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const MEDIA_TMP_DIR = path.join(__dirname, 'data', 'media_tmp');
const imageCooldowns = new Map(); // key: userId:type -> timestamp
const DEFAULT_IMAGE_COOLDOWN_MS = 1000 * 15; // 15s
const DEFAULT_VIDEO_COOLDOWN_MS = 1000 * 60 * 3; // 3 minutes

async function ensureTmpDir() {
  try {
    await fs.mkdir(MEDIA_TMP_DIR, { recursive: true });
  } catch (err) {
    console.error('MediaGen: ensureTmpDir error:', err);
  }
}

function checkMediaCooldown(userId, type = 'image') {
  try {
    const key = `${userId}:${type}`;
    const last = imageCooldowns.get(key) || 0;
    const now = Date.now();
    const limit = type === 'video' ? DEFAULT_VIDEO_COOLDOWN_MS : DEFAULT_IMAGE_COOLDOWN_MS;
    if (now - last < limit) {
      return { allowed: false, remainingMs: limit - (now - last) };
    }
    imageCooldowns.set(key, now);
    return { allowed: true, remainingMs: 0 };
  } catch (err) {
    console.error('MediaGen: checkMediaCooldown error:', err);
    return { allowed: true, remainingMs: 0 };
  }
}

async function generateImage(aiInstance, prompt) {
  try {
    if (!aiInstance) throw new Error('AI instance không được cung cấp.');

    // Attempt to call typical images API - this attempt may vary depending on SDK
    if (aiInstance.images && typeof aiInstance.images.generate === 'function') {
      const resp = await aiInstance.images.generate({ prompt }).catch((e) => { throw e; });
      // Normalize response: may return base64 or url
      if (resp?.data?.[0]?.b64_json) {
        const b64 = resp.data[0].b64_json;
        const buffer = Buffer.from(b64, 'base64');
        return { buffer, mimeType: 'image/png' };
      }
      if (resp?.data?.[0]?.url) {
        // fetch that url to buffer
        const url = resp.data[0].url;
        const fetched = await fetchToBuffer(url);
        return { buffer: fetched, mimeType: 'image/png' };
      }
      throw new Error('AI trả về định dạng ảnh không nhận diện được.');
    } else {
      throw new Error('AI instance không hỗ trợ tạo ảnh (aiInstance.images.generate không tồn tại).');
    }
  } catch (err) {
    console.error('MediaGen: generateImage error:', err);
    throw err;
  }
}

async function generateVideo(aiInstance, prompt, opts = {}) {
  // Return a path to temp video file. Implementation depends on AI SDK; here we try common shape and otherwise throw.
  await ensureTmpDir();
  try {
    if (!aiInstance) throw new Error('AI instance không được cung cấp.');

    if (aiInstance.videos && typeof aiInstance.videos.generate === 'function') {
      const outPath = path.join(MEDIA_TMP_DIR, `nexus_video_${Date.now()}.mp4`);
      // SDK specifics vary; attempt naive call and write stream if returned base64
      const resp = await aiInstance.videos.generate({ prompt }).catch((e) => { throw e; });
      if (resp?.data?.[0]?.b64_json) {
        const b64 = resp.data[0].b64_json;
        const buffer = Buffer.from(b64, 'base64');
        await fs.writeFile(outPath, buffer);
        return outPath;
      }
      if (resp?.data?.[0]?.url) {
        const buf = await fetchToBuffer(resp.data[0].url);
        await fs.writeFile(outPath, buf);
        return outPath;
      }
      throw new Error('AI trả về định dạng video không nhận diện được.');
    } else {
      throw new Error('AI instance không hỗ trợ tạo video (aiInstance.videos.generate không tồn tại).');
    }
  } catch (err) {
    console.error('MediaGen: generateVideo error:', err);
    throw err;
  }
}

async function cleanupTempFile(p) {
  try {
    if (!p) return;
    await fs.unlink(p).catch(() => {});
  } catch (err) {
    console.error('MediaGen: cleanupTempFile error:', err);
  }
}

// helper: fetch url -> buffer (uses global fetch if available)
async function fetchToBuffer(url) {
  try {
    if (typeof fetch === 'undefined') {
      // attempt to require node-fetch if available
      const nodeFetch = require('node-fetch');
      const r = await nodeFetch(url);
      const arr = await r.arrayBuffer();
      return Buffer.from(arr);
    } else {
      const r = await fetch(url);
      const arr = await r.arrayBuffer();
      return Buffer.from(arr);
    }
  } catch (err) {
    console.error('MediaGen: fetchToBuffer error:', err);
    throw err;
  }
}

module.exports = {
  generateImage,
  generateVideo,
  cleanupTempFile,
  checkMediaCooldown,
};
