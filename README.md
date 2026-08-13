# Nexus AI — Discord Bot

Bot Discord AI (Node.js + discord.js v14 + Google Gemini), hỗ trợ ticket, persona, dịch, memory, voice/TTS và nhiều tiện ích.

> **Lưu ý bảo mật:** Không commit file `.env`. Token & API key chỉ đặt trên host (Railway, VPS…).

---

## Tính năng chính

| Nhóm | Chi tiết |
|------|----------|
| **Chat AI** | Trả lời trong kênh AI / ticket / mention; xem ảnh (Vision) |
| **Ticket** | Tạo ticket chat riêng, chọn model + persona, `key:` API riêng |
| **Persona** | Nexus, ChatGPT (Luna), Gemini, Claude, Grok, Dola, Copilot, DeepSeek, tùy chỉnh |
| **Bộ nhớ** | `remember:` / `memory` / `forget:` — nhớ lâu dài theo user |
| **Dịch** | `/dich`, `dịch:`, nút **Dịch** dưới câu trả lời (bản dịch dài tách nhiều tin) |
| **Code dài** | Tự đăng paste (link) — không bắt tải file nặng |
| **Trả lời dài** | Tự tách nhiều tin `(1/n)…` |
| **Nút** | Trả lời lại · Dịch · 👍 / 👎 |
| **Quota** | Giới hạn chat/ảnh/video theo ngày + cảnh báo gần hết |
| **Khác** | `/ask`, `/summary`, `/export`, `/quiz`, `/ship`, `/remind`, TTS, voice, GIF cảm xúc (hạn chế spam) |

Gõ `help` hoặc `!help` trong kênh AI để xem hướng dẫn nhanh.

---

## Yêu cầu

- Node.js **18+**
- Tài khoản [Discord Developer](https://discord.com/developers/applications)
- [Google AI Studio](https://aistudio.google.com) — Gemini API key
- (Tuỳ chọn) [Giphy Developers](https://developers.giphy.com) — API key loại **API** (không phải SDK)

---

## Cài đặt nhanh

### 1. Clone & cài package

```bash
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
npm install
```

### 2. Biến môi trường

Tạo file `.env` (hoặc Variables trên Railway):

```env
DISCORD_TOKEN=token_bot_discord
GEMINI_API_KEY=AIza... hoặc AQ...
GIPHY_API_KEY=          # không bắt buộc
ADMIN_LOG_CHANNEL_ID=   # kênh log admin (tuỳ chọn)

# Tuỳ chọn giới hạn/ngày
QUOTA_CHAT_PER_DAY=80
QUOTA_IMAGE_PER_DAY=12
QUOTA_VIDEO_PER_DAY=3
```

### 3. Intent Discord

Developer Portal → Bot → bật:

- **Message Content Intent**
- **Server Members Intent** (nếu cần)
- **Presence Intent** (tuỳ chọn)

### 4. Chạy local

```bash
npm start
```

### 5. Deploy (Railway)

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub  
2. Thêm đúng Variables như trên  
3. Start: `npm start`  
4. Xem log: `Bot … đã online`

---

## Lệnh slash (một phần)

| Lệnh | Mô tả |
|------|--------|
| `/help` | Hướng dẫn |
| `/ping` | Độ trễ |
| `/ask` | Hỏi 1 phát (ephemeral) |
| `/persona` | Đổi persona ngoài ticket |
| `/quota` | Xem hạn mức ngày |
| `/summary` | Tóm tắt kênh |
| `/export` | Xuất chat `.txt` |
| `/dich` | Dịch VI ↔ EN |
| `/imagine` · `/video` | Tạo ảnh / video |
| `/tts` · `/speak` · `/voice` | Giọng nói |
| `/setchannel` | Chỉ Admin — khóa bot 1 kênh |
| `/setup_ticketai` | Chỉ Admin — panel ticket |

Tin nhắn thường: `help`, `remember: …`, `note: …`, `dịch: …`, `key: …` (trong ticket).

---

## Cấu trúc thư mục (rút gọn)

```text
index.js           # Entry, slash, chat pipeline
TicketManager.js   # Ticket + persona menu
Interest.js        # Persona presets
Memory.js          # Ghi nhớ dài hạn
Emotion.js         # Cảm xúc + GIF (throttle)
QuotaManager.js    # Hạn mức ngày
GifSearch.js       # Giphy
VoiceManager.js    # Voice / fallback
Tts.js             # TTS MP3
AdminLog.js        # Log admin
…
data/              # JSON runtime (không commit secret)
```

---

## Mời bot vào server

1. Discord Developer Portal → **OAuth2 → URL Generator**  
2. Scopes: `bot` + `applications.commands`  
3. Permissions: Send Messages, Embed Links, Attach Files, Read Message History, Use Slash Commands, Connect/Speak (nếu voice)…  
4. Copy URL → gửi bạn bè  

Hoặc:

```text
https://discord.com/api/oauth2/authorize?client_id=APPLICATION_ID&permissions=2147552256&scope=bot%20applications.commands
```

Thay `APPLICATION_ID` bằng Application ID của bot.

---

## Bảo mật khi chia sẻ

| Được share | Không share |
|------------|-------------|
| Link **mời bot** | `DISCORD_TOKEN` |
| Hướng dẫn dùng | `GEMINI_API_KEY` |
| Repo **private** (nếu không muốn lộ code) | File `.env` |
| | Link dashboard Railway/Render có quyền sửa |

Mời thêm server **không** nhân đôi phí host; **chat AI** mới tốn quota Gemini.

---

## License

MIT (hoặc ghi rõ quyền của bạn). Dùng Gemini / Giphy / Discord tuân theo điều khoản từng bên.

---

## Credits

Nexus AI — Discord bot powered by **Gemini** · discord.js v14  
