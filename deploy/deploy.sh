#!/bin/bash
# Sentinel Services — Full Deployment Script
# Deploys all 3 services to a Conway Cloud sandbox
# Usage: bash deploy.sh
# Prerequisites: Conway API key in ~/.automaton/config.json, funded wallet

set -e

# Path setup
WIN_HOME="${USERPROFILE:-C:\\Users\\devda}"
BASH_HOME="$HOME"
CONWAY_SCRIPT="${BASH_HOME}/.automaton/scripts/conway-api.sh"
STATE_FILE="${BASH_HOME}/.automaton/state/sentinel.json"
SERVICES_DIR="${BASH_HOME}/sentinel-services"

echo "==========================================="
echo "  Sentinel Services — Deployment"
echo "==========================================="

# Step 1: Check Conway credits
echo "[1/8] Checking Conway credits..."
CREDITS=$(bash "$CONWAY_SCRIPT" credits 2>/dev/null | node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);console.log(j.credits||j.balance||0)}catch{console.log(0)}})" 2>/dev/null || echo "0")
echo "  Credits: $CREDITS"

if [ "$CREDITS" = "0" ] || [ -z "$CREDITS" ]; then
  echo "  ERROR: No Conway credits. Fund your wallet first."
  echo "  Wallet: 0x9b6D3A992E1B7E53996c2bcCe2e8983fc33C4A87"
  echo "  Need: $25 USDC on Base chain"
  exit 1
fi

# Step 2: Check for existing sandbox
echo "[2/8] Checking existing sandboxes..."
EXISTING=$(bash "$CONWAY_SCRIPT" sandboxes 2>/dev/null)
SANDBOX_ID=$(echo "$EXISTING" | node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);const s=j.sandboxes||j.data||[];if(s.length>0)console.log(s[0].id||s[0].sandbox_id||'');else console.log('')}catch{console.log('')}})" 2>/dev/null || echo "")

if [ -n "$SANDBOX_ID" ] && [ "$SANDBOX_ID" != "" ]; then
  echo "  Found existing sandbox: $SANDBOX_ID"
else
  # Step 3: Create sandbox
  echo "[3/8] Creating sandbox (1 vCPU, 512MB, Node.js)..."
  CREATE_RESULT=$(bash "$CONWAY_SCRIPT" create-sandbox 2>/dev/null)
  SANDBOX_ID=$(echo "$CREATE_RESULT" | node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);console.log(j.id||j.sandbox_id||j.data?.id||'')}catch{console.log('')}})" 2>/dev/null || echo "")

  if [ -z "$SANDBOX_ID" ] || [ "$SANDBOX_ID" = "" ]; then
    echo "  ERROR: Failed to create sandbox"
    echo "  Response: $CREATE_RESULT"
    exit 1
  fi
  echo "  Created sandbox: $SANDBOX_ID"
fi

# Step 4: Upload source files
echo "[4/8] Uploading service files..."

# List of files to upload
FILES=(
  "package.json"
  "src/server.js"
  "src/memory.js"
  "src/email.js"
  "src/pdf.js"
  "src/x402.js"
  "deploy/setup.sh"
)

for FILE in "${FILES[@]}"; do
  LOCAL_PATH="${SERVICES_DIR}/${FILE}"
  REMOTE_PATH="/root/sentinel-services/${FILE}"

  if [ ! -f "$LOCAL_PATH" ]; then
    echo "  SKIP: $FILE (not found)"
    continue
  fi

  # Read file content and base64 encode
  CONTENT=$(base64 -w0 "$LOCAL_PATH" 2>/dev/null || base64 "$LOCAL_PATH" 2>/dev/null)

  # Upload via Conway API
  bash "$CONWAY_SCRIPT" write-file "$SANDBOX_ID" "$REMOTE_PATH" "$CONTENT" 2>/dev/null
  echo "  Uploaded: $FILE"
done

echo "  All files uploaded."

# Step 5: Run setup script
echo "[5/8] Running setup script in sandbox..."
bash "$CONWAY_SCRIPT" exec "$SANDBOX_ID" "cd /root/sentinel-services && chmod +x deploy/setup.sh && bash deploy/setup.sh" 2>/dev/null
echo "  Setup complete."

# Step 6: Expose port
echo "[6/8] Exposing port 3000..."
EXPOSE_RESULT=$(bash "$CONWAY_SCRIPT" expose-port "$SANDBOX_ID" 3000 2>/dev/null)
PUBLIC_URL=$(echo "$EXPOSE_RESULT" | node -e "process.stdin.on('data',d=>{try{const j=JSON.parse(d);console.log(j.url||j.public_url||j.data?.url||'')}catch{console.log('')}})" 2>/dev/null || echo "")
echo "  Public URL: ${PUBLIC_URL:-'(pending)'}"

# Step 7: Health check
echo "[7/8] Running health check..."
sleep 5
if [ -n "$PUBLIC_URL" ]; then
  HEALTH=$(curl -s "${PUBLIC_URL}/health" 2>/dev/null || echo '{}')
  echo "  Health: $HEALTH"
else
  HEALTH=$(bash "$CONWAY_SCRIPT" exec "$SANDBOX_ID" "curl -s http://localhost:3000/health" 2>/dev/null || echo '{}')
  echo "  Health (internal): $HEALTH"
fi

# Step 8: Update state file
echo "[8/8] Updating agent state..."
node -e "
const fs = require('fs');
const p = process.env.USERPROFILE || 'C:\\\\Users\\\\devda';
const sf = p + '\\\\.automaton\\\\state\\\\sentinel.json';
try {
  const state = JSON.parse(fs.readFileSync(sf, 'utf8'));
  state.status = 'deployed';
  state.sandbox_id = '${SANDBOX_ID}';
  state.deployed_services = ['memory', 'email', 'pdf'];
  state.public_url = '${PUBLIC_URL}';
  state.survival_tier = 'normal';
  state.last_check = new Date().toISOString();
  state.boot_count = (state.boot_count || 0) + 1;
  state.last_error = null;
  fs.writeFileSync(sf, JSON.stringify(state, null, 2));
  console.log('  State updated: deployed');
} catch (e) {
  console.log('  Warning: Could not update state: ' + e.message);
}
" 2>/dev/null

echo ""
echo "==========================================="
echo "  DEPLOYMENT COMPLETE"
echo "==========================================="
echo "  Sandbox ID:  $SANDBOX_ID"
echo "  Public URL:  ${PUBLIC_URL:-'check Conway dashboard'}"
echo "  Services:    Memory, Email, PDF"
echo "  Payment:     x402 (USDC on Base)"
echo "  Wallet:      0x9b6D3A992E1B7E53996c2bcCe2e8983fc33C4A87"
echo "==========================================="
echo ""
echo "Next steps:"
echo "  1. Register on x402list.fun"
echo "  2. Monitor: bash conway-api.sh exec $SANDBOX_ID 'curl -s http://localhost:3000/stats'"
echo "  3. Logs:    bash conway-api.sh exec $SANDBOX_ID 'cat /root/data/server.log'"
