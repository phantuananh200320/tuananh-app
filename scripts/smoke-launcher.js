'use strict';
// Kiểm thử cài đặt và cập nhật như người dùng thật: node scripts/smoke-launcher.js
// Giải nén gói cài đặt .zip vào thư mục tạm, chạy bằng start.js, cập nhật trên web (cả bản đổi phần lõi phải tự khởi động lại),
// cập nhật bằng gói .zip, dừng bằng "start.js --stop", tự chạy lại khi phần mềm bị tắt đột ngột.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { spawn, spawnSync, execSync } = require('node:child_process');
const pkg = require('../server/lib/pkg');
const REL = require('./make-release');

const ROOT = path.resolve(__dirname, '..');
const PORT = 4300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-install-'));
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bump = (v, n) => { const p = v.split('.').map(Number); p[2] += n; return p.join('.'); };
const V0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ✓', name); } catch (e) { results.push([false, name]); console.log('  ✗', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); }
}
async function api(method, url, body, token, raw) {
  const r = await fetch(BASE + url, { method, headers: { ...(raw ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* chưa */ } await sleep(400); } throw new Error('Hết thời gian chờ'); }

// Gói cài đặt đầy đủ: lấy từ chính mã hiện tại, đổi số phiên bản và (tuỳ chọn) đổi một tệp lõi
function release(version, tweak) {
  const files = REL.collect().map((f) => ({ ...f }));
  const pj = files.find((f) => f.rel === 'package.json');
  pj.data = Buffer.from(JSON.stringify({ ...JSON.parse(pj.data), version }, null, 2));
  if (tweak) tweak(files);
  return files;
}
const updatePkg = (files, version) => {
  const list = files.filter((f) => pkg.allowed(f.rel)).map((f) => ({ path: f.rel, data: f.data }));
  const m = pkg.makeManifest(list, { version, notes: 'thử' });
  return pkg.tarWrite([{ path: 'update.json', data: Buffer.from(JSON.stringify(m)) }, ...list]);
};

(async () => {
  console.log('Kiểm thử cài đặt và cập nhật tại', TMP);
  let launcher = null;
  let log = '';
  const APP = path.join(TMP, 'chamcong');
  let token = '';

  await step('giải nén gói cài đặt .zip (giữ quyền chạy của start.sh)', async () => {
    const zip = REL.makeZip(release(V0));
    for (const e of pkg.zipRead(zip)) {
      const full = path.join(TMP, e.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, e.data);
    }
    assert.ok(fs.existsSync(path.join(APP, 'start.js')) && fs.existsSync(path.join(APP, 'start.bat')) && fs.existsSync(path.join(APP, 'install-linux.sh')));
    assert.ok(!fs.existsSync(path.join(APP, 'data')), 'gói cài đặt không chứa dữ liệu');
    assert.ok(!fs.existsSync(path.join(APP, '.env')), 'gói cài đặt không chứa .env');
    const tgz = REL.makeTarGz(release(V0));
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-tar-'));
    fs.writeFileSync(path.join(tdir, 'a.tar.gz'), tgz);
    execSync(`tar -xzf a.tar.gz`, { cwd: tdir });
    assert.ok(fs.statSync(path.join(tdir, 'chamcong', 'start.sh')).mode & 0o100, 'start.sh trong tar.gz chạy được');
    fs.rmSync(tdir, { recursive: true, force: true });
    const bad = spawnSync('bash', ['-n', path.join(APP, 'install-linux.sh')]); assert.strictEqual(bad.status, 0, 'cú pháp install-linux.sh');
  });

  await step('chạy bằng start.js: đọc .env, ghi pid và log, chỉ một bản chạy', async () => {
    fs.writeFileSync(path.join(APP, '.env'), `PORT=${PORT}\nHOST=127.0.0.1\nADMIN_CODE=admin\nADMIN_PASSWORD=admin123\n`);
    launcher = spawn(process.execPath, ['start.js'], { cwd: APP, env: { ...process.env, PORT: '', DATA_DIR: '', ALLOW_ONLINE_UPDATE: '', AUTO_RESTART: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    launcher.stdout.on('data', (d) => (log += d)); launcher.stderr.on('data', (d) => (log += d));
    await waitFor(async () => (await fetch(BASE + '/api/health')).ok);
    assert.ok(fs.existsSync(path.join(APP, 'data', 'chamcong.pid')));
    await waitFor(() => /Phần mềm đã chạy/.test(log), 10000);
    const logs = fs.readdirSync(path.join(APP, 'data', 'logs'));
    assert.ok(logs.some((f) => /^chamcong-\d{4}-\d{2}-\d{2}\.log$/.test(f)), 'có file log theo ngày');
    const second = spawnSync(process.execPath, ['start.js'], { cwd: APP, encoding: 'utf8', timeout: 10000 });
    assert.notStrictEqual(second.status, 0); assert.match(second.stderr, /đang chạy/);
    const st = spawnSync(process.execPath, ['start.js', '--status'], { cwd: APP, encoding: 'utf8' }); assert.match(st.stdout, /đang chạy/);
  });

  await step('cập nhật trên web bật sẵn, biết đang được start.js giữ chạy', async () => {
    let r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    r = await api('POST', '/api/auth/change-password', { old_password: 'admin123', new_password: 'Admin#12345' }, r.data.token);
    token = r.data.token;
    r = await api('GET', '/api/update/status', null, token);
    assert.strictEqual(r.data.enabled, true, 'không cần ALLOW_ONLINE_UPDATE'); assert.strictEqual(r.data.supervisor, 'launcher'); assert.strictEqual(r.data.auto_restart, true);
  });

  await step('bản thường: tải file lên là cập nhật, nạp nóng không khởi động lại', async () => {
    const v = bump(V0, 1);
    const files = release(v, (fs2) => { const f = fs2.find((x) => x.rel === 'public/erp/erp.css'); f.data = Buffer.concat([f.data, Buffer.from('\n/* ban-va-1 */\n')]); });
    let r = await api('POST', '/api/update/upload', null, token, updatePkg(files, v)); assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.restart_required, false);
    const before = (await api('GET', '/api/version')).data.started_at;
    r = await api('POST', '/api/update/apply', { token: r.data.token, password: 'Admin#12345' }, token); assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.hot_reloaded);
    const now = (await api('GET', '/api/version')).data; assert.strictEqual(now.version, v); assert.strictEqual(now.started_at, before, 'không khởi động lại');
    assert.ok((await (await fetch(BASE + '/erp/erp.css')).text()).includes('ban-va-1'));
  });

  await step('bản đổi phần lõi: start.js tự khởi động lại, dữ liệu và phiên đăng nhập giữ nguyên', async () => {
    const v = bump(V0, 2);
    const files = release(v, (fs2) => { const f = fs2.find((x) => x.rel === 'server/config.js'); f.data = Buffer.concat([f.data, Buffer.from('\n// đổi phần lõi\n')]); });
    let r = await api('POST', '/api/update/upload', null, token, updatePkg(files, v));
    assert.strictEqual(r.data.restart_required, true);
    const before = (await api('GET', '/api/version')).data.started_at;
    r = await api('POST', '/api/update/apply', { token: r.data.token, password: 'Admin#12345' }, token); assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.restarted, true);
    const now = await waitFor(async () => { const x = (await api('GET', '/api/version')).data; return x.version === v && x.started_at !== before ? x : null; });
    assert.ok(now);
    assert.strictEqual((await api('GET', '/api/update/status', null, token)).status, 200, 'phiên đăng nhập vẫn còn');
    assert.ok(fs.readFileSync(path.join(APP, 'server', 'config.js'), 'utf8').includes('đổi phần lõi'));
  });

  await step('tải gói cài đặt .zip lên cũng cập nhật được; gói cũ hơn bị chặn', async () => {
    const v = bump(V0, 3);
    const zip = REL.makeZip(release(v, (fs2) => { const f = fs2.find((x) => x.rel === 'public/index.html'); f.data = Buffer.from(f.data.toString().replace('<title>', '<title>ZIP ')); }));
    let r = await api('POST', '/api/update/upload', null, token, zip); assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.full, true); assert.strictEqual(r.data.version, v); assert.ok(r.data.changed.includes('public/index.html'));
    r = await api('POST', '/api/update/apply', { token: r.data.token, password: 'Admin#12345' }, token); assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    await waitFor(async () => (await api('GET', '/api/version')).data.version === v);
    assert.ok((await (await fetch(BASE + '/')).text()).includes('<title>ZIP '));
    r = await api('POST', '/api/update/upload', null, token, REL.makeZip(release(V0))); assert.strictEqual(r.data.downgrade, true, 'nhận ra bản cũ hơn');
    r = await api('POST', '/api/update/apply', { token: r.data.token, password: 'Admin#12345' }, token); assert.strictEqual(r.status, 400, 'không hạ phiên bản khi chưa xác nhận');
    r = await api('POST', '/api/update/upload', null, token, Buffer.from('không phải gói')); assert.strictEqual(r.status, 400);
    r = await api('POST', '/api/update/apply', { token: 'x', password: 'sai' }, token); assert.strictEqual(r.status, 403, 'sai mật khẩu xác nhận');
  });

  await step('phần mềm bị tắt đột ngột thì start.js tự chạy lại', async () => {
    const before = (await api('GET', '/api/version')).data.started_at;
    const pid = execSync(`pgrep -f "${path.join(APP, 'server', 'index.js')}"`, { encoding: 'utf8' }).trim().split('\n')[0];
    process.kill(Number(pid), 'SIGKILL');
    const now = await waitFor(async () => { const x = (await api('GET', '/api/version')).data; return x.started_at !== before ? x : null; });
    assert.ok(now);
  });

  await step('dừng bằng "start.js --stop": tắt êm, xoá pid', async () => {
    // Chạy không đồng bộ để tiến trình kiểm thử kịp "nhận" start.js khi nó thoát (tránh tiến trình xác sống)
    const r = await new Promise((res) => { const c = spawn(process.execPath, ['start.js', '--stop'], { cwd: APP }); let out = ''; c.stdout.on('data', (d) => (out += d)); c.on('exit', (code) => res({ status: code, stdout: out })); });
    assert.strictEqual(r.status, 0); assert.match(r.stdout, /Đã dừng\./);
    await waitFor(() => launcher.exitCode !== null, 10000);
    assert.ok(!fs.existsSync(path.join(APP, 'data', 'chamcong.pid')));
    await assert.rejects(fetch(BASE + '/api/health'));
    assert.ok(fs.existsSync(path.join(APP, 'data', 'chamcong.db')), 'dữ liệu còn nguyên');
  });

  if (launcher && launcher.exitCode === null) launcher.kill();
  const failed = results.filter((r) => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} bước đạt`);
  if (failed.length) { console.log('\n--- log ---\n' + log.slice(-3000)); process.exit(1); }
  fs.rmSync(TMP, { recursive: true, force: true });
})();
