# Nexus AI — Discord Bot

Bot Discord AI đa nhà cung cấp (**Node.js** + **discord.js v14**).

Chat kênh AI / ticket / mention · nhiều model · persona · đặt tên AI · memory · dịch · voice · GIF · quota · moderation · admin panel.

> **Bảo mật:** Không commit `.env`. Token & API key chỉ đặt trên host (Railway, VPS…).  
> Key trong ticket chỉ lưu server bot — không public repo.

---

## Mục lục

1. [Tải source](#tải-source)
2. [Tính năng](#tính-năng)
3. [Yêu cầu](#yêu-cầu)
4. [Cài đặt & chạy](#cài-đặt--chạy)
5. [Biến môi trường](#biến-môi-trường)
6. [Railway Volume (không mất data)](#railway-volume-không-mất-data)
7. [Chỉnh sở thích & tên AI](#chỉnh-sở-thích--tên-ai)
8. [Ticket — key & model](#ticket--key--model)
9. [Danh sách lệnh](#danh-sách-lệnh)
10. [Tin nhắn đặc biệt](#tin-nhắn-đặc-biệt)
11. [Voice & GIF](#voice--gif)
12. [Admin & an toàn](#admin--an-toàn)
13. [Thông báo online](#thông-báo-online)
14. [Mời bot / chia sẻ](#mời-bot--chia-sẻ)
15. [Cấu trúc code](#cấu-trúc-code)
16. [Xử lý lỗi thường gặp](#xử-lý-lỗi-thường-gặp)

---

## Tải source

[![Download ZIP](https://img.shields.io/badge/Download-ZIP-blue?style=for-the-badge&logo=github)](https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repo-black?style=for-the-badge&logo=github)](https://github.com/3hbin/nexus-bot)

| Cách | Link / lệnh |
|------|-------------|
| **Tải ZIP** | https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip |
| **Repo** | https://github.com/3hbin/nexus-bot |
| **Clone** | `git clone https://github.com/3hbin/nexus-bot.git` |

Repo **private** → người khác không tải được. Chỉ muốn người khác **dùng bot** → share **link mời Discord**, không cần share code.

---

## Tính năng

| Nhóm | Chi tiết |
|------|----------|
| **Chat AI** | Kênh AI (`/setchannel`), ticket, mention, DM; xem ảnh; tin nhắn thoại |
| **Đa provider** | Gemini · ChatGPT · Claude · Grok · DeepSeek (key + model trong ticket) |
| **Ticket** | Model, persona, multi-key, `note:`, đóng ticket + tóm tắt admin |
| **Persona** | Preset (Nexus, Luna, Gemini, Claude, Grok, Dola, Copilot, DeepSeek) + tùy chỉnh |
| **Tên AI** | Mặc định = **tên bot Discord**; hoặc `name: Luna` / `/ainame` |
| **Memory** | `remember:` · `memory` · `forget:` |
| **Dịch** | `/dich`, `dịch:`, nút **Dịch** (tách tin dài) |
| **Code dài** | Đưa **link paste**, không bắt tải file nặng |
| **Trả lời dài** | Tự tách `(1/n)` |
| **GIF** | Cảm xúc + `gif: từ khóa` (cần `GIPHY_API_KEY`) |
| **Voice / TTS** | `/voice`, `/speak`, `voicechat on` (host free có thể chỉ MP3) |
| **Quota** | Hạn mức chat/ảnh/video theo ngày; cảnh báo khi còn ≤10% |
| **Welcome DM** | Member mới → DM hướng dẫn (cần Server Members Intent) |
| **Moderation** | `/moderation` — spam lặp + link đáng ngờ (kênh AI/ticket) |
| **Prompt Shield** | Chặn jailbreak / “ignore instructions” / đòi system prompt (kiểu TikTok) |
| **Feedback** | `/feedback` → kênh admin log |
| **Admin panel** | `/adminpanel` — online, ticket, Gemini lock, lệnh nhanh |
| **Online announce** | Tin 🟢 sau deploy → admin log + kênh AI |
| **Khác** | `/ask`, `/summary`, `/export`, `/quiz`, `/ship`, `/remind`, nút 👍👎 · Trả lời lại |

Gõ **`help`** hoặc **`/help`**.

---

## Yêu cầu

- **Node.js 18+**
- [Discord Developer Portal](https://discord.com/developers/applications)
- Ít nhất `GEMINI_API_KEY` (khuyên) để bot chat mặc định
- (Tuỳ chọn) Giphy, OpenAI, Anthropic, xAI, DeepSeek cho ticket

### Intent Discord (Bot settings)

| Intent | Bắt buộc? |
|--------|-----------|
| **Message Content Intent** | Có |
| **Server Members Intent** | Có nếu dùng Welcome DM |
| Presence (optional) | Không |

### Quyền bot gợi ý

Send Messages · Embed Links · Attach Files · Read Message History · Manage Channels (ticket) · Manage Messages (clear/mod) · Connect · Speak (voice)

---

## Cài đặt & chạy

### Clone

```bash
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
npm install
```

### Hoặc ZIP

1. Tải [nexus-bot-main.zip](https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip)
2. Giải nén → `cd nexus-bot-main`
3. `npm install`

### Chạy local

```bash
cp .env.example .env   # nếu có
# sửa .env
npm start
```

### Railway

1. New Project → Deploy from GitHub  
2. Variables (xem bên dưới)  
3. **Volume** mount `/data` + `DATA_DIR=/data`  
4. Start: `npm start`  
5. Log: `Bot … đã online` · `📂 DATA_DIR = /data`

---

## Biến môi trường

```env
# Bắt buộc
DISCORD_TOKEN=
GEMINI_API_KEY=

# Tuỳ chọn
GIPHY_API_KEY=
ADMIN_LOG_CHANNEL_ID=
ONLINE_ANNOUNCE_CHANNEL_ID=

# Data bền (Railway Volume)
DATA_DIR=/data

# Hạn mức / ngày (mặc định trong code nếu bỏ trống)
QUOTA_CHAT_PER_DAY=80
QUOTA_IMAGE_PER_DAY=12
QUOTA_VIDEO_PER_DAY=3

# Tuỳ chọn nâng cao
ALLOWED_CHANNELS_FILE=
SESSIONS_FILE=
PORT=8080
```

| Biến | Việc |
|------|------|
| `DISCORD_TOKEN` | Token bot |
| `GEMINI_API_KEY` | Key server — chat mặc định / fallback ticket |
| `GIPHY_API_KEY` | GIF thật |
| `ADMIN_LOG_CHANNEL_ID` | Log online, ticket đóng, feedback, mod |
| `ONLINE_ANNOUNCE_CHANNEL_ID` | Thêm 1 kênh nhận tin online |
| `DATA_DIR` | Thư mục JSON bền (`/data` trên Railway) |

Ticket có thể dùng **key user** (ChatGPT/Claude/…) — không bắt buộc set sẵn trên server.

---

## Railway Volume (không mất data)

Không gắn Volume → mỗi deploy **xóa** ticket, setchannel, memory…

1. Service → **Settings** → **Volumes** → **Add Volume**  
2. **Mount path:** `/data`  
3. Variable: `DATA_DIR=/data`  
4. Redeploy  

Log đúng:

```text
📂 DATA_DIR = /data
```

| File trong DATA_DIR | Nội dung |
|---------------------|----------|
| `allowedChannels.json` | `/setchannel` |
| `tickets.json` | Ticket, key, persona, tên AI |
| `userPrefs.json` | Persona / TTS / tên AI user |
| `userMemory.json` | `remember:` |
| `sessions.json` | Lịch sử chat |
| `quota.json` | Hạn mức ngày |
| `moderation.json` | Bật/tắt mod |
| `autoClearChannels.json` | `/clear24h` |
| `geminiLock.json` | Khóa khi 429 |

Lần đầu Volume trống vẫn “tạo mới” **một lần**. Deploy sau **giữ data**.

---

## Chỉnh sở thích & tên AI

### Persona (gu nói)

**Trong ticket:** menu **Chọn sở thích AI** → preset hoặc **Tùy chỉnh** (viết mô tả).

**Ngoài ticket:**

```text
/persona style:…
/persona style:Tùy chỉnh custom:Nói Gen Z, thích anime, trả lời ngắn
```

### Tên gọi AI

| Ưu tiên | Tên |
|---------|-----|
| 1 | User đặt |
| 2 | **Tên bot Discord** |
| 3 | Fallback Nexus AI |

```text
name: Luna
tên ai: Mây
/ainame name:Luna
/ainame name:reset
```

- Trong **ticket** → tên theo kênh ticket  
- Ngoài ticket → tên theo **user**

### Ghim ngữ cảnh ticket

```text
note: Đang học Toán 12, giải thích từng bước
```

### Memory dài hạn

```text
remember: Tên mình là Nam, thích Valorant
memory
forget: Valorant
```

### Persona ≠ Model ≠ Key

| | Ý nghĩa |
|--|---------|
| **Persona** | Cách nói / tính cách |
| **Model** | Engine (Gemini, GPT-5, Grok 4.6…) |
| **Key** | API key đúng nhà cung cấp |

Có thể model Gemini + persona Grok (gu nói Grok, vẫn chạy Gemini). Model GPT/Claude/Grok **thật** cần **key đúng hãng**.

---

## Ticket — key & model

### Nhập key

Nút trên ticket **hoặc**:

```text
key gemini: AIza...
key chatgpt: sk-...
key claude: sk-ant-...
key grok: xai-...
key deepseek: sk-...
```

Gõ `keys` để xem provider nào đã lưu.

### Link lấy key

| Provider | Link |
|----------|------|
| Gemini | https://aistudio.google.com |
| ChatGPT | https://platform.openai.com/api-keys |
| Claude | https://console.anthropic.com/settings/keys |
| Grok | https://console.x.ai |
| DeepSeek | https://platform.deepseek.com/api_keys |

### Model (menu)

- **Gemini:** 3.6 Flash · 3.5 Flash · Flash-Lite · 3.1 Pro  
- **ChatGPT:** GPT-5 · GPT-5 Mini · GPT-5.1 · o4-mini  
- **Claude:** Sonnet 5 · Haiku 4.5 · Opus 5  
- **Grok:** 4.6 · 4.5 · 4.3  
- **DeepSeek:** Chat · Reasoner  

Model + key phải **cùng nhà**. Nhiều API free hạn chế hoặc trả phí.

Không có key ticket → bot **fallback** `GEMINI_API_KEY` server (nếu có).

Admin tạo panel: **`/setup_ticketai`**.

---

## Danh sách lệnh

### Mọi người

| Lệnh | Mô tả |
|------|--------|
| `/help` · `help` | Hướng dẫn |
| `/ping` | Độ trễ |
| `/reset` | Xóa lịch sử chat cá nhân |
| `/status` | Trạng thái + persona + quota |
| `/quota` | Hạn mức ngày |
| `/persona` | Đổi sở thích AI |
| `/ainame` | Đặt / xem tên AI |
| `/ask` | Hỏi 1 phát (ephemeral) |
| `/summary` | Tóm tắt kênh/ticket |
| `/export` | Xuất chat `.txt` |
| `/dich` | Dịch VI ↔ EN |
| `/imagine` | Tạo ảnh (Gemini) |
| `/video` | Tạo video (Gemini) |
| `/tts` | Bật/tắt TTS file MP3 |
| `/speak` | Đọc một đoạn (MP3) |
| `/voice` | join / leave / speak |
| `/voicechat` | Bot đọc câu trả lời |
| `/quiz` | Đố vui |
| `/remind` | Nhắc sau N phút |
| `/ship` | Meme % hợp đôi |
| `/feedback` | Góp ý → admin log |

### Admin

| Lệnh | Mô tả |
|------|--------|
| `/setchannel` | Khóa 1 kênh AI cho server |
| `/unsetchannel` | Bỏ khóa kênh |
| `/setup_ticketai` | Panel tạo ticket |
| `/clear` | Xóa N tin gần đây |
| `/clear24h` · `/unclear24h` | Tự xóa tin >24h |
| `/moderation` | Bật/tắt lọc spam-link |
| `/adminpanel` | Panel tổng quan |

---

## Tin nhắn đặc biệt

| Tin nhắn | Việc |
|----------|------|
| `help` · `!help` | Embed hướng dẫn |
| `key gemini:` / `key chatgpt:` … | Lưu API key ticket |
| `keys` | Xem key đã có |
| `name:` · `tên ai:` | Đặt tên AI |
| `note:` | Ghim ngữ cảnh ticket |
| `remember:` · `memory` · `forget:` | Bộ nhớ dài hạn |
| `dịch:` · `dich:` | Dịch nhanh |
| `gif:` · `gửi gif` | Gửi GIF Giphy |
| `voicechat on` / `off` | Bật đọc trả lời |

---

## Voice & GIF

### Voice

1. Vào kênh voice  
2. `/voice action:join`  
3. `voicechat on` hoặc `/voicechat`  
4. Nhắn text / tin thoại ở kênh AI hoặc ticket  

Host free (Railway) đôi khi chỉ gửi **file MP3** (UDP voice lỗi).

### GIF

```text
gif: funny
gif: cat
gửi gif đi
```

Cần `GIPHY_API_KEY` (https://developers.giphy.com).

---

## Admin & an toàn

| Lệnh / tính năng | Việc |
|------------------|------|
| `/adminpanel` | Online, số ticket, Gemini lock, moderation |
| `/moderation mode:Bật` | Lọc spam lặp + link đáng ngờ (AI/ticket) |
| `/feedback` | User → kênh `ADMIN_LOG_CHANNEL_ID` |
| Welcome DM | Member mới (Members Intent) |
| Quota warn | ≤10% hoặc ≤8 lượt → báo dưới câu trả lời |

```env
ADMIN_LOG_CHANNEL_ID=id_kênh_log
```

---

## Thông báo online

Sau **deploy / restart**, bot gửi **🟢 đã online**:

1. `ADMIN_LOG_CHANNEL_ID`  
2. `ONLINE_ANNOUNCE_CHANNEL_ID` (nếu có)  
3. Mọi kênh đã **`/setchannel`**

Chưa `/setchannel` và không set env → không có tin public (chỉ log Railway).

---

## Mời bot / chia sẻ

```text
https://discord.com/api/oauth2/authorize?client_id=APPLICATION_ID&permissions=2147552256&scope=bot%20applications.commands
```

- Share **link mời** — không share token, API key, dashboard host  
- Thêm server **không** nhân phí host; **chat API** mới tốn quota  
- Quota ticket = key **user** (nếu họ tự nhập)

---

## Cấu trúc code

```text
index.js            # Entry, slash, chat pipeline, online announce
paths.js            # DATA_DIR / Volume
Providers.js        # ChatGPT, Claude, Grok, DeepSeek + model list
TicketManager.js    # Ticket, menu, modal key
Interest.js         # Persona presets
UserPrefs.js        # Persona / TTS / ainame user
Memory.js           # remember / forget
Emotion.js          # Cảm xúc + xin GIF
GifSearch.js        # Giphy
QuotaManager.js     # Hạn mức + Gemini lock
SessionManager.js   # Lịch sử chat xuống đĩa
ClearManager.js     # clear / auto-clear 24h
Moderation.js       # Spam / link
VoiceManager.js     # Voice + fallback MP3
Tts.js              # TTS
AdminLog.js         # Log admin
Quiz.js             # Đố vui
data/               # Local only — trên Railway dùng /data (Volume)
```

`package.json` scripts: `"start": "node index.js"`

Dependencies chính: `discord.js` · `@google/genai` · `dotenv` · `express`

---

## Xử lý lỗi thường gặp

| Hiện tượng | Nguyên nhân / cách xử lý |
|------------|---------------------------|
| Deploy xong không chat trong ticket | Data mất — gắn **Volume** + `DATA_DIR=/data`; hoặc `key gemini:` lại |
| Log “khởi tạo tickets/allowedChannels mới” | Chưa Volume hoặc Volume trống lần đầu |
| Không tin 🟢 online | Chưa `/setchannel` và chưa set admin/announce channel |
| GIF chỉ chữ, không ảnh | Thiếu/sai `GIPHY_API_KEY` |
| GPT/Grok báo lỗi Gemini | Chọn đúng model + `key chatgpt:` / `key grok:` |
| 400 Grok | Model id cũ — dùng `grok-4.5` / `grok-4.6` |
| 403/402 API | Hết credit / cần billing nhà cung cấp |
| Slash không hiện | Đợi đăng ký guild; kick/re-add bot; xem log “Slash commands” |
| Welcome không DM | Tắt DM user hoặc chưa bật **Server Members Intent** |
| Voice không vào | Thiếu quyền Connect/Speak; host free → MP3 fallback |

---

## License

MIT (hoặc quyền bạn quy định). Tuân thủ điều khoản Discord, Google, OpenAI, Anthropic, xAI, DeepSeek, Giphy.

**Nexus AI** · multi-provider · discord.js v14 · Railway-ready
