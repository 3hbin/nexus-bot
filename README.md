# Nexus AI — Discord Bot

Bot Discord AI đa nhà cung cấp (Node.js + **discord.js v14**), chat trong kênh AI / ticket, persona, memory, dịch, voice, GIF, quota…

> **Bảo mật:** Không commit file `.env`. Token & API key chỉ đặt trên host (Railway, VPS…).

---

## Tính năng

| Nhóm | Chi tiết |
|------|----------|
| **Chat AI** | Kênh AI, ticket, mention; xem ảnh (Gemini Vision); tin nhắn thoại |
| **Đa provider** | Gemini · ChatGPT · Claude · Grok · DeepSeek (key + model trong ticket) |
| **Ticket** | Kênh riêng, menu model/persona, nút nhập key, `note:`, đóng ticket |
| **Persona** | Nexus, Luna (ChatGPT), Gemini, Claude, Grok, Dola, Copilot, DeepSeek, tùy chỉnh |
| **Bộ nhớ** | `remember:` / `memory` / `forget:` — nhớ dài hạn theo user |
| **Dịch** | `/dich`, `dịch:`, nút **Dịch** (bản dài tách nhiều tin) |
| **Code dài** | Tự đăng **link paste** (không bắt tải file nặng) |
| **Trả lời dài** | Tự tách tin `(1/n)` |
| **GIF** | Cảm xúc + khi user gõ `gif: …` / `gửi gif` (cần `GIPHY_API_KEY`) |
| **Voice / TTS** | `/voice`, `/speak`, `voicechat on`, đọc câu trả lời (host free có thể chỉ MP3) |
| **Nút** | Trả lời lại · Dịch · 👍 / 👎 |
| **Quota** | Giới hạn chat/ảnh/video theo ngày; cảnh báo gần hết |
| **Khác** | `/ask`, `/summary`, `/export`, `/quiz`, `/ship`, `/remind`, help |

Gõ **`help`** hoặc **`!help`** trong kênh AI / ticket.

---

## Yêu cầu

