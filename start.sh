#!/bin/bash
set -e

# Start SSH
service ssh start

# Start services
filebrowser -r / -p 8080 &
wetty --port 10000 &

# Start Node.js backend for stats & control
node /backend.js &

# Start Nginx
service nginx start

# Keep container alive
tail -f /dev/null
