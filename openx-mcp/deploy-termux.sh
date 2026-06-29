#!/bin/bash
# OpenX MCP - Termux Setup Script
# Run this on Termux after transferring files
# Usage: bash deploy-termux.sh

set -e

echo "========================================"
echo "  OpenX MCP - Termux Setup"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Step 1: Check prerequisites
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

if ! command -v go &> /dev/null; then
    echo -e "${RED}  Go not found! Installing...${NC}"
    pkg update -y
    pkg install -y golang
else
    GO_VERSION=$(go version | awk '{print $3}')
    echo -e "${GREEN}  OK: Go $GO_VERSION installed${NC}"
fi

# Step 2: Setup directory
echo -e "${YELLOW}[2/5] Setting up directory...${NC}"

INSTALL_DIR="$HOME/openx-mcp"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Copy files if in transfer directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "$SCRIPT_DIR" != "$INSTALL_DIR" ]; then
    if [ -f "$SCRIPT_DIR/openx-v2" ]; then
        cp "$SCRIPT_DIR/openx-v2" .
        cp "$SCRIPT_DIR/config.yaml" . 2>/dev/null || true
        cp "$SCRIPT_DIR/start.sh" . 2>/dev/null || true
        chmod +x openx-v2
        echo -e "${GREEN}  OK: Files copied to $INSTALL_DIR${NC}"
    else
        echo -e "${YELLOW}  WARN: No binary found in script directory${NC}"
    fi
else
    echo -e "${GREEN}  OK: Already in $INSTALL_DIR${NC}"
fi

# Step 3: Set environment variables
echo -e "${YELLOW}[3/5] Setting up environment variables...${NC}"

# AI API Key
if [ -z "$OPENX_AI_API_KEY" ]; then
    echo -e "${CYAN}  Enter your AI API Key:${NC}"
    read -r -s API_KEY
    echo ""
    
    if [ -n "$API_KEY" ]; then
        # Add to .bashrc if not exists
        if ! grep -q "OPENX_AI_API_KEY" "$HOME/.bashrc" 2>/dev/null; then
            echo "export OPENX_AI_API_KEY=\"$API_KEY\"" >> "$HOME/.bashrc"
        fi
        export OPENX_AI_API_KEY="$API_KEY"
        echo -e "${GREEN}  OK: API Key saved to .bashrc${NC}"
    else
        echo -e "${YELLOW}  WARN: No API Key provided${NC}"
    fi
else
    echo -e "${GREEN}  OK: API Key already set${NC}"
fi

# Step 4: Build (if needed)
echo -e "${YELLOW}[4/5] Checking build...${NC}"

if [ ! -f "openx-v2" ]; then
    echo -e "${CYAN}  Building from source...${NC}"
    if [ -f "main.go" ]; then
        go mod tidy
        go build -o openx-v2 .
        chmod +x openx-v2
        echo -e "${GREEN}  OK: Build complete${NC}"
    else
        echo -e "${RED}  FAIL: No main.go found${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}  OK: Binary exists${NC}"
fi

# Step 5: Create start script
echo -e "${YELLOW}[5/5] Creating start script...${NC}"

if [ ! -f "start.sh" ]; then
    cat > start.sh << 'EOF'
#!/bin/bash
# OpenX MCP - Start Script
cd ~/openx-mcp

echo "Starting OpenX MCP Server..."
echo "  Mode: Real Device (HTTP Only)"
echo "  Port: 8765"
echo ""
echo "  Health: http://localhost:8765/api/health"
echo "  Tools:  http://localhost:8765/api/health"
echo ""
echo "Press Ctrl+C to stop"
echo ""

./openx-v2
EOF
    chmod +x start.sh
fi

echo ""
echo "========================================"
echo -e "${GREEN}  Setup Complete!${NC}"
echo "========================================"
echo ""
echo -e "${CYAN}To start the server:${NC}"
echo "  cd ~/openx-mcp"
echo "  ./start.sh"
echo ""
echo -e "${CYAN}To test:${NC}"
echo "  curl http://localhost:8765/api/health"
echo ""
echo -e "${CYAN}To auto-start on boot:${NC}"
echo "  Add to ~/.bashrc:"
echo "  [ \"\$TTY\" = \"/dev/pts/0\" ] && cd ~/openx-mcp && ./start.sh &"
echo ""
