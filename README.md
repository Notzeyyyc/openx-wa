# OpenXX

WhatsApp AI productivity assistant. Belajar, kerja, dan produktivitas — semua dari WhatsApp.

## Features

- **AI Chat** — Multi-provider (OpenAI, Claude, ChatGPT, Gemini, OpenRouter)
- **Agents** — Homework, Essay, Solver, Research, Translate, Vision
- **Notes** — Simpan catatan via WhatsApp
- **Reminders** — Set pengingat via WhatsApp
- **Music Player** — `.play <lagu>`
- **Group Management** — Auto-welcome, anti-spam, auto-reply
- **Analytics** — Track usage statistics
- **Conversation Memory** — AI ingat percakapan sebelumnya

## Quick Start

### On Termux (Android)
```bash
pkg install curl -y && curl -sL https://raw.githubusercontent.com/Notzeyyyc/openx-wa/main/scripts/termux-setup.sh | sh
```

### On VPS
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs git
sudo npm install -g pnpm pm2
git clone https://github.com/Notzeyyyc/openx-wa.git ~/openxx
cd ~/openxx && pnpm install
pm2 start index.js --name openxx-bot
pm2 save && pm2 startup
```

## Commands

| Command | Description |
|---------|-------------|
| `.play <lagu>` | Play music |
| `.note add <text>` | Save note |
| `.note list` | List notes |
| `.reminder <HH:MM> <text>` | Set reminder |
| `.agent homework <task>` | Homework help |
| `.agent essay <task>` | Essay writing |
| `.agent solver <task>` | Math/science solver |
| `.ai provider <name>` | Change AI provider |
| `.ai apikey <key>` | Set API key |
| `.ai status` | Check config |
| `.stats` | View statistics |
| `ram` | RAM usage |
| `reset` | Clear memory |

## Configuration

All settings via WhatsApp:
```
.ai phone <number>     — set admin number
.ai provider <name>    — openai, claude, chatgpt, gemini, openrouter
.ai apikey <key>       — set API key
.ai model <name>       — set model
.ai status             — check config
```

## Project Structure

```
openxx/
├── index.js              # Entry point
├── src/
│   ├── config.js         # Configuration
│   ├── ai-provider.js    # AI provider router
│   ├── ai-config.js      # Flexible AI config
│   ├── database.js       # SQLite database
│   ├── analytics.js      # Usage tracking
│   ├── providers/        # AI providers
│   │   ├── openai.js
│   │   ├── claude.js
│   │   ├── chatgpt.js
│   │   ├── gemini.js
│   │   └── openrouter.js
│   └── whatsapp/
│       ├── connection.js      # WhatsApp socket
│       ├── message-router.js  # Message routing
│       ├── ai-processor.js    # AI processing
│       ├── commands.js        # Command handlers
│       ├── agent-manager.js   # Subagent system
│       ├── notes.js           # Notes feature
│       ├── reminders.js       # Reminders feature
│       ├── music-handler.js   # Music player
│       ├── helpers.js         # Utilities
│       ├── queue.js           # Message queue
│       └── conversation-store.js
├── setup/                # CLI setup tool
└── scripts/              # Setup scripts
```

## License

ISC
