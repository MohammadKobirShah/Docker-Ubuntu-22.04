

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
