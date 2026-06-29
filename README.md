# OpenXX

WhatsApp AI bot that actually does stuff — talks to your phone via ADB, runs AI models, plays music, and more. Built to run on a VPS or straight on your Android via Termux.

## Features

- **WhatsApp Bot** — AI-powered chat with multiple personalities
- **ADB Control** — Take screenshots, tap, swipe, open apps on your phone
- **Music Player** — `.play <song name>` and get the audio
- **AI Providers** — OpenRouter, OpenAI-compatible (SumoPod), Claude, custom REST
- **MCP Server** — 11 plugins (shell, file, device, browser, memory, cron, etc.)
- **Conversation Memory** — AI remembers your previous messages
- **RAM Monitor** — Check memory usage from WhatsApp
- **Plugin System** — Extend with custom plugins (sandboxed)

## Quick Start

### On Termux (Android)

One-liner install:

```bash
pkg install curl -y && curl -sL https://raw.githubusercontent.com/Notzeyyyc/openx-wa/main/scripts/termux-setup.sh | sh
```

This installs everything, builds the MCP server, and starts the bot in the background.

After install, use the `openxx` command:

```bash
openxx           # Start bot + MCP
openxx stop      # Stop everything
openxx restart   # Restart everything
openxx status    # Check if it's running
openxx logs      # View bot logs
openxx logs-mcp  # View MCP server logs
```

### On VPS / PC

```bash
# Clone the repo
git clone https://github.com/Notzeyyyc/openx-wa.git
cd openx-wa

# Install dependencies
pnpm install

# Setup config
cp .env.example .env
nano .env  # fill in your values

# Start
pnpm start
```

## Configuration

Copy `.env.example` to `.env` and fill in:

```env
# WhatsApp admin number (no + sign)
OPENX_DEV_PHONE_NUMBER=628123456789

# AI Provider: openrouter | openai | claude | rest
OPENX_AI_PROVIDER=openai

# OpenAI-compatible (SumoPod, Together, Groq, etc.)
OPENX_OPENAI_BASE_URL=https://ai.sumopod.com
OPENX_OPENAI_API_KEY=your-key
OPENX_OPENAI_MODEL=gpt-4o-mini

# Claude API (FongsiDev)
OPENX_CLAUDE_BASE_URL=https://fgsi.dpdns.org/api/ai/claude
OPENX_CLAUDE_API_KEY=your-key

# ADB mode: auto | usb | or port number
OPENX_ADB_PORT=usb

# MCP Server URL
OPENX_MCP_URL=http://localhost:8765
OPENX_MCP_API_KEY=your-token
```

## WhatsApp Commands

| Command | Description |
|---------|-------------|
| `.play <song>` | Play a song |
| `.personality list` | List available personalities |
| `.personality select <key>` | Switch personality |
| `.model list` | List AI models |
| `.model select <name>` | Switch model |
| `ram` | Show RAM usage |
| `gc` | Force garbage collect |
| `reset` | Clear conversation memory |
| `ping` | Pong! |

Just send any message without a prefix and the AI will reply naturally.

## USB ADB Setup

1. Connect phone to laptop via USB
2. Enable USB Debugging (Settings > Developer Options)
3. Accept the RSA key prompt on your phone
4. Set `OPENX_ADB_PORT=usb` in `.env`
5. Run `adb devices` to verify

## MCP Server

The MCP server runs separately and provides tools like shell execution, file ops, device control, browser, memory, and more.

```bash
# Build
cd openx-mcp
go build -o openx-mcp .

# Run
./openx-mcp
```

Config: `openx-mcp/config.yaml`

## Project Structure

```
openxx/
├── index.js              # Entry point
├── src/
│   ├── config.js         # Configuration + env loader
│   ├── logger.js         # Logging
│   ├── ai-provider.js    # AI provider router
│   ├── adb-connect.js    # ADB port detection
│   ├── adb-helper.js     # ADB commands
│   ├── downloader.js     # Media downloader
│   ├── plugin-manager.mjs
│   ├── providers/
│   │   ├── openai.js     # OpenAI-compatible
│   │   ├── openrouter.js # OpenRouter
│   │   ├── claude.js     # Claude API
│   │   └── rest.js       # Custom REST
│   └── whatsapp/
│       ├── connection.js      # WhatsApp socket
│       ├── message-router.js  # Message routing
│       ├── ai-processor.js    # AI processing + tags
│       ├── commands.js        # Command handlers
│       ├── helpers.js         # Utilities
│       ├── mcp-client.js      # MCP integration
│       ├── music-handler.js   # Music player
│       ├── conversation-store.js # Chat memory
│       ├── ram-monitor.js     # RAM monitoring
│       ├── queue.js           # Message queue
│       └── sensitive-actions.js # Confirmation flow
├── setup/                # CLI setup tool
├── scripts/              # Setup scripts
├── openx-mcp/            # MCP server (Go)
└── package/              # User configs
```

## License

ISC
