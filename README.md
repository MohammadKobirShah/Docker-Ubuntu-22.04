

# 🚀 Free VPS with SSHX Terminal — Complete Deployment

## 📁 Project Structure

```
free-vps/
├── Dockerfile
├── start.sh
├── server.js
├── worker.py
├── package.json
├── requirements.txt
└── render.yaml
```

---

## 📄 All Files

### `Dockerfile`

```dockerfile
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
```

---

### `start.sh`

```bash
#!/bin/bash
# ═══════════════════════════════════════════
#  Free VPS — Start-up Orchestrator
# ═══════════════════════════════════════════

G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'
R='\033[0;31m'; B='\033[1m'; N='\033[0m'

banner() { echo -e "${C}${B}$1${N}"; }
ok()     { echo -e "  ${G}[✓]${N} $1"; }
info()   { echo -e "  ${Y}[*]${N} $1"; }
fail()   { echo -e "  ${R}[✗]${N} $1"; }

echo ""
banner "╔═══════════════════════════════════════════════╗"
banner "║          ⚡  FREE VPS — DEPLOYING …           ║"
banner "╚═══════════════════════════════════════════════╝"
echo ""

mkdir -p /tmp/vps-logs /workspace

# ────────────────────────────────────────────
# 1) Install SSHX
# ────────────────────────────────────────────
info "Installing SSHX …"

install_sshx() {
    curl -sSf https://sshx.io/get | sh 2>/dev/null && return 0
    wget -qO- https://sshx.io/get | sh 2>/dev/null && return 0
    return 1
}

if ! command -v sshx &>/dev/null; then
    if install_sshx; then
        ok "SSHX installed → $(which sshx)"
    else
        fail "SSHX installation failed"
    fi
else
    ok "SSHX already present → $(which sshx)"
fi

# ────────────────────────────────────────────
# 2) Start SSHX in background
# ────────────────────────────────────────────
info "Launching SSHX session …"

rm -f /tmp/sshx_url.txt
: > /tmp/sshx_output.txt

(
    sshx 2>&1 | while IFS= read -r line; do
        echo "$line" >> /tmp/sshx_output.txt
        echo "$line" >> /tmp/vps-logs/sshx.log
        if echo "$line" | grep -q "https://sshx.io"; then
            echo "$line" | grep -o 'https://sshx.io/[^ ]*' > /tmp/sshx_url.txt
        fi
    done
) &
disown

echo -n "  "
for i in $(seq 1 30); do
    if [ -s /tmp/sshx_url.txt ]; then
        echo ""
        ok "SSHX ready → ${B}$(cat /tmp/sshx_url.txt)${N}"
        break
    fi
    echo -n "·"
    sleep 1
done

if [ ! -s /tmp/sshx_url.txt ]; then
    echo ""
    info "SSHX URL pending — will capture in background"
fi

# ────────────────────────────────────────────
# 3) Python keep-alive worker
# ────────────────────────────────────────────
info "Starting keep-alive worker …"
python3 /app/worker.py >> /tmp/vps-logs/worker.log 2>&1 &
WORKER_PID=$!
echo $WORKER_PID > /tmp/worker.pid
ok "Worker started (PID $WORKER_PID)"

# ────────────────────────────────────────────
# 4) Write keep_alive.txt
# ────────────────────────────────────────────
info "Writing keep_alive.txt …"

SSHX_LINK=$(cat /tmp/sshx_url.txt 2>/dev/null || echo "pending")
cat > /tmp/keep_alive.txt <<EOF
══════════════════════════════════════════════
  FREE VPS — KEEP-ALIVE STATUS
══════════════════════════════════════════════
  Status    : ONLINE ✅
  Started   : $(date -u '+%Y-%m-%d %H:%M:%S UTC')
  SSHX      : $SSHX_LINK
  Worker    : PID $WORKER_PID
  Web Port  : ${PORT:-3000}
══════════════════════════════════════════════
EOF

ok "keep_alive.txt written"
echo ""
cat /tmp/keep_alive.txt
echo ""

# ────────────────────────────────────────────
# 5) Start Express web server (foreground)
# ────────────────────────────────────────────
info "Starting web server on port ${PORT:-3000} …"
echo ""
banner "╔═══════════════════════════════════════════════╗"
banner "║           ✅  DEPLOYMENT COMPLETE             ║"
banner "╠═══════════════════════════════════════════════╣"
banner "║  Web  → http://localhost:${PORT:-3000}              ║"
banner "║  SSHX → $(printf '%-36s' "$SSHX_LINK")║"
banner "║                                               ║"
banner "║  Visit your service URL — auto-redirects      ║"
banner "║  to the live SSHX terminal session.           ║"
banner "╚═══════════════════════════════════════════════╝"
echo ""

exec node /app/server.js
```

