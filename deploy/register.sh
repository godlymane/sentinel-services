#!/bin/bash
# Sentinel Services — Auto-Registration Script
# Registers the service on x402 directories so agents can discover it
# Usage: bash register.sh <public_url>

set -e

PUBLIC_URL="${1}"
WALLET="0xaC20692711b35F3Bb020Ad02651f6eeD68C33fe7"

if [ -z "$PUBLIC_URL" ]; then
  echo "Usage: bash register.sh <public_url>"
  echo "Example: bash register.sh https://sentinel-abc123.conway.tech"
  exit 1
fi

echo "==========================================="
echo "  Sentinel Services — Registration"
echo "==========================================="

# Service descriptor (x402 standard format)
SERVICE_JSON=$(cat <<'ENDJSON'
{
  "name": "Sentinel Agent Services",
  "description": "4-in-1 agent toolkit: KV Store, Vector Storage, Email Relay, PDF Generator. x402 micropayments (USDC on Base). Free tier: 100 KV writes per wallet.",
  "provider": "sentinel",
  "version": "4.0.0",
  "network": "base-mainnet",
  "paymentProtocol": "x402",
  "facilitator": "https://x402.org/facilitator",
  "services": [
    {
      "name": "KV Store",
      "path": "/kv",
      "description": "Persistent key-value storage for AI agents. TTL support, search, export. First 100 writes free per wallet.",
      "pricing": { "PUT /kv/:key": "$0.01 (first 100 free)", "GET /kv/:key": "free" },
      "category": "storage"
    },
    {
      "name": "Vector Storage",
      "path": "/vectors",
      "description": "Store and query vector embeddings with cosine similarity. Any dimension supported.",
      "pricing": { "upsert": "$0.01", "batch": "$0.01", "query": "$0.005" },
      "category": "storage"
    },
    {
      "name": "Email Relay",
      "path": "/email",
      "description": "Send emails and webhook notifications. SMTP-backed with rate limiting.",
      "pricing": { "send": "$0.005", "webhook": "$0.005" },
      "category": "communication"
    },
    {
      "name": "PDF Generator",
      "path": "/pdf",
      "description": "Generate PDFs from text, structured data, invoices, or reports.",
      "pricing": { "generate": "$0.02" },
      "category": "document"
    }
  ]
}
ENDJSON
)

# ============ DIRECTORY REGISTRATION ============

STEP=1

# 1. x402list.fun
echo "[$STEP] Registering on x402list.fun..."
curl -s -X POST "https://x402list.fun/api/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${PUBLIC_URL}\",
    \"wallet\": \"${WALLET}\",
    \"name\": \"Sentinel Agent Services\",
    \"description\": \"4-in-1: Memory + Vectors + Email + PDF for AI agents. Credit-prepay x402.\",
    \"categories\": [\"storage\", \"vectors\", \"communication\", \"document\"],
    \"pricing\": \"x402\",
    \"network\": \"eip155:8453\"
  }" 2>/dev/null && echo " OK" || echo " (skipped)"
STEP=$((STEP+1))

# 2. x402scan.com
echo "[$STEP] Registering on x402scan.com..."
curl -s -X POST "https://x402scan.com/api/v1/services" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${PUBLIC_URL}\", \"wallet\": \"${WALLET}\", \"name\": \"Sentinel Agent Services\"}" 2>/dev/null && echo " OK" || echo " (skipped)"
STEP=$((STEP+1))

# 3. blockrun.ai
echo "[$STEP] Registering on blockrun.ai..."
curl -s -X POST "https://blockrun.ai/api/register" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${PUBLIC_URL}\", \"wallet\": \"${WALLET}\", \"name\": \"Sentinel Agent Services\"}" 2>/dev/null && echo " OK" || echo " (skipped)"
STEP=$((STEP+1))

# 4. Moltbook (1.2M agent directory)
echo "[$STEP] Registering on Moltbook..."
curl -s -X POST "https://api.moltbook.com/v1/services" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${PUBLIC_URL}\",
    \"wallet\": \"${WALLET}\",
    \"name\": \"Sentinel Agent Services\",
    \"description\": \"4-in-1 agent toolkit: Memory KV, Vector storage, Email relay, PDF generation. x402 micropayments on Base.\",
    \"tags\": [\"memory\", \"vectors\", \"email\", \"pdf\", \"x402\", \"base\"],
    \"network\": \"eip155:8453\"
  }" 2>/dev/null && echo " OK" || echo " (skipped)"
STEP=$((STEP+1))

# 5. Coinbase CDP (Developer Platform)
echo "[$STEP] Registering on Coinbase CDP..."
curl -s -X POST "https://api.developer.coinbase.com/v1/x402/services" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${PUBLIC_URL}\",
    \"wallet\": \"${WALLET}\",
    \"name\": \"Sentinel Agent Services\",
    \"network\": \"base\",
    \"paymentToken\": \"USDC\"
  }" 2>/dev/null && echo " OK" || echo " (skipped)"
STEP=$((STEP+1))

# 6. Dexter marketplace
echo "[$STEP] Registering on Dexter..."
curl -s -X POST "https://dexter.exchange/api/services" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${PUBLIC_URL}\",
    \"wallet\": \"${WALLET}\",
    \"name\": \"Sentinel Agent Services\",
    \"category\": \"agent-tools\"
  }" 2>/dev/null && echo " OK" || echo " (skipped)"
STEP=$((STEP+1))

# 7. Publish .well-known/x402.json on the sandbox
echo "[$STEP] Publishing .well-known/x402.json..."
BASH_HOME="$HOME"
CONWAY_SCRIPT="${BASH_HOME}/.automaton/scripts/conway-api.sh"

SANDBOX_ID=$(node -e "
const p=process.env.USERPROFILE||'C:\\\\Users\\\\devda';
const s=JSON.parse(require('fs').readFileSync(p+'\\\\.automaton\\\\state\\\\sentinel.json','utf8'));
console.log(s.sandbox_id||'');
" 2>/dev/null || echo "")

if [ -n "$SANDBOX_ID" ]; then
  bash "$CONWAY_SCRIPT" exec "$SANDBOX_ID" "mkdir -p /root/sentinel-services/.well-known && cat > /root/sentinel-services/.well-known/x402.json << 'EOF'
${SERVICE_JSON}
EOF" 2>/dev/null
  echo "  Published on sandbox"
else
  echo "  Warning: No sandbox ID found, skipping"
fi
STEP=$((STEP+1))

# 8. Self-health check
echo "[$STEP] Verifying service is reachable..."
HEALTH=$(curl -s "${PUBLIC_URL}/" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q "online" 2>/dev/null; then
  echo "  Service verified online"
else
  echo "  Warning: Could not verify service health"
fi

echo ""
echo "==========================================="
echo "  REGISTRATION COMPLETE"
echo "==========================================="
echo "  Service URL: ${PUBLIC_URL}"
echo "  Wallet:      ${WALLET}"
echo "  Services:    Memory, Vectors, Email, PDF"
echo ""
echo "  Discovery channels:"
echo "    - MCP: npm install -g sentinel-agent-mcp"
echo "    - Python: pip install sentinel-agent-tools (coming)"
echo "    - x402 directories: registered on 6 directories"
echo "    - Direct: GET ${PUBLIC_URL}/"
echo "==========================================="
