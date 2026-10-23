#!/usr/bin/env node
'use strict';
/*
 * Tệp khởi động phần mềm. Chạy được trên Windows, Linux, macOS; không cần cài thêm gì ngoài Node.js.
 *
 *   node start.js            chạy phần mềm (giữ chạy liên tục, tự bật lại sau khi cập nhật hoặc gặp sự cố)
 *   node start.js --open     chạy và mở trình duyệt
 *   node start.js --stop     dừng phần mềm đang chạy
 *   node start.js --status   xem phần mềm có đang chạy không
 *
 * Cấu hình đọc từ file .env cạnh tệp này (xem .env.example). Log ghi vào <thư mục dữ liệu>/logs.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork, spawn } = require('node:child_process');

const ROOT = __dirname;
const MIN = [22, 5, 0];
const ver = process.versions.node.split('.').map(Number);
const atLeast = (v, m) => v[0] !== m[0] ? v[0] > m[0] : v[1] !== m[1] ? v[1] > m[1] : v[2] >= m[2];

function die(msg) {
  console.error('\n[!] ' + msg + '\n');
  process.exit(1);
}
if (!atLeast(ver, MIN)) die(`Cần Node.js ${MIN.join('.')} trở lên (máy đang có ${process.versions.node}). Tải bản LTS tại https://nodejs.org rồi chạy lại.`);

// ---------- cấu hình ----------
// Biến môi trường đặt sẵn (dịch vụ, Docker) được ưu tiên hơn file .env; biến rỗng coi như chưa đặt
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  let parsed;
  try { parsed = require('node:util').parseEnv(fs.readFileSync(envFile, 'utf8')); } catch (e) { die('File .env bị lỗi: ' + e.message); }
  for (const [k, v] of Object.entries(parsed)) if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
}
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
process.env.DATA_DIR = DATA_DIR;
fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
const PID_FILE = path.join(DATA_DIR, 'chamcong.pid');
const STOP_FILE = path.join(DATA_DIR, 'chamcong.stop');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const runningPid = () => { try { const pid = Number(fs.readFileSync(PID_FILE, 'utf8')); return pid && pid !== process.pid && alive(pid) ? pid : 0; } catch { return 0; } };

// ---------- lệnh phụ ----------
const args = new Set(process.argv.slice(2));
if (args.has('--status')) {
  const pid = runningPid();
  console.log(pid ? `Phần mềm đang chạy (tiến trình ${pid}), cổng ${PORT}.` : 'Phần mềm đang không chạy.');
  process.exit(0);
}
if (args.has('--stop')) {
  const pid = runningPid();
  if (!pid) { console.log('Phần mềm đang không chạy.'); process.exit(0); }
  fs.writeFileSync(STOP_FILE, String(Date.now()));
  console.log('Đang dừng phần mềm...');
  const t0 = Date.now();
  const iv = setInterval(() => {
    // start.js xoá file pid khi đã dừng xong (kể cả khi hệ điều hành chưa kịp dọn tiến trình)
    if (!alive(pid) || !fs.existsSync(PID_FILE)) { clearInterval(iv); console.log('Đã dừng.'); process.exit(0); }
    if (Date.now() - t0 > 20000) { clearInterval(iv); try { process.kill(pid); } catch { /* đã dừng */ } console.log('Đã buộc dừng.'); process.exit(0); }
  }, 300);
  return;
}

// ---------- chỉ chạy một bản ----------
const other = runningPid();
if (other) die(`Phần mềm đã đang chạy (tiến trình ${other}). Muốn chạy lại, hãy dừng trước: node start.js --stop`);
fs.writeFileSync(PID_FILE, String(process.pid));
try { fs.unlinkSync(STOP_FILE); } catch { /* không có */ }

