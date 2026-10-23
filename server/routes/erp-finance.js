'use strict';
// Tài chính kế toán: công nợ phải thu, thu tiền, chốt công nợ và xuất hoá đơn.
const { q, tx, audit, settings } = require('../db');
const U = require('../lib/util');
const { bad, notFound } = require('../lib/http');
const { buildXlsx, STYLE } = require('../lib/xlsx');
const { auth } = require('../auth');
const { nextCode } = require('../erp/schema');
const { need, text, money, date, like, page, DEBT_SQL } = require('../erp/common');
const L = require('../erp/orders-lib');

const METHODS = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', other: 'Khác' };
const ODATE = 'COALESCE(o.delivered_date, o.delivery_date)';

const INV_SELECT = `SELECT i.*, c.code AS customer_code, c.name AS customer_name, c.address AS customer_address, c.tax_code AS customer_tax, c.phone AS customer_phone,
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id AND p.voided=0),0) AS paid,
  (SELECT COUNT(*) FROM invoice_orders io WHERE io.invoice_id=i.id) AS order_count
  FROM invoices i JOIN customers c ON c.id=i.customer_id`;
const invView = (i) => ({ ...i, state: i.status === 'void' ? 'void' : i.paid >= i.total ? 'paid' : i.paid > 0 ? 'partial' : 'issued', balance: Math.max(0, i.total - i.paid) });

function unbilled(customerId, from, to) {
  return q.all(
    `SELECT o.id, o.code, o.total, ${ODATE} AS d, o.delivery_date, o.note FROM orders o
     WHERE o.customer_id=? AND o.status='delivered' AND ${ODATE} BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM invoice_orders io WHERE io.order_id=o.id) ORDER BY ${ODATE}, o.id`, customerId, from, to);
}

