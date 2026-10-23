'use strict';
// Cấu trúc dữ liệu của các phân hệ ERP: khách hàng, sản phẩm, đơn hàng, giao hàng, công nợ, hoá đơn, phân quyền.
// Dùng CREATE TABLE IF NOT EXISTS nên chạy lại bao nhiêu lần cũng an toàn; dữ liệu chấm công hiện có không bị đụng tới.
const { db, q } = require('../db');

db.exec(`
CREATE TABLE IF NOT EXISTS erp_seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

-- Quyền dùng phân hệ ERP của từng người (danh sách phân hệ, cách nhau bằng dấu phẩy). Chưa có dòng thì dùng quyền mặc định theo vai trò.
CREATE TABLE IF NOT EXISTS erp_perm (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  modules TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  opening_debt INTEGER NOT NULL DEFAULT 0,
  credit_limit INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cus_name ON customers(name);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'cái',
  price INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL DEFAULT '',
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  trip_date TEXT NOT NULL,
  driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  route_id INTEGER REFERENCES delivery_routes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','done')),
  note TEXT NOT NULL DEFAULT '',
  started_at INTEGER,
  finished_at INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','producing','delivering','delivered','cancelled')),
  subtotal INTEGER NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  stop_seq INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  print_count INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER,
  delivered_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_ord_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_ord_deliv ON orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_ord_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_ord_cus ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_ord_trip ON orders(trip_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_item_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_evt_order ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_evt_ts ON order_events(ts);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  external_no TEXT NOT NULL DEFAULT '',
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  issue_date TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','void')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_cus ON invoices(customer_id);

CREATE TABLE IF NOT EXISTS invoice_orders (
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL PRIMARY KEY REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  paid_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  voided INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_cus ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(paid_date);
`);

