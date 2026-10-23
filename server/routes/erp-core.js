'use strict';
// Trang chủ ERP: tổng quan, tìm kiếm, thông báo, khách hàng, sản phẩm, phân quyền.
const { q, audit } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { auth } = require('../auth');
const { nextCode } = require('../erp/schema');
const { MODULES, MODULE_LABEL, modulesOf, driverOf, need, seesMoney, hideMoney, text, reqText, money, like, DEBT_SQL } = require('../erp/common');
const { hashPassword, randomPin } = require('../lib/security');
const { kv } = require('../erp/schema');
const { priceMap } = require('../erp/pricing');
const L = require('../erp/orders-lib');
const { scopeSql } = require('./requests');

const ymdAdd = (s, n) => U.addDays(s, n);

module.exports = (app) => {
  // Quyền của người đang đăng nhập: giao diện dùng để ẩn/hiện menu
  app.get('/api/erp/me', auth(), (req, res) => {
    const d = driverOf(req.user);
    res.json({ modules: modulesOf(req.user), is_admin: req.user.role === 'admin', driver: d ? { id: d.id, name: d.name } : null });
  });

  // ---------- Tổng quan ----------
  app.get('/api/erp/dashboard', auth(), hideMoney, (req, res) => {
    const mods = modulesOf(req.user);
    const today = U.today();
    const out = { today, modules: mods };
    if (mods.some((m) => ['orders', 'delivery', 'finance', 'warehouse'].includes(m))) {
      const cnt = (sql, ...a) => q.get(sql, ...a).n;
      const live = "status<>'cancelled'";
      const nToday = cnt(`SELECT COUNT(*) n FROM orders WHERE order_date=? AND ${live}`, today);
      const nYest = cnt(`SELECT COUNT(*) n FROM orders WHERE order_date=? AND ${live}`, ymdAdd(today, -1));
      const sToday = Object.fromEntries(q.all("SELECT status, COUNT(*) n FROM orders WHERE order_date=? GROUP BY status", today).map((r) => [r.status, r.n]));
      const days = Array.from({ length: 7 }, (_, i) => ymdAdd(today, i - 6));
      const rev = Object.fromEntries(q.all(`SELECT order_date d, SUM(total) s FROM orders WHERE order_date BETWEEN ? AND ? AND ${live} GROUP BY order_date`, days[0], days[6]).map((r) => [r.d, r.s]));
      const debtRows = q.all(`SELECT ${DEBT_SQL} AS debt FROM customers c`);
      out.orders = {
        today: nToday,
        yesterday: nYest,
        producing: cnt("SELECT COUNT(*) n FROM orders WHERE status='producing'"),
        delivering: cnt("SELECT COUNT(*) n FROM orders WHERE status='delivering'"),
        new_open: cnt("SELECT COUNT(*) n FROM orders WHERE status='new'"),
        status_today: { new: sToday.new || 0, producing: sToday.producing || 0, delivering: sToday.delivering || 0, delivered: sToday.delivered || 0, cancelled: sToday.cancelled || 0 },
        revenue7: days.map((d) => ({ date: d, total: rev[d] || 0 })),
        latest: q.all(`SELECT o.id, o.code, o.total, o.status, o.created_at, c.name AS customer_name FROM orders o JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC LIMIT 5`),
        unassigned: cnt("SELECT COUNT(*) n FROM orders WHERE trip_id IS NULL AND status IN ('new','producing') AND delivery_date<=?", today),
        to_make: cnt("SELECT COUNT(*) n FROM orders WHERE status IN ('new','producing') AND checked_at IS NULL AND delivery_date<=?", today),
        to_check: cnt("SELECT COUNT(*) n FROM orders WHERE status IN ('new','producing') AND checked_at IS NULL AND delivery_date<=?", today),
        checked_wait: cnt("SELECT COUNT(*) n FROM orders WHERE status IN ('new','producing') AND checked_at IS NOT NULL"),
        from_app_new: cnt("SELECT COUNT(*) n FROM orders WHERE status='new' AND source='app'"),
      };
      out.receivable = { total: debtRows.reduce((s, r) => s + Math.max(0, r.debt), 0), customers: debtRows.filter((r) => r.debt > 0).length };
    }
    // Chấm công của chính người dùng hôm nay
    const logs = q.all("SELECT type, ts FROM logs WHERE employee_id=? AND work_date=? ORDER BY ts", req.user.id, today);
    const first = logs.find((l) => l.type === 'in');
    out.attendance = { checked_in: !!first, first_in: first ? first.ts : null, last: logs.length ? logs[logs.length - 1] : null, tracked: !!req.user.track };
    res.json(out);
  });

  // ---------- Thông báo (tổng hợp từ dữ liệu thật) ----------
  app.get('/api/erp/notifications', auth(), (req, res) => {
    const mods = modulesOf(req.user);
    const items = [];
    if (mods.includes('orders') || mods.includes('delivery')) {
      for (const e of q.all(`SELECT e.ts, e.kind, e.detail, o.code, c.name AS cname FROM order_events e JOIN orders o ON o.id=e.order_id JOIN customers c ON c.id=o.customer_id
                             WHERE e.kind IN ('created','status','cancelled') ORDER BY e.id DESC LIMIT 8`)) {
        const t = e.kind === 'created' ? `Đơn hàng ${e.code} của ${e.cname} vừa được tạo`
          : e.kind === 'cancelled' ? `Đơn hàng ${e.code} đã bị huỷ`
          : e.detail.endsWith('Đã giao') ? `Đơn hàng ${e.code} đã được giao thành công` : `Đơn hàng ${e.code}: ${e.detail}`;
        items.push({ ts: e.ts, kind: e.kind === 'cancelled' ? 'warn' : e.detail.endsWith('Đã giao') ? 'ok' : 'info', text: t, route: 'order/' + e.code });
      }
      const un = q.get("SELECT COUNT(*) n FROM orders WHERE trip_id IS NULL AND status IN ('new','producing') AND delivery_date<=?", U.today()).n;
      if (un) items.push({ ts: Date.now(), kind: 'warn', text: `Có ${un} đơn hàng cần giao hôm nay chưa được gán chuyến`, route: 'delivery' });
    }
    if (mods.includes('finance')) {
      const over = q.all(`SELECT c.name, c.credit_limit, ${DEBT_SQL} AS debt FROM customers c WHERE c.credit_limit>0 AND c.active=1`).filter((r) => r.debt > r.credit_limit);
      for (const r of over.slice(0, 3)) items.push({ ts: Date.now(), kind: 'warn', text: `Công nợ khách hàng ${r.name} vượt hạn mức: ${r.debt.toLocaleString('vi-VN')}đ`, route: 'debts' });
    }
    if (req.user.role !== 'employee') {
      const sc = scopeSql(req.user);
      const n = q.get(`SELECT COUNT(*) AS n FROM requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='pending' AND ${sc.sql}`, ...sc.params).n;
      if (n) items.push({ ts: Date.now(), kind: 'info', text: `Có ${n} đơn từ nhân sự đang chờ duyệt`, embed: 'requests' });
      for (const l of q.all(`SELECT l.ts, l.type, e.full_name FROM logs l JOIN employees e ON e.id=l.employee_id ORDER BY l.ts DESC LIMIT 3`)) {
        items.push({ ts: l.ts, kind: 'user', text: `Nhân viên ${l.full_name} vừa chấm công ${l.type === 'in' ? 'vào' : 'ra'}`, embed: 'logs' });
      }
    }
    for (const a of q.all('SELECT title, created_at FROM announcements WHERE active=1 ORDER BY pinned DESC, id DESC LIMIT 3')) items.push({ ts: a.created_at, kind: 'info', text: `Thông báo: ${a.title}` });
    items.sort((a, b) => b.ts - a.ts);
    res.json(items.slice(0, 20));
  });

  // ---------- Tìm kiếm nhanh (Ctrl+K) ----------
  app.get('/api/erp/search', auth(), hideMoney, (req, res) => {
    const s = text(req.query.q, 60);
    if (s.length < 2) return res.json({ orders: [], customers: [], employees: [] });
    const mods = modulesOf(req.user);
    const L = like(s);
    const out = { orders: [], customers: [], employees: [] };
    if (mods.includes('orders') || mods.includes('delivery') || mods.includes('finance')) {
      out.orders = q.all(`SELECT o.id, o.code, o.status, o.total, c.name AS customer_name FROM orders o JOIN customers c ON c.id=o.customer_id
        WHERE o.code LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' ORDER BY o.id DESC LIMIT 6`, L, L);
      out.customers = q.all(`SELECT id, code, name, phone FROM customers WHERE name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' ORDER BY name LIMIT 6`, L, L, L);
    }
    if (mods.includes('manage')) {
      out.employees = q.all(`SELECT id, code, full_name FROM employees WHERE active=1 AND (full_name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') LIMIT 6`, L, L, L);
    }
    res.json(out);
  });

  // ---------- Khách hàng ----------
  // Không bao giờ trả mật khẩu app (app_hash) về trình duyệt
  const CUS_COLS = 'c.id, c.code, c.name, c.phone, c.contact, c.email, c.address, c.tax_code, c.opening_debt, c.credit_limit, c.note, c.active, c.created_at, c.area, c.price_list_id, c.app_login, c.app_active';
  const CUS_SELECT = `SELECT ${CUS_COLS}, ${DEBT_SQL} AS debt,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status<>'cancelled') AS order_count FROM customers c`;

  app.get('/api/customers', auth(), need('manage', 'orders', 'delivery', 'finance', 'warehouse'), hideMoney, (req, res) => {
    const where = [];
    const params = [];
    if (req.query.all !== '1') where.push('c.active=1');
    if (req.query.search) {
      const L = like(text(req.query.search, 60));
      where.push("(c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')");
      params.push(L, L, L);
    }
    res.json(q.all(`${CUS_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name COLLATE NOCASE LIMIT 2000`, ...params));
  });

  app.get('/api/customers/:id', auth(), need('manage', 'orders', 'delivery', 'finance', 'warehouse'), hideMoney, (req, res) => {
    const c = q.get(`${CUS_SELECT} WHERE c.id=?`, Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    c.orders = q.all("SELECT id, code, order_date, delivery_date, status, total FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 20", c.id);
    c.payments = q.all("SELECT id, code, paid_date, amount, method, voided FROM payments WHERE customer_id=? ORDER BY id DESC LIMIT 10", c.id);
    res.json(c);
  });

  function customerData(b, cur, canMoney) {
    return {
      name: reqText(b.name, 'tên khách hàng', 150),
      phone: text(b.phone, 30),
      contact: text(b.contact, 100),
      email: text(b.email, 120),
      address: text(b.address, 300),
      area: text(b.area, 80),
      tax_code: text(b.tax_code, 20),
      // Nợ đầu kỳ và hạn mức là số liệu tài chính: người không có quyền tài chính không đổi được
      opening_debt: !canMoney ? (cur ? cur.opening_debt : 0) : money(b.opening_debt || 0, 'Nợ đầu kỳ', { min: -1e12 }),
      credit_limit: !canMoney ? (cur ? cur.credit_limit : 0) : money(b.credit_limit || 0, 'Hạn mức công nợ'),
      note: text(b.note, 500),
    };
  }
  app.post('/api/customers', auth(), need('manage'), hideMoney, (req, res) => {
    const d = customerData(req.body, null, seesMoney(req.user));
    let code = text(req.body.code, 30).toUpperCase();
    if (code && q.get('SELECT 1 x FROM customers WHERE code=?', code)) throw bad('Mã khách hàng đã tồn tại');
    if (!code) code = nextCode('KH');
    const r = q.run(`INSERT INTO customers(code,name,phone,contact,email,address,area,tax_code,opening_debt,credit_limit,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      code, d.name, d.phone, d.contact, d.email, d.address, d.area, d.tax_code, d.opening_debt, d.credit_limit, d.note, Date.now());
    audit(req.user, 'Thêm khách hàng', `${code} - ${d.name}`);
    res.json(q.get(`${CUS_SELECT} WHERE c.id=?`, Number(r.lastInsertRowid)));
  });
  app.put('/api/customers/:id', auth(), need('manage'), hideMoney, (req, res) => {
    const c = q.get('SELECT * FROM customers WHERE id=?', Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    const d = customerData(req.body, c, seesMoney(req.user));
    q.run(`UPDATE customers SET name=?, phone=?, contact=?, email=?, address=?, area=?, tax_code=?, opening_debt=?, credit_limit=?, note=?, active=? WHERE id=?`,
      d.name, d.phone, d.contact, d.email, d.address, d.area, d.tax_code, d.opening_debt, d.credit_limit, d.note, req.body.active === false || req.body.active === 0 ? 0 : 1, c.id);
    audit(req.user, 'Sửa khách hàng', `${c.code} - ${d.name}`);
    res.json(q.get(`${CUS_SELECT} WHERE c.id=?`, c.id));
  });
  app.del('/api/customers/:id', auth(), need('manage'), (req, res) => {
    const c = q.get('SELECT * FROM customers WHERE id=?', Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    const used = q.get('SELECT (SELECT COUNT(*) FROM orders WHERE customer_id=?) + (SELECT COUNT(*) FROM payments WHERE customer_id=?) AS n', c.id, c.id).n;
    if (used) {
      q.run('UPDATE customers SET active=0 WHERE id=?', c.id);
      audit(req.user, 'Ngừng giao dịch khách hàng', `${c.code} - ${c.name}`);
      return res.json({ ok: true, deactivated: true });
    }
    q.run('DELETE FROM customers WHERE id=?', c.id);
    audit(req.user, 'Xoá khách hàng', `${c.code} - ${c.name}`);
    res.json({ ok: true, deleted: true });
  });

  // ---------- Sản phẩm ----------
  const READ_ALL = ['manage', 'orders', 'delivery', 'finance', 'warehouse'];
  app.get('/api/products', auth(), need(...READ_ALL), hideMoney, (req, res) => {
    const where = req.query.all === '1' ? '' : 'WHERE active=1';
    res.json(q.all(`SELECT * FROM products ${where} ORDER BY sort_no, name COLLATE NOCASE LIMIT 3000`));
  });
  function productData(b) {
    const step = Number(b.qty_step);
    const packKg = Number(b.pack_kg || 0);
    if (!(step > 0) || step > 1000) throw bad('Bước đặt hàng không hợp lệ');
    if (!(packKg >= 0) || packKg > 1000) throw bad('Khối lượng mỗi gói không hợp lệ');
    return {
      name: reqText(b.name, 'tên sản phẩm', 150), unit: (text(b.unit, 20) || 'KG').toUpperCase(), spec: text(b.spec, 60), pack_kg: packKg, pack_noun: text(b.pack_noun, 12) || 'gói',
      qty_step: step, group_name: text(b.group_name, 40), sort_no: Math.round(Number(b.sort_no) || 0), note: text(b.note, 300),
    };
  }
  app.post('/api/products', auth(), need('manage'), hideMoney, (req, res) => {
    const d = productData({ qty_step: 1, ...req.body });
    let code = text(req.body.code, 30).toUpperCase();
    if (code && q.get('SELECT 1 x FROM products WHERE code=?', code)) throw bad('Mã sản phẩm đã tồn tại');
    if (!code) { do code = nextCode('SP', 2); while (q.get('SELECT 1 x FROM products WHERE code=?', code)); }
    const price = seesMoney(req.user) ? money(req.body.price, 'Đơn giá') : 0;
    const r = q.run('INSERT INTO products(code,name,unit,spec,pack_kg,pack_noun,qty_step,group_name,sort_no,price,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      code, d.name, d.unit, d.spec, d.pack_kg, d.pack_noun, d.qty_step, d.group_name, d.sort_no, price, d.note, Date.now());
    audit(req.user, 'Thêm sản phẩm', `${code} - ${d.name}`);
    res.json(q.get('SELECT * FROM products WHERE id=?', Number(r.lastInsertRowid)));
  });
  app.put('/api/products/:id', auth(), need('manage'), hideMoney, (req, res) => {
    const p = q.get('SELECT * FROM products WHERE id=?', Number(req.params.id));
    if (!p) throw notFound('Không tìm thấy sản phẩm');
    const d = productData(req.body);
    const price = seesMoney(req.user) && req.body.price !== undefined ? money(req.body.price, 'Đơn giá') : p.price;
    q.run('UPDATE products SET name=?, unit=?, spec=?, pack_kg=?, pack_noun=?, qty_step=?, group_name=?, sort_no=?, price=?, note=?, active=? WHERE id=?',
      d.name, d.unit, d.spec, d.pack_kg, d.pack_noun, d.qty_step, d.group_name, d.sort_no, price, d.note, req.body.active === false || req.body.active === 0 ? 0 : 1, p.id);
    audit(req.user, 'Sửa sản phẩm', `${p.code} - ${d.name}`);
    res.json(q.get('SELECT * FROM products WHERE id=?', p.id));
  });
  app.del('/api/products/:id', auth(), need('manage'), (req, res) => {
    const p = q.get('SELECT * FROM products WHERE id=?', Number(req.params.id));
    if (!p) throw notFound('Không tìm thấy sản phẩm');
    if (q.get('SELECT 1 x FROM order_items WHERE product_id=? LIMIT 1', p.id)) {
      q.run('UPDATE products SET active=0 WHERE id=?', p.id);
      return res.json({ ok: true, deactivated: true });
    }
    q.run('DELETE FROM products WHERE id=?', p.id);
    audit(req.user, 'Xoá sản phẩm', `${p.code} - ${p.name}`);
    res.json({ ok: true, deleted: true });
  });

  // ---------- Bảng giá (chỉ bộ phận tài chính kế toán) ----------
  const fin = [auth(), need('finance')];
  app.get('/api/prices', ...fin, (req, res) => {
    res.json({
      products: q.all('SELECT id, code, name, spec, unit, group_name, price, active FROM products ORDER BY sort_no, name COLLATE NOCASE'),
      lists: q.all('SELECT l.*, (SELECT COUNT(*) FROM customers c WHERE c.price_list_id=l.id) AS customers FROM price_lists l ORDER BY l.name COLLATE NOCASE'),
      items: q.all('SELECT list_id, product_id, price FROM price_list_items'),
      app_show_price: kv.get('app_show_price', '0') === '1',
    });
  });
  app.put('/api/prices/product/:id', ...fin, (req, res) => {
    const p = q.get('SELECT * FROM products WHERE id=?', Number(req.params.id));
    if (!p) throw notFound('Không tìm thấy sản phẩm');
    const price = money(req.body.price, 'Đơn giá');
    q.run('UPDATE products SET price=? WHERE id=?', price, p.id);
    audit(req.user, 'Đặt giá chung', `${p.code}: ${p.price.toLocaleString('vi-VN')} → ${price.toLocaleString('vi-VN')}đ`);
    res.json({ ok: true, price });
  });
  app.put('/api/prices/item', ...fin, (req, res) => {
    const l = q.get('SELECT * FROM price_lists WHERE id=?', Number(req.body.list_id));
    const p = q.get('SELECT * FROM products WHERE id=?', Number(req.body.product_id));
    if (!l || !p) throw notFound('Không tìm thấy bảng giá hoặc sản phẩm');
    if (req.body.price === null || req.body.price === '') q.run('DELETE FROM price_list_items WHERE list_id=? AND product_id=?', l.id, p.id);
    else q.run('INSERT INTO price_list_items(list_id,product_id,price) VALUES(?,?,?) ON CONFLICT(list_id,product_id) DO UPDATE SET price=excluded.price', l.id, p.id, money(req.body.price, 'Đơn giá'));
    audit(req.user, 'Đặt giá theo bảng giá', `${l.name} / ${p.code}`);
    res.json({ ok: true });
  });
  app.post('/api/price-lists', ...fin, (req, res) => {
    const name = reqText(req.body.name, 'tên bảng giá', 80);
    if (q.get('SELECT 1 x FROM price_lists WHERE name=?', name)) throw bad('Đã có bảng giá trùng tên');
    const r = q.run('INSERT INTO price_lists(name,note) VALUES(?,?)', name, text(req.body.note, 200));
    const id = Number(r.lastInsertRowid);
    if (req.body.copy_base) q.run('INSERT INTO price_list_items(list_id,product_id,price) SELECT ?, id, price FROM products WHERE price>0', id);
    audit(req.user, 'Thêm bảng giá', name);
    res.json({ id, name });
  });
  app.put('/api/price-lists/:id', ...fin, (req, res) => {
    const l = q.get('SELECT * FROM price_lists WHERE id=?', Number(req.params.id));
    if (!l) throw notFound('Không tìm thấy bảng giá');
    const name = reqText(req.body.name, 'tên bảng giá', 80);
    if (q.get('SELECT 1 x FROM price_lists WHERE name=? AND id<>?', name, l.id)) throw bad('Đã có bảng giá trùng tên');
    q.run('UPDATE price_lists SET name=?, note=? WHERE id=?', name, text(req.body.note, 200), l.id);
    res.json({ ok: true });
  });
  app.del('/api/price-lists/:id', ...fin, (req, res) => {
    const l = q.get('SELECT * FROM price_lists WHERE id=?', Number(req.params.id));
    if (!l) throw notFound('Không tìm thấy bảng giá');
    q.run('UPDATE customers SET price_list_id=NULL WHERE price_list_id=?', l.id);
    q.run('DELETE FROM price_lists WHERE id=?', l.id);
    audit(req.user, 'Xoá bảng giá', l.name);
    res.json({ ok: true });
  });
  app.put('/api/customers/:id/price-list', ...fin, (req, res) => {
    const c = q.get('SELECT * FROM customers WHERE id=?', Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    const lid = req.body.price_list_id ? Number(req.body.price_list_id) : null;
    if (lid && !q.get('SELECT 1 x FROM price_lists WHERE id=?', lid)) throw bad('Bảng giá không hợp lệ');
    q.run('UPDATE customers SET price_list_id=? WHERE id=?', lid, c.id);
    audit(req.user, 'Gán bảng giá cho khách', `${c.code}`);
    res.json({ ok: true });
  });
  // Giá áp dụng cho một khách (để màn hình nhập đơn của tài chính hiển thị đúng thành tiền)
  app.get('/api/prices/for-customer/:id', ...fin, (req, res) => res.json(priceMap(Number(req.params.id))));
  // Áp lại giá hiện hành cho các đơn chưa chốt hoá đơn (mặc định chỉ dòng đang có giá 0)
  app.post('/api/prices/apply', ...fin, (req, res) => {
    const onlyZero = req.body.only_zero !== false;
    let n = 0;
    for (const o of q.all("SELECT id FROM orders WHERE status<>'cancelled'")) if (L.reprice(o.id, onlyZero)) n++;
    audit(req.user, 'Áp lại giá cho đơn hàng', `${n} đơn`);
    res.json({ ok: true, updated: n });
  });

  // ---------- Cài đặt app đặt hàng của khách ----------
  const cfg = () => ({
    app_show_price: kv.get('app_show_price', '0') === '1',
    app_cutoff_hour: Number(kv.get('app_cutoff_hour', '0')) || 0,
    app_max_days: Number(kv.get('app_max_days', '14')) || 14,
    app_notice: kv.get('app_notice', ''),
  });
  app.get('/api/erp/app-config', auth(), need('manage', 'finance'), (req, res) => res.json(cfg()));
  app.put('/api/erp/app-config', auth(), need('manage', 'finance'), (req, res) => {
    const b = req.body;
    if (b.app_show_price !== undefined) {
      if (!seesMoney(req.user)) throw new HttpError(403, 'Chỉ bộ phận tài chính được bật/tắt hiển thị giá cho khách', 'FORBIDDEN');
      kv.set('app_show_price', b.app_show_price ? '1' : '0');
    }
    if (b.app_cutoff_hour !== undefined) kv.set('app_cutoff_hour', String(Math.min(23, Math.max(0, Math.round(Number(b.app_cutoff_hour) || 0)))));
    if (b.app_max_days !== undefined) kv.set('app_max_days', String(Math.min(60, Math.max(1, Math.round(Number(b.app_max_days) || 14)))));
    if (b.app_notice !== undefined) kv.set('app_notice', text(b.app_notice, 300));
    audit(req.user, 'Cài đặt app đặt hàng', JSON.stringify(Object.keys(b)));
    res.json(cfg());
  });

  // ---------- Tài khoản app đặt hàng của đại lý ----------
  app.put('/api/customers/:id/app-account', auth(), need('manage'), (req, res) => {
    const c = q.get('SELECT * FROM customers WHERE id=?', Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    let login = text(req.body.login, 40).toLowerCase().replace(/\s+/g, '');
    if (!login) login = c.app_login || String(c.phone || '').replace(/\D/g, '') || c.code.toLowerCase();
    if (!/^[a-z0-9._@-]{3,40}$/.test(login)) throw bad('Tên đăng nhập chỉ gồm chữ không dấu, số và . _ - @ (3-40 ký tự)');
    if (q.get("SELECT 1 x FROM customers WHERE app_login=? AND id<>?", login, c.id)) throw bad('Tên đăng nhập này đã có người dùng, hãy chọn tên khác');
    const active = req.body.active === false || req.body.active === 0 ? 0 : 1;
    let password = null;
    if (req.body.reset || req.body.password || !c.app_hash) {
      password = text(req.body.password, 60) || randomPin(6);
      if (password.length < 6) throw bad('Mật khẩu phải có ít nhất 6 ký tự');
      q.run('UPDATE customers SET app_hash=?, app_tv=app_tv+1 WHERE id=?', hashPassword(password), c.id);
    }
    if (!active) q.run('UPDATE customers SET app_tv=app_tv+1 WHERE id=?', c.id);
    q.run('UPDATE customers SET app_login=?, app_active=? WHERE id=?', login, active, c.id);
    audit(req.user, password ? 'Cấp mật khẩu app đặt hàng' : 'Sửa tài khoản app đặt hàng', `${c.code} (${login})`);
    res.json({ login, password, active: !!active });
  });
  app.del('/api/customers/:id/app-account', auth(), need('manage'), (req, res) => {
    const c = q.get('SELECT * FROM customers WHERE id=?', Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    q.run("UPDATE customers SET app_login='', app_hash='', app_tv=app_tv+1 WHERE id=?", c.id);
    audit(req.user, 'Xoá tài khoản app đặt hàng', c.code);
    res.json({ ok: true });
  });

  // ---------- Phân quyền phân hệ ERP (quản trị viên) ----------
  app.get('/api/erp/perms', auth('admin'), (req, res) => {
    const rows = q.all(`SELECT e.id, e.code, e.full_name, e.role, e.position, p.modules AS custom,
        (SELECT d.id FROM drivers d WHERE d.employee_id=e.id AND d.active=1) AS driver_id
      FROM employees e LEFT JOIN erp_perm p ON p.employee_id=e.id WHERE e.active=1 ORDER BY e.code COLLATE NOCASE`);
    res.json({
      labels: MODULE_LABEL,
      rows: rows.map((r) => ({ id: r.id, code: r.code, full_name: r.full_name, role: r.role, position: r.position, driver: !!r.driver_id, custom: r.custom !== null, modules: modulesOf({ id: r.id, role: r.role }) })),
    });
  });
  app.put('/api/erp/perms/:id', auth('admin'), (req, res) => {
    const e = q.get('SELECT * FROM employees WHERE id=?', Number(req.params.id));
    if (!e) throw notFound('Không tìm thấy nhân viên');
    if (e.role === 'admin') throw new HttpError(400, 'Quản trị viên luôn có toàn quyền');
    if (req.body.reset) q.run('DELETE FROM erp_perm WHERE employee_id=?', e.id);
    else {
      const mods = (Array.isArray(req.body.modules) ? req.body.modules : []).filter((m) => MODULES.includes(m));
      q.run('INSERT INTO erp_perm(employee_id,modules) VALUES(?,?) ON CONFLICT(employee_id) DO UPDATE SET modules=excluded.modules', e.id, mods.join(','));
    }
    audit(req.user, 'Phân quyền ERP', `${e.code}: ${modulesOf(e).join(', ') || 'không có'}`);
    res.json({ ok: true, modules: modulesOf(e) });
  });
};
