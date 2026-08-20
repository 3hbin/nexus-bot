# Nexus AI — Discord Bot

[🇻🇳 Tiếng Việt](README.md) · [🇬🇧 English](README.en.md)

Discord AI bot built with **Node.js** + **discord.js v14**, powered by **Gemini 3.7 Flash** (auto-fallback to **3.6 / 3.5** on 503 errors).

Supports AI channel, tickets, DMs, mentions; language & persona switching; TTS / voicechat; Google Search · Maps · Code Execution; quota; moderation.

> **Security:** Never commit `.env`. Keep tokens and API keys only on your device or host (Termux, VPS…).

---

## Download

| Method | Link |
|------|------|
| **ZIP** | https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip |
| **Repo** | https://github.com/3hbin/nexus-bot |
| **Clone** | `git clone https://github.com/3hbin/nexus-bot.git` |

---

## Features

| Group | Details |
|------|----------|
| **AI chat** | AI channel, ticket (1 per user), DM, mention |
| **Model** | `gemini-3.7-flash` (default) · auto-fallback to 3.6 / 3.5 on 503 |
| **Thinking Level** | `thinking: low` · `thinking: medium` · `thinking: high` |
| **Gemini tools** | Google Search · Google Maps · Code Execution (Python sandbox) |
| **Language** | `/languages` · `lang: vi` · `lang: en` · `lang: auto` |
| **Persona** | Casual · toxic · gentle · cool · analytical · custom |
| **TTS / Voice** | `/voicechat` · `/speak` · male/female voice commands |
| **Other** | GIF · translate · quota · moderation · Prompt Shield |

Type **`help`** or **`/help`** in your server for in-bot guidance.

---

## Quick chat commands

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

## Environment variables (`.env`)

| Variable | Required | Description |
|------|:--------:|-------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `GEMINI_API_KEY` | ✅ | Gemini API key (AI Studio) |
| `GIPHY_API_KEY` | Recommended | GIF key — [developers.giphy.com](https://developers.giphy.com) |
| `ADMIN_USER_IDS` | Recommended | Admin user IDs, comma-separated |
| `ADMIN_LOG_CHANNEL_ID` | Optional | Admin log channel ID |
| `DATA_DIR` | Optional | Data directory (e.g. `/data`) |

Get a Gemini key: [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

---

## Manual testing on phone (Termux)

Use this when you **do not want 24/7 cloud hosting** (Railway, etc.). The bot runs only while Termux is open.

### 1. Install Termux & prepare

1. Install **Termux** from [F-Droid](https://f-droid.org/en/packages/com.termux/) (recommended) or GitHub releases.
2. Open Termux and update:

```bash
pkg update -y && pkg upgrade -y
pkg install git nodejs -y
```

3. Get the source:

```bash
cd ~
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
```

(Or unzip the ZIP and `cd` into the project folder.)

### 2. Create `.env`

```bash
cd nexus-bot
cp .env.example .env
nano .env
```

Inside nano, set at least:

```env
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=AIza_your_gemini_key
```

**Save in nano:**

1. `CTRL` + `O` (write)
2. `Enter` (confirm filename `.env`)
3. `CTRL` + `X` (exit)

> On Termux: tap **CTRL** on the extra key bar, then the matching letter on the keyboard.

### 3. Fix library install on phone CPUs

The Node package `ffmpeg-static` often has **no binary** for phone architectures → *"No binary found for architecture"*. Run these in order:

```bash
# 1) Install system FFmpeg from Termux
pkg install ffmpeg -y

# 2) Install Node deps, skip broken native scripts
npm install --ignore-scripts

# 3) Ensure dotenv is present (may be missing if the previous step was interrupted)
npm install dotenv
```

### 4. Start the bot

```bash
cd ~/nexus-bot
node index.js
```

On success you should see lines like:

- Slash commands registered
- Online announcement sent
- Bot online on Discord

The Termux screen will **stay busy** (you cannot type other commands) — that is expected.

### 5. Stop the bot

1. Press **CTRL** on the Termux extra key bar  
2. Press **C** on the keyboard  

→ Process stops and you return to `~$`.

### 6. Start again later

```bash
cd ~/nexus-bot
node index.js
```

> **Note:** Closing Termux or locking the phone may take the bot offline. This is manual testing, not 24/7 hosting.

---

## Main slash commands

| Command | Description |
|------|--------|
| `/help` | Help and feature overview |
| `/languages` | Set AI reply language |
| `/setchannel` | Set default AI channel (admin) |
| `/voicechat` | Toggle voice replies |
| `/dich` | Translate text |
| `/speak` · `/tts` | Text → speech (audio file) |
| `/ainame` | Change AI display name |
| `/adminpanel` | Admin control panel |

---

## Voicechat (summary)

```text
1. Join a Discord voice channel
2. /voicechat mode:on
3. Send text (or a voice message) in the AI channel / ticket
4. Use male/female voice preference commands if available
```

On phones or hosts with limited UDP, the bot may send an **MP3 file** instead of speaking live in voice.

---

## Common issues

| Issue | Fix |
|-----|--------|
| `Used disallowed intents` | Enable **Message Content Intent** in the Discord Developer Portal → restart the bot |
| Slash commands missing | Wait 1–2 minutes or re-invite the bot |
| **503** temporary AI server error | Wait 1–5 minutes; bot auto-falls back to 3.6 / 3.5 |
| **429** Gemini quota exceeded | Use another key/project, enable Billing, or wait until ~00:00 UTC+7 |
| `ffmpeg-static` / No binary | Use `pkg install ffmpeg` + `npm install --ignore-scripts` (see Termux section) |
| Bot offline after closing Termux | Expected for manual runs — start again with `node index.js` |

---

## Run on a computer (optional)

```bash
git clone https://github.com/3hbin/nexus-bot.git
cd nexus-bot
cp .env.example .env
# edit .env: DISCORD_TOKEN + GEMINI_API_KEY
npm install
node index.js
```

---

Thanks for using Nexus AI.  
Happy testing on Termux.
