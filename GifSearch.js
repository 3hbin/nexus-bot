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

async function chooseRandomGifFromData(data) {
  try {
    if (!data || !Array.isArray(data) || data.length === 0) return null;
    const idx = Math.floor(Math.random() * data.length);
    const gif = data[idx];
    const gifUrl = (gif.images && (gif.images.fixed_height?.url || gif.images.original?.url)) || gif.url;
    return gifUrl || null;
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
      // handle 404 or other status codes gracefully
      console.warn('GifSearch: search returned non-ok status', res.status);
      if (res.status === 404) return await fallbackTrending();
      return null;
    }

    const data = await res.json().catch(async (e) => {
      console.warn('GifSearch: invalid json on search, fallback', e);
      return null;
    });

    const gifUrl = await chooseRandomGifFromData(data?.data || []);
    if (gifUrl) return gifUrl;

    // fallback if no results
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
