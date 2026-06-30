#!/data/data/com.termux/files/usr/bin/sh
# OpenXX Tailscale Setup Script
# Setup Tailscale VPN untuk VPS ↔ Android connection

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      OpenXX Tailscale Setup          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# Detect environment
if command -v apt-get &> /dev/null; then
    ENV="debian"
elif command -v pkg &> /dev/null; then
    ENV="termux"
else
    ENV="unknown"
fi

echo -e "Environment: ${CYAN}$ENV${NC}"
echo ""

# ── Step 1: Install Tailscale ──
echo -e "${YELLOW}[1/4] Installing Tailscale...${NC}"

if [ "$ENV" = "termux" ]; then
    # Termux
    if command -v tailscale &> /dev/null; then
        echo -e "${GREEN}✓ Tailscale already installed${NC}"
    else
        pkg install -y tailscale
        echo -e "${GREEN}✓ Tailscale installed${NC}"
    fi
elif [ "$ENV" = "debian" ]; then
    # Debian/Ubuntu VPS
    if command -v tailscale &> /dev/null; then
        echo -e "${GREEN}✓ Tailscale already installed${NC}"
    else
        curl -fsSL https://tailscale.com/install.sh | sh
        echo -e "${GREEN}✓ Tailscale installed${NC}"
    fi
fi

# ── Step 2: Start Tailscale daemon ──
echo -e "${YELLOW}[2/4] Starting Tailscale daemon...${NC}"
if [ "$ENV" = "termux" ]; then
    tailscaled --state=/data/data/com.termux/files/home/.tailscale_state --socket=/data/data/com.termux/files/usr/var/run/tailscale/tailscaled.sock &
    sleep 2
else
    systemctl start tailscaled 2>/dev/null || tailscaled &
    sleep 2
fi
echo -e "${GREEN}✓ Daemon started${NC}"

# ── Step 3: Authenticate ──
echo -e "${YELLOW}[3/4] Authenticating...${NC}"
echo ""
echo -e "Run this command to authenticate:"
echo -e "  ${CYAN}tailscale up${NC}"
echo ""
echo -e "It will give you a URL to login."
echo -e "Open that URL in browser and login with your Tailscale account."
echo ""

# ── Step 4: Show IP ──
echo -e "${YELLOW}[4/4] Getting Tailscale IP...${NC}"
sleep 3

if command -v tailscale &> /dev/null; then
    TS_IP=$(tailscale ip -4 2>/dev/null)
    if [ -n "$TS_IP" ]; then
        echo -e "${GREEN}✓ Tailscale IP: ${CYAN}$TS_IP${NC}"
        echo ""
        echo -e "Use this IP in your VPS .env:"
        echo -e "  ${CYAN}OPENX_MCP_URL=http://$TS_IP:8765${NC}"
    else
        echo -e "${YELLOW}⚠ Not authenticated yet. Run: tailscale up${NC}"
    fi
fi

echo ""
echo -e "${CYAN}=== Setup Complete ===${NC}"
echo ""
echo -e "Commands:"
echo -e "  ${CYAN}tailscale up${NC}          — authenticate"
echo -e "  ${CYAN}tailscale ip -4${NC}       — show IP"
echo -e "  ${CYAN}tailscale status${NC}      — show peers"
echo -e "  ${CYAN}tailscale down${NC}        — disconnect"
echo ""
