'use strict';
// Nghiệp vụ đơn hàng dùng chung cho app khách, nhập tay, nhập Excel, làm hàng, giao hàng và công nợ.
const { q, tx, audit } = require('../db');
const { bad } = require('../lib/http');
const U = require('../lib/util');
const { nextCode } = require('./schema');
const { text, money, modulesOf, seesMoney } = require('./common');
const { priceOf } = require('./pricing');

// Giao dịch lồng nhau: nếu đã ở trong một giao dịch thì chạy tiếp trong đó (SQLite không cho BEGIN lồng)
let depth = 0;
function atomic(fn) {
  if (depth) return fn();
  depth++;
  try { return tx(fn); } finally { depth--; }
}

const STATUS = ['new', 'producing', 'delivering', 'delivered', 'cancelled'];
const STATUS_LABEL = { new: 'Mới', producing: 'Đang làm hàng', delivering: 'Đang giao', delivered: 'Đã giao', cancelled: 'Đã huỷ' };

function addEvent(orderId, kind, detail, user) {
  q.run('INSERT INTO order_events(order_id,ts,kind,detail,actor_id,actor_name) VALUES(?,?,?,?,?,?)',
    orderId, Date.now(), kind, String(detail || '').slice(0, 300), user && user.id ? user.id : null, user ? `${user.full_name}` : 'hệ thống');
}

const invoiceOf = (orderId) => q.get(
  `SELECT i.id, i.code FROM invoice_orders io JOIN invoices i ON i.id=io.invoice_id WHERE io.order_id=?`, orderId) || null;

const fmt = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const kgText = (kg) => (kg < 1 ? `${Math.round(kg * 1000)}gr` : `${fmt(kg)}kg`);
// Quy đổi ra số gói/hộp cho nhân viên làm hàng: 5 kg bún bò = 10 gói 500gr
function packText(i) {
  const qty = Number(i.qty);
  if (!i.pack_kg) return `${fmt(qty)} ${String(i.unit || 'kg').toLowerCase()} rời`;
  if (String(i.unit).toUpperCase() === 'KG') return `${fmt(qty / i.pack_kg)} ${i.pack_noun || 'gói'} ${kgText(i.pack_kg)}`;
  return `${fmt(qty)} ${i.pack_noun || 'hộp'} ${kgText(i.pack_kg)}`;
}

const stepOk = (qty, step) => !step || Math.abs(qty / step - Math.round(qty / step)) < 1e-6;

// Chuẩn hoá dòng hàng. Giá luôn do hệ thống lấy từ bảng giá của tài chính; chỉ người có quyền tài chính mới sửa giá từng dòng.
// ctx: { customerId, canPrice, keep: Map(productId -> giá cũ, giữ nguyên khi người không có quyền giá sửa đơn), allowFree, allowInactive }
function cleanItems(list, ctx = {}) {
  if (!Array.isArray(list) || !list.length) throw bad('Đơn hàng cần có ít nhất một dòng hàng');
  if (list.length > 200) throw bad('Một đơn tối đa 200 dòng hàng');
  const seen = new Set();
  return list.map((it, i) => {
    const prod = it.product_id ? q.get('SELECT * FROM products WHERE id=?', Number(it.product_id)) : null;
    if (it.product_id && !prod) throw bad(`Dòng ${i + 1}: sản phẩm không tồn tại`);
    if (prod && !prod.active && !(ctx.allowInactive && ctx.allowInactive.has(prod.id))) throw bad(`"${prod.name}" đã ngừng bán`);
    if (!prod && !ctx.allowFree) throw bad(`Dòng ${i + 1}: hãy chọn sản phẩm trong danh mục`);
    if (prod) {
      if (seen.has(prod.id)) throw bad(`"${prod.name}" bị trùng, hãy gộp thành một dòng`);
      seen.add(prod.id);
    }
    const name = prod ? prod.name : text(it.name, 200);
    if (!name) throw bad(`Dòng ${i + 1}: thiếu tên hàng`);
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) throw bad(`${name}: số lượng không hợp lệ`);
    if (prod && !stepOk(qty, prod.qty_step)) throw bad(`${name}: số lượng phải là bội số của ${fmt(prod.qty_step)} ${prod.unit}${prod.pack_kg ? ` (mỗi ${prod.pack_noun} ${kgText(prod.pack_kg)})` : ''}`);
    const q3 = Math.round(qty * 1000) / 1000;
    let price = 0;
    if (ctx.canPrice && it.price !== '' && it.price !== undefined && it.price !== null) price = money(it.price, `${name}: đơn giá`);
    else if (prod && ctx.keep && ctx.keep.has(prod.id)) price = ctx.keep.get(prod.id);
    else if (prod) price = priceOf(ctx.customerId, prod.id);
    return { product_id: prod ? prod.id : null, name, unit: prod ? prod.unit : text(it.unit, 20), qty: q3, price, amount: Math.round(q3 * price) };
  });
}

