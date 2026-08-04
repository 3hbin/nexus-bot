// Quiz.js — mini-game đố vui trong ticket / kênh
const activeQuizzes = new Map(); // channelId -> { question, answer, askedBy, expires }

const BANK = [
  { q: 'HTML viết tắt của gì?', a: ['hypertext markup language'] },
  { q: '2 + 2 × 2 = ?', a: ['6'] },
  { q: 'Thủ đô của Việt Nam là gì?', a: ['hà nội', 'ha noi'] },
  { q: 'HTTP status 404 nghĩa là gì?', a: ['not found', 'không tìm thấy'] },
  { q: 'Ngôn ngữ chính của Discord bot này (file index) là gì?', a: ['javascript', 'js', 'node', 'nodejs'] },
  { q: 'Trái đất quay quanh gì?', a: ['mặt trời', 'mat troi', 'sun'] },
  { q: '1 byte = ? bit', a: ['8'] },
  { q: 'CSS dùng để làm gì (một từ)?', a: ['style', 'giao diện', 'styling', 'định dạng'] },
  { q: 'Gemini là AI của công ty nào?', a: ['google'] },
  { q: 'Phím tắt copy trên Windows?', a: ['ctrl+c', 'ctrl c', 'control+c'] },
];

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function startQuiz(channelId, userId) {
  const item = BANK[Math.floor(Math.random() * BANK.length)];
  activeQuizzes.set(String(channelId), {
    question: item.q,
    answers: item.a.map(normalize),
    askedBy: userId,
    expires: Date.now() + 2 * 60 * 1000,
  });
  return item.q;
}

function tryAnswer(channelId, userId, text) {
  const quiz = activeQuizzes.get(String(channelId));
  if (!quiz) return null;
  if (Date.now() > quiz.expires) {
    activeQuizzes.delete(String(channelId));
    return { ok: false, expired: true, message: '⏰ Hết giờ câu đố này rồi. Gõ `/quiz` để lấy câu mới.' };
  }
  const ans = normalize(text);
  const hit = quiz.answers.some((a) => ans === a || ans.includes(a) || a.includes(ans));
  if (hit) {
    activeQuizzes.delete(String(channelId));
    return { ok: true, message: `🎉 **Đúng rồi!** <@${userId}> trả lời chính xác.` };
  }
  return { ok: false, expired: false, message: null }; // không phải câu trả lời quiz
}

function hasActiveQuiz(channelId) {
  const q = activeQuizzes.get(String(channelId));
  if (!q) return false;
  if (Date.now() > q.expires) {
    activeQuizzes.delete(String(channelId));
    return false;
  }
  return true;
}

module.exports = {
  startQuiz,
  tryAnswer,
  hasActiveQuiz,
};
