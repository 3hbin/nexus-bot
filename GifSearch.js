// GifSearch.js
// Module lấy GIF ĐỘNG theo cảm xúc từ Giphy Search API, thay cho danh sách hardcode
// (dễ bị ít GIF + link chết dần vì Giphy xoá/đổi nội dung theo thời gian).
//
// LƯU Ý: Tenor API (Google) đã bị NGỪNG HOÀN TOÀN từ 30/6/2026 -> không dùng được nữa.
// Module này dùng Giphy API — vẫn hoạt động bình thường tính đến hiện tại.

const GIPHY_BASE_URL = 'https://api.giphy.com/v1/gifs/search';

// Key public dùng thử của Giphy (giới hạn 100 request/giờ, KHÔNG khuyến khích dùng lâu dài).
// Nên đăng ký key riêng miễn phí tại https://developers.giphy.com/ rồi set biến môi trường GIPHY_API_KEY.
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || 'dc6zaTOxFJmzC';

// Từ khóa tìm kiếm cho từng loại cảm xúc (có thể chỉnh/thêm tuỳ ý).
const EMOTION_SEARCH_TERMS = {
  hello: 'hello wave anime',
  happy: 'happy excited anime',
  sorry: 'sorry apologize anime',
  thanks: 'thank you anime',
  thinking: 'thinking hmm anime',
};

// Cache theo emotion để tránh gọi API liên tục (đỡ tốn quota + phản hồi nhanh hơn).
const gifCache = new Map(); // emotion -> { urls: string[], fetchedAt: number }
const CACHE_TTL_MS = 30 * 60 * 1000; // cache 30 phút/emotion

// Danh sách GIF dự phòng (fallback) — dùng khi gọi API lỗi (mất mạng, hết quota, key sai...).
// Vẫn nên thay bằng link mới nếu phát hiện gãy, nhưng chỉ là lớp bảo hiểm cuối cùng.
const FALLBACK_GIFS = {
  hello: ['https://media.giphy.com/media/ASd0Ukj0y3qMM/giphy.gif'],
  happy: ['https://media.giphy.com/media/111ebonMs90YLu/giphy.gif'],
  sorry: ['https://media.giphy.com/media/9Y5BbDSkSTiY8/giphy.gif'],
  thanks: ['https://media.giphy.com/media/l4FGwHEUCGILg3g0A/giphy.gif'],
  thinking: ['https://media.giphy.com/media/l0HlQ7LRal2p7x1Wc/giphy.gif'],
};

/**
 * Gọi Giphy Search API để lấy danh sách URL GIF theo từ khóa.
 * @param {string} searchTerm
 * @returns {Promise<string[]>} danh sách URL gif (rỗng nếu lỗi/không có kết quả).
 */
async function fetchGifsFromGiphy(searchTerm) {
  const url =
    `${GIPHY_BASE_URL}?api_key=${encodeURIComponent(GIPHY_API_KEY)}` +
    `&q=${encodeURIComponent(searchTerm)}` +
    `&limit=15&rating=g&lang=en`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Giphy API trả về status ${response.status}`);
  }

  const data = await response.json();
  const results = Array.isArray(data?.data) ? data.data : [];

  return results
    .map((item) => item?.images?.fixed_height?.url || item?.images?.original?.url)
    .filter(Boolean);
}

/**
 * Lấy 1 URL GIF ngẫu nhiên phù hợp với cảm xúc, có cache + fallback.
 * @param {string} emotion - 'hello' | 'happy' | 'sorry' | 'thanks' | 'thinking'
 * @returns {Promise<string|null>} URL gif, hoặc null nếu emotion không hợp lệ.
 */
async function getGifForEmotion(emotion) {
  const searchTerm = EMOTION_SEARCH_TERMS[emotion];
  if (!searchTerm) return null;

  const cached = gifCache.get(emotion);
  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;

  if (isFresh && cached.urls.length > 0) {
    return cached.urls[Math.floor(Math.random() * cached.urls.length)];
  }

  try {
    const urls = await fetchGifsFromGiphy(searchTerm);
    if (urls.length > 0) {
      gifCache.set(emotion, { urls, fetchedAt: Date.now() });
      return urls[Math.floor(Math.random() * urls.length)];
    }
  } catch (err) {
    console.error(`⚠️ Lỗi khi lấy GIF từ Giphy cho emotion "${emotion}":`, err);
  }

  // Fallback: dùng cache cũ (dù hết hạn) nếu có, rồi mới tới danh sách dự phòng cứng.
  if (cached && cached.urls.length > 0) {
    return cached.urls[Math.floor(Math.random() * cached.urls.length)];
  }
  const fallbackList = FALLBACK_GIFS[emotion] || [];
  return fallbackList.length > 0
    ? fallbackList[Math.floor(Math.random() * fallbackList.length)]
    : null;
}

module.exports = {
  getGifForEmotion,
  EMOTION_SEARCH_TERMS,
};

/*
==========================================================================
HƯỚNG DẪN TÍCH HỢP VÀO index.js
==========================================================================

1) XOÁ (hoặc để nguyên cũng được, không dùng nữa) object `GIFS` và hàm `pickGifForEmotion`
   trong index.js — thay bằng import module này:

   const { getGifForEmotion } = require('./GifSearch.js');

2) Trong đoạn xử lý reply (sau khi có `replyText` và `emotion`), đổi từ:

   const gifUrl = emotion ? pickGifForEmotion(emotion) : null;

   thành (LƯU Ý: giờ là async, cần await):

   const gifUrl = emotion ? await getGifForEmotion(emotion) : null;

3) (Khuyến nghị) Đăng ký API key Giphy miễn phí riêng tại https://developers.giphy.com/
   rồi thêm vào biến môi trường trên Render:

   GIPHY_API_KEY=your_real_key_here

   Nếu không set, module sẽ tự dùng key public dùng thử của Giphy (giới hạn 100 request/giờ,
   dùng chung với hàng ngàn app khác trên thế giới -> dễ bị rate-limit khi bot đông user).

4) Không cần cài thêm package nào — `fetch` đã có sẵn native trong Node.js 18+.
   (Nếu Render đang chạy Node <18, cần nâng version hoặc cài `node-fetch`.)
==========================================================================
*/