function totals(items, discount) {
  const subtotal = items.reduce((s, x) => s + x.amount, 0);
  const d = Math.min(Math.max(0, discount || 0), subtotal);
  return { subtotal, discount: d, total: subtotal - d };
}

function orderFull(id) {
  const o = q.get(
    `SELECT o.*, c.code AS customer_code, c.name AS customer_name, c.phone AS customer_phone, c.tax_code AS customer_tax, c.area AS customer_area,
            t.code AS trip_code, t.status AS trip_status, d.name AS driver_name, d.phone AS driver_phone, d.plate AS driver_plate, r.name AS route_name
     FROM orders o JOIN customers c ON c.id=o.customer_id
     LEFT JOIN trips t ON t.id=o.trip_id LEFT JOIN drivers d ON d.id=t.driver_id LEFT JOIN delivery_routes r ON r.id=t.route_id
     WHERE o.id=?`, id);
  if (!o) return null;
  o.items = q.all(`SELECT i.*, p.spec, p.pack_kg, p.pack_noun, p.qty_step FROM order_items i LEFT JOIN products p ON p.id=i.product_id WHERE i.order_id=? ORDER BY i.id`, id)
    .map((i) => ({ ...i, pack_text: packText(i) }));
  o.invoice = invoiceOf(id);
  o.checked = !!o.checked_at;
  return o;
}

function insertItems(orderId, items) {
  for (const it of items) {
    q.run('INSERT INTO order_items(order_id,product_id,name,unit,qty,price,amount) VALUES(?,?,?,?,?,?,?)',
      orderId, it.product_id, it.name, it.unit, it.qty, it.price, it.amount);
  }
}

// user: nhân viên, hoặc { id: null, full_name: 'Khách ...' } khi khách tự đặt qua app. canPrice: người đặt được sửa giá không.
function createOrder(data, user, source = 'manual', { canPrice = false, allowFree = true } = {}) {
  const cus = q.get('SELECT * FROM customers WHERE id=?', Number(data.customer_id));
  if (!cus) throw bad('Vui lòng chọn khách hàng');
  if (!cus.active) throw bad('Khách hàng này đã ngừng giao dịch');
  const today = U.today();
  const orderDate = data.order_date || today;
  const deliveryDate = data.delivery_date || orderDate;
  if (!U.isYmd(orderDate) || !U.isYmd(deliveryDate)) throw bad('Ngày không hợp lệ');
  if (deliveryDate < orderDate) throw bad('Ngày giao không được trước ngày đặt');
  const items = cleanItems(data.items, { customerId: cus.id, canPrice, allowFree });
  const t = totals(items, canPrice ? money(data.discount || 0, 'Chiết khấu') : 0);
  return atomic(() => {
    const code = nextCode('DH');
    const now = Date.now();
    const r = q.run(
      `INSERT INTO orders(code,customer_id,order_date,delivery_date,address,status,subtotal,discount,total,note,source,created_by,created_at,updated_at)
       VALUES(?,?,?,?,?,'new',?,?,?,?,?,?,?,?)`,
      code, cus.id, orderDate, deliveryDate, text(data.address, 300) || cus.address, t.subtotal, t.discount, t.total, text(data.note, 500), source, user && user.id ? user.id : null, now, now);
    const id = Number(r.lastInsertRowid);
    insertItems(id, items);
    addEvent(id, 'created', source === 'excel' ? 'Nhập từ Excel' : source === 'app' ? 'Khách đặt hàng qua app' : 'Tạo đơn', user);
    return { id, code, total: t.total };
  });
}

