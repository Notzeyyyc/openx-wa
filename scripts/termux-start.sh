#!/data/data/com.termux/files/usr/bin/sh
# OpenXX Optimized Start Script
# Memory-efficient startup for Termux/Android

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

INSTALL_DIR="$HOME/openxx"

echo -e "${CYAN}OpenXX Starting (Optimized)...${NC}"

# Keep device awake
termux-wake-lock 2>/dev/null

# Kill existing sessions
tmux kill-session -t openxx 2>/dev/null || true
tmux kill-session -t openxx-mcp 2>/dev/null || true

# Start bot with memory-optimized flags
tmux new-session -d -s openxx "cd $INSTALL_DIR && node --max-old-space-size=128 --gc-interval=100 --expose-gc index.js"

# Start MCP server
if [ -f "$INSTALL_DIR/openx-mcp/openx-mcp" ]; then
    tmux new-session -d -s openxx-mcp "cd $INSTALL_DIR/openx-mcp && ./openx-mcp"
fi

echo -e "${GREEN}✓ Started with RAM limit 128MB${NC}"
echo -e "  tmux attach -t openxx    — view bot"
echo -e "  tmux attach -t openxx-mcp — view MCP"
