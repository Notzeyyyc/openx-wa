# OpenXX

WhatsApp AI productivity assistant. Belajar, kerja, dan produktivitas — semua dari WhatsApp.

## Features

- **AI Chat** — any OpenAI-compatible API (SumoPod, OpenRouter, etc.)
- **Agents** — Homework, Essay, Solver, Research, Translate, Vision
- **Notes** — Simpan catatan via WhatsApp
- **Reminders** — Set pengingat via WhatsApp
- **Group Management** — Auto-welcome, anti-spam, auto-reply
- **Analytics** — Track usage statistics
- **Conversation Memory** — AI ingat percakapan sebelumnya

## Quick Start

### On Termux (Android)
```bash
pkg install nodejs-lts git -y
npm install -g pnpm
git clone https://github.com/Notzeyyyc/openx-wa.git ~/openxx
cd ~/openxx && pnpm install
pnpm start   # scan QR, lalu Ctrl+C, isi .env, jalankan ulang
```
Keep alive: `termux-wake-lock` + Termux battery unrestricted.

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
| `.note add <text>` | Save note |
| `.note list` | List notes |
| `.reminder <HH:MM> <text>` | Set reminder |
| `.ai status` | Check config |
| `.ai url <base-url>` | Set AI base URL |
| `.ai apikey <key>` | Set API key |
| `ram` | RAM usage |
| `reset` | Clear memory |

## Configuration

All settings via WhatsApp:
```
.ai phone <number>     — set admin number
.ai url <base-url>     — OpenAI-compatible API base URL
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
│   ├── provider.js       # OpenAI-compatible chat API
│   ├── ai-config.js      # AI profiles config
│   └── whatsapp/
│       ├── connection.js      # WhatsApp socket
│       ├── message-router.js  # Message routing
│       ├── ai-processor.js    # AI processing
│       ├── commands.js        # Command handlers
│       ├── notes.js           # Notes feature
│       ├── reminders.js       # Reminders feature
│       ├── helpers.js         # Utilities
│       ├── queue.js           # Message queue
│       └── conversation-store.js
├── setup/                # CLI setup tool
└── scripts/              # Dev helpers (scan-secrets)
```

## License

ISC
