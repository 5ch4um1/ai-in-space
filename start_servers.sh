#!/bin/bash

echo "Starting all Sentinel-2 servers..."

# TiTiler on port 8000
echo "Starting TiTiler server on port 8000..."
cd /home/duke/ai-in-space/sentinel2-node
source venv/bin/activate
python titiler_server.py > /tmp/titiler.log 2>&1 &
TITILER_PID=$!

sleep 3

# Main Node.js API server on port 3000
echo "Starting Node.js API server on port 3000..."
node server.js > /tmp/node.log 2>&1 &
NODE_PID=$!

sleep 2

# Satellite simulator on port 3001
echo "Starting Satellite Simulator on port 3001..."
node sat_server.js > /tmp/sat.log 2>&1 &
SAT_PID=$!

sleep 2

TITILER_ACTUAL=$(pgrep -f "titiler_server.py" | head -1)
NODE_ACTUAL=$(pgrep -f "node server.js" | head -1)
SAT_ACTUAL=$(pgrep -f "node sat_server.js" | head -1)

echo ""
echo "All servers started!"
echo "TiTiler:       ${TITILER_ACTUAL:-unknown} (http://localhost:8000 - for images)"
echo "API Server:    ${NODE_ACTUAL:-unknown} (http://localhost:3000)"
echo "Sat Simulator: ${SAT_ACTUAL:-unknown} (http://localhost:3001 - browser UI)"

echo ""
echo "To stop all servers:"
echo "  pkill -f titiler_server.py"
echo "  pkill -f 'node server.js'"
echo "  pkill -f 'node sat_server.js'"