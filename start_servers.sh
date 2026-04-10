#!/bin/bash

# Start both TiTiler and Node.js servers

echo "Starting TiTiler server on port 8000..."
cd ~/sentinel2-node
source venv/bin/activate
python titiler_server.py > /tmp/titiler.log 2>&1 &
TITILER_PID=$!

sleep 3

echo "Starting Node.js server on port 3000..."
node server.js > /tmp/node.log 2>&1 &
NODE_PID=$!

sleep 2

# Get actual python and node PIDs (the ones actually listening)
TITILER_ACTUAL=$(pgrep -f "titiler_server.py" | head -1)
NODE_ACTUAL=$(pgrep -f "node server.js" | head -1)

echo "Servers started!"
echo "TiTiler: ${TITILER_ACTUAL:-unknown} (http://localhost:8000)"
echo "Node.js: ${NODE_ACTUAL:-unknown} (http://localhost:3000)"

echo ""
if [ -n "$TITILER_ACTUAL" ] && [ -n "$NODE_ACTUAL" ]; then
    echo "To stop servers:"
    echo "  kill $TITILER_ACTUAL $NODE_ACTUAL"
else
    echo "To stop servers:"
    echo "  pkill -f titiler_server.py"
    echo "  pkill -f 'node server.js'"
fi