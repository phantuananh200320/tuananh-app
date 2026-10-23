'use strict';
// Điều hành giao hàng: tài xế, tuyến, chuyến giao, điều đơn, phân bổ hàng hoá, ứng dụng của tài xế.
const { q, tx, audit } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { auth } = require('../auth');
const { nextCode } = require('../erp/schema');
const { need, driverOf, text, reqText, date, money, hideMoney } = require('../erp/common');
const L = require('../erp/orders-lib');

const TRIP_SELECT = `SELECT t.*, d.name AS driver_name, d.phone AS driver_phone, d.plate AS driver_plate, r.name AS route_name,
  (SELECT COUNT(*) FROM orders o WHERE o.trip_id=t.id AND o.status<>'cancelled') AS order_count,
  (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.trip_id=t.id AND o.status<>'cancelled') AS total,
  (SELECT COUNT(*) FROM orders o WHERE o.trip_id=t.id AND o.status='delivered') AS delivered_count
  FROM trips t LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN delivery_routes r ON r.id=t.route_id`;

const tripOrders = (tripId) => q.all(
  `SELECT o.id, o.code, o.status, o.total, o.address, o.note, o.stop_seq, o.delivery_date, o.print_count, o.checked_at, o.source, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone,
          (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) AS item_count
   FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.trip_id=? AND o.status<>'cancelled' ORDER BY o.stop_seq, o.id`, tripId);

// Tổng hợp hàng hoá cần chuẩn bị cho một chuyến: theo sản phẩm và theo từng đơn
function allocation(tripId) {
  const lines = q.all(
    `SELECT i.name, i.unit, SUM(i.qty) AS qty, COUNT(DISTINCT i.order_id) AS orders
     FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.trip_id=? AND o.status<>'cancelled' GROUP BY i.name, i.unit ORDER BY i.name COLLATE NOCASE`, tripId);
  const perOrder = q.all(
    `SELECT o.id, o.code, o.stop_seq, c.name AS customer_name, i.name, i.unit, i.qty
     FROM order_items i JOIN orders o ON o.id=i.order_id JOIN customers c ON c.id=o.customer_id WHERE o.trip_id=? AND o.status<>'cancelled' ORDER BY o.stop_seq, o.id, i.id`, tripId);
  return { lines, perOrder };
}

function loadTrip(id) {
  const t = q.get(`${TRIP_SELECT} WHERE t.id=?`, Number(id));
  if (!t) throw notFound('Không tìm thấy chuyến giao');
  return t;
}

