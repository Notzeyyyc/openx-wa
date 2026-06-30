#!/data/data/com.termux/files/usr/bin/sh
# OpenXX Keep-Alive Script
# Prevents Termux from being killed by Android
# Usage: bash scripts/termux-keepalive.sh

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}=== OpenXX Keep-Alive Setup ===${NC}"
echo ""

# 1. Install Termux:API
echo -e "${YELLOW}[1/4] Installing Termux:API...${NC}"
pkg install -y termux-api
echo -e "${GREEN}✓ termux-api installed${NC}"

# 2. Create persistent notification
echo -e "${YELLOW}[2/4] Creating persistent notification...${NC}"
termux-notification -i openxx -t "OpenXX Running" --priority low -c "Bot is active" --ongoing
echo -e "${GREEN}✓ Notification created${NC}"

# 3. Create keep-alive script
echo -e "${YELLOW}[3/4] Creating keep-alive script...${NC}"
cat > ~/openxx/scripts/keepalive-daemon.sh << 'DAEMON'
#!/data/data/com.termux/files/usr/bin/sh
# Refresh notification every 5 minutes to keep Termux alive
while true; do
    termux-notification -i openxx -t "OpenXX Running" \
        --priority low \
        -c "Bot active | $(date +%H:%M)" \
        --ongoing \
        --sound-vibration 2>/dev/null
    sleep 300
done
DAEMON
chmod +x ~/openxx/scripts/keepalive-daemon.sh

# Start keep-alive daemon
pkill -f keepalive-daemon.sh 2>/dev/null
nohup ~/openxx/scripts/keepalive-daemon.sh > /dev/null 2>&1 &
echo -e "${GREEN}✓ Keep-alive daemon started${NC}"

# 4. Disable battery optimization hints
echo -e "${YELLOW}[4/4] Battery optimization tips...${NC}"
echo ""
echo -e "${GREEN}✓ Setup Complete!${NC}"
echo ""
echo -e "${CYAN}Manual steps (once):${NC}"
echo -e "1. Settings > Apps > Termux > Battery > ${GREEN}Unrestricted${NC}"
echo -e "2. Settings > Apps > Termux > Disable ${GREEN}Auto-optimize${NC}"
echo -e "3. Install ${GREEN}Termux:Boot${NC} from F-Droid"
echo -e "4. Settings > Apps > Special > Battery optimization > Termux > ${GREEN}Don't optimize${NC}"
echo ""
echo -e "${CYAN}Commands:${NC}"
echo -e "  termux-notification -i openxx -t 'OpenXX' -c 'Running' --ongoing"
echo -e "  pkill -f keepalive-daemon"
