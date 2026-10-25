/**
 * Trang cấu hình bot — mỗi thành viên sửa setting CỦA MÌNH.
 * Admin (ADMIN_USER_IDS) thấy thêm trạng thái pool / hướng dẫn.
 *
 * Link lấy bằng lệnh Discord: /web  hoặc  web
 * Token hết hạn sau 30 phút.
 */
const crypto = require('crypto');
const {
  getUserPrefs,
  setUserLanguage,
  setUserVoiceGender,
  setUserTts,
  setUserVoiceChat,
  setUserPersona,
  setUserReplyMode,
  setUserAiName,
} = require('./UserPrefs.js');

const TOKEN_TTL_MS = 30 * 60 * 1000;
/** token -> { userId, username, isAdmin, exp } */
const tokens = new Map();

const PERSONAS = [
  ['default', 'Nexus mặc định'],
  ['tretrau', 'Trẻ trâu (không chửi)'],
  ['tretrau_toxic', 'Trẻ trâu (mạnh)'],
  ['nhe_nhang', 'Nhẹ nhàng'],
  ['ngau', 'Ngầu'],
  ['phan_tich', 'Phân tích'],
  ['chatgpt', 'ChatGPT (Luna)'],
  ['gemini', 'Gemini'],
  ['claude', 'Claude'],
  ['grok', 'Grok'],
  ['dola', 'Dola'],
  ['copilot', 'Copilot'],
  ['deepseek', 'DeepSeek'],
  ['delta', 'Delta'],
];

const LANGS = [
  ['vi', '🇻🇳 Tiếng Việt'],
  ['en', '🇬🇧 English'],
  ['ko', '🇰🇷 한국어'],
  ['ja', '🇯🇵 日本語'],
  ['zh', '🇨🇳 中文'],
  ['th', '🇹🇭 ไทย'],
  ['auto', '🌐 Auto (theo Discord)'],
];

function getPublicBaseUrl() {
  const env = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  const domain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (domain) return `https://${domain}`;
  return '';
}

