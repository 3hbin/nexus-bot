# Nexus AI — Discord Bot

Bot Discord AI (**Node.js** + **discord.js v14**) — chat kênh AI / ticket / DM / mention.

Hỗ trợ **Gemini · ChatGPT · Claude · Grok · DeepSeek**, persona, Training/KB, TTS, voice, GIF, quota, moderation, Prompt Shield.

> **Bảo mật:** Không commit `.env`. Token & API key chỉ đặt trên host (Railway, VPS…).  
> Key trong ticket / DM chỉ lưu trên server bot — không public repo.

---

## Mục lục

1. [Tải source](#tải-source)
2. [Tính năng](#tính-năng)
3. [Yêu cầu](#yêu-cầu)
4. [Cài đặt & chạy](#cài-đặt--chạy)
5. [Biến môi trường](#biến-môi-trường)
6. [Railway Volume (không mất data)](#railway-volume-không-mất-data)
7. [Chat ở đâu?](#chat-ở-đâu)
8. [DM — key Gemini bắt buộc](#dm--key-gemini-bắt-buộc)
9. [Ticket — key & model](#ticket--key--model)
10. [Persona & tên AI](#persona--tên-ai)
11. [Training / Knowledge Base](#training--knowledge-base)
12. [Memory](#memory)
13. [Auto-speech / TTS](#auto-speech--tts)
14. [Voice & GIF](#voice--gif)
15. [Danh sách lệnh slash](#danh-sách-lệnh-slash)
16. [Tin nhắn đặc biệt](#tin-nhắn-đặc-biệt)
17. [Admin & an toàn](#admin--an-toàn)
18. [Cấu trúc code](#cấu-trúc-code)
19. [Xử lý lỗi thường gặp](#xử-lý-lỗi-thường-gặp)

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
| **Chat AI** | `/setchannel`, ticket, mention, **DM** (cần key Gemini user) |
| **Đa provider** | Gemini · ChatGPT · Claude · Grok · DeepSeek (key + model trong **ticket**) |
| **Ticket** | Model, persona, multi-key, `note:`, đóng + tóm tắt admin |
| **DM** | Chỉ Gemini, model **mặc định** (`gemini-3.6-flash`), bắt buộc `key gemini:` |
| **Persona** | Preset (Nexus, Luna/ChatGPT, Gemini, Claude, Grok, Dola, Copilot, DeepSeek) + tùy chỉnh |
| **Tên AI** | Mặc định = **tên bot Discord**; `name: Luna` / `/ainame` |
| **Training / KB** | `train:` · `kb add:` · guild / global — tự chỉnh tri thức |
| **Memory** | `remember:` · `memory` · `forget:` |
| **Auto-speech / TTS** | `/auto-speech` · `/tts` · tin nhắn `auto-speech mode: on` |
| **Dịch** | `/dich`, `dịch:`, nút **Dịch** (tách tin dài) |
| **Code dài** | Đưa **link paste**, không bắt tải file nặng |
| **Trả lời dài** | Tự tách `(1/n)` · công thức **không LaTeX** (Discord) |
| **GIF** | Cảm xúc + `gif: từ khóa` (cần `GIPHY_API_KEY`) |
| **Voice** | `/voice`, `/speak`, `/voicechat` (host free có thể chỉ MP3) |
| **Quota** | Hạn mức chat/ảnh/video theo ngày; cảnh báo ≤10% |
| **Welcome DM** | Member mới → DM hướng dẫn (cần Server Members Intent) |
| **Moderation** | `/moderation` — spam / link đáng ngờ (kênh AI · ticket) |
| **Prompt Shield** | Chặn jailbreak / deity mode / đòi system prompt (kiểu TikTok) |
| **Feedback** | `/feedback` → admin log |
| **Admin panel** | `/adminpanel` |
| **Khác** | `/ask`, `/summary`, `/export`, `/quiz`, `/ship`, `/remind`, nút 👍👎 · Trả lời lại |

Gõ **`help`** hoặc **`/help`**.

---

## Yêu cầu

- **Node.js 18+**
- [Discord Developer Portal](https://discord.com/developers/applications)
- Ít nhất một API key (Gemini khuyến nghị cho admin bot)

**Discord Privileged Intents** (bật trong Portal):

- Message Content Intent  
- Server Members Intent (welcome DM)  
- Presence không bắt buộc  

---

## Cài đặt & chạy

### 1. Local

```bash
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
npm install
cp .env.example .env   # nếu có — hoặc tạo .env
# Điền DISCORD_TOKEN, GEMINI_API_KEY
npm start
```

### 2. Railway (khuyên dùng)

1. New Project → Deploy from GitHub (repo của bạn)  
2. **Variables** → thêm env (bảng bên dưới)  
3. **Volume** (quan trọng) → xem mục [Railway Volume](#railway-volume-không-mất-data)  
4. Deploy → xem log: `Bot ... đã online!` và `DATA_DIR = /data`

### 3. Discord Bot

1. [Discord Developer Portal](https://discord.com/developers/applications) → New Application  
2. Bot → Reset Token → copy `DISCORD_TOKEN`  
3. OAuth2 → URL Generator → scopes: `bot`, `applications.commands`  
4. Permissions gợi ý: Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels (ticket), Connect + Speak (voice)  
5. Mời bot vào server  

---

## Biến môi trường

| Biến | Bắt buộc | Mô tả |
|------|----------|--------|
| `DISCORD_TOKEN` | ✅ | Token bot Discord |
| `GEMINI_API_KEY` | Khuyên | Key Gemini **admin bot** (kênh AI / mention fallback) |
| `DATA_DIR` | Khuyên Railway | Đường dẫn volume, ví dụ `/data` |
| `GIPHY_API_KEY` | Không | GIF (`gif:`) — [developers.giphy.com](https://developers.giphy.com) |
| `ADMIN_USER_IDS` | Không | Discord user ID chủ bot (cách nhau dấu phẩy) — KB global |
| `ADMIN_LOG_CHANNEL_ID` | Không | Kênh log admin (ticket đóng, moderation, feedback) |
| `ONLINE_ANNOUNCE_CHANNEL_ID` | Không | Kênh báo bot online sau deploy |
| `PORT` | Không | Mặc định `3000` (keep-alive Express) |

**Không** commit key lên GitHub.

---

## Railway Volume (không mất data)

Mỗi lần redeploy **không có Volume** → mất ticket, setchannel, session, KB, prefs.

1. Railway project → **Volumes** → Add Volume  
2. Mount path: **`/data`**  
3. Variables: `DATA_DIR=/data`  
4. Redeploy  

Data lưu trong `/data`:

- `tickets.json`, `allowedChannels.json`, `sessions.json`  
- `userPrefs.json`, `userMemory.json`, `knowledgeBase.json`  
- `autoClearChannels.json`, quota, moderation…

---

## Chat ở đâu?

| Nơi | Cách hoạt động |
|-----|----------------|
| **Kênh AI** | Admin `/setchannel` → chat không cần mention |
| **Mention** | `@Nexus AI ...` ở kênh khác |
| **Ticket** | Panel ticket → user nhập **key** (Gemini/ChatGPT/…) + chọn model/persona |
| **DM** | Tin nhắn riêng bot → **bắt buộc** `key gemini:` của user, model mặc định |

---

## DM — key Gemini bắt buộc

Chat DM **không dùng ticket**, **không dùng key bot**.

```text
key gemini: AIza...
```

Lấy key: https://aistudio.google.com  

| Lệnh tin nhắn | Ý nghĩa |
|---------------|---------|
| `key gemini: AIza...` | Lưu key |
| `keys` | Đã lưu key chưa |
| `key gemini: xóa` | Xóa key |
| `help` | Hướng dẫn |

- Model: **mặc định** (`gemini-3.6-flash`) — **không chọn model** trong DM  
- Chỉ **Gemini** trong DM (ChatGPT/Claude… dùng **ticket**)

---

## Ticket — key & model

1. Admin: `/setup_ticketai` (chọn category)  
2. User mở ticket → nhập key:

```text
key gemini: AIza...
key chatgpt: sk-...
key claude: sk-ant-...
key grok: xai-...
key deepseek: sk-...
```

3. Chọn model / persona trong panel ticket (nếu có)  
4. `keys` — xem provider đã nhập  
5. `note: ...` — ghim ngữ cảnh ticket  

**Ticket chưa có key → bot không chat** (nhắc nhập key).

Link lấy key:

| Provider | Link |
|----------|------|
| Gemini | https://aistudio.google.com |
| ChatGPT | https://platform.openai.com/api-keys |
| Claude | https://console.anthropic.com/settings/keys |
| Grok | https://console.x.ai |
| DeepSeek | https://platform.deepseek.com/api_keys |

Một số model / quota **cần billing** trên nhà cung cấp tương ứng.

---

## Persona & tên AI

### Persona (tính cách)

- Slash: `/persona style:...` (kèm `custom` nếu tùy chỉnh)  
- Trong ticket: chọn preset hoặc mô tả tùy chỉnh  

Preset: default, chatgpt (Luna), gemini, claude, grok, dola, copilot, deepseek, custom.

### Tên AI

Mặc định = **tên bot trên Discord** (đổi nick bot → AI xưng theo tên đó).

```text
name: Luna
tên ai: Mây
```

Slash: `/ainame name:Luna`  

Reset: `name: reset` hoặc `/ainame` để trống (tùy triển khai).

---

## Training / Knowledge Base

Bot **học fact bạn dạy** và ưu tiên khi trả lời (system prompt).

### Cá nhân (mọi user)

```text
train: Tên mình là Minh, thích Roblox
kb add: Mã giảm giá hôm nay NEXUS50
kb list
kb del: Roblox
kb del: 1
kb clear
kb help
```

Slash: `/kb` → hướng dẫn.

### Server (cần Admin)

```text
kb guild add: Luật server: không spam
kb guild list
kb guild del: spam
kb guild clear
```

### Global (chủ bot — `ADMIN_USER_IDS`)

```text
kb global add: Nexus AI là bot chính thức
kb global list
kb global del: ...
kb global clear
```

| Phạm vi | Ai chỉnh | Giới hạn |
|---------|----------|----------|
| Cá nhân | User | 20 mục |
| Server | Admin | 30 mục |
| Global | Chủ bot | 40 mục |

File: `knowledgeBase.json` (trong `DATA_DIR`).

---

## Memory

Ghi chú theo user (khác KB — nhẹ hơn):

```text
remember: Mình dị ứng hải sản
memory
forget: hải sản
```

---

## Auto-speech / TTS

Mỗi câu bot trả lời kèm **file MP3** (đoạn đầu, tiếng Việt).

**Slash**

```text
/auto-speech mode:on
/auto-speech mode:off
/tts mode:on
/tts mode:off
```

**Tin nhắn tự do**

```text
auto-speech mode: on
auto-speech mode: off
tts: on
tự đọc: bật
```

`/speak text:...` — đọc một đoạn bất kỳ thành MP3.

---

## Voice & GIF

### Voice

```text
/voice action:join
/voice action:leave
/voice action:speak   (+ text)
/voicechat mode:on    — bot đọc câu trả lời trong voice (host hỗ trợ UDP)
```

Host free (một số platform) có thể **không join voice ổn định** → fallback MP3.

### GIF

Cần `GIPHY_API_KEY`:

```text
gif: cat
gif: funny
```

Bot cũng có thể đính GIF theo cảm xúc (không spam).

---

## Danh sách lệnh slash

| Lệnh | Mô tả |
|------|--------|
| `/help` | Hướng dẫn |
| `/ping` | Độ trễ |
| `/reset` | Xóa lịch sử chat session |
| `/setchannel` | Đặt kênh AI (Admin) |
| `/unsetchannel` | Bỏ kênh AI (Admin) |
| `/status` | Trạng thái bot / TTS / persona |
| `/clear` | Xóa tin nhắn (Admin) |
| `/clear24h` · `/unclear24h` | Tự xóa kênh theo lịch (Admin) |
| `/setup_ticketai` | Panel ticket (Admin) |
| `/imagine` · `/video` | Tạo ảnh / video (model có thể cần billing) |
| `/persona` | Đổi tính cách |
| `/ainame` | Đặt tên gọi AI |
| `/quota` | Hạn mức ngày |
| `/tts` · `/auto-speech` | Bật/tắt đọc to MP3 |
| `/speak` | TTS một đoạn text |
| `/mode` | normal / strict |
| `/quiz` | Đố vui |
| `/voice` · `/voicechat` | Voice channel |
| `/summary` | Tóm tắt kênh |
| `/dich` | Dịch đoạn |
| `/remind` | Nhắc sau N phút |
| `/ask` | Hỏi nhanh |
| `/export` | Xuất transcript |
| `/kb` | Hướng dẫn Knowledge Base |
| `/feedback` | Góp ý → admin log |
| `/adminpanel` | Panel admin |
| `/moderation` | Bật/tắt moderation (Admin) |
| `/ship` | Ship 2 user vui |

---

## Tin nhắn đặc biệt

| Cú pháp | Việc |
|---------|------|
| `help` | Embed hướng dẫn |
| `key gemini: ...` | Lưu key (ticket / DM) |
| `keys` | Xem key đã lưu |
| `train:` / `kb add:` | Thêm tri thức cá nhân |
| `kb list` / `kb del:` / `kb clear` | Quản lý KB |
| `kb guild ...` | KB server (Admin) |
| `kb global ...` | KB global (chủ bot) |
| `remember:` / `memory` / `forget:` | Memory user |
| `name: ...` / `tên ai: ...` | Đặt tên AI |
| `note: ...` | Ghim ngữ cảnh **ticket** |
| `dịch: ...` | Dịch nhanh |
| `gif: ...` | Tìm GIF |
| `auto-speech mode: on/off` | TTS tự động |

---

## Admin & an toàn

### Admin log

Set `ADMIN_LOG_CHANNEL_ID` → nhận: ticket đóng, moderation, toxic/jailbreak, feedback.

### Prompt Shield

Chặn kiểu jailbreak TikTok (`/deity`, ignore instructions, đòi system prompt, hướng dẫn tấn công mạng…).

### Toxic filter

Chặn từ ngữ xúc phạm nặng (có tinh chỉnh tránh false positive kiểu chữ “đêm”).

### Online announce

Sau deploy bot gửi tin online nếu có `ONLINE_ANNOUNCE_CHANNEL_ID` hoặc kênh admin log / setchannel.

### Gemini lock (quota bot)

Khi key bot hết quota, kênh dùng key bot bị khóa chat; **ticket/DM có key user vẫn chat**.

---

## Cấu trúc code

```text
index.js            — bot chính, slash, message pipeline
paths.js            — DATA_DIR + dataFile()
KnowledgeBase.js    — Training / KB
Memory.js           — remember / forget
Interest.js         — persona, toxic, jailbreak shield
Providers.js        — ChatGPT / Claude / Grok / DeepSeek + parse key
TicketManager.js    — ticket
SessionManager.js   — lịch sử chat
UserPrefs.js        — persona, TTS, key DM, tên AI
ClearManager.js     — auto-clear kênh
QuotaManager.js     — hạn mức ngày
Moderation.js       — spam / link
Tts.js · VoiceManager.js · GifSearch.js · Emotion.js · Quiz.js · AdminLog.js
```

---

## Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|------------|------------|
| Bot không online | Kiểm tra `DISCORD_TOKEN`, log Railway |
| Slash trùng 2 lần | Deploy bản chỉ đăng ký **guild** + xóa global; mở lại app Discord |
| DM chat không cần key | Deploy bản mới — DM **bắt buộc** `key gemini:` |
| Ticket chat không cần key | Deploy bản mới — ticket bắt buộc key user |
| Mất ticket / setchannel sau deploy | Gắn **Volume** `/data` + `DATA_DIR=/data` |
| `Key quá ngắn` | Dán full key (`AIza...` / `sk-...`), không gõ thử `d` |
| GIF không ra | Thêm `GIPHY_API_KEY` |
| Voice không join | Host không hỗ trợ UDP voice → dùng `/tts` / MP3 |
| Công thức `$O(\sqrt{n})$` | Bản mới sanitize → `O(sqrt(n))` |
| 429 / quota Gemini | Billing AI Studio hoặc dùng key khác trong ticket/DM |
| Toxic chặn oan | Cập nhật `Interest.js` (regex đã siết) |

---

## License / ghi chú

Tự host, tự chịu trách nhiệm API key & nội dung.  
Không chia sẻ token bot / API key trong ticket public hoặc repo public.
