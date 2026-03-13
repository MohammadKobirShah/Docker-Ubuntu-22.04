#!/bin/bash
set -e

# Start SSH service
service ssh start

# Start Filebrowser
filebrowser -r / -p 8080 &

# Start Wetty SSH
wetty --port 10000 &

# Start Node.js backend
node /backend.js &

# Start Nginx
service nginx start

# Keep container alive
tail -f /dev/null