// ---------- log: in ra màn hình và ghi file theo ngày, giữ 14 ngày ----------
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
let logDay = '';
let logStream = null;
function logTo() {
  const d = today();
  if (d !== logDay) {
    if (logStream) logStream.end();
    logDay = d;
    logStream = fs.createWriteStream(path.join(DATA_DIR, 'logs', `chamcong-${d}.log`), { flags: 'a' });
    try {
      const files = fs.readdirSync(path.join(DATA_DIR, 'logs')).filter((f) => /^chamcong-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.rmSync(path.join(DATA_DIR, 'logs', f), { force: true });
    } catch { /* bỏ qua */ }
  }
  return logStream;
}
function log(line, err) {
  const s = `[${new Date().toLocaleString('vi-VN')}] ${line}`;
  (err ? console.error : console.log)(s);
  logTo().write(s + os.EOL);
}

// ---------- địa chỉ truy cập trong mạng nội bộ ----------
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  return out;
}
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* không có trình duyệt */ }
}

// ---------- giữ phần mềm luôn chạy ----------
const execArgv = ['--disable-warning=ExperimentalWarning'];
if (!atLeast(ver, [22, 13, 0])) execArgv.push('--experimental-sqlite'); // Node 22.5 - 22.12 cần cờ này cho SQLite
let child = null;
let stopping = false;
let quickFails = 0;
let opened = false;

function startChild() {
  const started = Date.now();
  child = fork(path.join(ROOT, 'server', 'index.js'), [], {
    cwd: ROOT,
    execArgv,
    env: { ...process.env, CHAMCONG_SUPERVISED: '1', AUTO_RESTART: process.env.AUTO_RESTART === '0' ? '0' : '1', NODE_ENV: process.env.NODE_ENV || 'production' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const pipe = (stream, err) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (line) log(line, err); }
    });
  };
  pipe(child.stdout, false);
  pipe(child.stderr, true);
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) { log('Phần mềm đã dừng.'); cleanup(); process.exit(0); }
    const ran = Date.now() - started;
    quickFails = ran < 15000 && code !== 0 ? quickFails + 1 : 0;
    const wait = quickFails ? Math.min(30000, 1000 * 2 ** (quickFails - 1)) : 800;
    log(code === 0 ? 'Phần mềm khởi động lại (sau khi cập nhật hoặc theo yêu cầu)...' : `Phần mềm dừng bất thường (mã ${code ?? signal}). Tự chạy lại sau ${Math.round(wait / 1000)} giây.`, code !== 0);
    setTimeout(startChild, wait);
  });
  // Lần đầu chạy được: in địa chỉ truy cập
  if (!opened) {
    const wait = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (!r.ok) return;
        clearInterval(wait);
        opened = true;
        log('──────────────────────────────────────────────');
        log(`Phần mềm đã chạy. Mở trên máy này:  http://localhost:${PORT}`);
        for (const u of lanUrls()) log(`Máy khác trong cùng mạng mở:      ${u}`);
        log('Dữ liệu lưu tại: ' + DATA_DIR);
        log('Đóng cửa sổ này hoặc chạy "node start.js --stop" để dừng.');
        log('──────────────────────────────────────────────');
        if (args.has('--open')) openBrowser(`http://localhost:${PORT}`);
      } catch { /* đang khởi động */ }
    }, 700);
    setTimeout(() => clearInterval(wait), 60000).unref();
  }
}

function cleanup() {
  try { if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.unlinkSync(PID_FILE); } catch { /* bỏ qua */ }
  try { fs.unlinkSync(STOP_FILE); } catch { /* bỏ qua */ }
}
function stop(reason) {
  if (stopping) return;
  stopping = true;
  log(`Đang dừng phần mềm (${reason})...`);
  if (!child) { cleanup(); process.exit(0); }
  try { child.send({ cmd: 'shutdown' }); } catch { child.kill(); }
  setTimeout(() => { if (child) child.kill(); }, 8000).unref();
}
process.on('SIGINT', () => stop('Ctrl+C'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGHUP', () => stop('đóng cửa sổ'));
process.on('exit', cleanup);
// Lệnh "node start.js --stop" từ cửa sổ khác: tạo file chamcong.stop
setInterval(() => { if (fs.existsSync(STOP_FILE)) stop('lệnh dừng'); }, 1000).unref();

log(`Khởi động phần mềm (Node.js ${process.versions.node}, ${os.type()} ${os.arch()})`);
startChild();
