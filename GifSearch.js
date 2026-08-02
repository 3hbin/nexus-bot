// GifSearch.js
// Sử dụng GIPHY API để lấy GIF theo cảm xúc (async)
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

async function getGifForEmotion(emotion) {
  try {
    if (!emotion) return null;
    const q = EMOTION_MAP[emotion] || emotion;
    if (!GIPHY_API_KEY) {
      // if no API key, return null gracefully
      return null;
    }
    if (!fetch) {
      console.warn('GifSearch: No fetch implementation available.');
      return null;
    }
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(
      GIPHY_API_KEY
    )}&q=${encodeURIComponent(q)}&limit=12&rating=pg-13`;
    const res = await fetch(url).catch((e) => { throw e; });
    if (!res || !res.ok) {
      console.warn('GifSearch: Giphy API returned non-ok:', res && res.status);
      return null;
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.data) || data.data.length === 0) return null;
    // choose a random gif
    const idx = Math.floor(Math.random() * data.data.length);
    const gif = data.data[idx];
    // prefer fixed_height or original
    const gifUrl = (gif.images && (gif.images.fixed_height?.url || gif.images.original?.url)) || gif.url;
    return gifUrl || null;
  } catch (err) {
    console.error('GifSearch: getGifForEmotion error:', err);
    return null;
  }
}

module.exports = {
  getGifForEmotion,
};
