// MediaGen.js
// Module tạo ẢNH (Nano Banana) và VIDEO (Veo 3.1) cho Nexus AI Discord Bot
// Dùng chung với instance `ai` (GoogleGenAI) đã khởi tạo sẵn trong index.js.

const fs = require('fs');
const path = require('path');
const os = require('os');

// ==========================================
// CẤU HÌNH MODEL
// ==========================================
// Nano Banana 2 (GA) — model tạo ảnh hiện hành, thay thế Imagen (Imagen sẽ shutdown 17/8/2026).
const IMAGE_MODEL = 'gemini-3.1-flash-image';

// Veo 3.1 Fast — ưu tiên tốc độ/chi phí, phù hợp bot Discord (người dùng không muốn đợi quá lâu).
// Đổi thành 'veo-3.1-generate-preview' nếu muốn chất lượng cao hơn (nhưng chậm hơn).
const VIDEO_MODEL_FAST = 'veo-3.1-fast-generate-preview';
const VIDEO_MODEL_QUALITY = 'veo-3.1-generate-preview';

// Video generation là long-running operation -> cần poll định kỳ.
const VIDEO_POLL_INTERVAL_MS = 10000; // 10 giây/lần kiểm tra
const VIDEO_MAX_WAIT_MS = 6 * 60 * 1000; // Google công bố tối đa ~6 phút vào giờ cao điểm

// ==========================================
// 1. TẠO ẢNH (NANO BANANA)
// ==========================================
/**
 * Tạo ảnh từ prompt text bằng Nano Banana.
 * @param {import('@google/genai').GoogleGenAI} ai - instance client đã khởi tạo trong index.js.
 * @param {string} prompt - mô tả ảnh muốn tạo.
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function generateImage(ai, prompt) {
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt tạo ảnh không được để trống.');
  }

  const response = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: prompt,
  });

  const parts =
    response?.candidates?.[0]?.content?.parts || response?.parts || [];

  const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);

  if (!imagePart) {
    throw new Error(
      'Gemini không trả về ảnh nào (có thể do bộ lọc an toàn chặn prompt).'
    );
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}

// ==========================================
// 2. TẠO VIDEO (VEO 3.1)
// ==========================================
/**
 * Tạo video từ prompt text (và tùy chọn ảnh khởi đầu) bằng Veo 3.1.
 * Đây là long-running operation -> hàm này sẽ tự poll tới khi video sẵn sàng.
 *
 * @param {import('@google/genai').GoogleGenAI} ai - instance client đã khởi tạo trong index.js.
 * @param {string} prompt - mô tả video muốn tạo.
 * @param {object} [options]
 * @param {boolean} [options.highQuality=false] - true = dùng model chất lượng cao hơn (chậm hơn).
 * @param {{ imageBytes: string, mimeType: string }} [options.startImage] - ảnh khung hình đầu (tùy chọn).
 * @param {(secondsWaited: number) => void} [options.onProgress] - callback báo tiến độ (để bot có thể update tin nhắn "đang tạo...").
 * @returns {Promise<string>} đường dẫn file .mp4 tạm (đã tải về máy).
 */
async function generateVideo(ai, prompt, options = {}) {
  if (!prompt || !prompt.trim()) {
    throw new Error('Prompt tạo video không được để trống.');
  }

  const model = options.highQuality ? VIDEO_MODEL_QUALITY : VIDEO_MODEL_FAST;

  const requestPayload = { model, prompt };
  if (options.startImage) {
    requestPayload.image = options.startImage;
  }

  let operation = await ai.models.generateVideos(requestPayload);

  const startedAt = Date.now();
  while (!operation.done) {
    const waited = Date.now() - startedAt;
    if (waited > VIDEO_MAX_WAIT_MS) {
      throw new Error(
        'Quá thời gian chờ tạo video (hơn 6 phút). Server Google có thể đang quá tải, hãy thử lại sau.'
      );
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress(Math.floor(waited / 1000));
    }
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const generatedVideos = operation.response?.generatedVideos;
  if (!generatedVideos || generatedVideos.length === 0) {
    throw new Error(
      'Gemini không trả về video nào (có thể do bộ lọc an toàn chặn prompt).'
    );
  }

  const tmpFilePath = path.join(
    os.tmpdir(),
    `nexus_video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`
  );

  await ai.files.download({
    file: generatedVideos[0].video,
    downloadPath: tmpFilePath,
  });

  return tmpFilePath;
}

/**
 * Xoá file video tạm sau khi đã gửi lên Discord, tránh rác chiếm dung lượng đĩa trên Render.
 * @param {string} filePath
 */
function cleanupTempFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) console.error('⚠️ Không xoá được file tạm:', err);
  });
}

// ==========================================
// 3. COOLDOWN RIÊNG CHO MEDIA (ảnh/video tốn quota hơn chat thường)
// ==========================================
const mediaCooldowns = new Map(); // key: `${userId}:${kind}` -> timestamp

const MEDIA_COOLDOWN_MS = {
  image: 15000, // 15 giây/lần tạo ảnh
  video: 90000, // 90 giây/lần tạo video (rất tốn quota + thời gian)
};

/**
 * Kiểm tra & cập nhật cooldown riêng cho tạo ảnh/video.
 * @param {string} userId
 * @param {'image'|'video'} kind
 * @returns {{ allowed: boolean, remainingMs: number }}
 */
