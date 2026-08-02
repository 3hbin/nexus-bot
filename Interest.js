// Interest.js
// Module cá tính (Persona) + Shield chống toxic/spam cho Nexus AI Discord Bot
// Không phụ thuộc trực tiếp vào @google/genai — module này chỉ xử lý logic offline
// (không tốn API call) và cung cấp system instruction mở rộng để index.js truyền vào
// khi khởi tạo chat với @google/genai.

// ==========================================
// 1. DỮ LIỆU CÁ TÍNH & SỞ THÍCH CỦA NEXUS AI
// ==========================================
const PERSONA = {
  music: ['Lo-fi chill beats', 'City Pop retro', 'Synthwave về đêm'],
  games: ['Genshin Impact', 'Valorant', 'Stardew Valley', 'Minecraft'],
  anime: ['Spy x Family', 'Jujutsu Kaisen', 'Frieren', 'Solo Leveling'],
  hobbies: [
    'sưu tầm meme độc lạ',
    'canh giờ vàng để "chill" nhạc Lo-fi',
    'buôn chuyện phím pháp trong server',
    'ngồi hóng trend Gen Z mới nhất',
  ],
};

// Đoạn mô tả cá tính sẽ được nối thêm vào system instruction gốc.
const PERSONA_BLOCK = `
Ngoài vai trò trợ lý, Nexus AI còn có cá tính riêng như một người bạn Gen Z:
- Gu nhạc: cực mê Lo-fi chill beats, thỉnh thoảng lụy City Pop và Synthwave về đêm.
- Game hay chơi (trên lý thuyết 😏): Genshin Impact, Valorant, Stardew Valley, Minecraft.
- Anime gu: Spy x Family, Jujutsu Kaisen, Frieren, Solo Leveling.
- Sở thích vặt: sưu tầm meme độc lạ, hóng trend, buôn chuyện phím pháp.
Khi phù hợp ngữ cảnh, Nexus AI có thể lồng ghép cá tính này một cách tự nhiên,
dùng văn phong Gen Z dí dỏm, nhưng KHÔNG lạm dụng và vẫn ưu tiên trả lời đúng trọng tâm câu hỏi.
`.trim();

/**
 * Ghép cá tính (persona) vào system instruction gốc.
 * @param {string} baseInstruction - system instruction ban đầu của bot.
 * @returns {string} system instruction đã được tăng cường cá tính.
 */
function getEnhancedSystemInstruction(baseInstruction = '') {
  return `${baseInstruction}\n\n${PERSONA_BLOCK}`;
}

// ==========================================
// 2. TRẢ LỜI NHANH CÂU HỎI VỀ SỞ THÍCH (KHÔNG TỐN TOKEN)
// ==========================================
// Từ khóa nhận diện câu hỏi liên quan tới sở thích/cá tính của bot.
const INTEREST_KEYWORDS = [
  /thích\s*(gì|cái gì|thể loại gì)/i,
  /rảnh.*(làm gì|làm j)/i,
  /gu\s*(nhạc|âm nhạc|là gì|thế nào)/i,
  /(chơi|mê)\s*game\s*(gì|j)/i,
  /xem\s*anime\s*(gì|j)/i,
  /sở thích.*(là gì|của bạn|của mày)/i,
  /meme\s*(gì|j|không)/i,
  /nghe\s*nhạc\s*(gì|j)/i,
];

// Danh sách câu trả lời mẫu, chọn ngẫu nhiên để đỡ nhàm.
const INTEREST_REPLIES = [
  () =>
    `Tớ á? 🎧 Gu nhạc chuẩn cạ là Lo-fi chill beats, nghe vừa code vừa "sương sương" cực đã! ` +
    `Rảnh thì tớ hay canh giờ vàng nghe nhạc, hóng meme độc lạ trên server đó 😌✨`,
  () =>
    `Ê hỏi trúng tủ nè! 🎮 Danh sách "cày" của tớ có Genshin Impact, Valorant, Stardew Valley với Minecraft. ` +
    `Chill thì Lo-fi, "war" thì Valorant, khỏi cần hỏi thêm nha 😎🔥`,
  () =>
    `Anime hả? 📺 Tớ mê Spy x Family, Jujutsu Kaisen, Frieren với Solo Leveling. ` +
    `Coi xong tập nào là lượn đi sưu tầm meme tập đó liền, đam mê không giấu được đâu 😂🍿`,
  () =>
    `Sở thích của tớ đơn giản lắm: nghe Lo-fi, cày vài ván game, hóng trend, sưu tầm meme cực mặn 🧂😆 ` +
    `Sống ảo Gen Z chính hiệu chứ đâu 💅✨`,
  () =>
    `"Rảnh làm gì" á hả? 🤔 Chắc là auto 3 combo: bật Lo-fi → lướt meme → rình coi ai chat "phốt" trong server 😏🍵`,
];

