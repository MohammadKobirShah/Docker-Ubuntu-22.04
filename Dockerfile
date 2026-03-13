FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# ── System packages ──
RUN apt-get update && apt-get install -y \
    curl wget git vim nano htop tmux screen \
    python3 python3-pip \
    build-essential ca-certificates gnupg \
    net-tools procps sudo lsof dnsutils \
    iputils-ping unzip jq openssh-client \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 ──
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Node deps ──
COPY package.json ./
RUN npm install --production

# ── Python deps ──
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# ── App files ──
COPY . .
RUN chmod +x start.sh

# ── Workspace ──
RUN mkdir -p /workspace /tmp/vps-logs \
    && echo 'cd /workspace' >> /root/.bashrc
ENV HOME=/workspace

EXPOSE 3000

CMD ["bash", "/app/start.sh"]
