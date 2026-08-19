# Nexus AI — Discord Bot

[🇻🇳 Tiếng Việt](README.md) · [🇬🇧 English](README.en.md)

Nexus AI là một bot Discord thông minh viết bằng Node.js (discord.js v14) giúp bạn tạo kênh AI, ticket, DM và phản hồi khi được mention. Bot hỗ trợ nhiều nhà cung cấp mô hình (Gemini, ChatGPT/OpenAI, Claude, Grok, DeepSeek), persona, TTS/voicechat, Knowledge Base / Training, GIF, quota quản lý, moderation và Prompt Shield.

> Bảo mật: Không commit file `.env` vào repository. Token và API key chỉ cấu hình trong environment trên host (Railway, VPS, ...).

---

## Video hướng dẫn

Có video hướng dẫn triển khai và thao tác cơ bản (đính kèm trên trang repo).

---

## Tải source

[![Download ZIP](https://img.shields.io/badge/Download-ZIP-blue?style=for-the-badge&logo=github)](https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip)

| Cách | Link |
|------:|------|
| ZIP | https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip |
| Repo | https://github.com/3hbin/nexus-bot |
| Clone | `git clone https://github.com/3hbin/nexus-bot.git` |

---

## Tính năng chính

- Chat AI: kênh AI, ticket (1 user = 1 ticket), DM, mention bot
- Hỗ trợ đa provider: Gemini · ChatGPT/OpenAI · Claude · Grok · DeepSeek
- Ngôn ngữ trả lời: chọn cho từng người dùng / kênh / ticket
- Persona: bộ persona sẵn có + tuỳ chỉnh
- TTS / Voicechat: đọc câu trả lời trong voice hoặc đính kèm MP3
- KB / Memory: lệnh `kb`, `train:`, `remember:` để dạy bot
- Media: tạo ảnh / video (Gemini Veo / image models), GIF tích hợp
- Quota & Moderation: giới hạn sử dụng, lọc nội dung, Prompt Shield

Gõ `help` hoặc `/help` để xem hướng dẫn chi tiết trong bot.

---

## Ngôn ngữ AI trả lời

Bạn có thể đặt ngôn ngữ cho AI bằng lệnh `/languages` hoặc gửi nhanh trong chat:

```text
/languages language: 🇻🇳 Tiếng Việt
/languages language: 🇬🇧 English
lang: vi
lang: en
lang: ko
lang: auto
```

Bảng mã ngôn ngữ hỗ trợ:

| Mã | Ngôn ngữ |
|----|----------|
| `vi` | Tiếng Việt |
| `en` | English |
| `ko` | 한국어 (Korean) |
| `ja` | 日本語 (Japanese) |
| `zh` | 中文 (Chinese) |
| `th`, `fr`, `es`, `de`, `ru`, `id` | … |
| `auto` | Tự động theo locale Discord (không dùng IP) |

AI trả lời trực tiếp bằng ngôn ngữ đã chọn (áp dụng cho ticket / kênh / DM). Nếu chỉ cần dịch 1 đoạn, dùng: `/dich` hoặc `dịch: ...`.

---

## Thiết lập nhanh (Quick setup)

1. Tạo Discord App: https://discord.com/developers → New Application → bật **Message Content Intent** → lấy Bot Token.
2. Clone hoặc tải mã nguồn và đẩy vào GitHub private repository của bạn (nên giữ repo riêng để chứa API keys khi deploy).
3. Deploy: Ví dụ deploy lên Railway (kết nối GitHub và deploy branch `main`).
4. Thiết lập environment variables (shared / host):

| Biến | Bắt buộc | Mô tả |
|------|:--------:|-------|
| `DISCORD_TOKEN` | ✅ | Token bot Discord (Developer Portal) |
| `GEMINI_API_KEY` | ✅ (nếu dùng Gemini) | Key Gemini / Google AI Studio (https://aistudio.google.com/apikey) |
| `OPENAI_API_KEY` | Tuỳ (nếu dùng ChatGPT/OpenAI) | Key OpenAI (sk-...)
| `ANTHROPIC_API_KEY` | Tuỳ (nếu dùng Claude) | Key Anthropic |
| `XAI_API_KEY` | Tuỳ (nếu dùng Grok) | Key xAI |
| `DEEPSEEK_API_KEY` | Tuỳ (nếu dùng DeepSeek) | Key DeepSeek |
| `GIPHY_API_KEY` | Recommended | Cho GIF (https://developers.giphy.com) |
| `ADMIN_USER_IDS` | Recommended | Danh sách user id (comma-separated) |
| `ADMIN_LOG_CHANNEL_ID` | Optional | Channel ID để bot gửi log admin |
| `ONLINE_ANNOUNCE_CHANNEL_ID` | Optional | Channel ID để bot gửi thông báo online |
| `DATA_DIR` | Optional | Thư mục lưu data bền (ví dụ `/data` khi mount Volume) |

5. Start: `npm install` → `npm start`, hoặc dùng process manager / container trong host.

Sau khi chạy, gõ `help` hoặc `/help` trong server để kiểm tra.

---

## Lệnh chính (cơ bản)

| Lệnh | Mô tả |
|------|-------|
| `/help` | Xem hướng dẫn lệnh & tính năng |
| `/languages` | Chọn ngôn ngữ AI |
| `/setchannel` | Thiết lập kênh AI mặc định (admin) |
| `/voicechat` | Bật/tắt trả lời bằng voice |
| `/dich` | Dịch văn bản |
| `/speak`, `/tts` | Tạo file âm thanh từ text |
| `/ainame` | Đặt tên AI hiển thị |
| `/adminpanel` | Bảng điều khiển admin |

Ngoài ra còn nhiều lệnh liên quan ticket, kb, quota, moderation, media (xem README chi tiết hoặc gõ `help`).

---

## Voicechat (hiện dùng)

```text
1. Vào voice channel trên Discord
2. Chạy: /voicechat mode:on
3. Gửi text hoặc tin nhắn thoại trong kênh AI / ticket
4. Chọn giọng: giọng: nam  hoặc  giọng: nữ
```

---

## Lỗi thường gặp & cách khắc phục

| Lỗi | Xử lý |
|-----|-------|
| `Used disallowed intents` | Bật Message Content Intent trong Developer Portal → Redeploy bot |
| Slash commands không hiện | Đợi 1–2 phút hoặc mời lại bot vào server |
| Voice chỉ gửi MP3 | Thường do host miễn phí giới hạn UDP — vẫn ok dưới dạng MP3 |
| Mất data khi redeploy | Mount Volume và đặt `DATA_DIR=/data` để giữ sessions & tickets |

---

Cảm ơn bạn — chúc deploy thành công!

