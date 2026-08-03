// GifSearch.js
// Sử dụng GIPHY API để lấy GIF theo cảm xúc (async) với fallback và xử lý lỗi
const fetch = (typeof globalThis.fetch === 'function') ? globalThis.fetch : (() => {
  try { return require('node-fetch'); } catch (e) { return null; }
})();

const GIPHY_API_KEY = process.env.GIPHY_API_KEY || '';

const EMOTION_MAP = {
  hello: 'hello',
  thanks: 'thank you',
  sorry: 'sorry',
  thinking: 'thinking',
  happy: 'happy',
};

// Thứ tự ưu tiên các field ảnh của Giphy. Tránh dùng field có kèm nhiều
// query param tracking dài (dễ bị Discord unfurl lỗi / vỡ icon khi nối vào text).
// "downsized" và "original" cho URL .gif gọn, ổn định hơn "fixed_height" khi copy nguyên link.
const IMAGE_FIELD_PRIORITY = ['downsized', 'downsized_medium', 'fixed_height', 'original'];

function extractStableGifUrl(gif) {
  if (!gif || !gif.images) return gif?.url || null;

  for (const field of IMAGE_FIELD_PRIORITY) {
    const candidate = gif.images[field]?.url;
    if (candidate && typeof candidate === 'string' && candidate.startsWith('http')) {
      return candidate;
    }
  }
  return gif.url || null;
}

// Kiểm tra nhanh URL còn tồn tại thật trước khi trả về cho Discord (tránh gửi link chết/vỡ).
async function validateGifUrl(url) {
  try {
    if (!url || !fetch) return false;
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!res) return false;
    return res.ok;
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
        console.error('GifSearch: GIPHY_API_KEY có thể không hợp lệ hoặc bị thu hồi.');
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
    if (!r || !r.ok) return null;
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
