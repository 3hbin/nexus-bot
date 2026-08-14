# Nexus AI — Discord Bot

Bot Discord AI đa nhà cung cấp (**Node.js** + **discord.js v14**).

Chat trong kênh AI / ticket / mention · nhiều model · persona (sở thích AI) · memory · dịch · voice · GIF · quota.

> **Bảo mật:** Không commit `.env`. Token & API key chỉ đặt trên host (Railway, VPS…).

### Tải source code

[![Download ZIP](https://img.shields.io/badge/Download-ZIP-blue?style=for-the-badge&logo=github)](https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip)
[![GitHub Repo](https://img.shields.io/badge/GitHub-Repo-black?style=for-the-badge&logo=github)](https://github.com/3hbin/nexus-bot)
[![Clone](https://img.shields.io/badge/git-clone-green?style=for-the-badge&logo=git)](https://github.com/3hbin/nexus-bot.git)

| Cách | Link / lệnh |
|------|-------------|
| **Tải ZIP (không cần Git)** | [nexus-bot-main.zip](https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip) |
| **Mở repo GitHub** | https://github.com/3hbin/nexus-bot |
| **Clone** | `git clone https://github.com/3hbin/nexus-bot.git` |

> Repo **private** → người khác **không** tải được. Muốn share code: bật Public hoặc thêm Collaborator.  
> Muốn người khác **chỉ dùng bot**: share **link mời Discord**, không cần share repo.

---

## Mục lục

1. [Tính năng](#tính-năng)
2. [Cài đặt & chạy](#cài-đặt--chạy)
3. [Chỉnh sở thích AI (persona)](#chỉnh-sở-thích-ai-persona) ← **hướng dẫn chi tiết**
4. [Ticket — key & model](#ticket--key--model)
5. [Lệnh](#lệnh)
6. [Voice & GIF](#voice--gif)
7. [Deploy & chia sẻ](#deploy--chia-sẻ)
8. [Cấu trúc code](#cấu-trúc-code)

---

## Tính năng

| Nhóm | Chi tiết |
|------|----------|
| **Chat AI** | Kênh AI, ticket, mention; xem ảnh; tin nhắn thoại |
| **Đa provider** | Gemini · ChatGPT · Claude · Grok · DeepSeek |
| **Ticket** | Model + persona + key riêng, `note:`, đóng ticket |
| **Persona / sở thích** | Preset sẵn + **tùy chỉnh tự viết** |
| **Bộ nhớ** | `remember:` · `memory` · `forget:` |
| **Dịch** | `/dich`, `dịch:`, nút Dịch |
| **Code dài** | Link paste (không bắt tải file nặng) |
| **GIF** | `gif: từ khóa` / cảm xúc (cần `GIPHY_API_KEY`) |
| **Voice / TTS** | `/voice`, `voicechat on`, `/speak` |
| **Welcome DM** | User mới join → bot nhắn hướng dẫn (cần intent Members) |
| **Moderation** | `/moderation` — lọc spam / link lạ trong kênh AI (Admin) |
| **Cảnh báo quota** | Còn ≤10% hoặc ≤8 lượt → bot báo trong câu trả lời |
| **Feedback** | `/feedback` — góp ý gửi kênh admin log |
| **Admin panel** | `/adminpanel` — online, ticket, Gemini lock, lệnh nhanh |
| **Khác** | `/ask`, `/summary`, `/export`, `/quiz`, quota, nút 👍👎 |

Gõ **`help`** hoặc **`!help`** trong kênh bot.

---

## Cài đặt & chạy

### Yêu cầu

- Node.js **18+**
- [Discord Developer](https://discord.com/developers/applications) — bật **Message Content Intent**
- `GEMINI_API_KEY` (khuyên dùng để bot chạy mặc định)
- (Tuỳ chọn) Giphy + key OpenAI / Anthropic / xAI / DeepSeek cho ticket

### Cài

**Cách 1 — Clone Git**

```bash
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
npm install
```

**Cách 2 — Tải ZIP (không cần Git)**

1. Bấm badge **Download ZIP** phía trên (hoặc mở: https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip)
2. Giải nén → mở thư mục `nexus-bot-main`
3. Trong terminal:

```bash
cd nexus-bot-main
npm install
```

### `.env` / Railway Variables

```env
DISCORD_TOKEN=
GEMINI_API_KEY=
GIPHY_API_KEY=
ADMIN_LOG_CHANNEL_ID=

QUOTA_CHAT_PER_DAY=80
QUOTA_IMAGE_PER_DAY=12
QUOTA_VIDEO_PER_DAY=3
```

```bash
npm start
```

Railway: Deploy from GitHub → thêm Variables → log có `Bot … đã online`.

---

## Chỉnh sở thích AI (persona)

Bot **không** “học” sở thích theo từng tin nhắn lung tung. Gu nói chuyện = **persona** (preset hoặc bạn tự viết).

### A. User Discord — đổi theo ý muốn (không cần sửa code)

#### 1) Trong **Ticket** (khuyên dùng)

1. Tạo ticket (nút **Tạo Ticket**).
2. Mở menu **Chọn sở thích AI** (persona).
3. Chọn một preset, ví dụ:
   - Nexus mặc định  
   - ChatGPT (Luna)  
   - Gemini  
   - Claude (Nam)  
   - Grok  
   - Dola · Copilot · DeepSeek  
4. Hoặc chọn **Tùy chỉnh sở thích AI** → hiện form, **viết mô tả gu bạn muốn**.

**Gợi ý viết tùy chỉnh (copy sửa):**

```text
Xưng "mình", gọi user "bạn".
Tiếng Việt suồng sã, hơi Gen Z, không quá trẻ trâu.
Thích: Roblox, anime shounen, giải thích bài tập ngắn.
Trả lời ngắn, có ví dụ, không văn mẫu.
Không spoiler anime. Không nhận là người thật.
```

Tin nhắn **tiếp theo** trong ticket sẽ theo persona mới.

#### 2) Ngoài ticket (kênh AI)

```text
/persona
```

- Chọn preset **hoặc**
- `style: Tùy chỉnh` + điền `custom: ...` mô tả gu.

Ví dụ:

```text
/persona style: Tùy chỉnh
custom: Nói nhẹ nhàng, thích lo-fi, giải thích toán lớp 12 dễ hiểu, trả lời ngắn
```

#### 3) Đặt **tên gọi AI** (không bắt buộc Nexus)

```text
name: Luna
tên ai: Mây
/ainame name:Luna
/ainame name:reset
```

- Trong **ticket** → tên lưu theo ticket  
- Ngoài ticket → tên lưu theo user  
- AI sẽ xưng / giới thiệu theo tên đó; persona + model giữ nguyên  

#### 4) Ghim ngữ cảnh thêm (ticket)

```text
note: Đang học Toán 12, giải thích từng bước, không nhảy bước
```

`note:` **cộng thêm** ngữ cảnh, không thay cả persona.

#### 5) Bộ nhớ dài hạn (mọi kênh bot)

```text
remember: Tên mình là Nam, thích Valorant
memory
forget: Valorant
```

### B. Dev / chủ bot — sửa preset trong code

File: **`Interest.js`** → object `PERSONA_PRESETS`.

Mỗi persona có:

| Field | Ý nghĩa |
|-------|---------|
| `id` | Mã nội bộ (`chatgpt`, `grok`, …) |
| `label` | Tên hiện trên menu Discord |
| `description` | Mô tả ngắn trên menu |
| `emojiId` | Custom emoji server (logo menu) |
| `block` | **Prompt gu** — AI sẽ nói theo đoạn này |

**Sửa gu có sẵn:** mở `Interest.js`, sửa nội dung trong `` block: `...` `` của persona đó → save → push Railway.

**Thêm persona mới:**

1. Copy một block trong `PERSONA_PRESETS`, đổi `id` / `label` / `block`.
2. Thêm option tương ứng trong lệnh `/persona` (`index.js`, `.addChoices`).
3. (Tuỳ) gắn `emojiId` logo server.
4. Deploy lại.

**Không** nhét token/API key vào `Interest.js`.

### C. Persona ≠ Model ≠ Key

| Thứ | Việc |
|-----|------|
| **Persona** | *Cách nói* / tính cách / sở thích giả lập |
| **Model** | Engine (Gemini 3.6, GPT-5, Grok 4.6…) |
| **Key** | API key nhà cung cấp tương ứng |

Có thể: model **Gemini** + persona **Grok** (gu nói giống Grok, vẫn chạy Gemini).  
Muốn model Grok/GPT/Claude **thật** → chọn model + nhập **key đúng hãng** trong ticket.

---

## Ticket — key & model

### Nhập key

Nút trên ticket **hoặc** nhắn:

```text
key gemini: AIza...
key chatgpt: sk-...
key claude: sk-ant-...
key grok: xai-...
key deepseek: sk-...
```

Gõ `keys` để xem đã lưu provider nào.

### Link lấy key

| Provider | Link |
|----------|------|
| Gemini | https://aistudio.google.com |
| ChatGPT | https://platform.openai.com/api-keys |
| Claude | https://console.anthropic.com/settings/keys |
| Grok | https://console.x.ai |
| DeepSeek | https://platform.deepseek.com/api_keys |

### Model (menu ticket)

- **Gemini:** 3.6 Flash · 3.5 Flash · Flash-Lite · 3.1 Pro  
- **ChatGPT:** GPT-5 · GPT-5 Mini · GPT-5.1 · o4-mini  
- **Claude:** Sonnet 5 · Haiku 4.5 · Opus 5  
- **Grok:** 4.6 · 4.5 · 4.3  
- **DeepSeek:** Chat · Reasoner  

Model + key phải **cùng nhà cung cấp**. Nhiều API có free hạn chế hoặc trả phí.

**Sau mỗi deploy Railway:** file `data/` có thể mất → ticket cũ cần **nhập lại key** (hoặc gắn Volume cho `data/`). Bot sẽ cố nhận kênh `ticket-…` và fallback `GEMINI_API_KEY` server nếu chưa có key ticket.

---

## Lệnh

| Lệnh / tin | Mô tả |
|------------|--------|
| `help` · `/help` | Hướng dẫn |
| `/persona` | Đổi sở thích AI (ngoài ticket) |
| `/ping` · `/quota` · `/reset` | Trạng thái / hạn mức / xóa session |
| `/ask` | Hỏi 1 phát (ephemeral) |
| `/summary` · `/export` | Tóm tắt / xuất chat |
| `/dich` · `dịch:` | Dịch VI ↔ EN |
| `/imagine` · `/video` | Ảnh / video (Gemini) |
| `/tts` · `/speak` · `/voice` · `voicechat on` | Giọng nói |
| `/setchannel` · `/setup_ticketai` | Admin |
| `remember:` · `note:` · `gif: cat` | Memory / ghi chú / GIF |

---

## Voice & GIF

**Voice**

1. Vào voice → `/voice action:join`  
2. `voicechat on`  
3. Nhắn text hoặc tin nhắn thoại ở kênh AI/ticket  

Host free đôi khi chỉ gửi **MP3**.

**GIF**

```text
gif: funny
gửi gif đi
gif: cat
```

Cần `GIPHY_API_KEY` trên host.

---


## Admin & an toàn (mới)

| Lệnh | Ai dùng | Việc |
|------|---------|------|
| `/adminpanel` | Admin | Embed: bot online, số ticket, khóa Gemini, moderation, lệnh nhanh |
| `/moderation mode:Bật` | Admin | Lọc spam lặp + link đáng ngờ trong **kênh AI / ticket** |
| `/feedback message:...` | Mọi user | Gửi góp ý → kênh `ADMIN_LOG_CHANNEL_ID` |
| Welcome DM | Tự động | Member mới join → DM hướng dẫn (tắt DM thì bỏ qua) |

**Cấu hình**

```env
ADMIN_LOG_CHANNEL_ID=id_kênh_log_admin
```

Discord Developer Portal → Bot → bật **Server Members Intent** (cho Welcome DM).

**Quota:** sau mỗi chat thành công, nếu còn ≤ **10%** hạn mức ngày (hoặc ≤ 8 lượt), bot gắn cảnh báo dưới câu trả lời. Xem `/quota`.

---
## Deploy & chia sẻ

- **Railway / VPS:** chạy 24/7, Variables = `.env`  
- **Mời bot:** OAuth2 URL (`bot` + `applications.commands`) — **không** share token/key  
- Mời thêm server **không** nhân phí host; **chat API** mới tốn quota  

```text
https://discord.com/api/oauth2/authorize?client_id=APPLICATION_ID&permissions=2147552256&scope=bot%20applications.commands
```

---

## Cấu trúc code

```text
index.js           # Entry, slash, chat
Interest.js        # Persona / sở thích AI (sửa gu tại đây)
Providers.js       # ChatGPT, Claude, Grok, DeepSeek + model
TicketManager.js   # Ticket, menu, modal key
Memory.js          # remember / forget
Emotion.js         # Cảm xúc + xin GIF
GifSearch.js       # Giphy
QuotaManager.js    # Hạn mức ngày
VoiceManager.js    # Voice + fallback MP3
Tts.js · UserPrefs.js · AdminLog.js
data/              # Runtime JSON (nên Volume trên Railway)
```

---

## License

MIT (hoặc quyền bạn quy định). Tuân thủ điều khoản Discord & từng nhà cung cấp API.

**Nexus AI** · multi-provider · discord.js v14
