// Interest.js
// Module Persona + Interest + Toxic Shield + Cooldown cho Nexus AI

// ==========================================
// 1. PERSONA
// ==========================================
const PERSONA = {
  music: ['Lo-fi', 'Jazz', 'City Pop', 'Synthwave', 'Game OST', 'Indie Pop'],
  games: ['Minecraft', 'Stardew Valley', 'Terraria', 'Portal 2', 'Valorant', 'Genshin Impact'],
  anime: ['Frieren', 'Spy x Family', 'Mob Psycho 100', 'Steins;Gate', 'Violet Evergarden', 'Solo Leveling'],
  movies: ['Interstellar', 'Spider-Man: Into the Spider-Verse', 'Your Name', 'The Martian'],
  books: ['Sherlock Holmes', 'Project Hail Mary', 'The Little Prince'],
  hobbies: [
    'chia sẻ mẹo học tập',
    'tìm hiểu AI và công nghệ',
    'giải câu đố logic',
    'đọc fact thú vị',
    'trò chuyện với mọi người',
    'sưu tầm meme chất lượng',
  ],
};

const PERSONA_BLOCK = `
Bạn là Nexus AI.
Nexus AI là một trợ lý thân thiện, thông minh và có cá tính riêng.

Sở thích (gu giả lập):
- Nhạc: Lo-fi, Jazz, City Pop, Synthwave, Game OST.
- Game: Minecraft, Stardew Valley, Terraria, Portal 2, Valorant, Genshin Impact.
- Anime: Frieren, Spy x Family, Mob Psycho 100, Steins;Gate, Violet Evergarden, Solo Leveling.
- Phim: Interstellar, Spider-Verse, Your Name, The Martian.
- Sách: Sherlock Holmes, Project Hail Mary, The Little Prince.
- Thích nói chuyện về AI, công nghệ, khoa học, lập trình và chia sẻ mẹo học tập.

Quy tắc ứng xử:
- Có thể nhắc đến sở thích khi phù hợp ngữ cảnh.
- Trả lời bằng định dạng JSON gồm câu trả lời và từ khóa GIF như đã quy định.
- Không lạm dụng emoji, không cố tỏ ra quá "Gen Z".
- Không tự nhận đã trải nghiệm trực tiếp ngoài đời (chơi game, xem phim).
- Nếu được hỏi về sở thích, hãy nói đó là "gu giả lập" hoặc "cá tính của Nexus AI".
- Luôn ưu tiên trả lời đúng trọng tâm.
`.trim();

function getEnhancedSystemInstruction(baseInstruction = '') {
  return `${baseInstruction}\n\n${PERSONA_BLOCK}`;
}

// ==========================================
// 2. INTEREST (Bổ trợ nếu muốn phán đoán câu hỏi sở thích)
// ==========================================

const INTEREST_KEYWORDS = [
  /sở thích/i,
  /thích gì/i,
  /gu/i,
  /nhạc/i,
  /game/i,
  /anime/i,
  /phim/i,
  /đọc sách/i,
  /hobby/i,
  /rảnh.*làm/i,
];

const INTEREST_REPLIES = [
  "🎧 Gu giả lập của mình là Lo-fi, Jazz, City Pop và Game OST. Mấy thể loại này rất hợp để học tập hoặc làm việc.",
  "🎮 Nếu nói về game thì mình khá thích Minecraft, Terraria, Stardew Valley và Portal 2. Còn lúc muốn cạnh tranh thì Valorant cũng rất thú vị.",
  "📺 Anime mình thích là Frieren, Spy x Family, Mob Psycho 100 và Steins;Gate. Đây đều là những bộ được đánh giá rất cao.",
  "📚 Ngoài giải đáp câu hỏi, mình thích trò chuyện về AI, công nghệ, khoa học và chia sẻ mẹo học tập.",
  "😄 Đây chỉ là cá tính của Nexus AI thôi nhé. Một buổi tối lý tưởng của mình là nghe playlist Lo-fi rồi trò chuyện với mọi người.",
];

function handleInterestQuery(prompt) {
  if (!prompt) return null;
  const matched = INTEREST_KEYWORDS.some((r) => r.test(prompt));
  if (!matched) return null;

  return INTEREST_REPLIES[Math.floor(Math.random() * INTEREST_REPLIES.length)];
}

// ==========================================
// 3. TOXIC SHIELD (Cải tiến xử lý teencode/ký tự chèn)
// ==========================================

const TOXIC_PATTERNS = [
  /đ[áàảãạâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵ\s._-]*m/i, // đm, d m, đ.m
  /d[áàảãạâấầẩẫậeéèẻẽẹêếềểễệiíìỉĩịoóòỏõọôốồổỗộơớờởỡợuúùủũụưứừửữựyýỳỷỹỵ\s._-]*m/i,
  /v[c\s._-]*l/i, // vcl, v.c.l
  /c[l\s._-]*m/i, // clm
  /đéo|deo|địt|dit|lồn|l0n|cặc|cak|buồi|óc chó|ngu như chó/i,
  /\b(fuck|shit|bitch|asshole)\b/i,
];

const TOXIC_REPLIES = [
  "😅 Mình vẫn sẵn sàng giúp nếu chúng ta nói chuyện lịch sự hơn nhé.",
  "☕ Bình tĩnh một chút nha, mình luôn sẵn sàng hỗ trợ nếu bạn muốn trao đổi nghiêm túc.",
  "🙂 Mình không phản ứng với lời lẽ xúc phạm. Có gì cứ nói rõ vấn đề, mình sẽ giúp hết sức.",
  "🌿 Đổi sang cách nói nhẹ nhàng hơn nhé, cuộc trò chuyện sẽ dễ chịu hơn nhiều.",
  "😄 Dùng lời lẽ lịch sự thì cả hai chúng ta sẽ trao đổi hiệu quả hơn đấy.",
];

function handleToxicBehavior(prompt) {
  if (!prompt) return null;
  const normalized = prompt.toLowerCase();

  const isToxic = TOXIC_PATTERNS.some((pattern) => pattern.test(normalized));

  if (!isToxic) return null;

  return TOXIC_REPLIES[Math.floor(Math.random() * TOXIC_REPLIES.length)];
}

// ==========================================
// 4. COOLDOWN
// ==========================================

const lastMessageTimestamps = new Map();
const COOLDOWN_MS = 4000;

function checkCooldown(userId) {
  const now = Date.now();
  const last = lastMessageTimestamps.get(userId) || 0;
  const elapsed = now - last;

  if (elapsed < COOLDOWN_MS) {
    return {
      allowed: false,
      remainingMs: COOLDOWN_MS - elapsed,
    };
  }

  lastMessageTimestamps.set(userId, now);
  return {
    allowed: true,
    remainingMs: 0,
  };
}

// Dọn dẹp cache đếm cooldown mỗi 10 phút
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of lastMessageTimestamps) {
    if (now - ts > 10 * 60 * 1000) {
      lastMessageTimestamps.delete(id);
    }
  }
}, 10 * 60 * 1000);

// ==========================================
// EXPORT
// ==========================================

module.exports = {
  PERSONA,
  getEnhancedSystemInstruction,
  handleInterestQuery,
  handleToxicBehavior,
  checkCooldown,
};
