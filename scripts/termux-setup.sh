#!/data/data/com.termux/files/usr/bin/sh
# OpenXX Termux Setup Script
# Install + Run + Background (single command)
# Usage: curl -sL <url>/termux-setup.sh | sh

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="$HOME/openxx"
MCP_DIR="$INSTALL_DIR/openx-mcp"

echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║       OpenXX Termux Setup            ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Install dependencies ──
echo -e "${YELLOW}[1/6] Installing dependencies...${NC}"
pkg update -y
pkg install -y nodejs-lts golang git tmux curl

# Install pnpm
if ! command -v pnpm &> /dev/null; then
    corepack enable
    corepack prepare pnpm@latest --activate
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"

# ── Step 2: Clone or update project ──
echo -e "${YELLOW}[2/6] Setting up project...${NC}"
if [ -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR"
    git pull
    echo -e "${GREEN}✓ Project updated${NC}"
else
    if [ -d "$INSTALL_DIR" ]; then
        rm -rf "$INSTALL_DIR"
    fi
    # Clone from your repo
    git clone https://github.com/Notzeyyyc/openx-wa.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    echo -e "${GREEN}✓ Project cloned${NC}"
fi

# ── Step 3: Install npm dependencies ──
echo -e "${YELLOW}[3/6] Installing npm packages...${NC}"
pnpm install
echo -e "${GREEN}✓ npm packages installed${NC}"

# ── Step 4: Build MCP server ──
echo -e "${YELLOW}[4/6] Building MCP server...${NC}"
if [ -d "$MCP_DIR" ]; then
    cd "$MCP_DIR"
    go build -o openx-mcp . 2>/dev/null && echo -e "${GREEN}✓ MCP server built${NC}" || echo -e "${RED}⚠ MCP build skipped (Go error)${NC}"
    cd "$INSTALL_DIR"
fi

# ── Step 5: Create .env if not exists ──
echo -e "${YELLOW}[5/6] Checking configuration...${NC}"
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo -e "${YELLOW}⚠ Created .env from template — edit it with your values:${NC}"
    echo -e "   ${CYAN}nano .env${NC}"
else
    echo -e "${GREEN}✓ .env exists${NC}"
fi

# ── Step 6: Setup tmux + start ──
echo -e "${YELLOW}[6/6] Starting services...${NC}"

# Kill existing sessions
tmux kill-session -t openxx 2>/dev/null || true
tmux kill-session -t openxx-mcp 2>/dev/null || true

# Start bot in tmux (memory-optimized)
tmux new-session -d -s openxx "cd $INSTALL_DIR && node --max-old-space-size=128 --gc-interval=100 --expose-gc index.js"
echo -e "${GREEN}✓ Bot started in tmux session 'openxx'${NC}"

# Start MCP server in tmux
if [ -f "$MCP_DIR/openx-mcp" ]; then
    tmux new-session -d -s openxx-mcp "cd $MCP_DIR && ./openx-mcp"
    echo -e "${GREEN}✓ MCP server started in tmux session 'openxx-mcp'${NC}"
fi

# ── Setup Termux:Boot (auto-start on boot) ──
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
cat > "$BOOT_DIR/openxx.sh" << 'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
sleep 5

# Start bot (memory-optimized)
tmux new-session -d -s openxx "cd ~/openxx && node --max-old-space-size=128 --gc-interval=100 --expose-gc index.js"

# Start MCP server
if [ -f ~/openxx/openx-mcp/openx-mcp ]; then
    tmux new-session -d -s openxx-mcp "cd ~/openxx/openx-mcp && ./openx-mcp"
fi
BOOTEOF
chmod +x "$BOOT_DIR/openxx.sh"
echo -e "${GREEN}✓ Auto-start configured (Termux:Boot)${NC}"

# ── Keep device awake ──
termux-wake-lock 2>/dev/null

# ── Install openxx shortcut ──
cp "$INSTALL_DIR/scripts/openxx" "$PREFIX/bin/openxx"
chmod +x "$PREFIX/bin/openxx"
echo -e "${GREEN}✓ Installed 'openxx' command${NC}"

# ── Done ──
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          Setup Complete!             ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "Quick commands:"
echo -e "  ${CYAN}openxx${NC}            — Start bot + MCP"
echo -e "  ${CYAN}openxx stop${NC}       — Stop all"
echo -e "  ${CYAN}openxx restart${NC}    — Restart all"
echo -e "  ${CYAN}openxx status${NC}     — Check status"
echo -e "  ${CYAN}openxx logs${NC}       — View bot logs"
echo -e "  ${CYAN}openxx logs-mcp${NC}   — View MCP logs"
echo ""
echo -e "Other:"
echo -e "  ${CYAN}nano .env${NC}         — Edit config"
echo -e "  ${CYAN}tmux ls${NC}           — List sessions"
echo ""
echo -e "Sessions:"
tmux ls 2>/dev/null || echo "  (no sessions)"
