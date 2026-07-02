#!/bin/bash
# OpenXX Pterodactyl Setup Script
# Run inside Pterodactyl container
# Usage: bash scripts/pterodactyl-setup.sh

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   OpenXX Pterodactyl Setup           ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: System deps ──
echo -e "${YELLOW}[1/5] Installing system dependencies...${NC}"
apt-get update -y
apt-get install -y curl git build-essential python3

# ── Step 2: Node.js ──
echo -e "${YELLOW}[2/5] Installing Node.js...${NC}"
if command -v node &> /dev/null; then
    echo -e "${GREEN}✓ Node.js $(node -v) already installed${NC}"
else
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
fi

# ── Step 3: pnpm + pm2 ──
echo -e "${YELLOW}[3/5] Installing pnpm + pm2...${NC}"
npm install -g pnpm pm2
echo -e "${GREEN}✓ pnpm + pm2 ready${NC}"

# ── Step 4: Setup project ──
echo -e "${YELLOW}[4/5] Setting up project...${NC}"
WORKSPACE="/home/container"
cd "$WORKSPACE"

# Clone if not exists
if [ ! -d ".git" ]; then
    git clone https://github.com/Notzeyyyc/openx-wa.git .
else
    git pull
fi

# Install deps
pnpm install

# Setup .env
if [ ! -f ".env" ]; then
    cp .env.example .env

    # Generate MCP token (not needed but keep for compatibility)
    TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)

    cat > .env << EOF
# OpenXX Pterodactyl Configuration

# WhatsApp admin phone number (set via: .ai phone <number>)
OPENX_DEV_PHONE_NUMBER=

# AI Provider (set via: .ai provider <name>)
OPENX_AI_PROVIDER=openai

# OpenAI-compatible
OPENX_OPENAI_BASE_URL=https://ai.sumopod.com
OPENX_OPENAI_API_KEY=
OPENX_OPENAI_MODEL=gpt-4o-mini

# Voice/TTS
OPENX_TTS_VOICE=voice_furina_
EOF

    echo -e "${GREEN}✓ .env created${NC}"
fi

echo -e "${GREEN}✓ Project ready${NC}"

# ── Step 5: Start ──
echo -e "${YELLOW}[5/5] Starting bot...${NC}"

# Kill existing pm2
pm2 delete all 2>/dev/null || true

# Start bot
pm2 start index.js --name openxx-bot --node-args="--max-old-space-size=256 --expose-gc"
pm2 save

# Enable startup script
pm2 startup 2>/dev/null || true

echo -e "${GREEN}✓ Bot started${NC}"

# ── Done ──
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Setup Complete!              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "Bot is running with pm2."
echo -e "Configure via WhatsApp after connecting:"
echo -e "  ${CYAN}.ai phone <number>${NC}"
echo -e "  ${CYAN}.ai provider <name>${NC}"
echo -e "  ${CYAN}.ai apikey <key>${NC}"
echo ""
pm2 status
