'use strict';
// App đặt hàng của khách đại lý (/dl/): đăng nhập riêng, xem danh mục, lên đơn, theo dõi và huỷ đơn.
// Khách chỉ thấy đơn của chính mình. Giá chỉ hiện khi bộ phận tài chính bật "hiển thị giá cho khách".
const C = require('../config');
const { q, settings } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { signJwt, verifyJwt, checkPassword, hashPassword } = require('../lib/security');
const { loginGuard, loginFail, loginOk } = require('../auth');
const { kv } = require('../erp/schema');
const { text } = require('../erp/common');
const { priceMap } = require('../erp/pricing');
const L = require('../erp/orders-lib');

const TTL = 60 * 60 * 24 * 30;
const STATUS_TEXT = { new: 'Đã nhận đơn', producing: 'Đang làm hàng', delivering: 'Đang giao hàng', delivered: 'Đã giao', cancelled: 'Đã huỷ' };

// Khách chỉ dùng token riêng (có trường cu); token nhân viên không dùng được ở đây và ngược lại
function custAuth() {
  return (req) => {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const p = token ? verifyJwt(token, C.JWT_SECRET) : null;
    const fail = () => new HttpError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', 'UNAUTHORIZED');
    if (!p || !p.cu || p.id || p.ph) throw fail();
    const c = q.get("SELECT * FROM customers WHERE id=? AND active=1 AND app_active=1 AND app_login<>''", p.cu);
    if (!c || c.app_tv !== p.v) throw fail();
    req.cust = c;
  };
}
const issue = (c) => signJwt({ cu: c.id, v: c.app_tv }, C.JWT_SECRET, TTL);
const showPrice = () => kv.get('app_show_price', '0') === '1';
const me = (c) => ({ id: c.id, code: c.code, name: c.name, phone: c.phone, address: c.address, area: c.area });
const actor = (c) => ({ id: null, full_name: `Khách ${c.name}` });

// Ngày giao sớm nhất: hôm nay, hoặc ngày mai nếu đã quá giờ chốt đơn trong ngày
function minDeliveryDate() {
  const cut = Number(kv.get('app_cutoff_hour', '0')) || 0;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: C.TZ || process.env.TZ || 'Asia/Ho_Chi_Minh' }).format(new Date())) % 24;
  return cut && hour >= cut ? U.addDays(U.today(), 1) : U.today();
}

const recent = new Map(); // chống bấm gửi đơn hai lần
function view(o, withPrice) {
  const items = o.items.map((i) => ({ product_id: i.product_id, name: i.name, unit: i.unit, qty: i.qty, spec: i.spec || '', pack_text: i.pack_text, ...(withPrice ? { price: i.price, amount: i.amount } : {}) }));
  return {
    code: o.code, status: o.status, status_text: o.status === 'new' && o.source !== 'app' ? 'Đã nhận đơn' : STATUS_TEXT[o.status] || o.status, order_date: o.order_date, delivery_date: o.delivery_date,
    address: o.address, note: o.note, can_cancel: o.status === 'new' && !o.checked_at, created_at: o.created_at, items,
    ...(withPrice ? { total: o.total } : {}), item_count: items.length,
  };
}