function createToken(userId, username, isAdmin) {
  const token = crypto.randomBytes(18).toString('hex');
  tokens.set(token, {
    userId: String(userId),
    username: String(username || 'user').slice(0, 40),
    isAdmin: !!isAdmin,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

function readToken(token) {
  const t = tokens.get(String(token || ''));
  if (!t) return null;
  if (Date.now() > t.exp) {
    tokens.delete(String(token));
    return null;
  }
  return t;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; background:#0f1115; color:#eee; margin:0; padding:16px; }
  .box { max-width:520px; margin:0 auto; background:#1a1d24; border-radius:16px; padding:20px; }
  h1 { font-size:1.25rem; margin:0 0 8px; }
  p, label { color:#c9cdd4; font-size:.95rem; }
  select, input[type=text] { width:100%; padding:10px; border-radius:10px; border:1px solid #333; background:#111; color:#fff; box-sizing:border-box; margin:6px 0 14px; }
  button { width:100%; padding:12px; border:0; border-radius:10px; background:#5865F2; color:#fff; font-weight:700; }
  .ok { background:#1e3a2f; color:#b6f3c8; padding:10px; border-radius:10px; margin-bottom:12px; }
  .warn { background:#3a2a12; color:#ffd89a; padding:10px; border-radius:10px; margin-bottom:12px; font-size:.9rem; }
  .hint { font-size:.8rem; color:#888; }
</style>
</head>
<body><div class="box">${body}</div></body>
</html>`;
}

function renderForm(sess, prefs, saved) {
  const langOpts = LANGS.map(
    ([id, label]) =>
      `<option value="${id}" ${String(prefs.language || 'vi') === id ? 'selected' : ''}>${label}</option>`
  ).join('');
  const personaOpts = PERSONAS.map(
    ([id, label]) =>
      `<option value="${id}" ${String(prefs.selectedPersona || 'default') === id ? 'selected' : ''}>${label}</option>`
  ).join('');
  const gender = prefs.voiceGender === 'nam' ? 'nam' : 'nu';
  const adminBox = sess.isAdmin
    ? `<div class="warn">Bạn là <b>admin</b>. Key Gemini / token Discord vẫn chỉ sửa trên Railway Variables — không để trên web công cộng.</div>`
    : `<div class="warn">Bạn chỉ sửa setting <b>của mình</b>. Không đổi được key bot hay kênh AI (cần admin + Discord <code>/setchannel</code>).</div>`;

  return page(
    'Cài đặt Nexus AI',
    `
    <h1>⚙️ Cài đặt Nexus AI</h1>
    <p>Xin chào <b>${escapeHtml(sess.username)}</b></p>
    ${saved ? '<div class="ok">✅ Đã lưu. Chat lại trên Discord để dùng setting mới.</div>' : ''}
    ${adminBox}
    <form method="post" action="/caidat">
      <input type="hidden" name="token" value="${escapeHtml(sess.token)}"/>
      <label>Ngôn ngữ AI</label>
      <select name="language">${langOpts}</select>
      <label>Giọng TTS</label>
      <select name="voiceGender">
        <option value="nam" ${gender === 'nam' ? 'selected' : ''}>Nam (Nam Minh)</option>
        <option value="nu" ${gender === 'nu' ? 'selected' : ''}>Nữ (Hoài My)</option>
      </select>
      <label>Persona</label>
      <select name="persona">${personaOpts}</select>
      <label>Tên gọi AI (trống = mặc định)</label>
      <input type="text" name="aiName" maxlength="40" value="${escapeHtml(prefs.aiName || '')}"/>
      <label>Chế độ trả lời</label>
      <select name="replyMode">
        <option value="normal" ${prefs.replyMode !== 'strict' ? 'selected' : ''}>Normal</option>
        <option value="strict" ${prefs.replyMode === 'strict' ? 'selected' : ''}>Strict (ngắn)</option>
      </select>
      <label>Đính MP3 mỗi câu (auto-speech)</label>
      <select name="ttsEnabled">
        <option value="0" ${!prefs.ttsEnabled ? 'selected' : ''}>Tắt</option>
        <option value="1" ${prefs.ttsEnabled ? 'selected' : ''}>Bật</option>
      </select>
      <label>Voicechat (đọc to khi bật /voicechat)</label>
      <select name="voiceChat">
        <option value="0" ${!prefs.voiceChat ? 'selected' : ''}>Tắt</option>
        <option value="1" ${prefs.voiceChat ? 'selected' : ''}>Bật</option>
      </select>
      <button type="submit">Lưu cài đặt</button>
    </form>
    <p class="hint">Link hết hạn sau 30 phút. Lấy link mới: gõ <code>web</code> hoặc <code>/web</code> trên Discord.</p>
    `
  );
}

function mountDashboard(app, { isBotOwner }) {
  app.use(require('express').urlencoded({ extended: false }));

  app.get('/caidat', (req, res) => {
    const token = String(req.query.token || '');
    const sess = readToken(token);
    if (!sess) {
      return res
        .status(401)
        .send(
          page(
            'Hết hạn',
            '<h1>🔒 Link hết hạn hoặc sai</h1><p>Vào Discord gõ <b>web</b> hoặc <b>/web</b> để lấy link mới.</p>'
          )
        );
    }
    sess.token = token;
    const prefs = getUserPrefs(sess.userId);
    res.send(renderForm(sess, prefs, req.query.saved === '1'));
  });

  app.post('/caidat', (req, res) => {
    const token = String(req.body.token || '');
    const sess = readToken(token);
    if (!sess) {
      return res
        .status(401)
        .send(page('Hết hạn', '<h1>🔒 Link hết hạn</h1><p>Gõ <b>web</b> trên Discord.</p>'));
    }
    setUserLanguage(sess.userId, req.body.language || 'vi');
    setUserVoiceGender(sess.userId, req.body.voiceGender || 'nu');
    setUserPersona(sess.userId, req.body.persona || 'default', null);
    setUserReplyMode(sess.userId, req.body.replyMode || 'normal');
    setUserTts(sess.userId, String(req.body.ttsEnabled) === '1');
    setUserVoiceChat(sess.userId, String(req.body.voiceChat) === '1');
    setUserAiName(sess.userId, req.body.aiName || '');
    res.redirect(`/caidat?token=${encodeURIComponent(token)}&saved=1`);
  });
}

function buildWebLink(userId, username, isAdmin) {
  const base = getPublicBaseUrl();
  const token = createToken(userId, username, isAdmin);
  if (!base) {
    return {
      ok: false,
      token,
      message:
        '⚠️ Chưa có địa chỉ web công khai.\n' +
        'Railway: Settings → **Networking** → Generate Domain\n' +
        'Rồi thêm Variable: `PUBLIC_BASE_URL=https://ten-cua-ban.up.railway.app`',
    };
  }
  return {
    ok: true,
    token,
    url: `${base}/caidat?token=${token}`,
  };
}

module.exports = {
  mountDashboard,
  buildWebLink,
  getPublicBaseUrl,
};
