// MediaGen.js
// Xử lý tạo ảnh (Nano Banana) & tạo video (Veo 3.1) qua Google Gemini API
const fs = require('fs');
const path = require('path');

const userMediaCooldowns = new Map();
const COOLDOWN_IMAGE_MS = 10 * 1000;  // 10 giây
const COOLDOWN_VIDEO_MS = 60 * 1000;  // 60 giây

/**
 * Kiểm tra cooldown tạo media của người dùng
 */
function checkMediaCooldown(userId, type = 'image') {
  const key = `${userId}_${type}`;
  const now = Date.now();
  const cooldownMs = type === 'video' ? COOLDOWN_VIDEO_MS : COOLDOWN_IMAGE_MS;

  if (userMediaCooldowns.has(key)) {
    const expireTime = userMediaCooldowns.get(key) + cooldownMs;
    if (now < expireTime) {
      return { allowed: false, remainingMs: expireTime - now };
    }
  }

  userMediaCooldowns.set(key, now);
  return { allowed: true, remainingMs: 0 };
}

/**
 * Dọn dẹp file tạm an toàn
 */
function cleanupTempFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Đã dọn dẹp file tạm: ${filePath}`);
    }
  } catch (err) {
    console.error(`❌ Lỗi dọn dẹp file ${filePath}:`, err);
  }
}

/**
 * Tạo ảnh từ prompt bằng Gemini Image Generation Model
 */
async function generateImage(aiInstance, promptStr) {
  if (!aiInstance) {
    throw new Error('Chưa khởi tạo Google Gen AI instance.');
  }

  // Sử dụng model tạo ảnh phù hợp của Gemini
  const response = await aiInstance.models.generateImages({
    model: 'imagen-3.0-generate-002',
    prompt: promptStr,
    config: {
      numberOfImages: 1,
      outputMimeType: 'image/jpeg',
      aspectRatio: '1:1',
    },
  });

  if (!response?.generatedImages || response.generatedImages.length === 0) {
    throw new Error('Không nhận được dữ liệu ảnh trả về từ AI.');
  }

  const base64Data = response.generatedImages[0].image.imageBytes;
  const buffer = Buffer.from(base64Data, 'base64');
  return { buffer, mimeType: 'image/jpeg' };
}

/**
 * Tạo video từ prompt bằng Gemini Video Generation (Veo)
 */
async function generateVideo(aiInstance, promptStr, options = {}) {
  if (!aiInstance) {
    throw new Error('Chưa khởi tạo Google Gen AI instance.');
  }

  console.log(`🎬 Bắt đầu tạo video với prompt: "${promptStr}"`);

  let operation = await aiInstance.models.generateVideos({
    model: 'veo-2.0-generate-001',
    prompt: promptStr,
    config: {
      aspectRatio: '16:9',
    },
  });

  const startTime = Date.now();
  while (!operation.done) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (options.onProgress) {
      options.onProgress(elapsed);
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
    operation = await aiInstance.operations.getOperation({ name: operation.name });
  }

  if (operation.error) {
    throw new Error(`Lỗi khởi tạo video: ${operation.error.message || JSON.stringify(operation.error)}`);
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    throw new Error('Không tìm thấy link tải video sau khi hoàn tất.');
  }

  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const outputPath = path.join(tempDir, `video_${Date.now()}.mp4`);
  
  // Tải file video
  const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
  const res = await fetch(videoUri);
  if (!res.ok) {
    throw new Error(`Không thể tải video từ URI (${res.statusText})`);
  }
  
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

  return outputPath;
}

module.exports = {
  checkMediaCooldown,
  cleanupTempFile,
  generateImage,
  generateVideo,
};
