#!/bin/bash
# OpenX MCP - Start Script for Termux
# Usage: ./start.sh

set -e

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd ~/openx-mcp

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  OpenX MCP Server${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${YELLOW}  Mode:   Real Device (Android)${NC}"
echo -e "${YELLOW}  Port:   8765${NC}"
echo -e "${YELLOW}  Access: http://localhost:8765${NC}"
echo ""
echo -e "  ${GREEN}Endpoints:${NC}"
echo "    Health:  GET  /api/health"
echo "    AI:      POST /api/ai"
echo "    Shell:   POST /api/shell"
echo "    Device:  POST /api/device"
echo "    Battery: POST /api/battery"
echo "    File:    POST /api/file/read"
echo ""
echo -e "${CYAN}Press Ctrl+C to stop${NC}"
echo ""

# Check if binary exists
if [ ! -f "openx-v2" ]; then
    echo -e "${RED}  ERROR: openx-v2 binary not found!${NC}"
    echo "  Run: bash deploy-termux.sh"
    exit 1
fi

# Run the server
./openx-v2