---

### `server.js`

```javascript
// ═══════════════════════════════════════════════
//  Free VPS — Web Server + Dashboard
// ═══════════════════════════════════════════════

const express = require("express");
const fs      = require("fs");
const os      = require("os");
const { execSync } = require("child_process");

const app  = express();
const PORT = process.env.PORT || 3000;
const BOOT = Date.now();

// ── helpers ───────────────────────────────────

function sshxUrl() {
  // 1. cached file
  try {
    const u = fs.readFileSync("/tmp/sshx_url.txt", "utf8").trim();
    if (u.startsWith("https://")) return u;
  } catch {}
  // 2. scan raw output
  try {
    const raw = fs.readFileSync("/tmp/sshx_output.txt", "utf8");
    const m   = raw.match(/https:\/\/sshx\.io\/\S+/);
    if (m) { fs.writeFileSync("/tmp/sshx_url.txt", m[0]); return m[0]; }
  } catch {}
  return null;
}

function uptime() {
  const d = Date.now() - BOOT;
  const h = Math.floor(d / 3.6e6);
  const m = Math.floor((d % 3.6e6) / 6e4);
  const s = Math.floor((d % 6e4) / 1e3);
  return `${h}h ${m}m ${s}s`;
}

function alive(name) {
  try { execSync(`pgrep -x ${name}`, { stdio: "pipe" }); return true; }
  catch { return false; }
}

function sysinfo() {
  let py = "N/A";
  try { py = execSync("python3 --version 2>&1").toString().trim(); } catch {}
  return {
    arch    : os.arch(),
    cpus    : os.cpus().length,
    memTotal: (os.totalmem() / 1048576)|0,
    memFree : (os.freemem() / 1048576)|0,
    node    : process.version,
    python  : py,
    host    : os.hostname(),
  };
}

// ── HTML dashboard ────────────────────────────

function html(autoRedirect) {
  const url  = sshxUrl();
  const sx   = alive("sshx");
  const wk   = alive("python3");
  const si   = sysinfo();
  const up   = uptime();

  const statusClass = url ? "on" : "wait";
  const statusText  = url ? "Connected" : "Connecting …";

  const urlBlock = url
    ? `<div class="url"><a href="${url}" target="_blank" rel="noopener">${url}</a></div>`
    : `<div class="url dim">Waiting for session URL …</div>`;

  const actionBlock = url
    ? `<a href="${url}" class="btn" target="_blank" rel="noopener">🖥️&ensp;OPEN TERMINAL</a>
       ${autoRedirect
         ? `<p class="sub" id="cd">Redirecting in <b id="t">5</b>s&ensp;·&ensp;<a onclick="cx()">cancel</a></p>`
         : `<p class="sub"><a href="/">Enable auto-redirect</a></p>`}`
    : `<button class="btn off" disabled>⏳&ensp;Starting SSHX …</button>
       <p class="sub blink">Refreshing automatically …</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>⚡ Free VPS</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>">