function updateOrder(o, data, user, { canPrice = false } = {}) {
  const old = q.all('SELECT product_id, price FROM order_items WHERE order_id=?', o.id);
  const keep = new Map(old.filter((r) => r.product_id).map((r) => [r.product_id, r.price]));
  const inactiveOk = new Set(old.filter((r) => r.product_id).map((r) => r.product_id));
  let customerId = o.customer_id;
  if (data.customer_id && Number(data.customer_id) !== o.customer_id) {
    const c = q.get('SELECT * FROM customers WHERE id=? AND active=1', Number(data.customer_id));
    if (!c) throw bad('Khách hàng không hợp lệ');
    customerId = c.id;
    keep.clear(); // đổi khách thì tính lại giá theo bảng giá của khách mới
  }
  const items = cleanItems(data.items, { customerId, canPrice, keep: canPrice ? null : keep, allowFree: true, allowInactive: inactiveOk });
  const t = totals(items, canPrice ? money(data.discount || 0, 'Chiết khấu') : o.discount);
  const orderDate = data.order_date || o.order_date;
  const deliveryDate = data.delivery_date || o.delivery_date;
  if (!U.isYmd(orderDate) || !U.isYmd(deliveryDate)) throw bad('Ngày không hợp lệ');
  if (deliveryDate < orderDate) throw bad('Ngày giao không được trước ngày đặt');
  atomic(() => {
    q.run('DELETE FROM order_items WHERE order_id=?', o.id);
    insertItems(o.id, items);
    // Sửa đơn thì phải soạn/kiểm lại hàng
    q.run(`UPDATE orders SET customer_id=?, order_date=?, delivery_date=?, address=?, subtotal=?, discount=?, total=?, note=?, checked_at=NULL, checked_by=NULL, updated_at=? WHERE id=?`,
      customerId, orderDate, deliveryDate, text(data.address, 300), t.subtotal, t.discount, t.total, text(data.note, 500), Date.now(), o.id);
    addEvent(o.id, 'edited', o.checked_at ? 'Sửa đơn (đã bỏ check in, cần kiểm lại hàng)' : 'Sửa đơn', user);
  });
}

function setStatus(o, status, user, note) {
  if (!['new', 'producing', 'delivering', 'delivered'].includes(status)) throw bad('Trạng thái không hợp lệ');
  if (o.status === 'cancelled') throw bad('Đơn đã huỷ. Hãy khôi phục đơn trước khi đổi trạng thái.');
  if (o.status === status) return;
  const inv = invoiceOf(o.id);
  if (inv && o.status === 'delivered') throw bad(`Đơn đã nằm trong hoá đơn ${inv.code}. Huỷ hoá đơn trước khi đổi trạng thái.`);
  const now = Date.now();
  if (status === 'delivered') q.run("UPDATE orders SET status='delivered', delivered_at=?, delivered_date=?, updated_at=? WHERE id=?", now, U.today(), now, o.id);
  else if (status === 'new') q.run("UPDATE orders SET status='new', delivered_at=NULL, delivered_date=NULL, checked_at=NULL, checked_by=NULL, updated_at=? WHERE id=?", now, o.id);
  else q.run('UPDATE orders SET status=?, delivered_at=NULL, delivered_date=NULL, updated_at=? WHERE id=?', status, now, o.id);
  addEvent(o.id, 'status', `${STATUS_LABEL[o.status]} → ${STATUS_LABEL[status]}${note ? ': ' + note : ''}`, user);
}