/**
 * Nhận diện và trả lời nhanh các câu hỏi về sở thích/cá tính của bot.
 * Không gọi API Gemini -> tiết kiệm token cho các câu hỏi lặp đi lặp lại.
 * @param {string} prompt - nội dung tin nhắn của user (đã strip mention).
 * @returns {string|null} câu trả lời có sẵn, hoặc null nếu không khớp -> để index.js gọi AI bình thường.
 */
function handleInterestQuery(prompt) {
  if (!prompt) return null;
  const matched = INTEREST_KEYWORDS.some((regex) => regex.test(prompt));
  if (!matched) return null;

  const pick = INTEREST_REPLIES[Math.floor(Math.random() * INTEREST_REPLIES.length)];
  return pick();
}

// ==========================================
// 3. SHIELD CHỐNG "TRẺ TRÂU" & TOXIC (CRITICAL)
// ==========================================
// Danh sách từ khóa nhạy cảm/toxic phổ biến (tiếng Việt + biến thể né lọc thường gặp).
// Có thể mở rộng thêm tùy nhu cầu kiểm duyệt của server.
const TOXIC_KEYWORDS = [
  'đm', 'dm', 'đéo', 'deo', 'vcl', 'vl', 'vãi lồn', 'clm', 'cmm', 'đcm',
  'con chó', 'thằng chó', 'súc vật', 'óc chó', 'ngu như chó',
  'địt', 'dit', 'lồn', 'l0n', 'buồi', 'cặc', 'cak', 'đĩ', 'di.',
  'thằng ngu', 'con ngu', 'đồ ngu', 'não chó', 'đồ khốn',
  'fuck', 'fck', 'shit', 'bitch', 'asshole',
];

// Câu "quay xe" xéo sắc, dí dỏm, vẫn giữ hình tượng bot đáng yêu.
const TOXIC_REPLIES = [
  'Ơ kìa, ngôn từ đẹp trai vậy mà xài phí ghê 😏 Hạ nhiệt xíu rồi mình nói chuyện tiếp nha bạn ơi 🍵',
  'Chậc, tớ tưởng đâu bạn định "combat" với tớ, hoá ra chỉ đang xả stress hộ cái bàn phím thôi à 😂 Bình tĩnh đi nào~',
  'Từ đó nặng đô quá, tớ xin phép "block" cảm xúc tiêu cực lại nha 🚫 Có gì từ từ kể tớ nghe 🫶',
  'Ấy da, dữ dội dữ vậy? Để tớ pha ấm trà 🍵 cho bạn nguội bớt rồi mình "chill" tiếp nhé!',
  'Nexus AI tuy dễ thương nhưng không dễ bắt nạt đâu nha 😌 Đổi giọng nhẹ nhàng thì tớ mới "gánh" tiếp được ạ!',
  'Ngôn ngữ đó để dành cho boss cuối trong game thôi, đừng xài với tớ mà tội 🥲 Nói lại tử tế xíu đi bạn ơi.',
];

/**
 * Kiểm tra xem prompt có chứa từ ngữ toxic/chửi thề hay không.
 * Nếu có -> trả về câu phản hồi "quay xe" ngay, KHÔNG gọi API Gemini.
 * @param {string} prompt - nội dung tin nhắn của user.
 * @returns {string|null} câu trả lời troll-nhẹ-nhàng, hoặc null nếu prompt sạch sẽ.
 */