// ---------- Nâng cấp cấu trúc (phiên bản 1.4.0): chạy lại nhiều lần vẫn an toàn ----------
const colsOf = (t) => new Set(q.all(`PRAGMA table_info(${t})`).map((r) => r.name));
function addCol(t, c, ddl) { if (!colsOf(t).has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${ddl}`); }

// Sản phẩm: quy cách đóng gói, bước đặt hàng, nhóm hàng
addCol('products', 'spec', "TEXT NOT NULL DEFAULT ''");          // quy cách hiển thị: 500gr, Rời (xá)...
addCol('products', 'pack_kg', 'REAL NOT NULL DEFAULT 0');        // khối lượng 1 gói/hộp (kg); 0 = hàng rời
addCol('products', 'pack_noun', "TEXT NOT NULL DEFAULT 'gói'");  // gói, hộp, bịch
addCol('products', 'qty_step', 'REAL NOT NULL DEFAULT 1');       // số lượng đặt phải là bội của số này
addCol('products', 'group_name', "TEXT NOT NULL DEFAULT ''");
addCol('products', 'sort_no', 'INTEGER NOT NULL DEFAULT 0');
// Khách hàng: khu vực, bảng giá, tài khoản app đặt hàng
addCol('customers', 'area', "TEXT NOT NULL DEFAULT ''");
addCol('customers', 'price_list_id', 'INTEGER');
addCol('customers', 'app_login', "TEXT NOT NULL DEFAULT ''");
addCol('customers', 'app_hash', "TEXT NOT NULL DEFAULT ''");
addCol('customers', 'app_tv', 'INTEGER NOT NULL DEFAULT 1');
addCol('customers', 'app_active', 'INTEGER NOT NULL DEFAULT 1');
// Đơn hàng: check in hàng trước khi giao
addCol('orders', 'checked_at', 'INTEGER');
addCol('orders', 'checked_by', 'INTEGER');

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_cus_applogin ON customers(app_login) WHERE app_login <> '';
CREATE TABLE IF NOT EXISTS price_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS price_list_items (
  list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  PRIMARY KEY (list_id, product_id)
);
CREATE TABLE IF NOT EXISTS erp_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '');
`);

const kv = {
  get: (k, def = '') => { const r = q.get('SELECT v FROM erp_kv WHERE k=?', k); return r ? r.v : def; },
  set: (k, v) => q.run('INSERT INTO erp_kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v)),
};

// Danh mục 28 sản phẩm theo bảng báo giá của công ty. Nạp một lần; bỏ qua sản phẩm đã có (trùng mã hoặc trùng tên).
// [mã, tên, nhóm, quy cách, kg/gói, bước đặt, ĐVT, đơn vị đóng gói]
const SEED = [
  ['SP01', 'BÚN SỢI NHUYỄN', 'Bún', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP02', 'BÚN SỢI TRUNG', 'Bún', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP03', 'BÚN BÒ', 'Bún', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP04', 'MÌ QUẢNG TRẮNG', 'Mì Quảng', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP05', 'MÌ QUẢNG VÀNG', 'Mì Quảng', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP06', 'MÌ QUẢNG NÂU', 'Mì Quảng', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP07', 'PHỞ BẮC', 'Phở', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP08', 'PHỞ NAM', 'Phở', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP09', 'PHỞ XÀO (HỦ TIẾU XÀO)', 'Phở', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP10', 'BÁNH ƯỚT - PHỞ CUỐN', 'Bánh', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP11', 'BÁNH CANH VUÔNG (CÓ BỘT)', 'Bánh', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP12', 'BÁNH CANH TRÒN', 'Bánh', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP13', 'HỦ TIẾU DAI (1 bịch)', 'Hủ tiếu', '1 bịch 5Kg', 5, 5, 'KG', 'bịch'],
  ['SP14', 'BÁNH HỎI (TRẮNG - XANH - TÍM)', 'Bánh', '500gr', 0.5, 0.5, 'KG', 'gói'],
  ['SP15', 'NUI TƯƠI TRẮNG', 'Nui tươi', '500gr', 0.5, 1, 'HỘP', 'hộp'],
  ['SP16', 'NUI TƯƠI VÀNG', 'Nui tươi', '500gr', 0.5, 1, 'HỘP', 'hộp'],
  ['SP17', 'NUI TƯƠI CHÙM NGÂY', 'Nui tươi', '500gr (1 hộp)', 0.5, 1, 'HỘP', 'hộp'],
  ['SP18', 'NUI TƯƠI LÁ CẨM', 'Nui tươi', '500gr (1 hộp)', 0.5, 1, 'HỘP', 'hộp'],
  ['SP19', 'NUI TƯƠI ĐẬU XANH', 'Nui tươi', '500gr (1 hộp)', 0.5, 1, 'HỘP', 'hộp'],
  ['SP20', 'NUI TƯƠI CẢI THÌA', 'Nui tươi', '500gr (1 hộp)', 0.5, 1, 'HỘP', 'hộp'],
  ['SP21', 'NUI TƯƠI HẠT SEN', 'Nui tươi', '500gr (1 hộp)', 0.5, 1, 'HỘP', 'hộp'],
  ['SP22', 'NUI TƯƠI CỦ SÂM', 'Nui tươi', '500gr (1 hộp)', 0.5, 1, 'HỘP', 'hộp'],
  ['SP23', 'PHỞ CHÙM NGÂY', 'Phở rời', 'Rời (xá)', 0, 1, 'KG', 'kg'],
  ['SP24', 'PHỞ LÁ CẨM', 'Phở rời', 'Rời (xá)', 0, 1, 'KG', 'kg'],
  ['SP25', 'PHỞ ĐẬU XANH', 'Phở rời', 'Rời (xá)', 0, 1, 'KG', 'kg'],
  ['SP26', 'PHỞ CẢI THÌA', 'Phở rời', 'Rời (xá)', 0, 1, 'KG', 'kg'],
  ['SP27', 'PHỞ HẠT SEN', 'Phở rời', 'Rời (xá)', 0, 1, 'KG', 'kg'],
  ['SP28', 'PHỞ CỦ SÂM', 'Phở rời', 'Rời (xá)', 0, 1, 'KG', 'kg'],
];
if (!kv.get('seed_products_v1')) {
  SEED.forEach((r, i) => {
    if (q.get('SELECT 1 x FROM products WHERE code=? OR name=?', r[0], r[1])) return;
    q.run('INSERT INTO products(code,name,group_name,spec,pack_kg,qty_step,unit,pack_noun,price,sort_no,created_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)', r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], i + 1, Date.now());
  });
  q.run('INSERT INTO erp_seq(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=MAX(value, excluded.value)', 'SP', SEED.length);
  kv.set('seed_products_v1', '1');
}

// Sinh mã tăng dần theo tiền tố (DH000001, KH000001, ...). Chạy đồng bộ trong một tiến trình nên không bị trùng.
function nextCode(prefix, width = 6) {
  q.run('INSERT INTO erp_seq(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1', prefix);
  return prefix + String(q.get('SELECT value FROM erp_seq WHERE name=?', prefix).value).padStart(width, '0');
}

module.exports = { nextCode, kv };
