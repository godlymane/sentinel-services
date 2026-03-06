#!/bin/bash
# Sentinel Services — Conway Sandbox Setup Script
# This runs INSIDE the sandbox after files are uploaded

set -e

echo "[Sentinel] Setting up Node.js services..."

cd /root/sentinel-services

# Install dependencies
npm install --production 2>&1

# Create data directory
mkdir -p /root/data

# Set environment
export PORT=3000
export DB_PATH=/root/data/sentinel.db
export WALLET_ADDRESS="0x9b6D3A992E1B7E53996c2bcCe2e8983fc33C4A87"
export NODE_ENV=production

# Start server with auto-restart
echo "[Sentinel] Starting server..."
nohup node src/server.js > /root/data/server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > /root/data/server.pid

# Wait for startup
sleep 3

# Health check
if curl -s http://localhost:3000/health | grep -q "online"; then
  echo "[Sentinel] Server is ONLINE at port 3000"
  echo "[Sentinel] PID: $SERVER_PID"
else
  echo "[Sentinel] WARNING: Server may not have started correctly"
  cat /root/data/server.log
fi

# Create restart script
cat > /root/restart.sh << 'RESTART'
#!/bin/bash
kill $(cat /root/data/server.pid 2>/dev/null) 2>/dev/null || true
sleep 1
cd /root/sentinel-services
export PORT=3000 DB_PATH=/root/data/sentinel.db WALLET_ADDRESS="0x9b6D3A992E1B7E53996c2bcCe2e8983fc33C4A87" NODE_ENV=production
nohup node src/server.js > /root/data/server.log 2>&1 &
echo $! > /root/data/server.pid
echo "Restarted. PID: $(cat /root/data/server.pid)"
RESTART
chmod +x /root/restart.sh

# Create watchdog — auto-restarts server if it crashes
cat > /root/watchdog.sh << 'WATCHDOG'
#!/bin/bash
# Watchdog: checks server every 30s, restarts if down
while true; do
  sleep 30
  if ! curl -s http://localhost:3000/health | grep -q "online" 2>/dev/null; then
    echo "[Watchdog] $(date) Server down, restarting..."
    bash /root/restart.sh
    echo "[Watchdog] $(date) Restart triggered"
    sleep 10
  fi
done
WATCHDOG
chmod +x /root/watchdog.sh

# Start watchdog in background
nohup bash /root/watchdog.sh > /root/data/watchdog.log 2>&1 &
echo $! > /root/data/watchdog.pid
echo "[Sentinel] Watchdog started (PID: $!)"

echo "[Sentinel] Setup complete. Service ready with auto-recovery."
