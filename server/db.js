'use strict';
// Cơ sở dữ liệu SQLite (module node:sqlite có sẵn trong Node 22+).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const C = require('./config');
const { hashPassword, randomToken } = require('./lib/security');

const file = path.join(C.DATA_DIR, 'chamcong.db');
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

const cache = new Map();
const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    if (cache.size > 400) cache.clear();
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
const q = {
  all: (sql, ...a) => stmt(sql).all(...norm(a)),
  get: (sql, ...a) => stmt(sql).get(...norm(a)),
  run: (sql, ...a) => stmt(sql).run(...norm(a)),
  exec: (sql) => db.exec(sql),
};
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* đã rollback */ }
    throw e;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL, lng REAL,
  radius INTEGER NOT NULL DEFAULT 100,
  allowed_ips TEXT NOT NULL DEFAULT '',
  qr_secret TEXT NOT NULL,
  kiosk_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 60,
  late_grace INTEGER NOT NULL DEFAULT 5,
  early_grace INTEGER NOT NULL DEFAULT 0,
  work_days TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin','manager','employee')),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  manager_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  position TEXT NOT NULL DEFAULT '',
  base_salary INTEGER NOT NULL DEFAULT 0,
  allowance INTEGER NOT NULL DEFAULT 0,
  annual_leave REAL NOT NULL DEFAULT 12,
  allow_remote INTEGER NOT NULL DEFAULT 0,
  track INTEGER NOT NULL DEFAULT 1,
  device_id TEXT,
  hired_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  tv INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emp_phone ON employees(phone);

