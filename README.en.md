# Nexus AI — Discord Bot

[🇻🇳 Tiếng Việt](README.md) · [🇬🇧 English](README.en.md)

Discord AI bot (**Node.js** + **discord.js v14**) — AI channel / ticket / DM / mention.

Supports **Gemini · ChatGPT · Claude · Grok · DeepSeek**, persona, Training/KB, TTS, voicechat, multi-language replies, GIF, quota, moderation, Prompt Shield.

> **Security:** Do not commit `.env`. Put tokens & API keys only on the host (Railway, VPS…).

---

## Setup video


https://github.com/user-attachments/assets/5a4fa948-ea97-4e3a-ab69-8be3cf4af3e4


---

## Download

[![Download ZIP](https://img.shields.io/badge/Download-ZIP-blue?style=for-the-badge&logo=github)](https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip)

| Method | Link |
|------|------|
| **ZIP** | https://github.com/3hbin/nexus-bot/archive/refs/heads/main.zip |
| **Repo** | https://github.com/3hbin/nexus-bot |
| **Clone** | `git clone https://github.com/3hbin/nexus-bot.git` |

---

## Features

| Group | Details |
|------|----------|
| **AI chat** | AI channel, ticket, mention, DM |
| **Providers** | Gemini · ChatGPT · Claude · Grok · DeepSeek |
| **Reply language** | `/languages` · `lang: en` |
| **Ticket** | 1 ticket per user · keys/models · persona |
| **Persona** | Casual · toxic · gentle · cool · analytical + AI presets |
| **TTS / Voicechat** | `/voicechat` · male/female voice |
| **KB / Memory** | `train:` · `kb add:` · `remember:` |
| **GIF · Translate · Quota · Prompt Shield** | |

Type **`help`** or **`/help`**.

---

## AI reply language

```text
/languages language: English
lang: en
lang: vi
lang: ko
lang: auto
```

| Code | Language |
|----|----------|
| `vi` | Vietnamese |
| `en` | English |
| `ko` | Korean |
| `ja` | Japanese |
| `zh` | Chinese |
| `th` `fr` `es` `de` `ru` `id` | … |
| `auto` | Discord app locale (not IP) |

The model **replies directly** in the selected language (ticket / channel / DM).  
Translate one snippet only: `/dich` or `dịch: ...`.

---

## Quick setup

1. [discord.com/developers](https://discord.com/developers/applications) → New app → enable **Message Content Intent** → copy token  
2. Download ZIP / clone → push to your **private GitHub** repo  
3. [railway.app](https://railway.app) → Deploy from GitHub  
4. **Shared Variables:**

| Variable | Required | Source |
|------|----------|--------|
| `DISCORD_TOKEN` | ✅ | Bot → Reset Token |
| `GEMINI_API_KEY` | ✅ | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `GIPHY_API_KEY` | Recommended | [developers.giphy.com](https://developers.giphy.com) |
| `ADMIN_USER_IDS` | Recommended | Copy User ID (Developer Mode) |
| `ADMIN_LOG_CHANNEL_ID` | Optional | `#logs` channel ID |
| `ONLINE_ANNOUNCE_CHANNEL_ID` | Optional | Online announce channel |
| `DATA_DIR` | Optional | `/data` if using a Volume |

5. Deploy → type `help` in your server  

---

## Main commands

| Command | Description |
|------|--------|
| `/help` | Help |
| `/languages` | AI reply language |
| `/setchannel` | Set AI channel |
| `/voicechat` | Voice chat replies |
| `/dich` | Translate text |
| `/speak` `/tts` | Speak text |
| `/ainame` | AI display name |
| `/adminpanel` | Admin |

**Quick chat:** `lang: en` · `giọng: nữ` · `key gemini: ...` · `gif: ...` · `help`

---

## Voicechat

```text
1. Join a voice channel
2. /voicechat mode:on
3. Send text or a voice message
4. giọng: nam | giọng: nữ
```

---

## Common issues

| Issue | Fix |
|-----|--------|
| `Used disallowed intents` | Enable Message Content Intent → Redeploy |
| Slash commands missing | Wait 1–2 minutes / re-invite bot |
| Voice only sends MP3 | Normal on free hosts (UDP limits) |
| Data lost on redeploy | Volume + `DATA_DIR=/data` |

---

**Happy deploying.**  
[🇻🇳 Phiên bản Tiếng Việt](README.md)