function makeInvoice(customerId, from, to, orderIds, user, extra = {}) {
  let orders = unbilled(customerId, from, to);
  if (orderIds && orderIds.length) { const set = new Set(orderIds.map(Number)); orders = orders.filter((o) => set.has(o.id)); }
  if (!orders.length) return null;
  const total = orders.reduce((s, o) => s + o.total, 0);
  return tx(() => {
    const code = nextCode('HD');
    const r = q.run(`INSERT INTO invoices(code,external_no,customer_id,issue_date,period_from,period_to,total,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      code, text(extra.external_no, 40), customerId, extra.issue_date || U.today(), from, to, total, text(extra.note, 300), user.id, Date.now());
    const id = Number(r.lastInsertRowid);
    for (const o of orders) {
      q.run('INSERT INTO invoice_orders(invoice_id,order_id) VALUES(?,?)', id, o.id);
      L.addEvent(o.id, 'invoice', `Đưa vào hoá đơn ${code}`, user);
    }
    return { id, code, total, orders: orders.length };
  });
}

function debtRows(search, onlyDebt) {
  const where = ['c.active=1'];
  const params = [];
  if (search) {
    const s = like(text(search, 60));
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')");
    params.push(s, s, s);
  }
  const rows = q.all(`SELECT c.id, c.code, c.name, c.phone, c.opening_debt, c.credit_limit,
      COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.customer_id=c.id AND o.status='delivered'),0) AS billed,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.customer_id=c.id AND p.voided=0),0) AS paid,
      (SELECT MAX(p.paid_date) FROM payments p WHERE p.customer_id=c.id AND p.voided=0) AS last_payment,
      COALESCE((SELECT SUM(o.total) FROM orders o WHERE o.customer_id=c.id AND o.status='delivered' AND NOT EXISTS (SELECT 1 FROM invoice_orders io WHERE io.order_id=o.id)),0) AS unbilled,
      ${DEBT_SQL} AS debt
    FROM customers c WHERE ${where.join(' AND ')} ORDER BY debt DESC, c.name COLLATE NOCASE LIMIT 3000`, ...params);
  return onlyDebt ? rows.filter((r) => r.debt !== 0) : rows;
}

module.exports = (app) => {
  const read = [auth(), need('finance')];

  app.get('/api/finance/summary', ...read, (req, res) => {
    const month = U.currentMonth();
    const { from, to } = U.monthRange(month);
    const rows = debtRows('', false);
    const sum = (sql, ...a) => q.get(sql, ...a).s;
    res.json({
      month,
      receivable: rows.reduce((s, r) => s + Math.max(0, r.debt), 0),
      owing_customers: rows.filter((r) => r.debt > 0).length,
      over_limit: rows.filter((r) => r.credit_limit > 0 && r.debt > r.credit_limit).length,
      revenue_month: sum(`SELECT COALESCE(SUM(o.total),0) s FROM orders o WHERE o.status='delivered' AND ${ODATE} BETWEEN ? AND ?`, from, to),
      collected_month: sum('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE voided=0 AND paid_date BETWEEN ? AND ?', from, to),
      unbilled: rows.reduce((s, r) => s + r.unbilled, 0),
      top: rows.filter((r) => r.debt > 0).slice(0, 5),
    });
  });

  app.get('/api/finance/debts', ...read, (req, res) => res.json(debtRows(req.query.search, req.query.only_debt === '1')));

  app.get('/api/finance/debts/export', ...read, (req, res) => {
    const S = settings();
    const rows = debtRows(req.query.search, req.query.only_debt === '1');
    const head = ['STT', 'Mã KH', 'Khách hàng', 'Điện thoại', 'Nợ đầu kỳ', 'Đã giao (phát sinh)', 'Đã thu', 'Còn nợ', 'Chưa chốt hoá đơn', 'Hạn mức', 'Lần thu gần nhất'];
    const data = [[{ v: `BẢNG CÔNG NỢ PHẢI THU - ${S.company_name} - ${U.today().split('-').reverse().join('/')}`, s: STYLE.title }], head.map((h) => ({ v: h, s: STYLE.header }))];
    let total = 0;
    rows.forEach((r, i) => {
      total += r.debt;
      data.push([{ v: i + 1, s: STYLE.center }, { v: r.code, s: STYLE.text }, { v: r.name, s: STYLE.text }, { v: r.phone, s: STYLE.text }, { v: r.opening_debt, s: STYLE.int }, { v: r.billed, s: STYLE.int },
        { v: r.paid, s: STYLE.int }, { v: r.debt, s: STYLE.int }, { v: r.unbilled, s: STYLE.int }, { v: r.credit_limit, s: STYLE.int }, { v: r.last_payment || '', s: STYLE.center }]);
    });
    data.push([null, null, { v: 'TỔNG CỘNG', s: STYLE.bold }, null, null, null, null, { v: total, s: STYLE.int }]);
    const buf = buildXlsx([{ name: 'Công nợ', rows: data, freeze: { cols: 3, rows: 2 }, widths: [5, 11, 28, 14, 13, 15, 13, 14, 16, 13, 14] }]);
    res.send(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, { 'Content-Disposition': 'attachment; filename="cong-no-phai-thu.xlsx"', 'Cache-Control': 'no-store' });
  });

  // Sổ chi tiết công nợ của một khách hàng
  app.get('/api/finance/ledger/:id', ...read, (req, res) => {
    const c = q.get('SELECT * FROM customers WHERE id=?', Number(req.params.id));
    if (!c) throw notFound('Không tìm thấy khách hàng');
    const from = date(req.query.from, 'Từ ngày', '2000-01-01');
    const to = date(req.query.to, 'Đến ngày', '2999-12-31');
    const before = c.opening_debt
      + q.get(`SELECT COALESCE(SUM(o.total),0) s FROM orders o WHERE o.customer_id=? AND o.status='delivered' AND ${ODATE}<?`, c.id, from).s
      - q.get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE customer_id=? AND voided=0 AND paid_date<?', c.id, from).s;
    const ents = [
      ...q.all(`SELECT o.id, o.code, ${ODATE} AS d, o.total AS amount FROM orders o WHERE o.customer_id=? AND o.status='delivered' AND ${ODATE} BETWEEN ? AND ?`, c.id, from, to)
        .map((o) => ({ date: o.d, kind: 'order', ref: o.code, text: `Đơn hàng ${o.code}`, debit: o.amount, credit: 0, order_id: o.id })),
      ...q.all('SELECT id, code, paid_date, amount, method, note FROM payments WHERE customer_id=? AND voided=0 AND paid_date BETWEEN ? AND ?', c.id, from, to)
        .map((p) => ({ date: p.paid_date, kind: 'payment', ref: p.code, text: `Thu tiền ${p.code} (${METHODS[p.method] || p.method})${p.note ? ' - ' + p.note : ''}`, debit: 0, credit: p.amount })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'order' ? -1 : 1));
    let bal = before;
    for (const e of ents) { bal += e.debit - e.credit; e.balance = bal; }
    res.json({ customer: { id: c.id, code: c.code, name: c.name, address: c.address, phone: c.phone, tax_code: c.tax_code }, from, to, opening: before, entries: ents, closing: bal,
      debit: ents.reduce((s, e) => s + e.debit, 0), credit: ents.reduce((s, e) => s + e.credit, 0), company: settings().company_name });
  });

  // ---------- Thu tiền ----------
  app.get('/api/payments', ...read, (req, res) => {
    const where = [];
    const params = [];
    if (req.query.customer_id) { where.push('p.customer_id=?'); params.push(Number(req.query.customer_id)); }
    if (U.isYmd(req.query.from)) { where.push('p.paid_date>=?'); params.push(req.query.from); }
    if (U.isYmd(req.query.to)) { where.push('p.paid_date<=?'); params.push(req.query.to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const pg = page(req, 40);
    const agg = q.get(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN p.voided=0 THEN p.amount END),0) s FROM payments p ${w}`, ...params);
    const rows = q.all(`SELECT p.*, c.code AS customer_code, c.name AS customer_name, i.code AS invoice_code, o.code AS order_code, e.full_name AS by_name
      FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN employees e ON e.id=p.created_by
      ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...params, pg.per, pg.offset);
    res.json({ rows, total: agg.n, sum: agg.s, page: pg.page, per: pg.per, methods: METHODS });
  });

  app.post('/api/payments', ...read, (req, res) => {
    const c = q.get('SELECT * FROM customers WHERE id=?', Number(req.body.customer_id));
    if (!c) throw bad('Vui lòng chọn khách hàng');
    const amount = money(req.body.amount, 'Số tiền', { min: 1 });
    const method = METHODS[req.body.method] ? req.body.method : 'cash';
    let invoiceId = null;
    if (req.body.invoice_id) {
      const inv = q.get('SELECT * FROM invoices WHERE id=? AND customer_id=?', Number(req.body.invoice_id), c.id);
      if (!inv || inv.status === 'void') throw bad('Hoá đơn không hợp lệ');
      invoiceId = inv.id;
    }
    const code = nextCode('PT');
    const r = q.run('INSERT INTO payments(code,customer_id,invoice_id,amount,method,paid_date,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      code, c.id, invoiceId, amount, method, date(req.body.paid_date, 'Ngày thu', U.today()), text(req.body.note, 300), req.user.id, Date.now());
    audit(req.user, 'Thu tiền', `${code} ${c.name}: ${amount.toLocaleString('vi-VN')}đ`);
    res.json(q.get('SELECT * FROM payments WHERE id=?', Number(r.lastInsertRowid)));
  });

  app.post('/api/payments/:id/void', ...read, (req, res) => {
    const p = q.get('SELECT * FROM payments WHERE id=?', Number(req.params.id));
    if (!p) throw notFound('Không tìm thấy phiếu thu');
    if (p.voided) throw bad('Phiếu thu đã được huỷ');
    q.run('UPDATE payments SET voided=1, note=? WHERE id=?', text(`${p.note} [Huỷ: ${req.body.reason || 'không ghi lý do'}]`, 300), p.id);
    audit(req.user, 'Huỷ phiếu thu', `${p.code}: ${p.amount.toLocaleString('vi-VN')}đ`);
    res.json({ ok: true });
  });

  // ---------- Chốt công nợ và hoá đơn ----------
  app.get('/api/invoices', ...read, (req, res) => {
    const where = [];
    const params = [];
    if (req.query.customer_id) { where.push('i.customer_id=?'); params.push(Number(req.query.customer_id)); }
    if (U.isYmd(req.query.from)) { where.push('i.issue_date>=?'); params.push(req.query.from); }
    if (U.isYmd(req.query.to)) { where.push('i.issue_date<=?'); params.push(req.query.to); }
    if (req.query.q) { const s = like(text(req.query.q, 60)); where.push("(i.code LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR i.external_no LIKE ? ESCAPE '\\')"); params.push(s, s, s); }
    let rows = q.all(`${INV_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.id DESC LIMIT 500`, ...params).map(invView);
    if (req.query.state) rows = rows.filter((r) => r.state === req.query.state);
    res.json(rows);
  });

  app.get('/api/invoices/:id', ...read, (req, res) => {
    const i = q.get(`${INV_SELECT} WHERE i.id=?`, Number(req.params.id));
    if (!i) throw notFound('Không tìm thấy hoá đơn');
    const orders = q.all('SELECT o.id FROM invoice_orders io JOIN orders o ON o.id=io.order_id WHERE io.invoice_id=? ORDER BY o.id', i.id).map((r) => L.orderFull(r.id));
    const payments = q.all('SELECT id, code, paid_date, amount, method, voided FROM payments WHERE invoice_id=? ORDER BY id', i.id);
    res.json({ ...invView(i), orders, payments, company: settings().company_name });
  });

  app.post('/api/invoices/preview', ...read, (req, res) => {
    const cid = Number(req.body.customer_id);
    if (!q.get('SELECT 1 x FROM customers WHERE id=?', cid)) throw bad('Vui lòng chọn khách hàng');
    const from = date(req.body.from, 'Từ ngày');
    const to = date(req.body.to, 'Đến ngày');
    const orders = unbilled(cid, from, to);
    res.json({ orders, total: orders.reduce((s, o) => s + o.total, 0) });
  });

  app.post('/api/invoices', ...read, (req, res) => {
    const cid = Number(req.body.customer_id);
    if (!q.get('SELECT 1 x FROM customers WHERE id=?', cid)) throw bad('Vui lòng chọn khách hàng');
    const from = date(req.body.from, 'Từ ngày');
    const to = date(req.body.to, 'Đến ngày');
    const r = makeInvoice(cid, from, to, req.body.order_ids, req.user, { external_no: req.body.external_no, note: req.body.note, issue_date: req.body.issue_date && date(req.body.issue_date, 'Ngày lập') });
    if (!r) throw bad('Không có đơn đã giao nào chưa chốt trong khoảng thời gian này');
    audit(req.user, 'Lập hoá đơn / chốt công nợ', `${r.code}: ${r.total.toLocaleString('vi-VN')}đ`);
    res.json(r);
  });

  // Chốt công nợ hàng loạt: mỗi khách có đơn đã giao chưa chốt trong kỳ được một hoá đơn
  app.post('/api/invoices/close-period', ...read, (req, res) => {
    const from = date(req.body.from, 'Từ ngày');
    const to = date(req.body.to, 'Đến ngày');
    if (to < from) throw bad('Khoảng thời gian không hợp lệ');
    const cus = q.all(`SELECT DISTINCT o.customer_id AS id FROM orders o WHERE o.status='delivered' AND ${ODATE} BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM invoice_orders io WHERE io.order_id=o.id)`, from, to);
    const only = Array.isArray(req.body.customer_ids) && req.body.customer_ids.length ? new Set(req.body.customer_ids.map(Number)) : null;
    const made = [];
    for (const c of cus) {
      if (only && !only.has(c.id)) continue;
      const r = makeInvoice(c.id, from, to, null, req.user, { note: `Chốt công nợ ${from.split('-').reverse().join('/')} - ${to.split('-').reverse().join('/')}` });
      if (r) made.push(r);
    }
    audit(req.user, 'Chốt công nợ hàng loạt', `${made.length} hoá đơn kỳ ${from} → ${to}`);
    res.json({ created: made.length, invoices: made, total: made.reduce((s, r) => s + r.total, 0) });
  });

  app.put('/api/invoices/:id', ...read, (req, res) => {
    const i = q.get('SELECT * FROM invoices WHERE id=?', Number(req.params.id));
    if (!i) throw notFound('Không tìm thấy hoá đơn');
    q.run('UPDATE invoices SET external_no=?, note=? WHERE id=?', text(req.body.external_no, 40), text(req.body.note, 300), i.id);
    res.json({ ok: true });
  });

  // Huỷ hoá đơn: các đơn được giải phóng để chốt lại; phiếu thu gắn với hoá đơn vẫn giữ (chỉ bỏ liên kết)
  app.post('/api/invoices/:id/void', ...read, (req, res) => {
    const i = q.get('SELECT * FROM invoices WHERE id=?', Number(req.params.id));
    if (!i) throw notFound('Không tìm thấy hoá đơn');
    if (i.status === 'void') throw bad('Hoá đơn đã huỷ');
    tx(() => {
      for (const r of q.all('SELECT order_id FROM invoice_orders WHERE invoice_id=?', i.id)) L.addEvent(r.order_id, 'invoice', `Hoá đơn ${i.code} bị huỷ`, req.user);
      q.run('DELETE FROM invoice_orders WHERE invoice_id=?', i.id);
      q.run("UPDATE invoices SET status='void', note=? WHERE id=?", text(`${i.note} [Huỷ: ${req.body.reason || 'không ghi lý do'}]`, 300), i.id);
      q.run('UPDATE payments SET invoice_id=NULL WHERE invoice_id=?', i.id);
    });
    audit(req.user, 'Huỷ hoá đơn', i.code);
    res.json({ ok: true });
  });
};
