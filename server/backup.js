'use strict';
// Sao lưu tự động lúc 02:00 mỗi đêm, danh sách bản sao lưu, và nạp lại dữ liệu cũ.
// Bản sao lưu là file SQLite nằm ở DATA_DIR/backups. Ảnh chấm công (DATA_DIR/photos) không nằm trong file này.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const C = require('./config');
const { db, q, tx, settings, setSetting, backupTo, audit } = require('./db');
const { bad, notFound } = require('./lib/http');

const DIR = path.join(C.DATA_DIR, 'backups');
const AUTO_HOUR = 2;
const KINDS = { 'tu-dong': 'Tự động', 'thu-cong': 'Thủ công', 'truoc-khoi-phuc': 'Trước khi khôi phục', 'truoc-cap-nhat': 'Trước khi cập nhật phiên bản', 'tai-len': 'Dữ liệu cũ đã tải lên' };
const KEEP_EXTRA = 5; // số bản "trước khi khôi phục" và "tải lên" được giữ lại
const NAME_RE = /^[\w.-]+\.db$/;
const REQUIRED = ['employees', 'logs', 'settings', 'branches'];

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const kindOf = (name) => Object.keys(KINDS).find((k) => name.startsWith(k + '-')) || 'khac';

function safeName(name) {
  if (!NAME_RE.test(String(name || ''))) throw bad('Tên file không hợp lệ');
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) throw notFound('Không tìm thấy bản sao lưu');
  return p;
}

function list() {
  return fs.readdirSync(DIR).filter((f) => NAME_RE.test(f)).map((name) => {
    const st = fs.statSync(path.join(DIR, name));
    const kind = kindOf(name);
    return { name, size: st.size, ts: st.mtimeMs, kind, kind_label: KINDS[kind] || 'Khác' };
  }).sort((a, b) => b.ts - a.ts);
}

function prune() {
  const keep = Math.max(1, Number(settings().backup_keep) || 30);
  const rows = list();
  const drop = [
    ...rows.filter((r) => r.kind === 'tu-dong').slice(keep),
    ...rows.filter((r) => r.kind === 'truoc-khoi-phuc').slice(KEEP_EXTRA),
    ...rows.filter((r) => r.kind === 'truoc-cap-nhat').slice(KEEP_EXTRA),
    ...rows.filter((r) => r.kind === 'tai-len').slice(KEEP_EXTRA),
  ];
  for (const r of drop) { try { fs.unlinkSync(path.join(DIR, r.name)); } catch { /* đã xoá */ } }
}

// kind: 'tu-dong' | 'thu-cong' | 'truoc-khoi-phuc'
function create(kind) {
  let name = `${kind}-${stamp()}.db`;
  for (let n = 2; fs.existsSync(path.join(DIR, name)); n++) name = `${kind}-${stamp()}-${n}.db`; // hai bản trong cùng một giây vẫn khác tên
  backupTo(path.join(DIR, name));
  if (kind === 'tu-dong') prune();
  return name;
}

function runAuto() {
  const now = new Date();
  try {
    const name = create('tu-dong');
    setSetting('backup_last', JSON.stringify({ ts: Date.now(), ok: true, name }));
    console.log(`[chamcong] Đã sao lưu tự động: ${name}`);
  } catch (e) {
    setSetting('backup_last', JSON.stringify({ ts: Date.now(), ok: false, error: String(e.message || e) }));
    console.error('[chamcong] Sao lưu tự động lỗi:', e);
  }
  setSetting('backup_last_day', dayKey(now)); // dù lỗi cũng không thử lại liên tục; đêm sau thử lại
}

// Mỗi phút kiểm tra: qua 02:00 mà hôm nay chưa sao lưu thì chạy (nếu máy chủ tắt đúng 02:00 thì bù khi bật lại)
function tick() {
  try {
    const S = settings();
    if (S.auto_backup !== '1') return;
    const now = new Date();
    if (now.getHours() < AUTO_HOUR || S.backup_last_day === dayKey(now)) return;
    runAuto();
  } catch (e) { console.error('[chamcong] Lịch sao lưu lỗi:', e); }
}
function start() {
  // Gọi lại được khi ứng dụng nạp lại sau cập nhật: huỷ lịch cũ trước để không chạy trùng
  for (const t of global.__ccBackupTimers || []) clearTimeout(t);
  const a = setTimeout(tick, 5000), b = setInterval(tick, 60 * 1000);
  a.unref(); b.unref();
  global.__ccBackupTimers = [a, b];
}

function nextRun() {
  const S = settings();
  if (S.auto_backup !== '1') return null;
  const now = new Date();
  const d = new Date(now); d.setHours(AUTO_HOUR, 0, 0, 0);
  if (S.backup_last_day === dayKey(now) || d <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function status() {
  const S = settings();
  let last = null;
  try { last = S.backup_last ? JSON.parse(S.backup_last) : null; } catch { /* bỏ qua */ }
  return { auto: S.auto_backup === '1', keep: Number(S.backup_keep) || 30, hour: AUTO_HOUR, last, next: nextRun(), items: list() };
}

// ---------- Kiểm tra và nạp dữ liệu cũ ----------
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
function inspect(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (!head.equals(SQLITE_MAGIC)) throw bad('Đây không phải file dữ liệu chấm công (.db)');
  let o;
  try {
    o = new DatabaseSync(file, { readOnly: true });
    if (o.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('File bị hỏng, không đọc được');
    const have = o.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const miss = REQUIRED.filter((t) => !have.includes(t));
    if (miss.length) throw new Error('Không phải dữ liệu của hệ thống chấm công này (thiếu bảng: ' + miss.join(', ') + ')');
    const n = (t) => o.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const r = o.prepare('SELECT MIN(work_date) AS a, MAX(work_date) AS b FROM logs').get();
    return { employees: n('employees'), logs: n('logs'), from: r.a, to: r.b };
  } catch (e) {
    throw e.status ? e : bad(e.message || 'File không đọc được');
  } finally { try { o && o.close(); } catch { /* đã đóng */ } }
}

// Thay toàn bộ dữ liệu hiện tại bằng dữ liệu trong file. Tự sao lưu bản hiện tại trước.
function restore(file) {
  const info = inspect(file);
  const safety = create('truoc-khoi-phuc');
  const esc = file.replace(/'/g, "''");
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec(`ATTACH DATABASE '${esc}' AS old`);
  try {
    const cols = (schema, t) => db.prepare(`PRAGMA ${schema}.table_info(${t})`).all().map((c) => c.name);
    const mainTables = db.prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    const oldTables = db.prepare("SELECT name FROM old.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
    tx(() => {
      for (const t of mainTables) {
        db.exec(`DELETE FROM main."${t}"`);
        if (!oldTables.includes(t)) continue;
        const oc = cols('old', t);
        const common = cols('main', t).filter((c) => oc.includes(c)).map((c) => `"${c}"`).join(',');
        if (common) db.exec(`INSERT INTO main."${t}"(${common}) SELECT ${common} FROM old."${t}"`);
      }
      const broken = db.prepare('PRAGMA main.foreign_key_check').all();
      if (broken.length) throw bad('Dữ liệu cũ bị lệch liên kết giữa các bảng, đã huỷ khôi phục');
    });
  } finally {
    try { db.exec('DETACH DATABASE old'); } catch { /* chưa gắn */ }
    db.exec('PRAGMA foreign_keys=ON');
  }
  return { ...info, safety };
}

module.exports = { _tick: tick, DIR, list, create, status, start, safeName, inspect, restore, prune, stamp, audit, NAME_RE, q };
