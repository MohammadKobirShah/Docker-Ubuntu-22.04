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
# Install Node.js 20 LTS
# ----------------------------
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt install -y nodejs \
    && node -v \
    && npm -v

# ----------------------------
# Install Wetty (Web SSH)
# ----------------------------
RUN npm install -g wetty

# ----------------------------
# Install Filebrowser (v2.61.2)
# ----------------------------
RUN curl -L -o /tmp/filebrowser.tar.gz \
    https://github.com/filebrowser/filebrowser/releases/download/v2.61.2/linux-amd64-filebrowser.tar.gz \
    && tar -xzvf /tmp/filebrowser.tar.gz -C /usr/local/bin \
    && rm -f /tmp/filebrowser.tar.gz \
    && chmod +x /usr/local/bin/filebrowser

# ----------------------------
# Optional Node backend
# ----------------------------
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY backend.js ./

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
