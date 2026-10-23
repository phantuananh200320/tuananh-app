'use strict';
// Cập nhật phiên bản ngay trong ứng dụng, không cần build lại hay khởi động lại cả hệ thống.
//  - Chỉ ghi các tệp thật sự thay đổi. Giao diện (public/) có hiệu lực ngay.
//  - Mã máy chủ được NẠP NÓNG trong tiến trình đang chạy (kết nối CSDL và người đang dùng không bị ngắt).
//  - Chỉ khi gói đổi phần lõi (xem RESTART) mới cần khởi động lại tiến trình, và tự làm nếu chạy dưới Docker/systemd.
//  - Luôn sao lưu CSDL và lưu bản cũ của từng tệp để quay lại được. Lỗi khi nạp thì tự khôi phục.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./config');
const pkg = require('./lib/pkg');
const { bad } = require('./lib/http');

const ROOT = C.ROOT;
const DIR = path.join(C.DATA_DIR, 'updates');
const KEEP = 5; // số bản cập nhật gần nhất giữ lại để quay lại
// Phần lõi: đã được nạp vào bộ nhớ và giữ trạng thái (kết nối CSDL, máy chủ HTTP, chính bộ cập nhật). Đổi các tệp này cần khởi động lại tiến trình.
const RESTART = new Set(['server/db.js', 'server/config.js', 'server/lib/http.js', 'server/lib/security.js', 'server/lib/pkg.js', 'server/index.js', 'server/updater.js', 'server/updater-boot.js']);
const SCAN_DIRS = ['server', 'public', 'scripts'];
const SCAN_ROOT = ['package.json', 'README.md', '.env.example', ...pkg.LAUNCH_FILES];

const ctx = { app: null, busy: false };
const STARTED = Date.now();

fs.mkdirSync(path.join(DIR, 'packages'), { recursive: true });
fs.mkdirSync(path.join(DIR, 'rollback'), { recursive: true });

// Cập nhật trên web BẬT sẵn (chỉ quản trị viên, phải nhập lại mật khẩu). Muốn tắt hẳn: đặt ALLOW_ONLINE_UPDATE=0.
const enabled = () => !['0', 'false', 'no', 'off'].includes(String(process.env.ALLOW_ONLINE_UPDATE || '').trim().toLowerCase());
const publicKey = () => process.env.UPDATE_PUBLIC_KEY || '';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel));
function version() { return JSON.parse(read('package.json').toString('utf8')).version; }
function init({ app }) { ctx.app = app; }

// Ai bật lại ứng dụng khi nó tự tắt để chạy mã mới: start.js (tệp khởi động đi kèm), Docker, systemd
function supervisor() {
  if (process.env.AUTO_RESTART === '0') return null;
  if (process.env.CHAMCONG_SUPERVISED === '1') return 'launcher';
  if (fs.existsSync('/.dockerenv')) return 'docker';
  if (process.env.INVOCATION_ID) return 'systemd';
  if (process.env.AUTO_RESTART === '1') return 'other';
  return null;
}
const supervised = () => !!supervisor();

// ---------- trạng thái ----------
const stateFile = path.join(DIR, 'installed.json');
function walk(rel, out) {
  const full = path.join(ROOT, rel);
  let st;
  try { st = fs.statSync(full); } catch { return; }
  if (st.isDirectory()) {
    if (rel === 'node_modules' || pkg.allowed(rel + '/x') === false) return; // bỏ qua vendor, models
    for (const n of fs.readdirSync(full)) walk(rel + '/' + n, out);
  } else if (!/\.tmp-\d+$/.test(rel)) out[rel] = pkg.sha256(fs.readFileSync(full));
}
function managedTree() {
  const out = {};
  for (const d of SCAN_DIRS) walk(d, out);
  for (const f of SCAN_ROOT) walk(f, out);
  return out;
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* chưa có */ }
  // Lần đầu: coi cây mã hiện tại là mốc ban đầu (bản cài từ ảnh Docker hoặc từ gói đầy đủ)
  const s = { history: [{ version: version(), at: Date.now(), by: 'cài đặt ban đầu', package: null, rollback: null, manifest: managedTree() }] };
  saveState(s);
  return s;
}
function saveState(s) {
  const tmp = stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, stateFile);
}

function status() {
  const s = enabled() ? loadState() : { history: [] };
  return {
    enabled: enabled(),
    version: version(),
    started_at: STARTED,
    signature_required: !!publicKey(),
    auto_restart: supervised(),
    supervisor: supervisor(),
    can_rollback: s.history.length > 1,
    history: s.history.slice().reverse().slice(0, 10).map((h) => ({ version: h.version, at: h.at, by: h.by })),
  };
}

// ---------- kiểm tra gói và lập kế hoạch ----------
const stagedFile = path.join(DIR, 'staged.tgz');
function stage(buf) { fs.writeFileSync(stagedFile, buf); return inspect().plan; }