- Node.js **18+**
- [Discord Developer Portal](https://discord.com/developers/applications) — bot + intents
- Ít nhất một API chat (khuyên **Gemini** free tier để chạy server)
- (Tuỳ chọn) Giphy, OpenAI, Anthropic, xAI, DeepSeek keys cho ticket

### Intent Discord (bật trong Bot settings)

- **Message Content Intent**
- **Server Members Intent** (nếu cần)
- Presence (tuỳ chọn)

---

## Cài đặt

```bash
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
npm install
```

### Biến môi trường (`.env` hoặc Railway Variables)

```env
DISCORD_TOKEN=
GEMINI_API_KEY=

# Tuỳ chọn
GIPHY_API_KEY=
ADMIN_LOG_CHANNEL_ID=

# Giới hạn / ngày (mặc định trong code nếu bỏ trống)
QUOTA_CHAT_PER_DAY=80
QUOTA_IMAGE_PER_DAY=12
QUOTA_VIDEO_PER_DAY=3
```

Ticket có thể dùng key riêng của user (không cần set sẵn OPENAI/… trên server).

### Chạy local

```bash
npm start
```

### Deploy Railway

1. [railway.app](https://railway.app) → New Project → GitHub repo  
2. Thêm Variables như trên  
3. Start command: `npm start`  
4. Log: `Bot … đã online` + `Slash commands (guild) → …`

---

## Ticket — key & model

Trong kênh ticket:

**Nút:** Key Gemini · Key ChatGPT · Key Claude · Key Grok · Key DeepSeek  

**Hoặc nhắn:**

```text
key gemini: AIza...
key chatgpt: sk-...
key claude: sk-ant-...
key grok: xai-...
key deepseek: sk-...
```

Gõ `keys` để xem provider nào đã có key.

### Link lấy key

| Provider | Link |
|----------|------|
| Gemini | https://aistudio.google.com |
| ChatGPT | https://platform.openai.com/api-keys |
| Claude | https://console.anthropic.com/settings/keys |
| Grok | https://console.x.ai |
| DeepSeek | https://platform.deepseek.com/api_keys |

### Model (menu ticket — cập nhật theo API)

- **Gemini:** 3.6 Flash, 3.5 Flash, Flash-Lite, 3.1 Pro  
- **ChatGPT:** GPT-5, GPT-5 Mini, GPT-5.1, o4-mini  
- **Claude:** Sonnet 5, Haiku 4.5, Opus 5  
- **Grok:** 4.6, 4.5, 4.3  
- **DeepSeek:** Chat, Reasoner  

Model + key phải **cùng nhà cung cấp**. Nhiều API trả phí / có free hạn chế.

---

## Lệnh chính

| Lệnh / tin nhắn | Mô tả |
|-----------------|--------|
| `help` / `/help` | Hướng dẫn |
| `/ping` | Độ trễ |
| `/ask` | Hỏi 1 phát (ephemeral) |
| `/persona` | Đổi persona ngoài ticket |
| `/quota` | Hạn mức ngày |
| `/summary` | Tóm tắt kênh |
| `/export` | Xuất chat `.txt` |
| `/dich` · `dịch:` | Dịch VI ↔ EN |
| `/imagine` · `/video` | Tạo ảnh / video (Gemini) |
| `/tts` · `/speak` | TTS / file MP3 |
| `/voice` | Join / leave / speak |
| `/voicechat` · `voicechat on` | Bot đọc câu trả lời |
| `/setchannel` | Admin — khóa 1 kênh AI |
| `/setup_ticketai` | Admin — panel ticket |
| `remember:` · `memory` · `forget:` | Bộ nhớ dài hạn |
| `note:` | Ghim ngữ cảnh ticket |
| `gif: từ khóa` | Gửi GIF (Giphy) |

---

## Voice (tóm tắt)

1. Vào kênh voice → `/voice action:join`  
2. `voicechat on` hoặc `/voicechat mode:Bật`  
3. Nhắn text / tin nhắn thoại trong kênh AI hoặc ticket  

Host free (Railway) đôi khi chỉ gửi **file MP3** (UDP voice lỗi).

---

## Cấu trúc code (rút gọn)

```text
index.js            # Entry, slash, chat pipeline
Providers.js        # ChatGPT / Claude / Grok / DeepSeek + model list
TicketManager.js    # Ticket, menu model/persona, modal key
Interest.js         # Persona presets
Memory.js           # Ghi nhớ dài hạn
Emotion.js          # Cảm xúc + xin GIF
GifSearch.js        # Giphy
QuotaManager.js     # Hạn mức ngày
VoiceManager.js     # Voice + fallback MP3
Tts.js              # TTS
UserPrefs.js        # Persona / TTS / voicechat user
AdminLog.js         # Log admin
data/               # JSON runtime (không commit secret)
```

---

## Mời bot vào server

Developer Portal → **OAuth2 → URL Generator**  
Scopes: `bot` + `applications.commands`  

Hoặc:

```text
https://discord.com/api/oauth2/authorize?client_id=APPLICATION_ID&permissions=2147552256&scope=bot%20applications.commands
```

Chỉ share **link mời** — không share token, API key, dashboard host.

---

## Lưu ý quota & phí

| Việc | Ghi chú |
|------|---------|
| Chat Gemini (key server) | Tốn quota **bạn** |
| Ticket + key user | Tốn quota **user đó** |
| GPT / Claude / Grok API | Thường **trả phí** / cần credit |
| `/setchannel`, `help`, ping | Không tốn Gemini |
| Mời thêm server | Không nhân đôi phí host; chat mới tốn API |

---

## License

MIT (hoặc quyền bạn quy định). Tuân thủ điều khoản Discord, Google, OpenAI, Anthropic, xAI, DeepSeek, Giphy.

---

**Nexus AI** · Gemini + multi-provider · discord.js v14
