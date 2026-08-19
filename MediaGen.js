// MediaGen.js
// Wrapper cho tạo ảnh / video bằng AI (safety: bọc try/catch), và cooldown cho media
const fs = require('fs').promises;
const path = require('path');

const MEDIA_TMP_DIR = path.join(__dirname, 'data', 'media_tmp');
const imageCooldowns = new Map(); // key: userId:type -> timestamp
const DEFAULT_IMAGE_COOLDOWN_MS = 1000 * 15; // 15s
const DEFAULT_VIDEO_COOLDOWN_MS = 1000 * 60 * 3; // 3 minutes

// Model IDs
const IMAGE_MODEL = 'gemini-3.1-flash-image';
const VIDEO_MODEL = 'veo-3.1-generate-001';

const VIDEO_POLL_INTERVAL_MS = 10000; // 10s giữa mỗi lần poll
const VIDEO_MAX_WAIT_MS = 1000 * 60 * 8; // timeout an toàn 8 phút

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

/**
 * Tạo ảnh bằng Gemini Image ("Nano Banana") qua SDK @google/genai.
 * Trả về { buffer, mimeType }.
 */
async function generateImage(aiInstance, prompt) {
  try {
    if (!aiInstance) throw new Error('AI instance không được cung cấp.');
    if (!aiInstance.models || typeof aiInstance.models.generateContent !== 'function') {
      throw new Error('SDK hiện tại không hỗ trợ generateContent (kiểm tra lại phiên bản @google/genai).');
    }

    const response = await aiInstance.models.generateContent({
      model: IMAGE_MODEL,
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    const parts = response?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.data);

    if (!imagePart) {
      const textPart = parts.find((p) => p.text)?.text;
      const finishReason = response?.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        throw new Error(`Ảnh bị chặn bởi bộ lọc an toàn nội dung (finishReason: ${finishReason}).`);
      }
      throw new Error(textPart ? `AI từ chối tạo ảnh: ${textPart.slice(0, 200)}` : 'AI không trả về dữ liệu ảnh hợp lệ.');
    }

    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    return { buffer, mimeType };
  } catch (err) {
    console.error('MediaGen: generateImage error:', err);
    throw err;
  }
}

/**
 * Tạo video bằng Veo qua SDK @google/genai.
 * Trả về đường dẫn file .mp4 tạm trên đĩa.
 */
async function generateVideo(aiInstance, prompt, opts = {}) {
  await ensureTmpDir();
  try {
    if (!aiInstance) throw new Error('AI instance không được cung cấp.');
    if (!aiInstance.models || typeof aiInstance.models.generateVideos !== 'function') {
      throw new Error('SDK hiện tại không hỗ trợ generateVideos (kiểm tra lại phiên bản @google/genai).');
    }
    if (!aiInstance.operations || typeof aiInstance.operations.getVideosOperation !== 'function') {
      throw new Error('SDK hiện tại không hỗ trợ operations.getVideosOperation để theo dõi tiến trình video.');
    }

    // Đã loại bỏ personGeneration gây lỗi 400
    let operation = await aiInstance.models.generateVideos({
      model: VIDEO_MODEL,
      prompt,
      config: {
        aspectRatio: '16:9',
      },
    });

    const startedAt = Date.now();
    let elapsedSeconds = 0;

    while (!operation.done) {
      if (Date.now() - startedAt > VIDEO_MAX_WAIT_MS) {
        throw new Error('Quá thời gian chờ tạo video (timeout). Hãy thử lại với prompt ngắn gọn hơn.');
      }
      await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
      elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      if (typeof opts.onProgress === 'function') {
        try { opts.onProgress(elapsedSeconds); } catch (e) {}
      }
      operation = await aiInstance.operations.getVideosOperation({ operation });
    }

    const generatedVideo = operation.response?.generatedVideos?.[0];
    if (!generatedVideo?.video) {
      const raiReason = operation.response?.raiMediaFilteredReasons?.[0];
      if (raiReason) {
        throw new Error(`Video bị từ chối bởi bộ lọc an toàn nội dung: ${raiReason}`);
      }
      throw new Error('AI không trả về video hợp lệ.');
    }

    const outPath = path.join(MEDIA_TMP_DIR, `nexus_video_${Date.now()}.mp4`);

    if (aiInstance.files && typeof aiInstance.files.download === 'function') {
      await aiInstance.files.download({ file: generatedVideo.video, downloadPath: outPath });
      return outPath;
    }

    if (generatedVideo.video.uri) {
      const apiKey = aiInstance?.apiKey || process.env.GEMINI_API_KEY;
      const url = apiKey ? `${generatedVideo.video.uri}&key=${apiKey}` : generatedVideo.video.uri;
      const buffer = await fetchToBuffer(url);
      await fs.writeFile(outPath, buffer);
      return outPath;
    }

    throw new Error('Không tìm được cách tải video kết quả về (thiếu files.download và video.uri).');
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

async function fetchToBuffer(url) {
  try {
    if (typeof fetch === 'undefined') {
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
