'use strict';
// Phân quyền phân hệ ERP, ẩn giá với nhân viên không thuộc bộ phận tài chính, và các hàm kiểm tra dữ liệu dùng chung.
const { q } = require('../db');
const { HttpError, bad } = require('../lib/http');
const U = require('../lib/util');
require('./schema');

// Chấm công luôn dùng được với mọi tài khoản. "Hệ thống" chỉ dành cho quản trị viên.
const MODULES = ['manage', 'orders', 'warehouse', 'delivery', 'finance'];
const MODULE_LABEL = {
  manage: 'Quản lý (khách hàng, sản phẩm)', orders: 'Nhập đơn', warehouse: 'Làm hàng, soạn hàng, check in',
  delivery: 'Điều hành giao hàng', finance: 'Tài chính kế toán (xem và đặt giá)',
};
const DEFAULTS = { manager: ['manage', 'orders', 'warehouse', 'delivery'], employee: [] };

function modulesOf(user) {
  if (user.role === 'admin') return [...MODULES];
  const r = q.get('SELECT modules FROM erp_perm WHERE employee_id=?', user.id);
  if (r) return r.modules.split(',').filter((m) => MODULES.includes(m));
  return [...(DEFAULTS[user.role] || [])];
}
const driverOf = (user) => q.get('SELECT * FROM drivers WHERE employee_id=? AND active=1', user.id) || null;

// need('orders', 'delivery'): có ít nhất một trong các quyền này. Dùng sau auth().
function need(...mods) {
  return (req) => {
    const have = modulesOf(req.user);
    if (!mods.some((m) => have.includes(m))) throw new HttpError(403, 'Bạn không có quyền sử dụng chức năng này', 'FORBIDDEN');
  };
}

// ---------- Ẩn giá ----------
// Chỉ quản trị viên và người được cấp quyền "Tài chính kế toán" nhìn thấy giá, thành tiền, công nợ.
const seesMoney = (user) => modulesOf(user).includes('finance');
const MONEY_KEYS = new Set(['price', 'amount', 'subtotal', 'discount', 'total', 'paid', 'debt', 'opening_debt', 'credit_limit', 'balance',
  'billed', 'unbilled', 'receivable', 'revenue7', 'sum', 'price_list_id', 'collected', 'due']);
function stripMoney(v) {
  if (Array.isArray(v)) return v.map(stripMoney);
  if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
    const o = {};
    for (const k of Object.keys(v)) if (!MONEY_KEYS.has(k)) o[k] = stripMoney(v[k]);
    return o;
  }
  return v;
}
// Middleware đặt sau auth(): với người không có quyền xem giá, mọi trường tiền trong kết quả JSON bị bỏ đi trước khi gửi về trình duyệt.
function hideMoney(req, res) {
  if (seesMoney(req.user)) return;
  const orig = res.json;
  res.json = (data, status) => orig(stripMoney(data), status);
}

const text = (v, max = 200) => String(v === null || v === undefined ? '' : v).trim().slice(0, max);
function reqText(v, label, max = 200) {
  const s = text(v, max);
  if (!s) throw bad(`Vui lòng nhập ${label}`);
  return s;
}
function money(v, label, { min = 0, max = 1e12 } = {}) {
  const n = Number(v === '' || v === null || v === undefined ? 0 : v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} không hợp lệ`);
  return Math.round(n);
}
function date(v, label, fallback) {
  const s = text(v, 10) || fallback;
  if (!U.isYmd(s)) throw bad(`${label} không hợp lệ`);
  return s;
}
const like = (s) => `%${String(s).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
const page = (req, def = 30) => {
  const per = Math.min(200, Math.max(1, Number(req.query.per) || def));
  const p = Math.max(1, Number(req.query.page) || 1);
  return { per, offset: (p - 1) * per, page: p };
};
const nowTs = () => Date.now();

// Công nợ của khách = nợ đầu kỳ + đơn đã giao - tiền đã thu (không tính phiếu thu đã huỷ)
const DEBT_SQL = `(c.opening_debt
  + COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.customer_id=c.id AND o.status='delivered'),0)
  - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id=c.id AND p.voided=0),0))`;

module.exports = { MODULES, MODULE_LABEL, modulesOf, driverOf, need, seesMoney, hideMoney, stripMoney, text, reqText, money, date, like, page, nowTs, DEBT_SQL };
