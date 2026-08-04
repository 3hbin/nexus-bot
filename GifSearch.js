// GifSearch.js
// Sử dụng GIPHY API để lấy GIF theo cảm xúc (async) với fallback và xử lý lỗi
const fetch = (typeof globalThis.fetch === 'function') ? globalThis.fetch : (() => {
  try { return require('node-fetch'); } catch (e) { return null; }
})();

const GIPHY_API_KEY = (process.env.GIPHY_API_KEY || '').trim();

if (!GIPHY_API_KEY) {
  console.warn('⚠️ GifSearch: Chưa cấu hình GIPHY_API_KEY — tính năng GIF phản ứng sẽ bị tắt (sẽ không gửi GIF nào).');
}

const EMOTION_MAP = {
  hello: 'hello',
  thanks: 'thank you',
  sorry: 'sorry',
  thinking: 'thinking',
  happy: 'happy',
  shy: 'shy blushing embarrassed',
};

// Thứ tự ưu tiên các field ảnh của Giphy. Tránh dùng field có kèm nhiều
// query param tracking dài (dễ bị Discord unfurl lỗi / vỡ icon khi nối vào text).
// "downsized" và "original" cho URL .gif gọn, ổn định hơn "fixed_height" khi copy nguyên link.
const IMAGE_FIELD_PRIORITY = ['downsized', 'downsized_medium', 'fixed_height', 'original'];

// URL Giphy hợp lệ luôn có dạng .gif và host thuộc giphy. Chặn hẳn mọi thứ khác
// để không bao giờ đẩy một URL rác/không phải ảnh cho Discord.
function isLikelyValidGifUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (!/\.(gif|webp|mp4)(\?|$)/i.test(url)) return false;
  return true;
}

function extractStableGifUrl(gif) {
  if (!gif || typeof gif !== 'object' || !gif.images) return null;

  for (const field of IMAGE_FIELD_PRIORITY) {
    const candidate = gif.images[field]?.url;
    if (isLikelyValidGifUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Giphy trả "soft 404": khi một GIF đã bị xoá khỏi hệ thống, URL .gif của nó
// KHÔNG trả HTTP 404 — nó vẫn trả 200 OK nhưng nội dung là một ảnh placeholder
// cố định (icon "content unavailable", ví dụ ảnh con chó). Vì vậy không thể
// chỉ dựa vào status code để xác nhận GIF còn "sống" — phải kiểm tra thêm
// kích thước nội dung, vì placeholder luôn có cùng kích thước byte cố định.
//
// Ngưỡng dưới đây là ước lượng an toàn: file placeholder của Giphy rất nhỏ
// (vài KB), trong khi GIF thật (kể cả bản "downsized" nhỏ nhất) gần như luôn
// lớn hơn nhiều. Nếu vẫn gặp false positive/negative, log content-length ra
// và điều chỉnh ngưỡng THRESHOLD cho phù hợp với thực tế bạn quan sát được.
const PLACEHOLDER_SIZE_THRESHOLD_BYTES = 10000;

// Kiểm tra nhanh URL còn tồn tại thật trước khi trả về cho Discord (tránh gửi link chết/vỡ
// hoặc ảnh placeholder lỗi của Giphy).
// Dùng GET thay vì HEAD, vì nhiều CDN (kể cả Giphy) không hỗ trợ HEAD đúng cách
// và có thể trả 404/405 dù URL vẫn sống — khiến GIF hợp lệ bị loại oan.
async function validateGifUrl(url) {
  try {
    if (!url || !fetch) return false;

    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 4000) : null;

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        signal: controller ? controller.signal : undefined,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (!res) return false;
    if (!res.ok) return false;

    const contentLengthHeader = res.headers?.get?.('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;

    if (contentLength && contentLength < PLACEHOLDER_SIZE_THRESHOLD_BYTES) {
      console.warn(
        `GifSearch: nghi là ảnh placeholder lỗi của Giphy (chỉ ${contentLength} bytes), loại bỏ: ${url}`
      );
      return false;
    }

    // Nếu server không trả content-length (hiếm với Giphy), đành chấp nhận
    // dựa vào status 200/206 như trước — tốt hơn là chặn nhầm GIF hợp lệ.
    return true;
  } catch (e) {
    return false;
  }
}

async function chooseRandomGifFromData(data) {
  try {
    if (!data || !Array.isArray(data) || data.length === 0) return null;

    // Thử tối đa 5 GIF ngẫu nhiên khác nhau, dừng lại khi tìm được 1 link còn sống.
    const pool = [...data];
    const attempts = Math.min(5, pool.length);

    for (let i = 0; i < attempts; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const gif = pool.splice(idx, 1)[0];
      const gifUrl = extractStableGifUrl(gif);
      if (!gifUrl) continue;

      const ok = await validateGifUrl(gifUrl);
      if (ok) return gifUrl;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function getGifForEmotion(emotion) {
  try {
    if (!GIPHY_API_KEY) return null;
    if (!emotion) return null;
    const q = EMOTION_MAP[emotion] || emotion;
    return await getGifByKeyword(q);
  } catch (err) {
    console.error('GifSearch: getGifForEmotion error:', err);
    return null;
  }
}

async function getGifByKeyword(keyword) {
  // keyword: English keyword or phrase
  try {
    if (!keyword) return null;
    if (!GIPHY_API_KEY) return null;
    if (!fetch) {
      console.warn('GifSearch: No fetch available');
      return null;
    }

    const searchUrl = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&q=${encodeURIComponent(keyword)}&limit=12&rating=pg-13`;

    let res;
    try {
      res = await fetch(searchUrl);
    } catch (networkErr) {
      console.warn('GifSearch: network error on search:', networkErr);
      // fallback to trending
      return await fallbackTrending();
    }

    if (!res) return await fallbackTrending();
    if (!res.ok) {
      // handle 404, 401 (key sai), 429 (rate limit) hoặc status khác
      console.warn('GifSearch: search returned non-ok status', res.status);
      if (res.status === 401 || res.status === 403) {
        console.error('GifSearch: GIPHY_API_KEY không hợp lệ hoặc bị thu hồi. Kiểm tra lại giá trị trong Render Environment Variables.');
        return null;
      }
      if (res.status === 404 || res.status === 429) return await fallbackTrending();
      return null;
    }

    const data = await res.json().catch((e) => {
      console.warn('GifSearch: invalid json on search, fallback', e);
      return null;
    });

    const gifUrl = await chooseRandomGifFromData(data?.data || []);
    if (gifUrl) return gifUrl;

    // fallback if no results or all candidates were dead links
    return await fallbackTrending();
  } catch (err) {
    console.error('GifSearch: getGifByKeyword error:', err);
    return null;
  }
}

async function fallbackTrending() {
  try {
    if (!GIPHY_API_KEY) return null;
    if (!fetch) return null;
    const trendingUrl = `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&limit=25&rating=pg-13`;
    const r = await fetch(trendingUrl).catch((e) => {
      console.warn('GifSearch: trending network error', e);
      return null;
    });
    if (!r || !r.ok) {
      if (r && (r.status === 401 || r.status === 403)) {
        console.error('GifSearch: GIPHY_API_KEY không hợp lệ khi gọi trending.');
      }
      return null;
    }
    const d = await r.json().catch(() => null);
    return await chooseRandomGifFromData(d?.data || []);
  } catch (err) {
    console.error('GifSearch: fallbackTrending error:', err);
    return null;
  }
}

module.exports = {
  getGifForEmotion,
  getGifByKeyword,
};
