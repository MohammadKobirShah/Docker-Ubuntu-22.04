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