function checkMediaCooldown(userId, kind) {
  const key = `${userId}:${kind}`;
  const now = Date.now();
  const last = mediaCooldowns.get(key) || 0;
  const limit = MEDIA_COOLDOWN_MS[kind] || 15000;
  const elapsed = now - last;

  if (elapsed < limit) {
    return { allowed: false, remainingMs: limit - elapsed };
  }

  mediaCooldowns.set(key, now);
  return { allowed: true, remainingMs: 0 };
}

// Dọn dẹp Map cooldown định kỳ (mỗi 15 phút) để tránh phình bộ nhớ.
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of mediaCooldowns.entries()) {
    if (now - ts > 15 * 60 * 1000) mediaCooldowns.delete(key);
  }
}, 15 * 60 * 1000);

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  generateImage,
  generateVideo,
  cleanupTempFile,
  checkMediaCooldown,
  IMAGE_MODEL,
  VIDEO_MODEL_FAST,
  VIDEO_MODEL_QUALITY,
};

/*
==========================================================================
HƯỚNG DẪN TÍCH HỢP VÀO index.js
==========================================================================

1) Import module:

   const {
     generateImage,
     generateVideo,
     cleanupTempFile,
     checkMediaCooldown,
   } = require('./MediaGen.js');
   const { AttachmentBuilder } = require('discord.js');

2) Thêm 2 slash command mới vào mảng `commands` (cùng chỗ định nghĩa /ping, /reset...):

   new SlashCommandBuilder()
     .setName('imagine')
     .setDescription('Tạo ảnh bằng AI (Nano Banana)')
     .addStringOption(opt =>
       opt.setName('prompt').setDescription('Mô tả ảnh bạn muốn tạo').setRequired(true)
     ),
   new SlashCommandBuilder()
     .setName('video')
     .setDescription('Tạo video ngắn bằng AI (Veo 3.1, có thể mất tới vài phút)')
     .addStringOption(opt =>
       opt.setName('prompt').setDescription('Mô tả video bạn muốn tạo').setRequired(true)
     ),

3) Xử lý trong client.on('interactionCreate', ...), thêm 2 nhánh mới:

   if (commandName === 'imagine') {
     const cooldown = checkMediaCooldown(user.id, 'image');
     if (!cooldown.allowed) {
       return interaction.reply({
         content: `⏳ Từ từ đã, đợi ${Math.ceil(cooldown.remainingMs / 1000)}s nữa nha!`,
         ephemeral: true,
       });
     }
     const prompt = interaction.options.getString('prompt');
     await interaction.deferReply();
     try {
       const { buffer, mimeType } = await generateImage(ai, prompt);
       const ext = mimeType.includes('png') ? 'png' : 'jpg';
       const attachment = new AttachmentBuilder(buffer, { name: `nexus_image.${ext}` });
       return interaction.editReply({ content: `🎨 Đây rồi: "${prompt}"`, files: [attachment] });
     } catch (err) {
       console.error('❌ Lỗi tạo ảnh:', err);
       return interaction.editReply('❌ Rất tiếc, không tạo được ảnh lúc này. Thử lại sau nha!');
     }
   }

   if (commandName === 'video') {
     const cooldown = checkMediaCooldown(user.id, 'video');
     if (!cooldown.allowed) {
       return interaction.reply({
         content: `⏳ Video tốn tài nguyên lắm, đợi ${Math.ceil(cooldown.remainingMs / 1000)}s nữa nha!`,
         ephemeral: true,
       });
     }
     const prompt = interaction.options.getString('prompt');
     await interaction.deferReply();
     await interaction.editReply('🎬 Đang dựng video, có thể mất 1-6 phút, chờ tớ xíu nha...');
     let videoPath;
     try {
       videoPath = await generateVideo(ai, prompt, {
         onProgress: (s) => console.log(`⏳ Đang tạo video... ${s}s`),
       });
       const attachment = new AttachmentBuilder(videoPath, { name: 'nexus_video.mp4' });
       await interaction.editReply({ content: `🎬 Video của bạn đây: "${prompt}"`, files: [attachment] });
     } catch (err) {
       console.error('❌ Lỗi tạo video:', err);
       await interaction.editReply('❌ Rất tiếc, không tạo được video lúc này. Thử lại sau nha!');
     } finally {
       if (videoPath) cleanupTempFile(videoPath);
     }
   }

4) KHÔNG cần đăng ký lại gì thêm — `rest.put(Routes.applicationCommands(...))` trong `client.once('ready', ...)`
   sẽ tự đồng bộ 2 slash command mới này lên Discord khi bot khởi động lại.

LƯU Ý:
- File video Discord giới hạn 25MB (server thường / Nitro cao hơn) — video Veo 4-8s thường nằm trong giới hạn này,
  nhưng nếu dùng resolution 4k có thể vượt, nên giữ mặc định 720p (không cấu hình resolution) để an toàn.
- Bộ lọc an toàn của Google có thể chặn một số prompt (bạo lực, khoả thân, người thật nổi tiếng...) và trả lỗi —
  module đã bắt lỗi này và trả về message dễ hiểu thay vì crash bot.
==========================================================================
*/
