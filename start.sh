#!/bin/bash

# ----------------------------
# Start nginx
# ----------------------------
echo "Starting nginx..."
nginx -g "daemon off;" &

# ----------------------------
# Start Filebrowser
# ----------------------------
echo "Starting Filebrowser..."
filebrowser -r / &

# ----------------------------
# Start Wetty (Web SSH)
# ----------------------------
echo "Starting Wetty..."
wetty --port 10000 &

# ----------------------------
# Start Node backend (optional)
# ----------------------------
if [ -f /app/backend.js ]; then
    echo "Starting Node backend..."
    node /app/backend.js &
fi

wait
