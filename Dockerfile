FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# ----------------------------
# Base deps + SSH + build tools
# ----------------------------
RUN apt update && apt install -y --no-install-recommends \
    curl wget git sudo bash openssh-server nginx ca-certificates \
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
# Install Filebrowser (Web File Manager)
# ----------------------------
RUN curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash

# ----------------------------
# Install Express for backend API
# ----------------------------
RUN npm install express

# ----------------------------
# Setup SSH
# ----------------------------
RUN mkdir -p /var/run/sshd && echo "root:root" | chpasswd

# ----------------------------
# Copy dashboard & scripts
# ----------------------------
COPY index.html /usr/share/nginx/html/index.html
COPY start.sh /start.sh
COPY backend.js /backend.js
COPY nginx.conf /etc/nginx/nginx.conf
RUN chmod +x /start.sh

# ----------------------------
# Expose port
# ----------------------------
EXPOSE 80

# ----------------------------
# Default command
# ----------------------------
CMD ["/start.sh"]
