#!/data/data/com.termux/files/usr/bin/sh
# OpenXX Termux Installer v2
# One-click setup: install + configure + start + daemon
# Usage: curl -sL <url>/termux-setup.sh | sh

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="$HOME/openxx"
MCP_DIR="$INSTALL_DIR/openx-mcp"

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      OpenXX Installer v2             ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: System deps ──
echo -e "${YELLOW}[1/8] Installing system dependencies...${NC}"
pkg update -y
pkg install -y nodejs-lts golang git tmux curl android-tools

# ── Step 2: pnpm ──
echo -e "${YELLOW}[2/8] Installing pnpm...${NC}"
if ! command -v pnpm &> /dev/null; then
    corepack enable
    corepack prepare pnpm@latest --activate
fi
echo -e "${GREEN}✓ pnpm ready${NC}"

# ── Step 3: pm2 ──
echo -e "${YELLOW}[3/8] Installing pm2 (process manager)...${NC}"
npm install -g pm2
echo -e "${GREEN}✓ pm2 ready${NC}"

# ── Step 4: Clone project ──
echo -e "${YELLOW}[4/8] Setting up project...${NC}"
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

# ── Step 5: npm install ──
echo -e "${YELLOW}[5/8] Installing npm packages...${NC}"
pnpm install
echo -e "${GREEN}✓ npm packages installed${NC}"

# ── Step 6: Build MCP server ──
echo -e "${YELLOW}[6/8] Building MCP server...${NC}"
if [ -d "$MCP_DIR" ]; then
    cd "$MCP_DIR"
    go build -o openx-mcp . 2>/dev/null && echo -e "${GREEN}✓ MCP server built${NC}" || echo -e "${YELLOW}⚠ MCP build skipped${NC}"
    cd "$INSTALL_DIR"
fi

# ── Step 7: Configure .env ──
echo -e "${YELLOW}[7/8] Configuring...${NC}"
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# Generate MCP token
MCP_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)

# Write .env with defaults (user configures via WhatsApp later)
cat > .env << EOF
# OpenXX Configuration

# WhatsApp admin phone number (set via: .ai phone <number>)
OPENX_DEV_PHONE_NUMBER=

# AI Provider (set via: .ai provider <name>)
OPENX_AI_PROVIDER=openai

# OpenAI-compatible (set via: .ai model <name>)
OPENX_OPENAI_BASE_URL=https://ai.sumopod.com
OPENX_OPENAI_API_KEY=
OPENX_OPENAI_MODEL=gpt-4o-mini

# ADB
OPENX_ADB_PORT=auto

# MCP Server
OPENX_MCP_URL=http://localhost:8765
OPENX_MCP_API_KEY=$MCP_TOKEN
EOF

echo -e "${GREEN}✓ .env configured with defaults${NC}"
echo -e "${CYAN}MCP Token: $MCP_TOKEN${NC}"
echo ""
echo -e "${YELLOW}Configure everything via WhatsApp after bot starts:${NC}"
echo -e "  ${CYAN}.ai provider <name>${NC} — openrouter, openai, claude, chatgpt, gemini"
echo -e "  ${CYAN}.ai apikey <key>${NC} — set API key"
echo -e "  ${CYAN}.ai model <name>${NC} — set model"
echo -e "  ${CYAN}.ai status${NC} — check config"

# ── Step 8: Install CLI + start services ──
echo -e "${YELLOW}[8/8] Installing CLI + starting services...${NC}"

# Install openxx CLI
cp "$INSTALL_DIR/scripts/openxx" "$PREFIX/bin/openxx"
chmod +x "$PREFIX/bin/openxx"

# Stop existing pm2 processes
pm2 delete openxx-bot 2>/dev/null || true
pm2 delete openxx-mcp 2>/dev/null || true

# Start bot with pm2
cd "$INSTALL_DIR"
pm2 start index.js --name openxx-bot --node-args="--max-old-space-size=128 --gc-interval=100 --expose-gc"
echo -e "${GREEN}✓ Bot started with pm2${NC}"

# Start MCP server with pm2
if [ -f "$MCP_DIR/openx-mcp" ]; then
    pm2 start "$MCP_DIR/openx-mcp" --name openxx-mcp --cwd "$MCP_DIR"
    echo -e "${GREEN}✓ MCP server started with pm2${NC}"
fi

# Save pm2 config & setup auto-start
pm2 save
pm2 startup 2>/dev/null || true

# ── Setup Termux:Boot ──
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
cat > "$BOOT_DIR/openxx.sh" << 'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
sleep 3
pm2 resurrect
BOOTEOF
chmod +x "$BOOT_DIR/openxx.sh"
echo -e "${GREEN}✓ Auto-start configured (Termux:Boot)${NC}"

# ── Keep awake ──
termux-wake-lock 2>/dev/null

# ── Done ──
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Setup Complete!              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "Quick commands:"
echo -e "  ${CYAN}openxx${NC}            — Open start menu"
echo -e "  ${CYAN}openxx status${NC}     — Check status"
echo -e "  ${CYAN}openxx logs${NC}       — View bot logs"
echo -e "  ${CYAN}nano .env${NC}         — Edit config"
echo ""
pm2 status