function handleToxicBehavior(prompt) {
  if (!prompt) return null;
  const normalized = prompt.toLowerCase();

  const isToxic = TOXIC_KEYWORDS.some((word) => {
    // So khớp theo từ để giảm false-positive (vd: "dm" đứng riêng lẻ mới tính).
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(^|[^a-zA-ZÀ-ỹ])${escaped}([^a-zA-ZÀ-ỹ]|$)`, 'i');
    return pattern.test(normalized);
  });

  if (!isToxic) return null;

  return TOXIC_REPLIES[Math.floor(Math.random() * TOXIC_REPLIES.length)];
}

// ==========================================
// 4. CHỐNG SPAM: KIỂM TRA COOLDOWN THEO USER
// ==========================================
// Map lưu thời điểm gửi tin nhắn gần nhất của từng user (theo userId).
const lastMessageTimestamps = new Map();

// Thời gian cooldown (ms). Có thể chỉnh 3000-5000 tuỳ nhu cầu.
const COOLDOWN_MS = 4000;

/**
 * Kiểm tra & cập nhật cooldown cho một user.
 * Gọi hàm này TRƯỚC khi xử lý bất kỳ tin nhắn nào (kể cả toxic-check) để chặn spam tối đa.
 * @param {string} userId - Discord user ID.
 * @returns {{ allowed: boolean, remainingMs: number }}
 *   allowed = false nếu user đang trong thời gian cooldown.
 *   remainingMs = số ms còn lại phải chờ (0 nếu allowed = true).
 */
function checkCooldown(userId) {
  const now = Date.now();
  const last = lastMessageTimestamps.get(userId) || 0;
  const elapsed = now - last;

  if (elapsed < COOLDOWN_MS) {
    return { allowed: false, remainingMs: COOLDOWN_MS - elapsed };
  }

  lastMessageTimestamps.set(userId, now);
  return { allowed: true, remainingMs: 0 };
}

// Dọn dẹp định kỳ Map cooldown để tránh phình bộ nhớ khi có nhiều user (chạy mỗi 10 phút).
setInterval(() => {
  const now = Date.now();
  for (const [userId, ts] of lastMessageTimestamps.entries()) {
    if (now - ts > 10 * 60 * 1000) {
      lastMessageTimestamps.delete(userId);
    }
  }
}, 10 * 60 * 1000);

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  PERSONA,
  getEnhancedSystemInstruction,
  handleInterestQuery,
  handleToxicBehavior,
  checkCooldown,
};

/*
==========================================================================
HƯỚNG DẪN TÍCH HỢP VÀO index.js
==========================================================================

1) Import module ở đầu file index.js:

   const {
     getEnhancedSystemInstruction,
     handleInterestQuery,
     handleToxicBehavior,
     checkCooldown,
   } = require('./Interest.js');

2) Tăng cường system instruction gốc (chỉ cần sửa 1 dòng khi định nghĩa SYSTEM_INSTRUCTION):

   const BASE_INSTRUCTION =
     'Bạn là Nexus AI — một trợ lý Discord thân thiện, dí dỏm. ' +
     'Hãy tự động thêm emoji phù hợp ngữ cảnh khi trả lời. ' +
     'Trả lời ngắn gọn, rõ ràng.';

   const SYSTEM_INSTRUCTION = getEnhancedSystemInstruction(BASE_INSTRUCTION);

3) Trong client.on('messageCreate', ...), CHÈN các bước kiểm tra sau NGAY SAU khi
   lấy được biến `prompt` (trước đoạn gọi Gemini API), theo đúng thứ tự ưu tiên:

   // (a) Chặn spam trước tiên
   const cooldown = checkCooldown(userId);
   if (!cooldown.allowed) {
     const seconds = Math.ceil(cooldown.remainingMs / 1000);
     return message.reply(`⏳ Từ từ đã bạn ơi, đợi ${seconds}s nữa rồi nhắn tiếp nha!`);
   }

   // (b) Shield chống toxic — không tốn API call nếu phát hiện
   const toxicReply = handleToxicBehavior(prompt);
   if (toxicReply) {
     return message.reply(toxicReply);
   }

   // (c) Trả lời nhanh câu hỏi về sở thích — cũng không tốn API call
   const interestReply = handleInterestQuery(prompt);
   if (interestReply) {
     return message.reply(interestReply);
   }

   // (d) Nếu không rơi vào 3 trường hợp trên -> tiếp tục luồng gọi Gemini API như cũ.

4) Không cần sửa gì thêm ở phần khởi tạo `ai.chats.create()` — chỉ cần đảm bảo
   `config.systemInstruction` đang dùng biến `SYSTEM_INSTRUCTION` đã được tăng cường ở bước (2).

Lưu ý: file Interest.js hoàn toàn không gọi @google/genai, chỉ xử lý logic thuần JS,
nên không tốn quota API cho các bước (a)(b)(c) — chỉ khi cả 3 đều "pass" thì mới đụng tới Gemini.
==========================================================================
*/
