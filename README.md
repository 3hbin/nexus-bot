# Nexus AI — Discord Bot

[🇻🇳 Tiếng Việt](README.md) · [🇬🇧 English](README.en.md)

Bot Discord AI viết bằng **Node.js** + **discord.js v14**, dùng mô hình **Gemini 3.7 Flash** (tự fallback **3.6 / 3.5** khi lỗi 503).

Hỗ trợ kênh AI, ticket, DM, mention; đổi ngôn ngữ & persona; TTS / voicechat; Google Search · Maps · Code Execution; quota; moderation.

> **Bảo mật:** Không commit file `.env`. Token và API key chỉ để trên máy bạn hoặc host (Termux, VPS…).

---

## Tải source

| Cách | Link |
|------|------|
| **ZIP** | https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip |
| **Repo** | https://github.com/3hbin/nexus-bot |
| **Clone** | `git clone https://github.com/3hbin/nexus-bot.git` |

---

## Tính năng chính

| Nhóm | Chi tiết |
|------|----------|
| **Chat AI** | Kênh AI, ticket (1 user = 1 ticket), DM, mention bot |
| **Model** | `gemini-3.7-flash` (mặc định) · tự fallback 3.6 / 3.5 khi 503 |
| **Thinking Level** | `thinking: low` · `thinking: medium` · `thinking: high` |
| **Tools Gemini** | Google Search · Google Maps · Code Execution (Python sandbox) |
| **Ngôn ngữ** | `/languages` · `lang: vi` · `lang: en` · `lang: auto` |
| **Persona** | Casual · toxic · gentle · cool · analytical · custom |
| **TTS / Voice** | `/voicechat` · `/speak` · `giọng: nam` · `giọng: nữ` |
| **Khác** | GIF · dịch · quota · moderation · Prompt Shield |

Gõ **`help`** hoặc **`/help`** trong server để xem hướng dẫn trong bot.

---

## Lệnh gõ nhanh trong chat

```text
thinking: high
thinking: medium
thinking: low
lang: vi
lang: en
lang: auto
giọng: nam
giọng: nữ
key gemini: AIza...
```

---

## Biến môi trường (`.env`)

| Biến | Bắt buộc | Mô tả |
|------|:--------:|-------|
| `DISCORD_TOKEN` | ✅ | Token bot Discord |
| `GEMINI_API_KEY` | ✅ | API key Gemini (AI Studio) |
| `GIPHY_API_KEY` | Khuyên dùng | Key GIF — [developers.giphy.com](https://developers.giphy.com) |
| `ADMIN_USER_IDS` | Khuyên dùng | ID admin, cách nhau dấu phẩy |
| `ADMIN_LOG_CHANNEL_ID` | Tuỳ chọn | ID kênh log admin |
| `DATA_DIR` | Tuỳ chọn | Thư mục lưu data (VD `/data`) |

Lấy key Gemini: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

---

## Chạy thử nghiệm thủ công trên điện thoại (Termux)

Phù hợp khi **không muốn treo 24/7** trên Railway / cloud. Bot chỉ chạy khi bạn mở Termux.

### 1. Cài Termux & chuẩn bị

1. Cài **Termux** từ [F-Droid](https://f-droid.org/en/packages/com.termux/) (khuyến nghị) hoặc GitHub releases.
2. Mở Termux, cập nhật:

```bash
pkg update -y && pkg upgrade -y
pkg install git nodejs -y
```

3. Tải source:

```bash
cd ~
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
```

(Hoặc giải nén ZIP rồi `cd` vào thư mục dự án.)

### 2. Tạo file cấu hình `.env`

```bash
cd nexus-bot
cp .env.example .env
nano .env
```

Trong nano, điền tối thiểu:

```env
DISCORD_TOKEN=token_bot_discord_cua_ban
GEMINI_API_KEY=AIza_key_gemini_cua_ban
```

**Lưu file trong nano:**

1. `CTRL` + `O` (ghi file)
2. `Enter` (xác nhận tên `.env`)
3. `CTRL` + `X` (thoát nano)

> Trên Termux: bấm phím **CTRL** trên thanh phụ bên trái / trên, rồi bấm phím tương ứng trên bàn phím.

### 3. Sửa lỗi cài thư viện trên chip điện thoại

Gói `ffmpeg-static` của Node thường **không có binary** cho kiến trúc điện thoại → lỗi *"No binary found for architecture"*. Làm lần lượt:

```bash
# 1) Cài FFmpeg hệ thống Termux
pkg install ffmpeg -y

# 2) Cài dependency Node, bỏ qua script native lỗi
npm install --ignore-scripts

# 3) Bổ sung dotenv (có thể thiếu nếu bước trước bị gián đoạn)
npm install dotenv
```

### 4. Bật bot

```bash
cd ~/nexus-bot
node index.js
```

Khi thành công, terminal hiện tương tự:

- Đăng ký **Slash commands**
- **Đã gửi thông báo online...**
- Bot online trên Discord

Lúc này màn hình Termux **đứng chờ** (không gõ lệnh khác được) — đó là bình thường.

### 5. Tắt bot

1. Bấm **CTRL** trên thanh phím phụ Termux  
2. Bấm phím **C** trên bàn phím  

→ Process dừng, quay về dấu `~$`.

### 6. Chạy lại lần sau

```bash
cd ~/nexus-bot
node index.js
```

> **Lưu ý:** Tắt Termux / khóa máy có thể làm bot offline. Đây là chạy thủ công, không phải host 24/7.

---

## Lệnh gạch chéo (`/`) chính

| Lệnh | Mô tả |
|------|--------|
| `/help` | Xem hướng dẫn lệnh & tính năng |
| `/languages` | Chọn ngôn ngữ AI trả lời |
| `/setchannel` | Cài đặt kênh AI mặc định (admin) |
| `/voicechat` | Bật / tắt chế độ trả lời bằng giọng nói |
| `/dich` | Dịch văn bản |
| `/speak` · `/tts` | Chuyển văn bản thành giọng nói (file audio) |
| `/ainame` | Đổi tên hiển thị của AI |
| `/adminpanel` | Bảng điều khiển quản trị |

---

## Voicechat (tóm tắt)

```text
1. Vào một voice channel trên Discord
2. /voicechat mode:on
3. Gửi tin nhắn chữ (hoặc voice message) trong kênh AI / ticket
4. giọng: nam   hoặc   giọng: nữ
```

Trên điện thoại / host hạn chế UDP, bot có thể gửi **file MP3** thay vì nói trực tiếp trong voice.

---

## Lỗi thường gặp

| Lỗi | Cách xử lý |
|-----|------------|
| `Used disallowed intents` | Bật **Message Content Intent** trong Discord Developer Portal → chạy lại bot |
| Slash commands không hiện | Đợi 1–2 phút hoặc mời lại bot vào server |
| **503** máy chủ AI lỗi tạm | Đợi 1–5 phút; bot tự fallback model 3.6 / 3.5 |
| **429** hết quota Gemini | Đổi key / project, bật Billing, hoặc đợi reset ~00:00 UTC+7 |
| `ffmpeg-static` / No binary | Dùng `pkg install ffmpeg` + `npm install --ignore-scripts` (xem mục Termux) |
| Bot offline khi tắt Termux | Bình thường với chạy thủ công — bật lại bằng `node index.js` |

---

## Chạy trên máy tính (tham khảo)

```bash
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
cp .env.example .env
# sửa .env: DISCORD_TOKEN + GEMINI_API_KEY
npm install
node index.js
```

---

Cảm ơn bạn đã dùng Nexus AI.  
Chúc test trên Termux thuận lợi.