function inspect() {
  let gz;
  try { gz = fs.readFileSync(stagedFile); } catch { throw bad('Chưa có gói cập nhật nào được tải lên'); }
  let opened;
  try { opened = pkg.open(gz, { publicKey: publicKey() }); } catch (e) { throw bad(e.message); }
  const { manifest, files } = opened;
  const cur = version();
  const cmp = pkg.cmpVersion(manifest.version, cur);
  if (cmp === 0) throw bad(`Gói này cùng phiên bản với bản đang chạy (${cur}). Hãy tăng số phiên bản khi đóng gói.`);

  const depKeys = (b) => Object.keys(JSON.parse(b.toString('utf8')).dependencies || {}).sort().join(',');
  if (depKeys(files.get('package.json')) !== depKeys(read('package.json'))) throw bad('Gói này đổi thư viện phụ thuộc nên không cập nhật nóng được. Hãy build lại ảnh Docker.');

  const added = [], changed = [], infra = [];
  for (const [rel, data] of files) {
    const full = path.join(ROOT, rel);
    const exists = fs.existsSync(full);
    if (exists && pkg.sha256(fs.readFileSync(full)) === pkg.sha256(data)) continue;
    if (pkg.INFRA(rel)) { infra.push(rel); continue; }
    (exists ? changed : added).push(rel);
  }
  // Tệp bị bỏ: chỉ những tệp bản trước quản lý mà bản mới không còn
  const prev = loadState().history.slice(-1)[0].manifest || {};
  const removed = Object.keys(prev).filter((rel) => !files.has(rel) && !pkg.INFRA(rel) && pkg.allowed(rel) && fs.existsSync(path.join(ROOT, rel)));
  const restart = [...added, ...changed, ...removed].some((r) => RESTART.has(r));
  const crypto = require('crypto');
  const plan = {
    token: crypto.createHash('sha256').update(gz).digest('hex'),
    version: manifest.version, current: cur, created: manifest.created, notes: manifest.notes || '',
    signed: opened.signed, has_signature: opened.hasSignature, downgrade: cmp < 0,
    added, changed, removed, infra_changed: infra, restart_required: restart, full: !!opened.full,
    total: added.length + changed.length + removed.length,
  };

  // Kiểm tra cú pháp trước khi đụng vào hệ thống đang chạy
  const tmp = fs.mkdtempSync(path.join(DIR, 'check-'));
  try {
    for (const rel of [...added, ...changed].filter((r) => r.endsWith('.js'))) {
      const f = path.join(tmp, rel.replace(/\//g, '__'));
      fs.writeFileSync(f, files.get(rel));
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', timeout: 20000 });
      if (r.status !== 0) throw bad(`Lỗi cú pháp trong ${rel}, gói không được áp dụng:\n${(r.stderr || '').split('\n').slice(0, 4).join('\n')}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { plan, opened };
}

// ---------- ghi tệp, nạp lại, quay lại ----------
function atomicWrite(rel, data) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = full + '.tmp-' + process.pid;
  // Giữ quyền chạy của tệp cũ; tệp khởi động (.sh, start.js) luôn chạy được
  let mode = /\.sh$|^start\.js$/.test(rel) ? 0o755 : 0o644;
  try { mode = fs.statSync(full).mode & 0o777; } catch { /* tệp mới */ }
  fs.writeFileSync(tmp, data, { mode });
  try { fs.chmodSync(tmp, mode); } catch { /* Windows */ }
  fs.renameSync(tmp, full);
}

// Nạp lại mã máy chủ trong tiến trình đang chạy. Giữ nguyên phần lõi (CSDL, máy chủ HTTP).
function hotReload() {
  if (!ctx.app) throw new Error('Chưa khởi tạo bộ cập nhật');
  const serverDir = path.join(ROOT, 'server') + path.sep;
  const saved = ctx.app.snapshot();
  try {
    for (const k of Object.keys(require.cache)) {
      if (!k.startsWith(serverDir)) continue;
      const rel = 'server/' + k.slice(serverDir.length).split(path.sep).join('/');
      if (!RESTART.has(rel)) delete require.cache[k];
    }
    ctx.app.reset();
    require('./app-routes')(ctx.app);
    require('./backup').start();
  } catch (e) { ctx.app.restore(saved); throw e; }
}

function scheduleRestart() {
  if (!supervised()) return false;
  // Tắt êm (đóng kết nối, đóng CSDL) rồi để start.js / Docker / systemd bật lại. Dùng emit để chạy được cả trên Windows.
  setTimeout(() => process.emit('SIGTERM'), 1200).unref();
  return true;
}

function revert(meta, rdir) {
  for (const rel of [...meta.changed, ...meta.removed]) {
    const src = path.join(rdir, 'files', rel);
    if (fs.existsSync(src)) atomicWrite(rel, fs.readFileSync(src));
  }
  for (const rel of meta.added) { try { fs.unlinkSync(path.join(ROOT, rel)); } catch { /* đã mất */ } }
}

function finish(restartNeeded, rollbackFn) {
  if (!restartNeeded) {
    try { hotReload(); return { hot_reloaded: true, restarted: false }; } catch (e) {
      rollbackFn();
      try { hotReload(); } catch { /* giữ nguyên route cũ */ }
      throw bad('Nạp bản mới bị lỗi nên đã tự khôi phục bản cũ: ' + e.message);
    }
  }
  return { hot_reloaded: false, restarted: scheduleRestart() };
}

function prune(s) {
  while (s.history.length > KEEP + 1) {
    const old = s.history.splice(1, 1)[0];
    if (old.package) fs.rmSync(path.join(DIR, old.package), { force: true });
    if (old.rollback) fs.rmSync(path.join(DIR, old.rollback), { recursive: true, force: true });
  }
}

function apply({ user, token, allowDowngrade }) {
  if (ctx.busy) throw bad('Đang có một cập nhật khác đang chạy');
  ctx.busy = true;
  try {
    const { plan, opened } = inspect();
    if (plan.token !== token) throw bad('Gói đã thay đổi kể từ lúc kiểm tra, hãy tải lên lại');
    if (plan.downgrade && !allowDowngrade) throw bad('Đây là phiên bản cũ hơn bản đang chạy. Cần xác nhận hạ phiên bản.');
    if (!plan.total) throw bad('Gói không có thay đổi nào so với hệ thống hiện tại');
    const BK = require('./backup');
    const dbBackup = BK.create('truoc-cap-nhat'); // cập nhật có thể kèm cấu trúc dữ liệu mới: luôn có bản sao lưu đi kèm

    const id = `${plan.current}-${plan.version}-${Date.now()}`;
    const rdir = path.join(DIR, 'rollback', id);
    fs.mkdirSync(path.join(rdir, 'files'), { recursive: true });
    for (const rel of [...plan.changed, ...plan.removed]) {
      const dst = path.join(rdir, 'files', rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), dst);
    }
    const meta = { from: plan.current, to: plan.version, added: plan.added, changed: plan.changed, removed: plan.removed };
    fs.writeFileSync(path.join(rdir, 'meta.json'), JSON.stringify(meta));

    try {
      for (const rel of [...plan.added, ...plan.changed]) atomicWrite(rel, opened.files.get(rel));
      for (const rel of plan.removed) fs.unlinkSync(path.join(ROOT, rel));
    } catch (e) { revert(meta, rdir); throw bad('Ghi tệp bị lỗi, đã khôi phục: ' + e.message); }

    const result = finish(plan.restart_required, () => revert(meta, rdir));

    const s = loadState();
    const pfile = `packages/${plan.version}-${Date.now()}.tgz`;
    fs.copyFileSync(stagedFile, path.join(DIR, pfile));
    const manifest = {};
    for (const [rel, data] of opened.files) if (!pkg.INFRA(rel)) manifest[rel] = pkg.sha256(data);
    s.history.push({ version: plan.version, at: Date.now(), by: user.code, package: pfile, rollback: 'rollback/' + id, manifest });
    prune(s);
    saveState(s);
    fs.rmSync(stagedFile, { force: true });
    return { ok: true, version: plan.version, from: plan.current, changed: plan.total, restart_required: plan.restart_required, infra_changed: plan.infra_changed, db_backup: dbBackup, ...result };
  } finally { ctx.busy = false; }
}

function rollback({ user }) {
  if (ctx.busy) throw bad('Đang có một cập nhật khác đang chạy');
  ctx.busy = true;
  try {
    const s = loadState();
    if (s.history.length < 2) throw bad('Chưa có bản cập nhật nào để quay lại');
    const last = s.history[s.history.length - 1];
    const rdir = path.join(DIR, last.rollback || '');
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(rdir, 'meta.json'), 'utf8')); } catch { throw bad('Không còn dữ liệu để quay lại bản trước'); }
    const restartNeeded = [...meta.added, ...meta.changed, ...meta.removed].some((r) => RESTART.has(r));
    revert(meta, rdir);
    const result = finish(restartNeeded, () => { /* quay lại là bước khôi phục; không còn gì để lùi */ });
    s.history.pop();
    saveState(s);
    if (last.package) fs.rmSync(path.join(DIR, last.package), { force: true });
    fs.rmSync(rdir, { recursive: true, force: true });
    return { ok: true, version: s.history[s.history.length - 1].version, from: last.version, restart_required: restartNeeded, ...result };
  } finally { ctx.busy = false; }
}

module.exports = { init, version, enabled, status, stage, inspect, apply, rollback, RESTART };
