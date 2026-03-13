FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ----------------------------
# Base deps + build tools
# ----------------------------
RUN apt update && apt install -y --no-install-recommends \
    curl wget git bash nginx ca-certificates \
    python3 python3-pip make g++ build-essential \
    && rm -rf /var/lib/apt/lists/*

# ----------------------------
# Install ttyd (Web Terminal)
# ----------------------------
RUN curl -L -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.4/ttyd.x86_64 \
    && chmod +x /usr/local/bin/ttyd

# ----------------------------
# Install Filebrowser (v2.61.2)
# ----------------------------
RUN curl -L -o /tmp/filebrowser.tar.gz \
    https://github.com/filebrowser/filebrowser/releases/download/v2.61.2/linux-amd64-filebrowser.tar.gz \
    && tar -xzvf /tmp/filebrowser.tar.gz -C /usr/local/bin \
    && rm -f /tmp/filebrowser.tar.gz \
    && chmod +x /usr/local/bin/filebrowser

# ----------------------------
# Install SSHX
# ----------------------------
RUN curl -sSf https://sshx.io/get | sh || echo "SSHX install failed, continuing"

# ----------------------------
# Setup Python backend
# ----------------------------
WORKDIR /app
RUN pip3 install psutil --no-cache-dir
COPY backend.py ./

# ----------------------------
# Copy dashboard / scripts / config
# ----------------------------
COPY index.html /usr/share/nginx/html/index.html
COPY start.sh /start.sh
COPY nginx.conf /etc/nginx/nginx.conf
RUN chmod +x /start.sh

# ----------------------------
# Expose ports
# ----------------------------
# nginx / Filebrowser
EXPOSE 80
# Wetty
EXPOSE 10000

# ----------------------------
# Start all-in-one
# ----------------------------
CMD ["/start.sh"]