module.exports = (app) => {
  app.post('/api/dl/login', (req, res) => {
    const login = text(req.body.login, 40).toLowerCase().replace(/\s+/g, '');
    const key = `dl|${req.ip}|${login}`;
    loginGuard(key);
    const c = login ? q.get("SELECT * FROM customers WHERE app_login=? AND active=1 AND app_active=1", login) : null;
    if (!c || !checkPassword(String(req.body.password || ''), c.app_hash)) {
      loginFail(key);
      throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu', 'BAD_LOGIN');
    }
    loginOk(key);
    res.json({ token: issue(c), customer: me(c) });
  });

  app.get('/api/dl/info', (req, res) => {
    const S = settings();
    res.json({ company_name: S.company_name });
  });

  const auth = custAuth();
  app.get('/api/dl/me', auth, (req, res) => {
    res.json({ customer: me(req.cust), show_price: showPrice(), min_date: minDeliveryDate(), max_date: U.addDays(U.today(), Number(kv.get('app_max_days', '14')) || 14), notice: kv.get('app_notice', ''), company_name: settings().company_name });
  });

  app.get('/api/dl/catalog', auth, (req, res) => {
    const withPrice = showPrice();
    const pm = withPrice ? priceMap(req.cust.id) : null;
    const rows = q.all('SELECT id, code, name, unit, spec, pack_kg, pack_noun, qty_step, group_name FROM products WHERE active=1 ORDER BY sort_no, name COLLATE NOCASE')
      .map((p) => ({ ...p, ...(withPrice ? { price: pm[p.id] || 0 } : {}) }));
    res.json({ show_price: withPrice, products: rows });
  });

  app.get('/api/dl/orders', auth, (req, res) => {
    const withPrice = showPrice();
    const rows = q.all('SELECT id FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 60', req.cust.id).map((r) => view(L.orderFull(r.id), withPrice));
    res.json(rows);
  });

  app.get('/api/dl/orders/:code', auth, (req, res) => {
    const r = q.get('SELECT id FROM orders WHERE code=? AND customer_id=?', String(req.params.code).toUpperCase(), req.cust.id);
    if (!r) throw notFound('Không tìm thấy đơn hàng');
    const o = L.orderFull(r.id);
    const events = q.all("SELECT ts, kind, detail FROM order_events WHERE order_id=? AND kind IN ('created','status','cancelled','checkin') ORDER BY id", r.id)
      .map((e) => ({ ts: e.ts, text: e.kind === 'created' ? 'Đã nhận đơn' : e.kind === 'cancelled' ? 'Đơn đã huỷ' : e.kind === 'checkin' ? 'Hàng đã soạn xong' : e.detail.replace(/: .*/, '') }));
    res.json({ ...view(o, showPrice()), events });
  });

  app.post('/api/dl/orders', auth, (req, res) => {
    const c = req.cust;
    const items = (Array.isArray(req.body.items) ? req.body.items : []).filter((i) => Number(i.qty) > 0).map((i) => ({ product_id: Number(i.product_id), qty: Number(i.qty) }));
    if (!items.length) throw bad('Giỏ hàng đang trống');
    const dd = text(req.body.delivery_date, 10) || minDeliveryDate();
    if (!U.isYmd(dd)) throw bad('Ngày giao không hợp lệ');
    if (dd < minDeliveryDate()) throw bad(`Ngày giao sớm nhất là ${U.fmtDate ? U.fmtDate(minDeliveryDate()) : minDeliveryDate()}${Number(kv.get('app_cutoff_hour', '0')) ? ` (đơn đặt sau ${kv.get('app_cutoff_hour')}h chuyển sang ngày hôm sau)` : ''}`);
    if (dd > U.addDays(U.today(), Number(kv.get('app_max_days', '14')) || 14)) throw bad('Ngày giao quá xa, vui lòng chọn ngày gần hơn');
    // Giới hạn số đơn trong ngày để tránh gửi nhầm hàng loạt
    const today = q.get("SELECT COUNT(*) n FROM orders WHERE customer_id=? AND source='app' AND order_date=?", c.id, U.today()).n;
    if (today >= 20) throw bad('Hôm nay bạn đã gửi quá nhiều đơn. Vui lòng gọi nhân viên để được hỗ trợ.');
    const sig = `${c.id}|${dd}|${items.map((i) => `${i.product_id}x${i.qty}`).sort().join(',')}`;
    const prev = recent.get(sig);
    if (prev && Date.now() - prev.ts < 60000) return res.json({ ...view(L.orderFull(prev.id), showPrice()), duplicate: true });
    const r = L.createOrder({ customer_id: c.id, delivery_date: dd, address: req.body.address, note: req.body.note, items }, actor(c), 'app', { canPrice: false, allowFree: false });
    recent.set(sig, { id: r.id, ts: Date.now() });
    for (const [k, v] of recent) if (Date.now() - v.ts > 120000) recent.delete(k);
    res.json(view(L.orderFull(r.id), showPrice()));
  });

  app.post('/api/dl/orders/:code/cancel', auth, (req, res) => {
    const r = q.get('SELECT * FROM orders WHERE code=? AND customer_id=?', String(req.params.code).toUpperCase(), req.cust.id);
    if (!r) throw notFound('Không tìm thấy đơn hàng');
    if (r.status !== 'new' || r.checked_at) throw bad('Đơn đã vào làm hàng nên không tự huỷ được. Vui lòng gọi nhân viên để được hỗ trợ.');
    L.cancelOrder(r, 'Khách huỷ qua app', { ...actor(req.cust), role: 'customer' });
    res.json({ ok: true });
  });

  app.post('/api/dl/password', auth, (req, res) => {
    const c = req.cust;
    if (!checkPassword(String(req.body.old_password || ''), c.app_hash)) throw bad('Mật khẩu hiện tại chưa đúng');
    const np = String(req.body.new_password || '');
    if (np.length < 6) throw bad('Mật khẩu mới phải có ít nhất 6 ký tự');
    q.run('UPDATE customers SET app_hash=?, app_tv=app_tv+1 WHERE id=?', hashPassword(np), c.id);
    const fresh = q.get('SELECT * FROM customers WHERE id=?', c.id);
    res.json({ token: issue(fresh) });
  });
};
