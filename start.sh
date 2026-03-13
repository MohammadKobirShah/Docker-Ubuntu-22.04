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
# Start Web Terminal (ttyd)
# ----------------------------
echo "Starting ttyd..."
ttyd -p 10000 bash &

# ----------------------------
# Start SSHX
# ----------------------------
echo "Starting SSHX..."
sshx -q &

# ----------------------------
# Start Python backend (optional)
# ----------------------------
if [ -f /app/backend.py ]; then
    echo "Starting Python backend..."
    python3 /app/backend.py &
fi

wait
