#!/bin/bash
# OpenX REST API Connection Test Script
# Usage: bash test-api.sh

# Default values (override with env vars)
BASE_URL="${OPENX_REST_BASE_URL:-https://zelapioffciall.dpdns.org/ai/sdk}"
API_KEY="${OPENX_REST_API_KEY:-}"
MODEL="${OPENX_REST_MODEL:-deepseek/deepseek-v4-pro}"
METHOD="${OPENX_REST_METHOD:-GET}"
PARAM_NAME="${OPENX_REST_PARAM_NAME:-text}"
APIKEY_PARAM="${OPENX_REST_APIKEY_PARAM:-apikey}"

echo "=================================="
echo "  OpenX REST API Connection Test"
echo "=================================="
echo ""
echo "[Config]"
echo "  Base URL:     $BASE_URL"
echo "  API Key:      ${API_KEY:0:8}...${API_KEY:+(set)}"
[ -z "$API_KEY" ] && echo "  API Key:      (EMPTY - not set!)"
echo "  Model:        $MODEL"
echo "  Method:       $METHOD"
echo "  Param Name:   $PARAM_NAME"
echo "  ApiKey Param: $APIKEY_PARAM"
echo ""

# URL encode function
urlencode() {
    local string="$1"
    python3 -c "import urllib.parse; print(urllib.parse.quote('$string'))" 2>/dev/null || \
    node -e "console.log(encodeURIComponent('$string'))" 2>/dev/null || \
    echo "$string"
}

# Step 1: Test basic connectivity
echo "[1/3] Testing basic connectivity..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 "$BASE_URL" 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "  FAIL: Cannot connect to server"
    echo "  Check your network connection"
    exit 1
fi
echo "  OK: Server responded (HTTP $HTTP_CODE)"
echo ""

# Step 2: Test GET request
echo "[2/3] Testing GET request..."
TEST_PROMPT="Hello, respond with just OK"

ENCODED_PROMPT=$(urlencode "$TEST_PROMPT")
if [ "$METHOD" = "GET" ]; then
    REQUEST_URL="${BASE_URL}?${PARAM_NAME}=${ENCODED_PROMPT}&model=${MODEL}"
    [ -n "$API_KEY" ] && REQUEST_URL="${REQUEST_URL}&${APIKEY_PARAM}=${API_KEY}"
    
    echo "  URL: $REQUEST_URL" | head -c 200
    echo ""
    
    RESPONSE=$(curl -s --connect-timeout 10 --max-time 60 \
        "$REQUEST_URL" \
        -H "Accept: application/json" 2>/dev/null)
    
    if [ -n "$RESPONSE" ]; then
        echo "  Response (${#RESPONSE} bytes): ${RESPONSE:0:200}"
        echo ""
        if echo "$RESPONSE" | grep -qi "error"; then
            echo "  WARN: Response contains error"
        else
            echo "  OK: GET request successful"
        fi
    else
        echo "  FAIL: Empty response"
    fi
else
    echo "  SKIP: Method is POST"
fi
echo ""

# Step 3: Test POST request
echo "[3/3] Testing POST request..."
JSON_PAYLOAD=$(cat <<EOF
{
    "${PARAM_NAME}": "${TEST_PROMPT}",
    "model": "${MODEL}",
    "${APIKEY_PARAM}": "${API_KEY}"
}
EOF
)

echo "  Payload: ${JSON_PAYLOAD:0:200}"
echo ""

POST_RESPONSE=$(curl -s --connect-timeout 10 --max-time 60 \
    -X POST "$BASE_URL" \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" 2>/dev/null)

if [ -n "$POST_RESPONSE" ]; then
    echo "  Response (${#POST_RESPONSE} bytes): ${POST_RESPONSE:0:200}"
    echo ""
    if echo "$POST_RESPONSE" | grep -qi "error"; then
        echo "  WARN: Response contains error"
    else
        echo "  OK: POST request successful"
    fi
else
    echo "  FAIL: No response from POST request"
fi
echo ""

# Summary
echo "=================================="
echo "  Test Complete"
echo "=================================="
echo ""
echo "If you see errors above:"
echo "  1. Check if OPENX_REST_API_KEY is set correctly"
echo "  2. Verify the API endpoint URL"
echo "  3. Check if the server is running"
echo ""
echo "Quick fix - set env vars in Termux:"
echo "  export OPENX_REST_API_KEY='your-api-key'"
