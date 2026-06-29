# OpenX MCP - Termux Deployment Guide

## Quick Start (One Command)

```bash
# On Termux, paste this:
pkg update -y && pkg install -y golang && mkdir -p ~/openx-mcp && cd ~/openx-mcp && curl -L -o openx-v2 https://github.com/your-repo/releases/download/latest/openx-v2-termux && chmod +x openx-v2 && ./openx-v2
```

## Manual Setup

### 1. Install Go
```bash
pkg update -y
pkg install -y golang
```

### 2. Transfer Files from PC
```bash
# From PC (PowerShell):
scp D:\codingan\openxx\openx-mcp\deploy-termux\* user@termux:~/openx-mcp/

# Or use Termux:Boot to auto-start
```

### 3. Run Setup
```bash
cd ~/openx-mcp
bash deploy-termux.sh
```

### 4. Start Server
```bash
./start.sh
```

## Environment Variables

Add to `~/.bashrc`:
```bash
export OPENX_AI_API_KEY="your-api-key"
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/ai` | POST | AI query |
| `/api/shell` | POST | Execute shell command |
| `/api/device` | POST | Device info |
| `/api/battery` | POST | Battery status |
| `/api/network` | POST | Network stats |
| `/api/file/read` | POST | Read file |
| `/api/file/write` | POST | Write file |

## Testing

```bash
# Health check
curl http://localhost:8765/api/health

# AI query
curl -X POST http://localhost:8765/api/ai \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, respond with just OK"}'

# Device info
curl -X POST http://localhost:8765/api/device
```

## Auto-Start on Boot

Add to `~/.bashrc`:
```bash
if [ "$TTY" = "/dev/pts/0" ]; then
    cd ~/openx-mcp
    ./start.sh &
fi
```

Or use Termux:Boot plugin for proper auto-start.

## Troubleshooting

### Port already in use
```bash
# Find and kill process on port 8765
lsof -i :8765
kill -9 <PID>
```

### Permission denied
```bash
chmod +x openx-v2
chmod +x start.sh
chmod +x deploy-termux.sh
```

### Go build failed
```bash
# Clean and rebuild
rm -f openx-v2
go mod tidy
go build -o openx-v2 .
```