CREATE TABLE IF NOT EXISTS schedules (
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_sch_date ON schedules(work_date);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  method TEXT NOT NULL DEFAULT 'gps',
  branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  lat REAL, lng REAL, accuracy REAL,
  ip TEXT, photo TEXT, device_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_logs_emp_date ON logs(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(work_date);
CREATE INDEX IF NOT EXISTS idx_logs_emp_ts ON logs(employee_id, ts);

CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1,
  deduct_balance INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('leave','ot','trip','wfh','explain')),
  leave_type_id INTEGER REFERENCES leave_types(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  session TEXT NOT NULL DEFAULT 'full',
  hours REAL,
  in_time TEXT, out_time TEXT,
  days REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approver_id INTEGER,
  approver_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_req_emp ON requests(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_req_status ON requests(status);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

-- Mẫu khuôn mặt (vector 128 số do face-api.js tính trên trình duyệt) để chấm công bằng nhận diện tại màn hình QR.
-- Đây là dữ liệu sinh trắc học: chỉ lưu khi nhân viên đồng ý, xoá theo nhân viên, nằm trong bản sao lưu.
CREATE TABLE IF NOT EXISTS face_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  descriptor TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_face_emp ON face_templates(employee_id);

-- Tệp nhỏ của hệ thống (logo công ty). Lưu trong CSDL để sao lưu cùng dữ liệu.
CREATE TABLE IF NOT EXISTS assets (
  name TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Hình ảnh hiện ở màn hình chờ của màn hình QR (kiosk). Lưu trong CSDL để sao lưu cùng dữ liệu.
-- token ngẫu nhiên không đoán được dùng làm địa chỉ ảnh công khai (cùng cách với khoá kiosk).
CREATE TABLE IF NOT EXISTS screen_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor_id INTEGER,
  actor_name TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
`);

const DEFAULT_SETTINGS = {
  company_name: 'Công ty của tôi',
  default_shift_id: '',
  allow_gps: '1',
  allow_wifi: '1',
  allow_qr: '1',
  require_photo: '0',
  bind_device: '0',
  max_accuracy: '150',
  min_gap_seconds: '60',
  full_day_ratio: '0.9',
  half_day_ratio: '0.4',
  std_days: '0',
  ot_multiplier: '1.5',
  ot_base_hours: '8',
  late_penalty_per_minute: '0',
  public_url: '',
  allow_face: '0', // chấm công bằng nhận diện khuôn mặt tại màn hình QR
  face_liveness: '1', // yêu cầu chớp mắt trước khi nhận diện
  face_threshold: '0.5', // độ lệch tối đa giữa hai khuôn mặt (nhỏ hơn = chặt hơn)
  auto_backup: '1', // tự sao lưu lúc 02:00 mỗi đêm
  backup_keep: '30', // số bản tự động được giữ lại
  backup_last: '',
  backup_last_day: '',
  logo_version: '', // khác rỗng khi công ty đã tải logo lên (dùng để làm mới bộ nhớ đệm)
  screensaver_on: '1', // màn hình QR chuyển sang màn hình chờ khi lâu không có ai chấm công
  screensaver_idle_min: '5', // số phút không chấm công (và không chạm màn hình) thì vào màn hình chờ
  screensaver_slide_sec: '8', // số giây mỗi hình / mỗi thông báo
  screensaver_announce: '1', // hiện thông báo của công ty (mục Thông báo) trên màn hình chờ
};

function settings() {
  const o = { ...DEFAULT_SETTINGS };
  for (const r of q.all('SELECT key, value FROM settings')) o[r.key] = r.value;
  return o;
}
function setSetting(key, value) {
  q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}

// Đường dẫn logo công ty, rỗng nếu chưa có
const logoUrl = (S) => (S.logo_version ? `/api/logo?v=${encodeURIComponent(S.logo_version)}` : '');

function audit(actor, action, detail = '') {
  q.run('INSERT INTO audit(ts,actor_id,actor_name,action,detail) VALUES(?,?,?,?,?)',
    Date.now(), actor ? actor.id : null, actor ? `${actor.code} - ${actor.full_name}` : 'hệ thống', action, String(detail).slice(0, 500));
}

// ---- Khởi tạo dữ liệu mặc định ----
function seed() {
  if (!q.get('SELECT 1 AS x FROM shifts LIMIT 1')) {
    const r = q.run("INSERT INTO shifts(name,start_time,end_time,break_minutes,late_grace,work_days) VALUES('Ca hành chính','08:00','17:00',60,5,'1,2,3,4,5,6')");
    setSetting('default_shift_id', r.lastInsertRowid);
  }
  if (!q.get('SELECT 1 AS x FROM leave_types LIMIT 1')) {
    const ins = (n, paid, ded) => q.run('INSERT INTO leave_types(name,paid,deduct_balance) VALUES(?,?,?)', n, paid, ded);
    ins('Nghỉ phép năm', 1, 1);
    ins('Nghỉ ốm', 1, 0);
    ins('Nghỉ việc riêng có lương', 1, 0);
    ins('Nghỉ không lương', 0, 0);
  }
  if (!q.get('SELECT 1 AS x FROM employees LIMIT 1')) {
    q.run(
      `INSERT INTO employees(code,full_name,password_hash,role,track,must_change_password,created_at,position)
       VALUES(?,?,?,?,0,1,?,?)`,
      C.ADMIN_CODE, 'Quản trị viên', hashPassword(C.ADMIN_PASSWORD), 'admin', Date.now(), 'Quản trị hệ thống'
    );
    console.log(`[chamcong] Đã tạo tài khoản quản trị: "${C.ADMIN_CODE}" / mật khẩu từ biến ADMIN_PASSWORD (mặc định "admin123"). Hệ thống sẽ bắt đổi mật khẩu khi đăng nhập lần đầu.`);
  }
}
seed();

function newBranchSecrets() {
  return { qr_secret: randomToken(24), kiosk_key: randomToken(12) };
}

// Sao lưu an toàn bằng VACUUM INTO (không cần dừng server)
function backupTo(dest) {
  const safe = dest.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${safe}'`);
}

module.exports = { db, q, tx, settings, setSetting, logoUrl, audit, DEFAULT_SETTINGS, newBranchSecrets, backupTo, file };