module.exports = (app) => {
  const base = [auth(), need('delivery', 'orders', 'finance', 'warehouse'), hideMoney];
  const write = [auth(), need('delivery'), hideMoney];

  // ---------- Tài xế ----------
  app.get('/api/drivers', ...base, (req, res) => {
    res.json(q.all(`SELECT d.*, e.code AS employee_code, e.full_name AS employee_name FROM drivers d LEFT JOIN employees e ON e.id=d.employee_id
      ${req.query.all === '1' ? '' : 'WHERE d.active=1'} ORDER BY d.name COLLATE NOCASE`));
  });
  function driverData(b) {
    let empId = b.employee_id ? Number(b.employee_id) : null;
    let name = text(b.name, 100);
    let phone = text(b.phone, 30);
    if (empId) {
      const e = q.get('SELECT * FROM employees WHERE id=? AND active=1', empId);
      if (!e) throw bad('Nhân viên liên kết không hợp lệ');
      if (!name) name = e.full_name;
      if (!phone) phone = e.phone;
    }
    if (!name) throw bad('Vui lòng nhập tên tài xế');
    return { name, phone, plate: text(b.plate, 20).toUpperCase(), employee_id: empId };
  }
  app.post('/api/drivers', ...write, (req, res) => {
    const d = driverData(req.body);
    if (d.employee_id && q.get('SELECT 1 x FROM drivers WHERE employee_id=? AND active=1', d.employee_id)) throw bad('Nhân viên này đã là tài xế');
    const r = q.run('INSERT INTO drivers(name,phone,plate,employee_id,created_at) VALUES(?,?,?,?,?)', d.name, d.phone, d.plate, d.employee_id, Date.now());
    audit(req.user, 'Thêm tài xế', d.name);
    res.json(q.get('SELECT * FROM drivers WHERE id=?', Number(r.lastInsertRowid)));
  });
  app.put('/api/drivers/:id', ...write, (req, res) => {
    const cur = q.get('SELECT * FROM drivers WHERE id=?', Number(req.params.id));
    if (!cur) throw notFound('Không tìm thấy tài xế');
    const d = driverData(req.body);
    q.run('UPDATE drivers SET name=?, phone=?, plate=?, employee_id=?, active=? WHERE id=?', d.name, d.phone, d.plate, d.employee_id, req.body.active === false || req.body.active === 0 ? 0 : 1, cur.id);
    audit(req.user, 'Sửa tài xế', d.name);
    res.json(q.get('SELECT * FROM drivers WHERE id=?', cur.id));
  });
  app.del('/api/drivers/:id', ...write, (req, res) => {
    const cur = q.get('SELECT * FROM drivers WHERE id=?', Number(req.params.id));
    if (!cur) throw notFound('Không tìm thấy tài xế');
    if (q.get('SELECT 1 x FROM trips WHERE driver_id=? LIMIT 1', cur.id)) {
      q.run('UPDATE drivers SET active=0 WHERE id=?', cur.id);
      return res.json({ ok: true, deactivated: true });
    }
    q.run('DELETE FROM drivers WHERE id=?', cur.id);
    audit(req.user, 'Xoá tài xế', cur.name);
    res.json({ ok: true, deleted: true });
  });

  // ---------- Tuyến giao hàng ----------
  app.get('/api/delivery-routes', ...base, (req, res) => {
    res.json(q.all(`SELECT * FROM delivery_routes ${req.query.all === '1' ? '' : 'WHERE active=1'} ORDER BY name COLLATE NOCASE`));
  });
  app.post('/api/delivery-routes', ...write, (req, res) => {
    const name = reqText(req.body.name, 'tên tuyến', 100);
    const r = q.run('INSERT INTO delivery_routes(name,note) VALUES(?,?)', name, text(req.body.note, 300));
    audit(req.user, 'Thêm tuyến giao hàng', name);
    res.json(q.get('SELECT * FROM delivery_routes WHERE id=?', Number(r.lastInsertRowid)));
  });
  app.put('/api/delivery-routes/:id', ...write, (req, res) => {
    const cur = q.get('SELECT * FROM delivery_routes WHERE id=?', Number(req.params.id));
    if (!cur) throw notFound('Không tìm thấy tuyến');
    q.run('UPDATE delivery_routes SET name=?, note=?, active=? WHERE id=?', reqText(req.body.name, 'tên tuyến', 100), text(req.body.note, 300), req.body.active === false || req.body.active === 0 ? 0 : 1, cur.id);
    res.json(q.get('SELECT * FROM delivery_routes WHERE id=?', cur.id));
  });
  app.del('/api/delivery-routes/:id', ...write, (req, res) => {
    const cur = q.get('SELECT * FROM delivery_routes WHERE id=?', Number(req.params.id));
    if (!cur) throw notFound('Không tìm thấy tuyến');
    if (q.get('SELECT 1 x FROM trips WHERE route_id=? LIMIT 1', cur.id)) { q.run('UPDATE delivery_routes SET active=0 WHERE id=?', cur.id); return res.json({ ok: true, deactivated: true }); }
    q.run('DELETE FROM delivery_routes WHERE id=?', cur.id);
    res.json({ ok: true, deleted: true });
  });

  // ---------- Bảng điều đơn trong ngày ----------
  app.get('/api/delivery/board', ...base, (req, res) => {
    const day = date(req.query.date, 'Ngày', U.today());
    // Đơn chưa gán chuyến cần giao đến hết ngày đã chọn (kể cả đơn trễ hẹn các ngày trước)
    const unassigned = q.all(
      `SELECT o.id, o.code, o.status, o.total, o.address, o.note, o.delivery_date, o.checked_at, o.source, c.name AS customer_name, c.phone AS customer_phone, c.area AS customer_area,
              (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) AS item_count
       FROM orders o JOIN customers c ON c.id=o.customer_id
       WHERE o.trip_id IS NULL AND o.status IN ('new','producing') AND o.delivery_date<=? ORDER BY o.delivery_date, o.id`, day);
    const trips = q.all(`${TRIP_SELECT} WHERE t.trip_date=? ORDER BY t.id`, day).map((t) => ({ ...t, orders: tripOrders(t.id) }));
    res.json({ date: day, unassigned, trips });
  });

  app.get('/api/trips/:id', ...base, (req, res) => {
    const t = loadTrip(req.params.id);
    res.json({ ...t, orders: tripOrders(t.id), allocation: allocation(t.id) });
  });

  function tripFields(b) {
    const driverId = b.driver_id ? Number(b.driver_id) : null;
    const routeId = b.route_id ? Number(b.route_id) : null;
    if (driverId && !q.get('SELECT 1 x FROM drivers WHERE id=?', driverId)) throw bad('Tài xế không hợp lệ');
    if (routeId && !q.get('SELECT 1 x FROM delivery_routes WHERE id=?', routeId)) throw bad('Tuyến không hợp lệ');
    return { driverId, routeId, note: text(b.note, 300) };
  }
  app.post('/api/trips', ...write, (req, res) => {
    const day = date(req.body.trip_date, 'Ngày giao', U.today());
    const f = tripFields(req.body);
    const code = nextCode('CH');
    const r = q.run('INSERT INTO trips(code,trip_date,driver_id,route_id,note,created_by,created_at) VALUES(?,?,?,?,?,?,?)', code, day, f.driverId, f.routeId, f.note, req.user.id, Date.now());
    audit(req.user, 'Tạo chuyến giao hàng', code);
    res.json(loadTrip(Number(r.lastInsertRowid)));
  });
  app.put('/api/trips/:id', ...write, (req, res) => {
    const t = loadTrip(req.params.id);
    if (t.status === 'done') throw bad('Chuyến đã hoàn thành, không sửa được');
    const f = tripFields(req.body);
    q.run('UPDATE trips SET driver_id=?, route_id=?, note=?, trip_date=? WHERE id=?', f.driverId, f.routeId, f.note, req.body.trip_date ? date(req.body.trip_date, 'Ngày giao') : t.trip_date, t.id);
    res.json(loadTrip(t.id));
  });
  app.del('/api/trips/:id', ...write, (req, res) => {
    const t = loadTrip(req.params.id);
    if (t.status === 'running') throw bad('Chuyến đang chạy, không xoá được');
    tx(() => {
      q.run('UPDATE orders SET trip_id=NULL, stop_seq=0 WHERE trip_id=? AND status<>\'delivered\'', t.id);
      if (q.get('SELECT 1 x FROM orders WHERE trip_id=? LIMIT 1', t.id)) throw bad('Chuyến đã có đơn giao xong, không xoá được');
      q.run('DELETE FROM trips WHERE id=?', t.id);
    });
    audit(req.user, 'Xoá chuyến giao hàng', t.code);
    res.json({ ok: true });
  });

  // Gán đơn vào chuyến ("điều đơn")
  app.post('/api/trips/:id/assign', ...write, (req, res) => {
    const t = loadTrip(req.params.id);
    if (t.status === 'done') throw bad('Chuyến đã hoàn thành');
    const ids = (Array.isArray(req.body.order_ids) ? req.body.order_ids : []).map(Number).filter(Boolean);
    if (!ids.length) throw bad('Chưa chọn đơn nào');
    let n = 0;
    tx(() => {
      let seq = q.get('SELECT COALESCE(MAX(stop_seq),0) m FROM orders WHERE trip_id=?', t.id).m;
      for (const id of ids) {
        const o = q.get('SELECT * FROM orders WHERE id=?', id);
        if (!o || o.status === 'cancelled' || o.status === 'delivered') continue;
        q.run('UPDATE orders SET trip_id=?, stop_seq=?, updated_at=? WHERE id=?', t.id, ++seq, Date.now(), id);
        // Chuyến đã chạy thì đơn thêm vào đi giao luôn
        // Chuyến đã chạy: đơn đã check in thì đẩy sang tài xế ngay, chưa check in thì chờ check in
        if (t.status === 'running' && o.checked_at && o.status !== 'delivering') L.setStatus(o, 'delivering', req.user, `Đẩy sang tài xế, chuyến ${t.code}`);
        L.addEvent(id, 'assigned', `Gán vào chuyến ${t.code}${t.driver_name ? ' - ' + t.driver_name : ''}`, req.user);
        n++;
      }
    });
    audit(req.user, 'Điều đơn', `${n} đơn vào chuyến ${t.code}`);
    res.json({ ok: true, assigned: n });
  });
  app.post('/api/trips/:id/unassign', ...write, (req, res) => {
    const t = loadTrip(req.params.id);
    const o = q.get('SELECT * FROM orders WHERE id=? AND trip_id=?', Number(req.body.order_id), t.id);
    if (!o) throw notFound('Đơn không thuộc chuyến này');
    if (o.status === 'delivered') throw bad('Đơn đã giao xong, không gỡ khỏi chuyến được');
    tx(() => {
      q.run('UPDATE orders SET trip_id=NULL, stop_seq=0, updated_at=? WHERE id=?', Date.now(), o.id);
      if (o.status === 'delivering') L.setStatus(o, 'producing', req.user, `Gỡ khỏi chuyến ${t.code}`);
      L.addEvent(o.id, 'assigned', `Gỡ khỏi chuyến ${t.code}`, req.user);
    });
    res.json({ ok: true });
  });
  app.post('/api/trips/:id/reorder', ...write, (req, res) => {
    const t = loadTrip(req.params.id);
    const ids = (Array.isArray(req.body.order_ids) ? req.body.order_ids : []).map(Number);
    tx(() => ids.forEach((id, i) => q.run('UPDATE orders SET stop_seq=? WHERE id=? AND trip_id=?', i + 1, id, t.id)));
    res.json({ ok: true });
  });

  // Xuất phát: mọi đơn trong chuyến chuyển sang "Đang giao"
  app.post('/api/trips/:id/start', ...write, (req, res) => {
    const t = loadTrip(req.params.id);
    if (t.status !== 'planned') throw bad('Chuyến này đã xuất phát');
    if (!t.driver_id) throw bad('Hãy chọn tài xế cho chuyến trước khi xuất phát');
    const all = tripOrders(t.id);
    if (!all.length) throw bad('Chuyến chưa có đơn nào');
    // Hàng phải được check in trước khi đẩy sang tài xế
    const notChecked = all.filter((o) => !o.checked_at && o.status !== 'delivering' && o.status !== 'delivered');
    if (notChecked.length && !req.body.force) throw bad(`Còn ${notChecked.length} đơn chưa check in hàng: ${notChecked.slice(0, 6).map((o) => o.code).join(', ')}${notChecked.length > 6 ? '...' : ''}`, 'NOT_CHECKED');
    if (req.body.force && req.user.role === 'employee') throw new HttpError(403, 'Chỉ quản lý mới được xuất phát khi chưa check in đủ', 'FORBIDDEN');
    const os = all.filter((o) => o.status === 'new' || o.status === 'producing');
    tx(() => {
      q.run("UPDATE trips SET status='running', started_at=? WHERE id=?", Date.now(), t.id);
      for (const o of os) L.setStatus(q.get('SELECT * FROM orders WHERE id=?', o.id), 'delivering', req.user, `Chuyến ${t.code} xuất phát`);
    });
    audit(req.user, 'Xuất phát chuyến giao hàng', t.code);
    res.json(loadTrip(t.id));
  });
  app.post('/api/trips/:id/finish', ...write, (req, res) => {
    const t = loadTrip(req.params.id);
    if (t.status === 'done') throw bad('Chuyến đã hoàn thành');
    const open = tripOrders(t.id).filter((o) => o.status !== 'delivered');
    if (open.length && !req.body.mark_delivered) throw bad(`Còn ${open.length} đơn chưa giao xong. Đánh dấu đã giao hết hoặc gỡ các đơn đó khỏi chuyến.`, 'OPEN_ORDERS');
    tx(() => {
      for (const o of open) L.setStatus(q.get('SELECT * FROM orders WHERE id=?', o.id), 'delivered', req.user, `Hoàn thành chuyến ${t.code}`);
      q.run("UPDATE trips SET status='done', finished_at=? WHERE id=?", Date.now(), t.id);
    });
    audit(req.user, 'Hoàn thành chuyến giao hàng', t.code);
    res.json(loadTrip(t.id));
  });

  // In bảng kê chuyến: dữ liệu đơn + phân bổ hàng hoá
  app.get('/api/trips/:id/sheet', ...base, (req, res) => {
    const t = loadTrip(req.params.id);
    const orders = tripOrders(t.id).map((o) => L.orderFull(o.id));
    res.json({ trip: t, orders, allocation: allocation(t.id) });
  });

  app.get('/api/trips', ...base, (req, res) => {
    const from = U.isYmd(req.query.from) ? req.query.from : U.addDays(U.today(), -14);
    const to = U.isYmd(req.query.to) ? req.query.to : U.addDays(U.today(), 7);
    res.json(q.all(`${TRIP_SELECT} WHERE t.trip_date BETWEEN ? AND ? ORDER BY t.trip_date DESC, t.id DESC LIMIT 300`, from, to));
  });

  // ---------- Ứng dụng của tài xế ----------
  app.get('/api/my/trips', auth(), hideMoney, (req, res) => {
    const d = driverOf(req.user);
    if (!d) throw new HttpError(403, 'Tài khoản của bạn chưa được gán là tài xế', 'FORBIDDEN');
    const day = date(req.query.date, 'Ngày', U.today());
    const trips = q.all(`${TRIP_SELECT} WHERE t.driver_id=? AND t.trip_date=? ORDER BY t.id`, d.id, day).map((t) => ({
      ...t,
      orders: tripOrders(t.id).map((o) => ({ ...o, items: q.all('SELECT name, unit, qty FROM order_items WHERE order_id=? ORDER BY id', o.id), paid: q.get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND voided=0', o.id).s })),
    }));
    res.json({ driver: d, date: day, trips });
  });
  app.post('/api/my/orders/:id/delivered', auth(), hideMoney, (req, res) => {
    const d = driverOf(req.user);
    if (!d) throw new HttpError(403, 'Tài khoản của bạn chưa được gán là tài xế', 'FORBIDDEN');
    const o = q.get('SELECT o.* FROM orders o JOIN trips t ON t.id=o.trip_id WHERE o.id=? AND t.driver_id=?', Number(req.params.id), d.id);
    if (!o) throw notFound('Đơn này không thuộc chuyến của bạn');
    if (o.status === 'delivered') throw bad('Đơn đã được xác nhận giao');
    if (o.status !== 'delivering') throw bad('Chuyến chưa xuất phát, hãy báo điều phối viên');
    const amount = money(req.body.collected || 0, 'Số tiền thu');
    tx(() => {
      L.setStatus(o, 'delivered', req.user, 'Tài xế xác nhận');
      if (amount > 0) {
        const code = nextCode('PT');
        q.run(`INSERT INTO payments(code,customer_id,order_id,amount,method,paid_date,note,created_by,created_at) VALUES(?,?,?,?,'cash',?,?,?,?)`,
          code, o.customer_id, o.id, amount, U.today(), `Thu khi giao ${o.code}`, req.user.id, Date.now());
        L.addEvent(o.id, 'payment', `Thu ${amount.toLocaleString('vi-VN')}đ khi giao`, req.user);
      }
      // Giao xong đơn cuối cùng thì chuyến tự hoàn thành
      if (!q.get("SELECT 1 x FROM orders WHERE trip_id=? AND status NOT IN ('delivered','cancelled') LIMIT 1", o.trip_id)) q.run("UPDATE trips SET status='done', finished_at=? WHERE id=?", Date.now(), o.trip_id);
    });
    res.json({ ok: true });
  });
};
