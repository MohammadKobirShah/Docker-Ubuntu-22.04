// ═══════════════════════════════════════════════════════════
//  HVM VPS CONTROL PANEL — Full Dashboard + API
// ═══════════════════════════════════════════════════════════

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const BOOT = Date.now();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Helpers ───────────────────────────────────────────────

function sshxUrl() {
  try {
    const u = fs.readFileSync("/tmp/sshx_url.txt", "utf8").trim();
    if (u.startsWith("https://")) return u;
  } catch {}
  try {
    const raw = fs.readFileSync("/tmp/sshx_output.txt", "utf8");
    const m = raw.match(/https:\/\/sshx\.io\/\S+/);
    if (m) {
      fs.writeFileSync("/tmp/sshx_url.txt", m[0]);
      return m[0];
    }
  } catch {}
  return null;
}

function uptimeStr() {
  const d = Date.now() - BOOT;
  const days = Math.floor(d / 864e5);
  const h = Math.floor((d % 864e5) / 36e5);
  const m = Math.floor((d % 36e5) / 6e4);
  const s = Math.floor((d % 6e4) / 1e3);
  return days > 0 ? `${days}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`;
}

function run(cmd, fallback = "N/A") {
  try {
    return execSync(cmd, { timeout: 5000, stdio: "pipe" }).toString().trim();
  } catch {
    return fallback;
  }
}

function procAlive(name) {
  return run(`pgrep -x ${name}`, "") !== "";
}

function getCpuUsage() {
  try {
    const load = os.loadavg();
    const cpus = os.cpus().length;
    return Math.min(100, Math.round((load[0] / cpus) * 100));
  } catch {
    return 0;
  }
}

function getDisk() {
  const raw = run("df -h / | tail -1", "");
  if (!raw) return { total: "N/A", used: "N/A", free: "N/A", pct: 0 };
  const p = raw.split(/\s+/);
  return {
    total: p[1] || "N/A",
    used: p[2] || "N/A",
    free: p[3] || "N/A",
    pct: parseInt(p[4]) || 0,
  };
}

function getProcesses() {
  const raw = run("ps aux --sort=-%mem | head -20", "");
  if (!raw) return [];
  return raw
    .split("\n")
    .slice(1)
    .map((l) => {
      const p = l.split(/\s+/);
      return {
        user: p[0],
        pid: p[1],
        cpu: p[2],
        mem: p[3],
        vsz: p[4],
        rss: p[5],
        stat: p[7],
        time: p[9],
        cmd: p.slice(10).join(" ").substring(0, 60),
      };
    })
    .filter((p) => p.pid);
}

function getNetwork() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs) {
      if (!a.internal) {
        result.push({
          iface: name,
          addr: a.address,
          family: a.family,
          mac: a.mac,
        });
      }
    }
  }
  return result;
}

function getConnections() {
  const raw = run("ss -tuln 2>/dev/null | tail -20", "");
  if (!raw) return [];
  return raw
    .split("\n")
    .slice(1)
    .map((l) => {
      const p = l.split(/\s+/);
      return { proto: p[0], state: p[1], local: p[4], peer: p[5] };
    })
    .filter((c) => c.proto);
}

