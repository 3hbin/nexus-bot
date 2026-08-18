# Nexus AI — Discord Bot

[🇻🇳 Tiếng Việt](README.md) · [🇬🇧 English](README.en.md)

Bot Discord AI (**Node.js** + **discord.js v14**) — chat kênh AI / ticket / DM / mention.

Hỗ trợ **Gemini · ChatGPT · Claude · Grok · DeepSeek**, persona, Training/KB, TTS, voicechat, đa ngôn ngữ, GIF, quota, moderation, Prompt Shield.

> **Bảo mật:** Không commit `.env`. Token & API key chỉ đặt trên host (Railway, VPS…).

---

## Video hướng dẫn

https://github.com/user-attachments/assets/25d34b15-2b1f-4f6b-ab8a-4c400310f6ca

---

## Tải source

[![Download ZIP](https://img.shields.io/badge/Download-ZIP-blue?style=for-the-badge&logo=github)](https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip)

| Cách | Link |
|------|------|
| **ZIP** | https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip |
| **Repo** | https://github.com/3hbin/nexus-bot |
| **Clone** | `git clone https://github.com/3hbin/nexus-bot.git` |

---

## Tính năng

| Nhóm | Chi tiết |
|------|----------|
| **Chat AI** | Kênh AI, ticket, mention, DM |
| **Đa provider** | Gemini · ChatGPT · Claude · Grok · DeepSeek |
| **Ngôn ngữ AI** | `/languages` · `lang: en` — AI trả lời đúng tiếng đã chọn |
| **Ticket** | 1 user = 1 vé · key/model · persona |
| **Persona** | Trẻ trâu 🐃 · toxic 💀 · nhẹ 🍀 · ngầu 😎 · phân tích 📚 |
| **TTS / Voicechat** | `/voicechat` · `giọng: nam/nữ` |
| **KB / Memory** | `train:` · `kb add:` · `remember:` |
| **GIF · Dịch · Quota · Prompt Shield** | |

Gõ **`help`** hoặc **`/help`**.

---

## Ngôn ngữ AI trả lời

```text
/languages language: 🇻🇳 Tiếng Việt
/languages language: 🇬🇧 English
lang: vi
lang: en
lang: ko
lang: auto
```

| Mã | Ngôn ngữ |
|----|----------|
| `vi` | Tiếng Việt |
| `en` | English |
| `ko` | 한국어 |
| `ja` | 日本語 |
| `zh` | 中文 |
| `th` `fr` `es` `de` `ru` `id` | … |
| `auto` | Theo ngôn ngữ app Discord (không dùng IP) |

AI **viết luôn** bằng tiếng đã chọn trong ticket / kênh / DM.  
Chỉ dịch 1 đoạn: `/dich` hoặc `dịch: ...`.

---

## Setup nhanh

1. [discord.com/developers](https://discord.com/developers/applications) → tạo app → bật **Message Content Intent** → copy token  
2. Tải ZIP / clone repo → đẩy lên **GitHub Private** của bạn  
3. [railway.app](https://railway.app) → Deploy từ GitHub  
4. **Shared Variables:**

| Biến | Bắt buộc | Nguồn |
|------|----------|--------|
| `DISCORD_TOKEN` | ✅ | Bot → Reset Token |
| `GEMINI_API_KEY` | ✅ | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `GIPHY_API_KEY` | Khuyên | [developers.giphy.com](https://developers.giphy.com) |
| `ADMIN_USER_IDS` | Khuyên | Copy User ID (Developer Mode) |
| `ADMIN_LOG_CHANNEL_ID` | Tuỳ | ID kênh `#logs` |
| `ONLINE_ANNOUNCE_CHANNEL_ID` | Tuỳ | Kênh báo online |
| `DATA_DIR` | Tuỳ | `/data` nếu có Volume |

5. Deploy → gõ `help` trong server  

---

## Lệnh chính

| Lệnh | Mô tả |
|------|--------|
| `/help` | Trợ giúp |
| `/languages` | Chọn ngôn ngữ AI |
| `/setchannel` | Đặt kênh AI |
| `/voicechat` | Chat thoại |
| `/dich` | Dịch đoạn văn |
| `/speak` `/tts` | Đọc text |
| `/ainame` | Đặt tên AI |
| `/adminpanel` | Admin |

**Chat nhanh:** `lang: en` · `giọng: nữ` · `key gemini: ...` · `gif: ...` · `help`

---

## Voicechat

```text
1. Vào voice
2. /voicechat mode:on
3. Nhắn text hoặc tin nhắn thoại
4. giọng: nam | giọng: nữ
```

---

## Lỗi thường gặp

| Lỗi | Xử lý |
|-----|--------|
| `Used disallowed intents` | Bật Message Content Intent → Redeploy |
| Slash không hiện | Đợi 1–2 phút / mời lại bot |
| Voice chỉ MP3 | Bình thường trên host free |
| Mất data khi redeploy | Volume + `DATA_DIR=/data` |

---

**Chúc bạn deploy thành công.**  
[🇬🇧 English version](README.en.md)