// Check in hàng: xác nhận đã làm và soạn đủ hàng. Nếu đơn nằm trong chuyến đã xuất phát thì hệ thống đẩy hàng sang tài xế ngay.
function checkin(o, user) {
  if (o.status === 'cancelled') throw bad('Đơn đã huỷ');
  if (o.status === 'delivered') throw bad('Đơn đã giao');
  if (o.checked_at) throw bad('Đơn này đã check in rồi');
  atomic(() => {
    q.run('UPDATE orders SET checked_at=?, checked_by=?, updated_at=? WHERE id=?', Date.now(), user.id, Date.now(), o.id);
    addEvent(o.id, 'checkin', 'Check in hàng', user);
    const fresh = q.get('SELECT * FROM orders WHERE id=?', o.id);
    if (fresh.status === 'new') setStatus(fresh, 'producing', user, '');
    const t = fresh.trip_id ? q.get('SELECT * FROM trips WHERE id=?', fresh.trip_id) : null;
    if (t && t.status === 'running') setStatus(q.get('SELECT * FROM orders WHERE id=?', o.id), 'delivering', user, `Đẩy sang tài xế, chuyến ${t.code}`);
  });
}
function uncheck(o, user) {
  if (!o.checked_at) throw bad('Đơn chưa check in');
  if (o.status === 'delivering' || o.status === 'delivered') throw bad('Đơn đã giao cho tài xế, không bỏ check in được');
  q.run('UPDATE orders SET checked_at=NULL, checked_by=NULL, updated_at=? WHERE id=?', Date.now(), o.id);
  addEvent(o.id, 'checkin', 'Bỏ check in', user);
}

function cancelOrder(o, reason, user) {
  if (o.status === 'cancelled') throw bad('Đơn đã được huỷ trước đó');
  const inv = invoiceOf(o.id);
  if (inv) throw bad(`Đơn đã nằm trong hoá đơn ${inv.code}. Huỷ hoá đơn trước.`);
  if (o.status === 'delivered' && user.role !== 'admin') throw bad('Đơn đã giao chỉ quản trị viên mới huỷ được');
  q.run("UPDATE orders SET status='cancelled', cancel_reason=?, trip_id=NULL, stop_seq=0, delivered_at=NULL, delivered_date=NULL, checked_at=NULL, checked_by=NULL, updated_at=? WHERE id=?", text(reason, 300), Date.now(), o.id);
  addEvent(o.id, 'cancelled', text(reason, 300) || 'Huỷ đơn', user);
}

// Áp lại giá hiện hành cho đơn chưa nằm trong hoá đơn (dùng khi đơn đến trước lúc tài chính đặt giá)
function reprice(orderId, onlyZero = true) {
  const o = q.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || o.status === 'cancelled' || invoiceOf(o.id)) return false;
  const items = q.all('SELECT * FROM order_items WHERE order_id=?', o.id);
  if (onlyZero && !items.some((i) => i.price === 0 && i.product_id)) return false;
  let changed = false;
  for (const i of items) {
    if (!i.product_id || (onlyZero && i.price !== 0)) continue;
    const price = priceOf(o.customer_id, i.product_id);
    if (price !== i.price) { q.run('UPDATE order_items SET price=?, amount=? WHERE id=?', price, Math.round(i.qty * price), i.id); changed = true; }
  }
  if (changed) {
    const sub = q.get('SELECT COALESCE(SUM(amount),0) s FROM order_items WHERE order_id=?', o.id).s;
    const disc = Math.min(o.discount, sub);
    q.run('UPDATE orders SET subtotal=?, discount=?, total=?, updated_at=? WHERE id=?', sub, disc, sub - disc, Date.now(), o.id);
  }
  return changed;
}

module.exports = { atomic, STATUS, STATUS_LABEL, addEvent, invoiceOf, cleanItems, totals, orderFull, createOrder, updateOrder, setStatus, checkin, uncheck, cancelOrder, reprice, packText, audit, seesMoney, modulesOf };
