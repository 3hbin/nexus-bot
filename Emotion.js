// Emotion.js
// Hệ thống phản hồi cảm xúc cho Nexus AI
// - Phát hiện cảm xúc từ tin nhắn user
// - Gợi ý tone / system hint cho model
// - Ưu tiên GIF theo cảm xúc
// - Phản hồi nhanh cho một số tình huống (không cần gọi API)

/**
 * @typedef {'happy'|'sad'|'angry'|'anxious'|'confused'|'lonely'|'tired'|'excited'|'love'|'thanks'|'sorry'|'hello'|'thinking'|'neutral'} EmotionId
 */

/** Pattern ưu tiên cao → thấp (match đầu tiên thắng) */
const EMOTION_RULES = [
  {
    id: 'hello',
    patterns: [
      /^(hi|hello|hey|yo|chào|xin chào|halo|hí|hế lô)\b/i,
      /\b(chào bạn|chào bot|chào nexus|good morning|good evening|buổi sáng|buổi tối)\b/i,
    ],
  },
  {
    id: 'thanks',
    patterns: [
      /\b(cảm ơn|cam on|cám ơn|thanks|thank you|ty|tks|appreciate)\b/i,
    ],
  },
  {
    id: 'sorry',
    patterns: [
      /\b(xin lỗi|mình xin lỗi|tôi xin lỗi|sorry|my bad|lỗi của mình)\b/i,
    ],
  },
  {
    id: 'angry',
    patterns: [
      /\b(tức|giận|bực|cáu|khó chịu|đau đầu|bực mình|angry|mad|pissed|hate this|ghét)\b/i,
      /\b(đm|dm|vcl).{0,20}(bot|mày|ai)/i,
    ],
  },
  {
    id: 'sad',
    patterns: [
      /\b(buồn|khóc|thất vọng|tuyệt vọng|chán đời|tâm trạng xấu|sad|depressed|upset|cô đơn quá)\b/i,
      /\b(mình (rất )?buồn|tôi (rất )?buồn|hôm nay buồn)\b/i,
      /😢|😭|😔|😞|💔/,
    ],
  },
  {
    id: 'lonely',
    patterns: [
      /\b(cô đơn|một mình|không ai|lonely|alone|không có bạn)\b/i,
    ],
  },
  {
    id: 'anxious',
    patterns: [
      /\b(lo lắng|lo âu|sợ|hoảng|stress|áp lực|anxiety|worried|nervous|panic)\b/i,
      /\b(sợ hãi|bồn chồn|hồi hộp quá)\b/i,
    ],
  },
  {
    id: 'tired',
    patterns: [
      /\b(mệt|kiệt sức|đuối|ngủ|mệt mỏi|exhausted|tired|burnout|kiệt)\b/i,
      /\b(mệt quá|uể oải)\b/i,
    ],
  },
  {
    id: 'confused',
    patterns: [
      /\b(không hiểu|bối rối|confused|huh|sao vậy|là sao|không rõ|chưa hiểu)\b/i,
      /\b(giải thích lại|nói rõ hơn)\b/i,
      /\?{2,}/,
    ],
  },
  {
    id: 'excited',
    patterns: [
      /\b(hype|phấn khích|excited|can't wait|sắp được|quá đã|đỉnh thật)\b/i,
      /🤩|🚀|🔥{2,}/,
    ],
  },
  {
    id: 'love',
    patterns: [
      /\b(yêu|thương|love you|ily|crush|thích bạn|thích bot)\b/i,
      /❤️|💕|😍|🥰/,
    ],
  },
  {
    id: 'happy',
    patterns: [
      /\b(vui|haha|hihi|lol|lmao|tuyệt|tuyệt vời|happy|great|awesome|yay|hooray|thích quá)\b/i,
      /😂|😄|😁|🥳|✨/,
    ],
  },
  {
    id: 'thinking',
    patterns: [
      /\b(đang nghĩ|suy nghĩ|hmm+|maybe|có thể là|let me think|không chắc)\b/i,
    ],
  },
];

/** Tone gợi ý gắn vào system instruction (ngắn, không thay persona) */
const EMOTION_TONE_HINTS = {
  hello: 'User vừa chào. Hãy chào lại thân thiện, ngắn gọn, sẵn sàng hỗ trợ.',
  thanks: 'User đang cảm ơn. Hãy đáp lại khiêm tốn, ấm áp, không kéo dài.',
  sorry: 'User đang xin lỗi. Hãy trấn an, nói không sao, tiếp tục hỗ trợ.',
  angry: 'User đang bực/tức. Giữ bình tĩnh, không đáp trả gay gắt, thừa nhận cảm xúc, tập trung giải quyết vấn đề.',
  sad: 'User đang buồn. Thể hiện sự đồng cảm nhẹ, không sến súa, sẵn sàng lắng nghe và hỗ trợ thực tế.',
  lonely: 'User cảm thấy cô đơn. Thân thiện, đồng hành, không phán xét; mời trò chuyện nếu phù hợp.',
  anxious: 'User đang lo lắng. Giọng trấn an, rõ ràng, chia nhỏ bước nếu đang hướng dẫn.',
  tired: 'User mệt. Trả lời ngắn gọn, dễ đọc, tránh dài dòng.',
  confused: 'User đang bối rối. Giải thích đơn giản, có thể dùng gạch đầu dòng, hỏi lại nếu cần làm rõ.',
  excited: 'User đang hào hứng. Phản hồi năng lượng tích cực vừa phải, cùng vui nhưng vẫn đúng trọng tâm.',
  love: 'User thể hiện thiện cảm. Đáp lại thân thiện, nhẹ nhàng; nhắc đây là AI nếu cần, không tạo ảo tưởng quan hệ.',
  happy: 'User đang vui. Giữ không khí tích cực, có thể thêm chút dí dỏm phù hợp persona.',
  thinking: 'User đang suy nghĩ/phân vân. Hỗ trợ phân tích nhẹ, đưa gợi ý rõ ràng.',
  neutral: '',
};

/** Từ khóa GIF ưu tiên theo cảm xúc (fallback khi GifSearch hỗ trợ emotion id) */
const EMOTION_GIF_KEYWORDS = {
  hello: 'hello wave anime',
  thanks: 'thank you cute',
  sorry: 'sorry anime',
  angry: 'calm down anime',
  sad: 'hug comfort anime',
  lonely: 'friendship anime',
  anxious: 'relax calm anime',
  tired: 'sleep tired anime',
  confused: 'confused anime',
  excited: 'excited hype anime',
  love: 'heart cute anime',
  happy: 'happy dance anime',
  thinking: 'thinking anime',
  neutral: null,
};

/** Phản hồi nhanh (không gọi Gemini) — chỉ vài case cực ngắn */
const QUICK_REPLIES = {
  hello: [
    'Chào bạn! Mình là Nexus AI đây 👋 Cần hỗ trợ gì nào?',
    'Hi! Nexus sẵn sàng rồi, bạn muốn hỏi gì?',
    'Xin chào! Cứ nhắn thoải mái nhé ✨',
  ],
  thanks: [
    'Không có chi! Cần gì thêm cứ gọi mình nhé 😊',
    'Rất vui vì giúp được bạn. Cứ hỏi tiếp nếu cần!',
    'Haha được rồi, luôn sẵn sàng hỗ trợ 🙌',
  ],
};

/**
 * Phát hiện cảm xúc chính từ text user.
 * @param {string} text
 * @returns {{ id: EmotionId, confidence: number }}
 */
function detectUserEmotion(text) {
  if (!text || !String(text).trim()) {
    return { id: 'neutral', confidence: 0 };
  }
  const raw = String(text);
  for (const rule of EMOTION_RULES) {
    for (const p of rule.patterns) {
      if (p.test(raw)) {
        return { id: rule.id, confidence: 0.85 };
      }
    }
  }
  return { id: 'neutral', confidence: 0.3 };
}

/**
 * Phát hiện cảm xúc từ câu trả lời bot (dùng chọn GIF) — tương thích API cũ.
 * @param {string} text
 * @returns {string|null} emotion id hoặc null
 */
function detectEmotion(text) {
  const { id } = detectUserEmotion(text);
  if (id === 'neutral') return null;
  return id;
}

/**
 * Gợi ý tone gắn thêm vào system instruction (1–2 câu).
 * @param {EmotionId|string} emotionId
 * @returns {string}
 */
function getEmotionToneHint(emotionId) {
  if (!emotionId || emotionId === 'neutral') return '';
  return EMOTION_TONE_HINTS[emotionId] || '';
}

/**
 * System instruction = base + persona + emotion hint.
 * @param {string} baseWithPersona
 * @param {EmotionId|string} emotionId
 */
function appendEmotionToInstruction(baseWithPersona, emotionId) {
  const hint = getEmotionToneHint(emotionId);
  if (!hint) return baseWithPersona;
  return `${baseWithPersona}\n\n[Phản hồi cảm xúc hiện tại]\n${hint}`;
}

/**
 * Keyword tìm GIF theo cảm xúc.
 * @param {EmotionId|string} emotionId
 * @returns {string|null}
 */
function getGifKeywordForEmotion(emotionId) {
  if (!emotionId) return null;
  return EMOTION_GIF_KEYWORDS[emotionId] || null;
}

/**
 * Phản hồi nhanh nếu message quá ngắn / chỉ chào / cảm ơn — tiết kiệm API.
 * Trả null nếu nên gọi model bình thường.
 * @param {string} prompt
 * @param {EmotionId|string} emotionId
 * @returns {string|null}
 */
function tryQuickEmotionalReply(prompt, emotionId) {
  if (!prompt) return null;
  const trimmed = prompt.trim();
  // Chỉ quick-reply khi tin rất ngắn (≤ 24 ký tự) và đúng greeting/thanks
  if (trimmed.length > 24) return null;
  if (emotionId === 'hello' && QUICK_REPLIES.hello) {
    const list = QUICK_REPLIES.hello;
    return list[Math.floor(Math.random() * list.length)];
  }
  if (emotionId === 'thanks' && QUICK_REPLIES.thanks) {
    const list = QUICK_REPLIES.thanks;
    return list[Math.floor(Math.random() * list.length)];
  }
  return null;
}

/**
 * Chọn GIF: ưu tiên cảm xúc user → cảm xúc reply → keyword tiếng Anh từ reply.
 * @param {object} opts
 * @param {string} opts.userEmotion
 * @param {string} opts.replyText
 * @param {function} opts.getGifForEmotion - từ GifSearch
 * @param {function} opts.getGifByKeyword - từ GifSearch
 */
/** channelId -> last gif timestamp — chống spam GIF */
const lastGifAt = new Map();
const GIF_COOLDOWN_MS = 3 * 60 * 1000; // 3 phút / kênh
const GIF_CHANCE = 0.22; // ~22% khi đủ điều kiện cảm xúc mạnh

async function resolveEmotionalGif({ userEmotion, replyText, getGifForEmotion, getGifByKeyword, channelId }) {
  // Chỉ GIF khi cảm xúc user rõ (không neutral) + random + cooldown kênh
  const strong = userEmotion && userEmotion !== 'neutral';
  if (!strong) return null;
  if (Math.random() > GIF_CHANCE) return null;

  const cid = channelId ? String(channelId) : null;
  if (cid) {
    const last = lastGifAt.get(cid) || 0;
    if (Date.now() - last < GIF_COOLDOWN_MS) return null;
  }

  let gifUrl = null;
  try {
    gifUrl = await getGifForEmotion(userEmotion);
  } catch (_) {}
  if (!gifUrl) {
    const kw = getGifKeywordForEmotion(userEmotion);
    if (kw) {
      try {
        gifUrl = await getGifByKeyword(kw);
      } catch (_) {}
    }
  }
  // Không fallback keyword tiếng Anh từ reply (dễ spam GIF lệch)

  if (gifUrl && cid) lastGifAt.set(cid, Date.now());
  return gifUrl;
}

module.exports = {
  detectUserEmotion,
  detectEmotion,
  getEmotionToneHint,
  appendEmotionToInstruction,
  getGifKeywordForEmotion,
  tryQuickEmotionalReply,
  resolveEmotionalGif,
  EMOTION_GIF_KEYWORDS,
  EMOTION_TONE_HINTS,
};