<style>
:root{--bg:#0a0e17;--card:#111827;--bdr:#1e3a5f;--acc:#00ff88;--txt:#d4d4d4;--dim:#555}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--txt);font-family:'SF Mono','Fira Code','Cascadia Code','Consolas',monospace;
min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.w{max-width:540px;width:100%;animation:up .5s ease}
@keyframes up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
h1{text-align:center;font-size:1.55rem;color:var(--acc);text-shadow:0 0 28px rgba(0,255,136,.2);margin-bottom:6px}
.tag{text-align:center;color:var(--dim);font-size:.72rem;margin-bottom:22px;letter-spacing:.5px}
.card{background:var(--card);border:1px solid var(--bdr);border-radius:14px;padding:18px 20px;margin-bottom:14px;
position:relative;overflow:hidden}
.card::after{content:'';position:absolute;inset:0;border-radius:14px;
background:linear-gradient(180deg,rgba(0,255,136,.03) 0%,transparent 40%);pointer-events:none}
.dots{display:flex;gap:7px;margin-bottom:12px}
.dots i{width:11px;height:11px;border-radius:50%;display:block}
.dr{background:#ff5f57}.dy{background:#febc2e}.dg{background:#28c840}
.row{display:flex;align-items:center;gap:9px;padding:4px 0;font-size:.86rem}
.ind{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.on{background:var(--acc);box-shadow:0 0 7px var(--acc)}
.off{background:#ff4444;box-shadow:0 0 7px #ff4444}
.wait{background:#f0a500;animation:p 1.1s infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.2}}
.pr{color:var(--acc);font-weight:700}
.url{background:#0d1117;padding:9px 13px;border-radius:8px;border:1px solid var(--bdr);
font-size:.82rem;word-break:break-all;margin:9px 0}
.url a{color:#58a6ff;text-decoration:none}
.url a:hover{text-decoration:underline;color:#8dc6ff}
.url.dim{color:var(--dim)}
.btn{display:block;width:100%;padding:15px;
background:linear-gradient(135deg,#00ff88 0%,#00cc6a 100%);
color:#0a0e17;text-align:center;text-decoration:none;
font-size:1.05rem;font-weight:800;letter-spacing:.4px;
border-radius:10px;border:none;cursor:pointer;
font-family:inherit;margin-bottom:8px;transition:.2s}
.btn:hover{transform:translateY(-2px);box-shadow:0 6px 28px rgba(0,255,136,.35)}
.btn:active{transform:none}
.btn.off{background:#1a1a2e;color:#555;cursor:wait;box-shadow:none;transform:none}
.sub{text-align:center;font-size:.76rem;color:var(--dim);margin-bottom:14px}
.sub a{color:#ff7b7b;cursor:pointer;text-decoration:none}
.sub a:hover{text-decoration:underline}
.blink .wait{display:inline-block;vertical-align:middle;width:7px;height:7px;border-radius:50%;margin-left:4px}
.sec{color:var(--acc);font-size:.68rem;text-transform:uppercase;letter-spacing:2.5px;
font-weight:700;margin:14px 0 7px}
.g{display:grid;grid-template-columns:90px 1fr;gap:2px 12px;font-size:.82rem}
.g .l{color:var(--dim)}.g .v{color:#8899aa}
.ft{text-align:center;margin-top:18px;font-size:.68rem;color:#333}
.ft a{color:#444;text-decoration:none;margin:0 5px}
.ft a:hover{color:var(--acc)}
@media(max-width:480px){h1{font-size:1.3rem}.btn{font-size:.95rem;padding:13px}}
</style>
</head>
<body>
<div class="w">
  <h1>⚡ FREE VPS TERMINAL</h1>
  <p class="tag">Secure browser-based shell access via SSHX</p>

  <div class="card">
    <div class="dots"><i class="dr"></i><i class="dy"></i><i class="dg"></i></div>
    <div class="row"><span class="pr">$</span> status --check</div>
    <div class="row"><span class="ind ${statusClass}"></span>${statusText}</div>
    ${urlBlock}
    <div class="row"><span class="ind ${wk?"on":"off"}"></span>Keep-Alive: ${wk?"Active":"Down"}</div>
    <div class="row"><span class="ind on"></span>Web Server: Running</div>
  </div>

  ${actionBlock}

  <div class="card">
    <div class="sec">System</div>
    <div class="g">
      <span class="l">OS</span>      <span class="v">Ubuntu 22.04</span>
      <span class="l">Arch</span>    <span class="v">${si.arch}</span>
      <span class="l">CPUs</span>    <span class="v">${si.cpus} core${si.cpus>1?"s":""}</span>
      <span class="l">Memory</span>  <span class="v">${si.memFree} / ${si.memTotal} MB</span>
      <span class="l">Node.js</span> <span class="v">${si.node}</span>
      <span class="l">Python</span>  <span class="v">${si.python}</span>
    </div>
    <div class="sec">Session</div>
    <div class="g">
      <span class="l">Uptime</span>  <span class="v" id="up">${up}</span>
      <span class="l">Host</span>    <span class="v">${si.host}</span>
    </div>
  </div>

  <div class="ft">
    <a href="/dashboard">dashboard</a>·<a href="/api/status">api</a>·<a href="/health">health</a><br>
    powered by <a href="https://sshx.io" target="_blank" style="color:#58a6ff">sshx.io</a>
  </div>
</div>

<script>
const U="${url||""}";
let no=false;
${url&&autoRedirect?`
let c=5;const iv=setInterval(()=>{if(no)return;c--;
const e=document.getElementById("t");if(e)e.textContent=c;
if(c<=0){clearInterval(iv);location.href=U}},1e3);`:""}
${!url?`setTimeout(()=>location.reload(),3e3);`:""}
function cx(){no=true;const e=document.getElementById("cd");
if(e)e.innerHTML='Cancelled · <a href="'+U+'" target="_blank" style="color:var(--acc)">open manually →</a>';}
setInterval(async()=>{try{const r=await fetch("/api/status"),d=await r.json();
const u=document.getElementById("up");if(u)u.textContent=d.uptime;
if(!U&&d.sshxUrl)location.reload();}catch{}},5e3);
</script>
</body></html>`;
}

// ── routes ─────────────────────────────────────

app.get("/", (req, res) => {
  res.send(html(req.query.noredirect === undefined));
});

app.get("/dashboard", (_req, res) => {
  res.send(html(false));
});

app.get("/terminal", (_req, res) => {
  const u = sshxUrl();
  if (u) return res.redirect(302, u);
  res.status(503).json({ error: "SSHX not ready", retry: true });
});

app.get("/api/status", (_req, res) => {
  res.json({
    status     : "online",
    sshxUrl    : sshxUrl(),
    sshxAlive  : alive("sshx"),
    workerAlive: alive("python3"),
    uptime     : uptime(),
    system     : sysinfo(),
    ts         : new Date().toISOString(),
  });
});

app.get("/api/sshx-url", (_req, res) => {
  const u = sshxUrl();
  res.json(u ? { url: u } : { url: null, ready: false });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: uptime(), ts: new Date().toISOString() });
});

app.get("/keep-alive", (_req, res) => {
  const now = new Date().toISOString();
  try {
    fs.writeFileSync("/tmp/keep_alive.txt",
      `Status: ALIVE ✅\nTime: ${now}\nUptime: ${uptime()}\nSSHX: ${sshxUrl()||"N/A"}\n`);
  } catch {}
  res.json({ alive: true, uptime: uptime(), ts: now });
});

// ── start ──────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[✓] Web server  → http://0.0.0.0:${PORT}`);
  console.log(`[✓] Terminal    → http://0.0.0.0:${PORT}/terminal`);
  console.log(`[✓] API         → http://0.0.0.0:${PORT}/api/status`);
});
```

---

### `worker.py`

```python
#!/usr/bin/env python3
"""
Free VPS — Keep-Alive & SSHX Monitor Worker
Runs in background:
  • Pings the web server every 4 min to prevent idle shutdown
  • Monitors SSHX and restarts it if it dies
  • Updates /tmp/keep_alive.txt
"""

import os, re, time, signal, subprocess
from datetime import datetime, timezone
from urllib.request import Request, urlopen

# ── config ──────────────────────────────────────

PORT           = os.environ.get("PORT", "3000")
SERVICE_URL    = os.environ.get("RENDER_EXTERNAL_URL") \
              or os.environ.get("RAILWAY_PUBLIC_DOMAIN") \
              or os.environ.get("SERVICE_URL", "")
PING_INTERVAL  = 240   # seconds
CHECK_INTERVAL = 30    # seconds

# ── helpers ─────────────────────────────────────

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def proc_alive(name):
    try:
        return subprocess.run(
            ["pgrep", "-x", name],
            capture_output=True, timeout=5
        ).returncode == 0
    except Exception:
        return False

def read_file(path):
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return ""

def get_url():
    txt = read_file("/tmp/sshx_url.txt").strip()
    if txt.startswith("https://"):
        return txt
    # try extracting from raw output
    raw = read_file("/tmp/sshx_output.txt")
    m = re.search(r"https://sshx\.io/\S+", raw)
    if m:
        url = m.group().rstrip(".,;)")
        with open("/tmp/sshx_url.txt", "w") as f:
            f.write(url)
        log(f"Captured SSHX URL → {url}")
        return url
    return None

# ── sshx restart ────────────────────────────────

def restart_sshx():
    log("↻ Restarting SSHX …")
    subprocess.run(["pkill", "-f", "sshx"], capture_output=True)
    time.sleep(2)

    try:
        os.remove("/tmp/sshx_url.txt")
    except OSError:
        pass
    open("/tmp/sshx_output.txt", "w").close()

    subprocess.Popen(
        "sshx 2>&1 | tee -a /tmp/sshx_output.txt",
        shell=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    for _ in range(30):
        time.sleep(1)
        url = get_url()
        if url:
            log(f"✓ SSHX restarted → {url}")
            return True

    log("⚠ SSHX started but URL not yet captured")
    return False

# ── keep-alive ping ─────────────────────────────

def ping():
    # local ping (keeps Express alive → counts as activity)
    try:
        req = Request(
            f"http://127.0.0.1:{PORT}/keep-alive",
            headers={"User-Agent": "VPS-Worker/1.0"},
        )
        urlopen(req, timeout=10)
        log("↑ ping local OK")
    except Exception as e:
        log(f"↑ ping local FAIL: {e}")

    # external ping (works on Render / Railway)
    if SERVICE_URL:
        base = SERVICE_URL if SERVICE_URL.startswith("http") else f"https://{SERVICE_URL}"
        try:
            req = Request(
                f"{base}/health",
                headers={"User-Agent": "VPS-Worker/1.0"},
            )
            urlopen(req, timeout=10)
            log("↑ ping external OK")
        except Exception as e:
            log(f"↑ ping external FAIL: {e}")

# ── status file ─────────────────────────────────

def write_status():
    sshx = get_url() or "pending"
    txt = (
        f"══════════════════════════════════════════\n"
        f"  FREE VPS — KEEP-ALIVE STATUS\n"
        f"══════════════════════════════════════════\n"
        f"  Checked : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        f"  Status  : ALIVE ✅\n"
        f"  SSHX    : {sshx}\n"
        f"  Worker  : Running (PID {os.getpid()})\n"
        f"══════════════════════════════════════════\n"
    )
    try:
        with open("/tmp/keep_alive.txt", "w") as f:
            f.write(txt)
    except Exception:
        pass

# ── main loop ───────────────────────────────────

def main():
    log("Keep-Alive worker started")
    log(f"  PORT          = {PORT}")
    log(f"  SERVICE_URL   = {SERVICE_URL or '(not set)'}")
    log(f"  PING_INTERVAL = {PING_INTERVAL}s")

    last_ping = 0.0

    while True:
        try:
            # try capturing URL if still missing
            get_url()

            # restart SSHX if dead
            if not proc_alive("sshx"):
                log("⚠ SSHX not running")
                restart_sshx()

            # periodic ping
            now = time.time()
            if now - last_ping >= PING_INTERVAL:
                ping()
                last_ping = now

            write_status()

        except Exception as e:
            log(f"✗ error: {e}")

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: (log("Shutting down …"), exit(0)))
    main()
```

---

### `package.json`

```json
{
  "name": "free-vps",
  "version": "1.0.0",
  "private": true,
  "description": "Free VPS with SSHX terminal — auto-redirect dashboard",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.21.0"
  }
}
```

---

### `requirements.txt`

```
requests>=2.31.0
```

---

### `render.yaml`

```yaml
services:
  - type: web
    name: free-vps-terminal
    env: docker
    plan: free
    healthCheckPath: /health
    envVars:
      - key: PORT
        value: "10000"
```

---

## 🚀 Deploy (pick one)

### Option A — Render (recommended free)

```bash
# 1. Push to GitHub
git init && git add -A && git commit -m "free-vps"
gh repo create free-vps --public --push

# 2. Go to https://render.com → New → Web Service
#    • Connect your repo
#    • Environment: Docker
#    • Plan: Free
#    • Click Deploy
```

### Option B — Railway

```bash
# Install CLI: npm i -g @railway/cli
railway login
railway init
railway up          # auto-detects Dockerfile
```

### Option C — Any Docker host

```bash
docker build -t free-vps .
docker run -d -p 3000:3000 --name vps free-vps

# open http://localhost:3000 → auto-redirects to SSHX
```

---

## ⚙️ How It Works

```
┌─────────────────────────────────────────────────┐
│                   Docker Container              │
│                                                 │
│  start.sh                                       │
│  ├─ installs sshx binary                       │
│  ├─ launches sshx → captures session URL       │
│  ├─ starts worker.py (keep-alive + monitor)    │
│  ├─ writes keep_alive.txt                      │
│  └─ exec server.js (foreground, keeps alive)   │
│                                                 │
│  server.js (Express :PORT)                      │
│  ├─ GET /           → dashboard + auto-redirect│
│  ├─ GET /terminal   → 302 → sshx URL          │
│  ├─ GET /dashboard  → dashboard (no redirect)  │
│  ├─ GET /api/status → JSON system info         │
│  ├─ GET /health     → health check             │
│  └─ GET /keep-alive → updates keep_alive.txt   │
│                                                 │
│  worker.py (background)                         │
│  ├─ pings /keep-alive every 4 min              │
│  ├─ pings external URL (Render/Railway)        │
│  ├─ monitors sshx, restarts if crashed         │
│  └─ updates /tmp/keep_alive.txt                │
│                                                 │
│  sshx (background)                              │
│  └─ provides https://sshx.io/s/xxxxx terminal  │
└─────────────────────────────────────────────────┘

User visits https://your-app.onrender.com
         ↓
    Dashboard loads (5s countdown)
         ↓
    Auto-redirect → https://sshx.io/s/xxxxx
         ↓
    Full terminal access in browser 🖥️
```

---

## 📌 Endpoints

| Route | Description |
|---|---|
| `/` | Dashboard + **auto-redirect** to SSHX in 5s |
| `/?noredirect` | Dashboard without redirect |
| `/dashboard` | Dashboard (never redirects) |
| `/terminal` | Immediate 302 redirect to SSHX |
| `/api/status` | JSON: sshxUrl, uptime, system info |
| `/api/sshx-url` | JSON: just the SSHX URL |
| `/health` | `{"status":"ok"}` |
| `/keep-alive` | Ping endpoint, updates keep_alive.txt |

---

## 🛡️ Keep It Alive

For **Render free tier** (sleeps after 15 min idle), add an external ping:

1. Go to [**cron-job.org**](https://cron-job.org) (free)
2. Create a job → URL: `https://your-app.onrender.com/health`
3. Schedule: every 5 minutes

The built-in Python worker also self-pings, but external pings are more reliable on Render.
