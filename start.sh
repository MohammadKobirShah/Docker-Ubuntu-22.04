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
