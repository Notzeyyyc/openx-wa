#!/bin/bash
# OpenXX VPS Setup Script
# Run on Ubuntu/Debian VPS
# Usage: curl -sL <url>/vps-setup.sh | bash

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="$HOME/openxx"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      OpenXX VPS Setup                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: System deps ──
echo -e "${YELLOW}[1/6] Installing system dependencies...${NC}"
sudo apt update -y
sudo apt install -y curl git build-essential

# ── Step 2: Node.js ──
echo -e "${YELLOW}[2/6] Installing Node.js...${NC}"
if command -v node &> /dev/null; then
    echo -e "${GREEN}✓ Node.js already installed${NC}"
else
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo -e "Node: $(node -v)"

# ── Step 3: pnpm + pm2 ──
echo -e "${YELLOW}[3/6] Installing pnpm + pm2...${NC}"
sudo npm install -g pnpm pm2
echo -e "${GREEN}✓ pnpm + pm2 ready${NC}"

# ── Step 4: Clone project ──
echo -e "${YELLOW}[4/6] Setting up project...${NC}"
if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR"
    git pull
    echo -e "${GREEN}✓ Project updated${NC}"
else
    rm -rf "$INSTALL_DIR" 2>/dev/null
    git clone https://github.com/Notzeyyyc/openx-wa.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    echo -e "${GREEN}✓ Project cloned${NC}"
fi

# ── Step 5: Install deps ──
echo -e "${YELLOW}[5/6] Installing npm packages...${NC}"
pnpm install
echo -e "${GREEN}✓ npm packages installed${NC}"

# ── Step 6: Configure ──
echo -e "${YELLOW}[6/6] Configuring...${NC}"
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# Generate MCP token
MCP_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)

# Write .env
cat > .env << EOF
# OpenXX VPS Configuration

# WhatsApp admin phone number (set via: .ai phone <number>)
OPENX_DEV_PHONE_NUMBER=

# AI Provider (set via: .ai provider <name>)
OPENX_AI_PROVIDER=openai

# OpenAI-compatible
OPENX_OPENAI_BASE_URL=https://ai.sumopod.com
OPENX_OPENAI_API_KEY=
OPENX_OPENAI_MODEL=gpt-4o-mini

# ADB (disabled on VPS - no phone connected)
OPENX_ADB_PORT=

# MCP Server (disabled on VPS - no phone connected)
OPENX_MCP_URL=
OPENX_MCP_API_KEY=$MCP_TOKEN
EOF

echo -e "${GREEN}✓ .env configured${NC}"
echo -e "${CYAN}MCP Token: $MCP_TOKEN${NC}"

# ── Start services ──
echo ""
echo -e "${YELLOW}Starting services...${NC}"

cd "$INSTALL_DIR"
pm2 start index.js --name openxx-bot --node-args="--max-old-space-size=256 --expose-gc"
pm2 save
pm2 startup 2>/dev/null || true

echo -e "${GREEN}✓ Bot started with pm2${NC}"

# ── Done ──
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Setup Complete!              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "Quick commands:"
echo -e "  ${CYAN}pm2 status${NC}          — check status"
echo -e "  ${CYAN}pm2 logs openxx-bot${NC} — view logs"
echo -e "  ${CYAN}pm2 restart all${NC}     — restart bot"
echo -e "  ${CYAN}nano .env${NC}           — edit config"
echo ""
echo -e "Configure via WhatsApp:"
echo -e "  ${CYAN}.ai phone <number>${NC} — set admin number"
echo -e "  ${CYAN}.ai provider <name>${NC} — set AI provider"
echo -e "  ${CYAN}.ai apikey <key>${NC} — set API key"
echo ""
pm2 status