function listDir(dir) {
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    return items
      .map((i) => {
        let stat;
        try {
          stat = fs.statSync(path.join(dir, i.name));
        } catch {
          stat = { size: 0, mtime: new Date() };
        }
        return {
          name: i.name,
          isDir: i.isDirectory(),
          size: stat.size,
          modified: stat.mtime,
          perms: run(
            `stat -c '%a' "${path.join(dir, i.name)}" 2>/dev/null`,
            "---"
          ),
        };
      })
      .sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function getLogs(file, lines = 50) {
  try {
    return run(`tail -n ${lines} "${file}" 2>/dev/null`, "No logs available");
  } catch {
    return "No logs available";
  }
}

function getPackages() {
  const raw = run("dpkg --list 2>/dev/null | tail -30", "");
  if (!raw) return [];
  return raw
    .split("\n")
    .map((l) => {
      const p = l.split(/\s+/);
      if (p[0] === "ii")
        return { name: p[1], version: p[2], desc: p.slice(4).join(" ") };
      return null;
    })
    .filter(Boolean)
    .slice(0, 25);
}

// ═══════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════

app.get("/api/status", (_req, res) => {
  const disk = getDisk();
  res.json({
    status: "online",
    sshxUrl: sshxUrl(),
    sshx: procAlive("sshx"),
    worker: procAlive("python3"),
    uptime: uptimeStr(),
    cpu: getCpuUsage(),
    mem: {
      total: (os.totalmem() / 1048576) | 0,
      free: (os.freemem() / 1048576) | 0,
      used: ((os.totalmem() - os.freemem()) / 1048576) | 0,
      pct: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
    },
    disk,
    loadavg: os.loadavg(),
    hostname: os.hostname(),
    arch: os.arch(),
    platform: os.platform(),
    cpus: os.cpus().length,
    node: process.version,
    python: run("python3 --version 2>&1"),
    kernel: run("uname -r"),
    ts: new Date().toISOString(),
  });
});

app.get("/api/processes", (_req, res) => res.json(getProcesses()));

app.post("/api/kill/:pid", (req, res) => {
  const { pid } = req.params;
  const sig = req.body.signal || "TERM";
  const r = run(`kill -${sig} ${pid} 2>&1`, "failed");
  res.json({ ok: r !== "failed", result: r, pid, signal: sig });
});

app.get("/api/network", (_req, res) => {
  res.json({ interfaces: getNetwork(), connections: getConnections() });
});

app.get("/api/files", (req, res) => {
  const dir = req.query.path || "/workspace";
  res.json({ path: dir, items: listDir(dir) });
});

app.get("/api/file-content", (req, res) => {
  const f = req.query.path;
  if (!f) return res.status(400).json({ error: "path required" });
  try {
    const stat = fs.statSync(f);
    if (stat.size > 1048576)
      return res.status(413).json({ error: "File too large (>1MB)" });
    res.json({ path: f, content: fs.readFileSync(f, "utf8"), size: stat.size });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get("/api/logs", (req, res) => {
  const file = req.query.file || "/tmp/vps-logs/sshx.log";
  const lines = Math.min(parseInt(req.query.lines) || 50, 200);
  res.json({ file, content: getLogs(file, lines) });
});

app.get("/api/packages", (_req, res) => res.json(getPackages()));

app.post("/api/exec", (req, res) => {
  const { cmd } = req.body;
  if (!cmd) return res.status(400).json({ error: "cmd required" });
  const out = run(cmd, "[error]");
  res.json({ cmd, output: out });
});

app.get("/api/sshx-url", (_req, res) => {
  const u = sshxUrl();
  res.json(u ? { url: u, ready: true } : { url: null, ready: false });
});

app.post("/api/sshx/restart", (_req, res) => {
  run("pkill -f sshx");
  setTimeout(() => {
    exec(
      "sshx 2>&1 | tee -a /tmp/sshx_output.txt &",
      { shell: "/bin/bash" },
      () => {}
    );
  }, 1000);
  res.json({ ok: true, msg: "SSHX restarting…" });
});

app.get("/health", (_req, res) =>
  res.json({ status: "ok", uptime: uptimeStr() })
);
app.get("/keep-alive", (_req, res) =>
  res.json({ alive: true, uptime: uptimeStr(), ts: new Date().toISOString() })
);
app.get("/terminal", (_req, res) => {
  const u = sshxUrl();
  if (u) return res.redirect(302, u);
  res.status(503).json({ error: "SSHX not ready" });
});

// ═══════════════════════════════════════════════════════════
//  MAIN DASHBOARD  (  / and /dashboard  )
// ═══════════════════════════════════════════════════════════

app.get("/", (req, res) => {
  const autoRedirect =
    req.query.noredirect === undefined && req.query.panel === undefined;
  const url = sshxUrl();
  if (autoRedirect && url) return res.redirect(302, url);
  res.send(dashboardHTML());
});

app.get("/dashboard", (_req, res) => res.send(dashboardHTML()));

function dashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HVM VPS — Control Panel</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🖥️</text></svg>">
<style>
:root {
  --bg: #0b0e14;
  --sidebar: #0d1117;
  --card: #131820;
  --card-hover: #171e28;
  --border: #1b2838;
  --accent: #00ff88;
  --accent2: #58a6ff;
  --accent3: #ff7b72;
  --accent4: #d29922;
  --accent5: #bc8cff;
  --text: #c9d1d9;
  --dim: #484f58;
  --muted: #6e7681;
  --success: #2ea043;
  --danger: #da3633;
  --warn: #d29922;
  --input-bg: #0d1117;
  --scroll: #222;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg); color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  display: flex; min-height: 100vh;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scroll); border-radius: 3px; }

/* ── Sidebar ── */
.sidebar {
  width: 240px; background: var(--sidebar); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; position: fixed; top: 0; left: 0;
  height: 100vh; z-index: 100; transition: transform .3s;
}
.sidebar-brand {
  padding: 20px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px;
}
.sidebar-brand .logo {
  width: 38px; height: 38px; background: linear-gradient(135deg, var(--accent), #00cc6a);
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
  font-size: 18px; color: var(--bg); font-weight: 900;
}
.sidebar-brand h2 { font-size: .95rem; color: #fff; }
.sidebar-brand small { font-size: .65rem; color: var(--dim); display: block; margin-top: 2px; }
.sidebar nav { flex: 1; overflow-y: auto; padding: 8px 0; }
.sidebar .nav-section {
  padding: 12px 20px 6px; font-size: .65rem; text-transform: uppercase;
  letter-spacing: 1.5px; color: var(--dim); font-weight: 700;
}
.sidebar .nav-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 20px;
  color: var(--muted); text-decoration: none; font-size: .85rem;
  border-left: 3px solid transparent; transition: all .15s; cursor: pointer;
}
.sidebar .nav-item:hover { color: var(--text); background: rgba(255,255,255,.03); }
.sidebar .nav-item.active {
  color: var(--accent); background: rgba(0,255,136,.05);
  border-left-color: var(--accent);
}
.sidebar .nav-item .icon { font-size: 1.05rem; width: 22px; text-align: center; }
.sidebar .nav-badge {
  margin-left: auto; background: var(--accent); color: var(--bg);
  font-size: .6rem; padding: 2px 7px; border-radius: 10px; font-weight: 700;
}
.sidebar-footer {
  padding: 14px 20px; border-top: 1px solid var(--border);
  display: flex; align-items: center; gap: 10px;
}
.avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  display: flex; align-items: center; justify-content: center;
  font-size: .7rem; color: #fff; font-weight: 700;
}
.sidebar-footer .info .name { font-size: .78rem; color: var(--text); }
.sidebar-footer .info .role { font-size: .6rem; color: var(--dim); }

/* ── Main ── */
.main { margin-left: 240px; flex: 1; min-height: 100vh; }
.topbar {
  position: sticky; top: 0; z-index: 50; background: rgba(11,14,20,.85);
  backdrop-filter: blur(12px); border-bottom: 1px solid var(--border);
  padding: 12px 28px; display: flex; align-items: center; justify-content: space-between;
}
.topbar-left { display: flex; align-items: center; gap: 14px; }
.hamburger {
  display: none; background: none; border: none; color: var(--text);
  font-size: 1.3rem; cursor: pointer;
}
.breadcrumb { font-size: .82rem; color: var(--dim); }
.breadcrumb span { color: var(--text); }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.top-btn {
  background: var(--card); border: 1px solid var(--border); color: var(--text);
  padding: 6px 14px; border-radius: 8px; font-size: .78rem; cursor: pointer;
  transition: all .15s; font-family: inherit;
}
.top-btn:hover { border-color: var(--accent); color: var(--accent); }
.top-btn.primary {
  background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 700;
}
.top-btn.primary:hover { background: #00e07a; }
.status-pill {
  display: flex; align-items: center; gap: 6px; font-size: .78rem;
  padding: 5px 12px; border-radius: 20px; font-weight: 600;
}
.status-pill.online { background: rgba(46,160,67,.15); color: #3fb950; }
.status-pill.offline { background: rgba(218,54,51,.15); color: #f85149; }
.status-pill .dot {
  width: 7px; height: 7px; border-radius: 50%; background: currentColor;
  animation: pulse 2s infinite;
}
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

.content { padding: 24px 28px; }

/* ── Pages ── */
.page { display: none; animation: fadeUp .3s ease; }
.page.active { display: block; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

/* ── Cards ── */
.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card {
  background: var(--card); border: 1px solid var(--border); border-radius: 12px;
  padding: 18px 20px; transition: all .2s; position: relative; overflow: hidden;
}
.stat-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.stat-card .sc-head { display: flex; justify-content: space-between; align-items: flex-start; }
.stat-card .sc-icon {
  width: 40px; height: 40px; border-radius: 10px; display: flex;
  align-items: center; justify-content: center; font-size: 1.1rem;
}
.stat-card .sc-label { font-size: .72rem; color: var(--dim); text-transform: uppercase; letter-spacing: .8px; }
.stat-card .sc-value { font-size: 1.65rem; font-weight: 700; color: #fff; margin: 6px 0 4px; }
.stat-card .sc-sub { font-size: .72rem; color: var(--muted); }
.sc-bar { height: 4px; background: var(--border); border-radius: 2px; margin-top: 10px; overflow: hidden; }
.sc-bar-fill { height: 100%; border-radius: 2px; transition: width .5s; }

.panel {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; margin-bottom: 20px; overflow: hidden;
}
.panel-head {
  padding: 14px 20px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.panel-head h3 { font-size: .9rem; color: #fff; display: flex; align-items: center; gap: 8px; }
.panel-head .ph-actions { display: flex; gap: 8px; }
.panel-body { padding: 16px 20px; }
.panel-body.no-pad { padding: 0; }

/* ── Table ── */
.tbl { width: 100%; border-collapse: collapse; font-size: .8rem; }
.tbl th {
  text-align: left; padding: 10px 14px; font-size: .68rem;
  text-transform: uppercase; letter-spacing: .8px; color: var(--dim);
  background: rgba(0,0,0,.2); border-bottom: 1px solid var(--border);
  font-weight: 600; position: sticky; top: 0;
}
.tbl td {
  padding: 9px 14px; border-bottom: 1px solid rgba(27,40,56,.5);
  vertical-align: middle;
}
.tbl tr:hover td { background: rgba(255,255,255,.02); }
.tbl .mono { font-family: 'SF Mono','Fira Code',monospace; font-size: .75rem; }

/* ── Tags / Badges ── */
.tag {
  display: inline-block; padding: 2px 8px; border-radius: 6px;
  font-size: .68rem; font-weight: 600;
}
.tag.green { background: rgba(46,160,67,.15); color: #3fb950; }
.tag.red { background: rgba(218,54,51,.15); color: #f85149; }
.tag.yellow { background: rgba(210,153,34,.15); color: #d29922; }
.tag.blue { background: rgba(88,166,255,.15); color: #58a6ff; }
.tag.purple { background: rgba(188,140,255,.15); color: #bc8cff; }

/* ── Buttons ── */
.btn {
  border: none; border-radius: 8px; padding: 8px 16px; font-size: .8rem;
  cursor: pointer; font-family: inherit; transition: all .15s; font-weight: 600;
}
.btn-sm { padding: 4px 10px; font-size: .72rem; border-radius: 6px; }
.btn-accent { background: var(--accent); color: var(--bg); }
.btn-accent:hover { background: #00e07a; transform: translateY(-1px); }
.btn-danger { background: rgba(218,54,51,.15); color: #f85149; border: 1px solid rgba(218,54,51,.3); }
.btn-danger:hover { background: rgba(218,54,51,.3); }
.btn-ghost { background: transparent; color: var(--muted); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--accent); color: var(--accent); }
.btn-blue { background: rgba(88,166,255,.15); color: #58a6ff; border: 1px solid rgba(88,166,255,.3); }
.btn-blue:hover { background: rgba(88,166,255,.3); }

/* ── Terminal Widget ── */
.terminal-widget {
  background: #000; border-radius: 10px; padding: 14px 18px;
  font-family: 'SF Mono','Fira Code',monospace; font-size: .8rem;
  color: #0f0; max-height: 300px; overflow-y: auto; line-height: 1.6;
  position: relative;
}
.terminal-widget .prompt { color: var(--accent); }
.terminal-widget .output { color: #aaa; }

/* ── Quick-Run ── */
.qrun {
  display: flex; gap: 8px; margin-top: 12px;
}
.qrun input {
  flex: 1; background: var(--input-bg); border: 1px solid var(--border);
  color: var(--text); padding: 10px 14px; border-radius: 8px;
  font-family: 'SF Mono','Fira Code',monospace; font-size: .82rem;
}
.qrun input:focus { outline: none; border-color: var(--accent); }

/* ── File Browser ── */
.file-path {
  display: flex; align-items: center; gap: 6px; margin-bottom: 12px;
  background: var(--input-bg); padding: 8px 12px; border-radius: 8px;
  border: 1px solid var(--border);
}
.file-path input {
  flex: 1; background: transparent; border: none; color: var(--text);
  font-family: 'SF Mono','Fira Code',monospace; font-size: .82rem;
}
.file-path input:focus { outline: none; }
.file-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 14px;
  border-bottom: 1px solid rgba(27,40,56,.3); cursor: pointer;
  transition: background .1s; font-size: .82rem;
}
.file-item:hover { background: rgba(255,255,255,.03); }
.file-item .fi-icon { font-size: 1rem; width: 22px; text-align: center; }
.file-item .fi-name { flex: 1; }
.file-item .fi-meta { color: var(--dim); font-size: .72rem; }

/* ── Log Viewer ── */
.log-viewer {
  background: #000; padding: 14px; border-radius: 8px;
  font-family: 'SF Mono','Fira Code',monospace; font-size: .72rem;
  color: #888; max-height: 400px; overflow: auto; line-height: 1.7;
  white-space: pre-wrap; word-break: break-all;
}

/* ── Charts (CSS) ── */
.chart-row { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.mini-chart { flex: 1; min-width: 200px; }
.mini-chart h4 { font-size: .75rem; color: var(--dim); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .8px; }
.bar-chart { display: flex; flex-direction: column; gap: 6px; }
.bar-row { display: flex; align-items: center; gap: 10px; font-size: .78rem; }
.bar-row .bar-label { width: 60px; color: var(--muted); text-align: right; }
.bar-row .bar-track { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
.bar-row .bar-val { height: 100%; border-radius: 4px; transition: width .5s; }
.bar-row .bar-pct { width: 40px; color: var(--text); font-weight: 600; font-size: .72rem; }

/* ── SSHX Card ── */
.sshx-card {
  background: linear-gradient(135deg, rgba(0,255,136,.06), rgba(88,166,255,.06));
  border: 1px solid rgba(0,255,136,.2); border-radius: 14px;
  padding: 24px; text-align: center; margin-bottom: 20px;
}
.sshx-card h3 { color: var(--accent); font-size: 1.1rem; margin-bottom: 6px; }
.sshx-card .sshx-url {
  background: rgba(0,0,0,.3); padding: 12px; border-radius: 8px;
  font-family: 'SF Mono','Fira Code',monospace; font-size: .88rem;
  color: var(--accent2); margin: 14px 0; word-break: break-all;
}
.sshx-card .sshx-url a { color: var(--accent2); text-decoration: none; }
.sshx-card .sshx-url a:hover { text-decoration: underline; }
.sshx-btns { display: flex; gap: 10px; justify-content: center; margin-top: 14px; flex-wrap: wrap; }

/* ── Responsive ── */
@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
  .main { margin-left: 0; }
  .hamburger { display: block; }
  .cards-grid { grid-template-columns: 1fr 1fr; }
  .content { padding: 16px; }
}
@media (max-width: 480px) {
  .cards-grid { grid-template-columns: 1fr; }
  .chart-row { flex-direction: column; }
}

/* ── Spinner ── */
.spin { display: inline-block; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Toast ── */
.toast-container { position: fixed; bottom: 20px; right: 20px; z-index: 9999; }
.toast {
  background: var(--card); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px 18px; margin-top: 8px; font-size: .82rem;
  display: flex; align-items: center; gap: 10px; animation: slideIn .3s;
  box-shadow: 0 8px 32px rgba(0,0,0,.4);
}
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } }
.toast.success { border-left: 3px solid var(--success); }
.toast.error { border-left: 3px solid var(--danger); }
</style>
</head>
<body>

<!-- ── Sidebar ── -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-brand">
    <div class="logo">⚡</div>
    <div>
      <h2>HVM Panel</h2>
      <small>VPS Control Center</small>
    </div>
  </div>
  <nav>
    <div class="nav-section">Main</div>
    <a class="nav-item active" data-page="overview">
      <span class="icon">📊</span> Overview
    </a>
    <a class="nav-item" data-page="terminal">
      <span class="icon">🖥️</span> Terminal
      <span class="nav-badge" id="sshx-badge">SSHX</span>
    </a>
    <a class="nav-item" data-page="processes">
      <span class="icon">⚙️</span> Processes
    </a>

    <div class="nav-section">System</div>
    <a class="nav-item" data-page="monitoring">
      <span class="icon">📈</span> Monitoring
    </a>
    <a class="nav-item" data-page="network">
      <span class="icon">🌐</span> Network
    </a>
    <a class="nav-item" data-page="storage">
      <span class="icon">💾</span> Storage
    </a>

    <div class="nav-section">Tools</div>
    <a class="nav-item" data-page="files">
      <span class="icon">📁</span> File Manager
    </a>
    <a class="nav-item" data-page="logs">
      <span class="icon">📋</span> Logs
    </a>
    <a class="nav-item" data-page="packages">
      <span class="icon">📦</span> Packages
    </a>
    <a class="nav-item" data-page="console">
      <span class="icon">💻</span> Console
    </a>

    <div class="nav-section">Settings</div>
    <a class="nav-item" data-page="settings">
      <span class="icon">🔧</span> Settings
    </a>
  </nav>
  <div class="sidebar-footer">
    <div class="avatar">R</div>
    <div class="info">
      <div class="name">root</div>
      <div class="role">Administrator</div>
    </div>
  </div>
</aside>

<!-- ── Main Content ── -->
<div class="main">
  <div class="topbar">
    <div class="topbar-left">
      <button class="hamburger" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
      <div class="breadcrumb">HVM Panel / <span id="page-title">Overview</span></div>
    </div>
    <div class="topbar-right">
      <div class="status-pill online" id="status-pill">
        <span class="dot"></span>
        <span id="status-text">Online</span>
      </div>
      <button class="top-btn" onclick="refreshAll()">↻ Refresh</button>
      <button class="top-btn primary" onclick="openTerminal()">⚡ Terminal</button>
    </div>
  </div>

  <div class="content">

    <!-- ═══ OVERVIEW ═══ -->
    <div class="page active" id="page-overview">
      <div class="sshx-card">
        <h3>🖥️ SSHX Terminal Session</h3>
        <p style="color:var(--muted);font-size:.84rem;">Secure browser-based shell access</p>
        <div class="sshx-url" id="sshx-url-display">Loading…</div>
        <div class="sshx-btns">
          <button class="btn btn-accent" onclick="openTerminal()">🖥️ Open Terminal</button>
          <button class="btn btn-ghost" onclick="copyUrl()">📋 Copy URL</button>
          <button class="btn btn-danger btn-sm" onclick="restartSSHX()">↻ Restart SSHX</button>
        </div>
      </div>

      <div class="cards-grid" id="stat-cards">
        <!-- Filled by JS -->
      </div>

      <div class="chart-row">
        <div class="panel mini-chart" style="flex:1">
          <div class="panel-head"><h3>📊 Resource Usage</h3></div>
          <div class="panel-body">
            <div class="bar-chart" id="resource-bars"></div>
          </div>
        </div>
        <div class="panel mini-chart" style="flex:1">
          <div class="panel-head"><h3>📈 Load Average</h3></div>
          <div class="panel-body">
            <div class="bar-chart" id="load-bars"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>⚙️ Services</h3>
        </div>
        <div class="panel-body no-pad">
          <table class="tbl" id="services-table">
            <thead>
              <tr><th>Service</th><th>Status</th><th>Details</th><th>Action</th></tr>
            </thead>
            <tbody id="services-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ TERMINAL ═══ -->
    <div class="page" id="page-terminal">
      <div class="sshx-card" style="margin-bottom:20px">
        <h3>🖥️ Remote Terminal — SSHX</h3>
        <p style="color:var(--muted);font-size:.84rem">Click to open a full terminal session in your browser</p>
        <div class="sshx-url" id="sshx-url-terminal">Loading…</div>
        <div class="sshx-btns">
          <button class="btn btn-accent" style="font-size:1.1rem;padding:14px 36px" onclick="openTerminal()">🖥️ Launch Terminal</button>
          <button class="btn btn-ghost" onclick="copyUrl()">📋 Copy</button>
          <button class="btn btn-danger" onclick="restartSSHX()">↻ Restart</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>💻 Quick Command</h3></div>
        <div class="panel-body">
          <div class="qrun">
            <input type="text" id="quick-cmd" placeholder="Type a command and press Enter…"
              onkeydown="if(event.key==='Enter')runQuickCmd()">
            <button class="btn btn-accent" onclick="runQuickCmd()">Run ▶</button>
          </div>
          <div class="terminal-widget" id="quick-output" style="margin-top:12px">
            <span class="prompt">$</span> <span class="output">Ready for commands…</span>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>📖 Useful Commands</h3></div>
        <div class="panel-body">
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="runCmd('uname -a')">uname -a</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('free -h')">free -h</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('df -h')">df -h</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('top -bn1 | head -20')">top</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('whoami')">whoami</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('cat /etc/os-release')">OS info</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('ip addr show')">IP</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('ps aux --sort=-%mem | head -15')">ps</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('ls -la /workspace')">ls /workspace</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('env | sort')">env</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('python3 --version && node --version && npm --version')">versions</button>
            <button class="btn btn-ghost btn-sm" onclick="runCmd('curl -s ifconfig.me')">public IP</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ PROCESSES ═══ -->
    <div class="page" id="page-processes">
      <div class="panel">
        <div class="panel-head">
          <h3>⚙️ Process Manager</h3>
          <div class="ph-actions">
            <button class="btn btn-ghost btn-sm" onclick="loadProcesses()">↻ Refresh</button>
          </div>
        </div>
        <div class="panel-body no-pad" style="max-height:600px;overflow:auto">
          <table class="tbl">
            <thead>
              <tr><th>PID</th><th>User</th><th>CPU%</th><th>MEM%</th><th>Status</th><th>Time</th><th>Command</th><th></th></tr>
            </thead>
            <tbody id="proc-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ MONITORING ═══ -->
    <div class="page" id="page-monitoring">
      <div class="cards-grid" id="monitor-cards"></div>
      <div class="chart-row">
        <div class="panel" style="flex:1">
          <div class="panel-head"><h3>📊 CPU History</h3></div>
          <div class="panel-body">
            <canvas id="cpu-canvas" width="500" height="120" style="width:100%;height:120px"></canvas>
          </div>
        </div>
        <div class="panel" style="flex:1">
          <div class="panel-head"><h3>📊 Memory History</h3></div>
          <div class="panel-body">
            <canvas id="mem-canvas" width="500" height="120" style="width:100%;height:120px"></canvas>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>📋 System Information</h3></div>
        <div class="panel-body">
          <div id="sysinfo-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px"></div>
        </div>
      </div>
    </div>

    <!-- ═══ NETWORK ═══ -->
    <div class="page" id="page-network">
      <div class="panel">
        <div class="panel-head"><h3>🌐 Network Interfaces</h3></div>
        <div class="panel-body no-pad">
          <table class="tbl">
            <thead><tr><th>Interface</th><th>Address</th><th>Family</th><th>MAC</th></tr></thead>
            <tbody id="net-ifaces"></tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <h3>🔌 Listening Ports</h3>
          <div class="ph-actions"><button class="btn btn-ghost btn-sm" onclick="loadNetwork()">↻</button></div>
        </div>
        <div class="panel-body no-pad">
          <table class="tbl">
            <thead><tr><th>Protocol</th><th>State</th><th>Local Address</th><th>Peer</th></tr></thead>
            <tbody id="net-conn"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ STORAGE ═══ -->
    <div class="page" id="page-storage">
      <div class="cards-grid" id="storage-cards"></div>
      <div class="panel">
        <div class="panel-head"><h3>💾 Disk Usage</h3></div>
        <div class="panel-body">
          <div class="terminal-widget" id="disk-output" style="color:#aaa"></div>
        </div>
      </div>
    </div>

    <!-- ═══ FILE MANAGER ═══ -->
    <div class="page" id="page-files">
      <div class="panel">
        <div class="panel-head">
          <h3>📁 File Manager</h3>
          <div class="ph-actions">
            <button class="btn btn-ghost btn-sm" onclick="navigateTo(currentPath)">↻</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="file-path">
            <span>📂</span>
            <input type="text" id="path-input" value="/workspace"
              onkeydown="if(event.key==='Enter')navigateTo(this.value)">
            <button class="btn btn-ghost btn-sm" onclick="navigateTo(document.getElementById('path-input').value)">Go</button>
            <button class="btn btn-ghost btn-sm" onclick="goUp()">⬆ Up</button>
          </div>
          <div id="file-list"></div>
        </div>
      </div>
      <div class="panel" id="file-preview-panel" style="display:none">
        <div class="panel-head">
          <h3 id="preview-name">📄 File Preview</h3>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('file-preview-panel').style.display='none'">✕ Close</button>
        </div>
        <div class="panel-body">
          <div class="log-viewer" id="file-preview-content"></div>
        </div>
      </div>
    </div>

    <!-- ═══ LOGS ═══ -->
    <div class="page" id="page-logs">
      <div class="panel">
        <div class="panel-head">
          <h3>📋 Log Viewer</h3>
          <div class="ph-actions">
            <select id="log-select" class="top-btn" style="font-size:.75rem"
              onchange="loadLogs(this.value)">
              <option value="/tmp/vps-logs/sshx.log">SSHX Log</option>
              <option value="/tmp/vps-logs/worker.log">Worker Log</option>
              <option value="/tmp/keep_alive.txt">Keep Alive</option>
              <option value="/var/log/syslog">Syslog</option>
              <option value="/var/log/dpkg.log">DPKG Log</option>
            </select>
            <button class="btn btn-ghost btn-sm" onclick="loadLogs()">↻</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="log-viewer" id="log-content">Loading logs…</div>
        </div>
      </div>
    </div>

    <!-- ═══ PACKAGES ═══ -->
    <div class="page" id="page-packages">
      <div class="panel">
        <div class="panel-head">
          <h3>📦 Installed Packages</h3>
          <div class="ph-actions"><button class="btn btn-ghost btn-sm" onclick="loadPackages()">↻</button></div>
        </div>
        <div class="panel-body no-pad" style="max-height:500px;overflow:auto">
          <table class="tbl">
            <thead><tr><th>Package</th><th>Version</th><th>Description</th></tr></thead>
            <tbody id="pkg-body"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ═══ CONSOLE ═══ -->
    <div class="page" id="page-console">
      <div class="panel">
        <div class="panel-head">
          <h3>💻 Web Console</h3>
          <div class="ph-actions">
            <button class="btn btn-ghost btn-sm" onclick="clearConsole()">Clear</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="terminal-widget" id="console-output" style="min-height:350px;max-height:500px">
<span class="output">Welcome to HVM VPS Console
Type commands below and press Enter.
──────────────────────────────────────
</span></div>
          <div class="qrun">
            <span style="color:var(--accent);font-family:monospace;padding:10px 0">$</span>
            <input type="text" id="console-input" placeholder="Enter command…"
              onkeydown="if(event.key==='Enter')runConsole()">
            <button class="btn btn-accent" onclick="runConsole()">Run</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ SETTINGS ═══ -->
    <div class="page" id="page-settings">
      <div class="panel">
        <div class="panel-head"><h3>🔧 VPS Settings</h3></div>
        <div class="panel-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="stat-card">
              <div class="sc-label">SSHX Session</div>
              <p style="margin:10px 0;font-size:.82rem;color:var(--muted)">Restart the SSHX terminal session</p>
              <button class="btn btn-danger" onclick="restartSSHX()">↻ Restart SSHX</button>
            </div>
            <div class="stat-card">
              <div class="sc-label">Keep-Alive Status</div>
              <p style="margin:10px 0;font-size:.82rem;color:var(--muted)">Force a keep-alive ping</p>
              <button class="btn btn-blue" onclick="pingKeepAlive()">📡 Ping Now</button>
            </div>
            <div class="stat-card">
              <div class="sc-label">Auto Refresh</div>
              <p style="margin:10px 0;font-size:.82rem;color:var(--muted)">Dashboard auto-refresh interval</p>
              <select id="refresh-interval" class="top-btn" onchange="setRefreshInterval(this.value)">
                <option value="3000">3 seconds</option>
                <option value="5000" selected>5 seconds</option>
                <option value="10000">10 seconds</option>
                <option value="30000">30 seconds</option>
                <option value="0">Disabled</option>
              </select>
            </div>
            <div class="stat-card">
              <div class="sc-label">System Info</div>
              <p style="margin:10px 0;font-size:.82rem;color:var(--muted)">View raw system status</p>
              <button class="btn btn-ghost" onclick="window.open('/api/status','_blank')">📋 View JSON</button>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>🔗 API Endpoints</h3></div>
        <div class="panel-body no-pad">
          <table class="tbl">
            <thead><tr><th>Endpoint</th><th>Method</th><th>Description</th><th></th></tr></thead>
            <tbody>
              <tr><td class="mono">/api/status</td><td><span class="tag green">GET</span></td><td>Full system status</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/api/status')">Open</button></td></tr>
              <tr><td class="mono">/api/processes</td><td><span class="tag green">GET</span></td><td>Process list</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/api/processes')">Open</button></td></tr>
              <tr><td class="mono">/api/network</td><td><span class="tag green">GET</span></td><td>Network info</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/api/network')">Open</button></td></tr>
              <tr><td class="mono">/api/files?path=/</td><td><span class="tag green">GET</span></td><td>File listing</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/api/files?path=/')">Open</button></td></tr>
              <tr><td class="mono">/api/logs</td><td><span class="tag green">GET</span></td><td>Log viewer</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/api/logs')">Open</button></td></tr>
              <tr><td class="mono">/api/sshx-url</td><td><span class="tag green">GET</span></td><td>SSHX URL</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/api/sshx-url')">Open</button></td></tr>
              <tr><td class="mono">/api/exec</td><td><span class="tag yellow">POST</span></td><td>Run command</td><td><span class="tag purple">JSON body</span></td></tr>
              <tr><td class="mono">/api/kill/:pid</td><td><span class="tag red">POST</span></td><td>Kill process</td><td><span class="tag purple">JSON body</span></td></tr>
              <tr><td class="mono">/terminal</td><td><span class="tag green">GET</span></td><td>Redirect to SSHX</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/terminal')">Open</button></td></tr>
              <tr><td class="mono">/health</td><td><span class="tag green">GET</span></td><td>Health check</td><td><button class="btn btn-ghost btn-sm" onclick="window.open('/health')">Open</button></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </div>
</div>

<!-- Toast container -->
<div class="toast-container" id="toasts"></div>

<script>
// ═══════════════════════════════════════════════
//  HVM VPS PANEL — Client JS
// ═══════════════════════════════════════════════

let currentSshxUrl = null;
let currentPath = '/workspace';
let cpuHistory = new Array(60).fill(0);
let memHistory = new Array(60).fill(0);
let refreshTimer = null;
let REFRESH_MS = 5000;

// ── Navigation ───────────────────────────────

document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');
    document.getElementById('page-title').textContent =
      item.textContent.trim().replace(/SSHX/,'').trim();
    // Load page data
    loadPageData(page);
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
  });
});

function loadPageData(page) {
  switch(page) {
    case 'overview': refreshAll(); break;
    case 'terminal': loadSshxUrl(); break;
    case 'processes': loadProcesses(); break;
    case 'monitoring': refreshAll(); break;
    case 'network': loadNetwork(); break;
    case 'storage': loadStorage(); break;
    case 'files': navigateTo(currentPath); break;
    case 'logs': loadLogs(); break;
    case 'packages': loadPackages(); break;
  }
}

// ── Toast ─────────────────────────────────────

function toast(msg, type='success') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = (type==='success'?'✅':'❌') + ' ' + msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ── API helpers ───────────────────────────────

async function api(url, opts) {
  try {
    const r = await fetch(url, opts);
    return await r.json();
  } catch(e) {
    console.error('API Error:', e);
    return null;
  }
}

// ── SSHX ──────────────────────────────────────

async function loadSshxUrl() {
  const d = await api('/api/sshx-url');
  if (d && d.url) {
    currentSshxUrl = d.url;
    document.querySelectorAll('#sshx-url-display, #sshx-url-terminal').forEach(el => {
      el.innerHTML = '<a href="'+d.url+'" target="_blank">'+d.url+'</a>';
    });
    const badge = document.getElementById('sshx-badge');
    if (badge) { badge.style.background = 'var(--accent)'; badge.textContent = 'LIVE'; }
  } else {
    document.querySelectorAll('#sshx-url-display, #sshx-url-terminal').forEach(el => {
      el.innerHTML = '<span style="color:var(--warn)">⏳ Connecting… (auto-retry)</span>';
    });
  }
}

function openTerminal() {
  if (currentSshxUrl) window.open(currentSshxUrl, '_blank');
  else toast('SSHX not ready yet', 'error');
}

function copyUrl() {
  if (currentSshxUrl) {
    navigator.clipboard.writeText(currentSshxUrl).then(() => toast('URL copied!'));
  }
}

async function restartSSHX() {
  toast('Restarting SSHX…');
  await api('/api/sshx/restart', { method: 'POST' });
  setTimeout(loadSshxUrl, 3000);
}

// ── Overview ──────────────────────────────────

async function refreshAll() {
  const d = await api('/api/status');
  if (!d) return;

  // SSHX URL
  if (d.sshxUrl) {
    currentSshxUrl = d.sshxUrl;
    document.querySelectorAll('#sshx-url-display, #sshx-url-terminal').forEach(el => {
      el.innerHTML = '<a href="'+d.sshxUrl+'" target="_blank">'+d.sshxUrl+'</a>';
    });
  }

  // Status pill
  const pill = document.getElementById('status-pill');
  const stxt = document.getElementById('status-text');
  pill.className = 'status-pill ' + (d.status==='online'?'online':'offline');
  stxt.textContent = d.status==='online'?'Online':'Offline';

  // Stat cards
  const memPct = d.mem.pct;
  const cpuPct = d.cpu;
  document.getElementById('stat-cards').innerHTML = \`
    <div class="stat-card">
      <div class="sc-head">
        <div><div class="sc-label">CPU Usage</div>
        <div class="sc-value">\${cpuPct}%</div>
        <div class="sc-sub">\${d.cpus} core\${d.cpus>1?'s':''} · \${d.arch}</div></div>
        <div class="sc-icon" style="background:rgba(0,255,136,.1);color:var(--accent)">⚡</div>
      </div>
      <div class="sc-bar"><div class="sc-bar-fill" style="width:\${cpuPct}%;background:var(--accent)"></div></div>
    </div>
    <div class="stat-card">
      <div class="sc-head">
        <div><div class="sc-label">Memory</div>
        <div class="sc-value">\${d.mem.used} MB</div>
        <div class="sc-sub">\${d.mem.free} MB free / \${d.mem.total} MB</div></div>
        <div class="sc-icon" style="background:rgba(88,166,255,.1);color:var(--accent2)">🧠</div>
      </div>
      <div class="sc-bar"><div class="sc-bar-fill" style="width:\${memPct}%;background:var(--accent2)"></div></div>
    </div>
    <div class="stat-card">
      <div class="sc-head">
        <div><div class="sc-label">Disk</div>
        <div class="sc-value">\${d.disk.used}</div>
        <div class="sc-sub">\${d.disk.free} free / \${d.disk.total}</div></div>
        <div class="sc-icon" style="background:rgba(210,153,34,.1);color:var(--accent4)">💾</div>
      </div>
      <div class="sc-bar"><div class="sc-bar-fill" style="width:\${d.disk.pct}%;background:var(--accent4)"></div></div>
    </div>
    <div class="stat-card">
      <div class="sc-head">
        <div><div class="sc-label">Uptime</div>
        <div class="sc-value" style="font-size:1.3rem">\${d.uptime}</div>
        <div class="sc-sub">\${d.hostname}</div></div>
        <div class="sc-icon" style="background:rgba(188,140,255,.1);color:var(--accent5)">⏱️</div>
      </div>
    </div>
  \`;

  // Resource bars
  document.getElementById('resource-bars').innerHTML = \`
    <div class="bar-row"><span class="bar-label">CPU</span><div class="bar-track"><div class="bar-val" style="width:\${cpuPct}%;background:var(--accent)"></div></div><span class="bar-pct">\${cpuPct}%</span></div>
    <div class="bar-row"><span class="bar-label">Memory</span><div class="bar-track"><div class="bar-val" style="width:\${memPct}%;background:var(--accent2)"></div></div><span class="bar-pct">\${memPct}%</span></div>
    <div class="bar-row"><span class="bar-label">Disk</span><div class="bar-track"><div class="bar-val" style="width:\${d.disk.pct}%;background:var(--accent4)"></div></div><span class="bar-pct">\${d.disk.pct}%</span></div>
  \`;

  // Load average bars
  const maxLoad = Math.max(d.cpus, ...d.loadavg) || 1;
  document.getElementById('load-bars').innerHTML = ['1 min','5 min','15 min'].map((label, i) => {
    const pct = Math.min(100, Math.round((d.loadavg[i] / maxLoad) * 100));
    return \`<div class="bar-row"><span class="bar-label">\${label}</span><div class="bar-track"><div class="bar-val" style="width:\${pct}%;background:var(--accent5)"></div></div><span class="bar-pct">\${d.loadavg[i].toFixed(2)}</span></div>\`;
  }).join('');

  // Services table
  document.getElementById('services-body').innerHTML = \`
    <tr>
      <td><strong>🖥️ SSHX Terminal</strong></td>
      <td><span class="tag \${d.sshx?'green':'red'}">\${d.sshx?'Running':'Stopped'}</span></td>
      <td class="mono">\${d.sshxUrl||'N/A'}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="restartSSHX()">↻</button></td>
    </tr>
    <tr>
      <td><strong>🐍 Python Worker</strong></td>
      <td><span class="tag \${d.worker?'green':'red'}">\${d.worker?'Running':'Stopped'}</span></td>
      <td>Keep-alive + monitoring</td>
      <td><span class="tag blue">auto</span></td>
    </tr>
    <tr>
      <td><strong>🟢 Node.js Server</strong></td>
      <td><span class="tag green">Running</span></td>
      <td>Port \${location.port||'443'} · Express</td>
      <td><span class="tag blue">primary</span></td>
    </tr>
  \`;

  // Monitoring page
  document.getElementById('monitor-cards').innerHTML = \`
    <div class="stat-card">
      <div class="sc-label">Kernel</div>
      <div class="sc-value" style="font-size:1rem">\${d.kernel}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Node.js</div>
      <div class="sc-value" style="font-size:1rem">\${d.node}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Python</div>
      <div class="sc-value" style="font-size:1rem">\${d.python}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Platform</div>
      <div class="sc-value" style="font-size:1rem">\${d.platform} / \${d.arch}</div>
    </div>
  \`;

  const si = document.getElementById('sysinfo-grid');
  if (si) {
    si.innerHTML = [
      ['Hostname', d.hostname], ['Architecture', d.arch],
      ['CPUs', d.cpus], ['Total RAM', d.mem.total+' MB'],
      ['Free RAM', d.mem.free+' MB'], ['Node.js', d.node],
      ['Python', d.python], ['Kernel', d.kernel],
      ['Disk Total', d.disk.total], ['Disk Used', d.disk.used],
      ['Load 1m', d.loadavg[0].toFixed(2)], ['Uptime', d.uptime]
    ].map(([k,v]) => \`
      <div style="background:var(--input-bg);padding:10px 14px;border-radius:8px;border:1px solid var(--border)">
        <div style="font-size:.68rem;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">\${k}</div>
        <div style="font-size:.88rem;color:#fff;margin-top:4px;font-weight:600">\${v}</div>
      </div>
    \`).join('');
  }

  // Charts
  cpuHistory.push(cpuPct); cpuHistory.shift();
  memHistory.push(memPct); memHistory.shift();
  drawChart('cpu-canvas', cpuHistory, '#00ff88');
  drawChart('mem-canvas', memHistory, '#58a6ff');
}

function drawChart(id, data, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= 100; y += 25) {
    const py = H - (y / 100) * H;
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
  }

  // Line
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const step = W / (data.length - 1);
  data.forEach((v, i) => {
    const x = i * step;
    const y = H - (v / 100) * H;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '33');
  grad.addColorStop(1, color + '00');
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── Processes ─────────────────────────────────

async function loadProcesses() {
  const procs = await api('/api/processes');
  if (!procs) return;
  document.getElementById('proc-body').innerHTML = procs.map(p => \`
    <tr>
      <td class="mono">\${p.pid}</td>
      <td>\${p.user}</td>
      <td><span class="tag \${parseFloat(p.cpu)>50?'red':parseFloat(p.cpu)>20?'yellow':'green'}">\${p.cpu}%</span></td>
      <td><span class="tag \${parseFloat(p.mem)>50?'red':parseFloat(p.mem)>20?'yellow':'blue'}">\${p.mem}%</span></td>
      <td><span class="tag purple">\${p.stat||'?'}</span></td>
      <td class="mono">\${p.time||''}</td>
      <td class="mono" style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="\${p.cmd}">\${p.cmd}</td>
      <td><button class="btn btn-danger btn-sm" onclick="killProc('\${p.pid}')">Kill</button></td>
    </tr>
  \`).join('');
}

async function killProc(pid) {
  if (!confirm('Kill process ' + pid + '?')) return;
  const r = await api('/api/kill/'+pid, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if (r && r.ok) { toast('Process '+pid+' killed'); loadProcesses(); }
  else toast('Failed to kill '+pid, 'error');
}

// ── Network ───────────────────────────────────

async function loadNetwork() {
  const d = await api('/api/network');
  if (!d) return;
  document.getElementById('net-ifaces').innerHTML = d.interfaces.map(i => \`
    <tr><td>\${i.iface}</td><td class="mono">\${i.addr}</td><td><span class="tag blue">\${i.family}</span></td><td class="mono">\${i.mac}</td></tr>
  \`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--dim)">No external interfaces</td></tr>';
  document.getElementById('net-conn').innerHTML = d.connections.map(c => \`
    <tr><td><span class="tag green">\${c.proto}</span></td><td>\${c.state}</td><td class="mono">\${c.local}</td><td class="mono">\${c.peer||'*'}</td></tr>
  \`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--dim)">No connections</td></tr>';
}

// ── Storage ───────────────────────────────────

async function loadStorage() {
  const d = await api('/api/status');
  if (!d) return;
  document.getElementById('storage-cards').innerHTML = \`
    <div class="stat-card">
      <div class="sc-label">Total</div>
      <div class="sc-value">\${d.disk.total}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Used</div>
      <div class="sc-value">\${d.disk.used}</div>
      <div class="sc-bar"><div class="sc-bar-fill" style="width:\${d.disk.pct}%;background:var(--accent4)"></div></div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Free</div>
      <div class="sc-value">\${d.disk.free}</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">Usage</div>
      <div class="sc-value">\${d.disk.pct}%</div>
    </div>
  \`;
  const o = await api('/api/exec', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:'df -h && echo "\\n── Inodes ──" && df -i'})});
  if (o) document.getElementById('disk-output').textContent = o.output;
}

// ── File Manager ──────────────────────────────

async function navigateTo(dir) {
  currentPath = dir;
  document.getElementById('path-input').value = dir;
  const d = await api('/api/files?path=' + encodeURIComponent(dir));
  if (!d) return;
  const list = document.getElementById('file-list');
  if (!d.items.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--dim)">Empty directory</div>';
    return;
  }
  list.innerHTML = d.items.map(f => {
    const size = f.isDir ? '--' : formatSize(f.size);
    const icon = f.isDir ? '📁' : fileIcon(f.name);
    const modified = new Date(f.modified).toLocaleString();
    return \`
      <div class="file-item" onclick="\${f.isDir ? "navigateTo('"+dir+'/'+f.name+"')" : "previewFile('"+dir+'/'+f.name+"')"}">
        <span class="fi-icon">\${icon}</span>
        <span class="fi-name">\${f.name}</span>
        <span class="fi-meta">\${f.perms}</span>
        <span class="fi-meta">\${size}</span>
        <span class="fi-meta">\${modified}</span>
      </div>
    \`;
  }).join('');
}

function goUp() {
  const parts = currentPath.split('/').filter(Boolean);
  parts.pop();
  navigateTo('/' + parts.join('/') || '/');
}

async function previewFile(path) {
  const d = await api('/api/file-content?path=' + encodeURIComponent(path));
  const panel = document.getElementById('file-preview-panel');
  const name = document.getElementById('preview-name');
  const content = document.getElementById('file-preview-content');
  panel.style.display = 'block';
  name.textContent = '📄 ' + path.split('/').pop();
  content.textContent = d ? d.content : 'Unable to read file';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1048576).toFixed(1) + ' MB';
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    js:'📜',ts:'📜',py:'🐍',sh:'⚙️',json:'📋',yml:'📋',yaml:'📋',
    md:'📝',txt:'📝',log:'📋',html:'🌐',css:'🎨',
    jpg:'🖼️',png:'🖼️',gif:'🖼️',svg:'🖼️',
    zip:'📦',tar:'📦',gz:'📦',
    Dockerfile:'🐳',Makefile:'🔨',
  };
  return map[ext] || '📄';
}

// ── Logs ──────────────────────────────────────

async function loadLogs(file) {
  if (!file) file = document.getElementById('log-select').value;
  const d = await api('/api/logs?file=' + encodeURIComponent(file) + '&lines=100');
  document.getElementById('log-content').textContent = d ? d.content : 'No logs available';
}

// ── Packages ──────────────────────────────────

async function loadPackages() {
  const pkgs = await api('/api/packages');
  if (!pkgs) return;
  document.getElementById('pkg-body').innerHTML = pkgs.map(p => \`
    <tr><td class="mono" style="color:var(--accent2)">\${p.name}</td><td class="mono">\${p.version}</td><td>\${p.desc}</td></tr>
  \`).join('');
}

// ── Console ───────────────────────────────────

async function runConsole() {
  const input = document.getElementById('console-input');
  const output = document.getElementById('console-output');
  const cmd = input.value.trim();
  if (!cmd) return;
  input.value = '';
  output.innerHTML += '<br><span class="prompt">$ </span>' + escapeHtml(cmd) + '<br>';
  const d = await api('/api/exec', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd})});
  output.innerHTML += '<span class="output">' + escapeHtml(d?d.output:'[error]') + '</span><br>';
  output.scrollTop = output.scrollHeight;
}

function clearConsole() {
  document.getElementById('console-output').innerHTML = '<span class="output">Console cleared.\\n</span>';
}

// ── Quick Cmd (Terminal page) ─────────────────

async function runQuickCmd() {
  const input = document.getElementById('quick-cmd');
  const cmd = input.value.trim();
  if (!cmd) return;
  await runCmd(cmd);
  input.value = '';
}

async function runCmd(cmd) {
  const output = document.getElementById('quick-output');
  output.innerHTML = '<span class="prompt">$ </span>' + escapeHtml(cmd) + '<br><span class="output">Running…</span>';
  const d = await api('/api/exec', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd})});
  output.innerHTML = '<span class="prompt">$ </span>' + escapeHtml(cmd) + '<br><span class="output">' + escapeHtml(d?d.output:'[error]') + '</span>';
}

// ── Settings helpers ──────────────────────────

async function pingKeepAlive() {
  await api('/keep-alive');
  toast('Keep-alive ping sent!');
}

function setRefreshInterval(ms) {
  REFRESH_MS = parseInt(ms);
  if (refreshTimer) clearInterval(refreshTimer);
  if (REFRESH_MS > 0) refreshTimer = setInterval(refreshAll, REFRESH_MS);
  toast('Refresh: ' + (REFRESH_MS > 0 ? (REFRESH_MS/1000)+'s' : 'disabled'));
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────

refreshAll();
loadSshxUrl();
refreshTimer = setInterval(refreshAll, REFRESH_MS);
setInterval(loadSshxUrl, 10000);
</script>
</body></html>`;
}

// ═══════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[✓] HVM VPS Panel  → http://0.0.0.0:${PORT}`);
  console.log(`[✓] Dashboard      → http://0.0.0.0:${PORT}/dashboard`);
  console.log(`[✓] Terminal        → http://0.0.0.0:${PORT}/terminal`);
  console.log(`[✓] API Status      → http://0.0.0.0:${PORT}/api/status`);
});
