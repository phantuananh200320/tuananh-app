'use strict';
// Nhập đơn: danh sách, tạo, sửa, đổi trạng thái, huỷ, in phiếu, nhập từ Excel, xuất Excel.
const { q, audit, settings } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { buildXlsx, STYLE } = require('../lib/xlsx');
const { readSheet } = require('../lib/xlsx-read');
const { auth } = require('../auth');
const { nextCode } = require('../erp/schema');
const { need, text, like, page, hideMoney, seesMoney } = require('../erp/common');
const L = require('../erp/orders-lib');

const SOURCE_LABEL = { manual: 'Nhân viên', excel: 'Excel', app: 'App khách' };
const norm = (s) => String(s === undefined || s === null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
const FIELD_ALIASES = {
  group: ['madon', 'madonnhom', 'manhomdon', 'sodon', 'nhomdon', 'madonhang', 'nhom'],
  customer: ['khachhang', 'makhachhang', 'makh', 'tenkhachhang', 'khach', 'tenkh'],
  order_date: ['ngaydat', 'ngaylap', 'ngaydathang'],
  delivery_date: ['ngaygiao', 'ngaygiaohang'],
  address: ['diachi', 'diachigiao', 'diachigiaohang'],
  product: ['sanpham', 'masp', 'tensp', 'mahang', 'tenhang', 'masanpham', 'tensanpham', 'mahangtenhang', 'maspten', 'hanghoa'],
  unit: ['dvt', 'donvitinh', 'donvi'],
  qty: ['soluong', 'sl'],
  price: ['dongia', 'gia'],
  note: ['ghichu', 'note'],
};

// Ngày trong Excel có thể là số thứ tự (46000) hoặc chuỗi dd/mm/yyyy, yyyy-mm-dd
function parseDate(v) {
  if (v === '' || v === undefined || v === null) return '';
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${U.pad(m[2])}-${U.pad(m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${U.pad(m[2])}-${U.pad(m[1])}`;
  return null;
}
const parseNum = (v) => {
  if (typeof v === 'number') return v;
  let s = String(v || '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  return Number(s);
};

function parseImport(rows, createCustomers, canPrice) {
  if (rows.length < 2) throw bad('File không có dữ liệu. Dòng đầu phải là tiêu đề cột.');
  // Tìm dòng tiêu đề trong 5 dòng đầu
  let hi = -1, map = {};
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const m = {};
    rows[i].forEach((c, ci) => {
      const k = norm(c);
      for (const [f, al] of Object.entries(FIELD_ALIASES)) if (m[f] === undefined && al.includes(k)) m[f] = ci;
    });
    if (m.customer !== undefined && m.product !== undefined && m.qty !== undefined) { hi = i; map = m; break; }
  }
  if (hi < 0) throw bad('Không nhận ra tiêu đề cột. Cần tối thiểu: Khách hàng, Sản phẩm, Số lượng. Hãy tải file mẫu.');

  const customers = q.all('SELECT id, code, name, address, active FROM customers');
  const byCode = new Map(customers.map((c) => [c.code.toLowerCase(), c]));
  const byName = new Map(customers.map((c) => [norm(c.name), c]));
  const products = q.all('SELECT * FROM products WHERE active=1');
  const pByCode = new Map(products.map((p) => [p.code.toLowerCase(), p]));
  const pByName = new Map(products.map((p) => [norm(p.name), p]));

  const today = U.today();
  const groups = new Map();
  const errors = [];
  let lastCus = '', lastGroup = '';
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const cell = (f) => (map[f] === undefined ? '' : r[map[f]] === undefined ? '' : r[map[f]]);
    if (!r.some((x) => String(x).trim() !== '')) continue;
    const line = i + 1;
    let cusRaw = String(cell('customer')).trim();
    const grp = String(cell('group')).trim();
    if (!cusRaw && (grp === lastGroup || !grp)) cusRaw = lastCus;
    if (!cusRaw) { errors.push({ row: line, msg: 'Thiếu khách hàng' }); continue; }
    lastCus = cusRaw; lastGroup = grp;
    const prodRaw = String(cell('product')).trim();
    const qty = parseNum(cell('qty'));
    if (!prodRaw) { errors.push({ row: line, msg: 'Thiếu sản phẩm' }); continue; }
    if (!Number.isFinite(qty) || qty <= 0) { errors.push({ row: line, msg: 'Số lượng không hợp lệ' }); continue; }
    const dd = parseDate(cell('delivery_date'));
    const od = parseDate(cell('order_date'));
    if (dd === null || od === null) { errors.push({ row: line, msg: 'Ngày không đúng định dạng (dd/mm/yyyy)' }); continue; }
    const addr = String(cell('address')).trim();
    const key = grp ? `g:${grp}` : `c:${norm(cusRaw)}|${dd}|${norm(addr)}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, customer_text: cusRaw, order_date: od || today, delivery_date: dd || od || today, address: addr, note: '', items: [], errors: [], first_row: line };
      groups.set(key, g);
    }
    const prod = pByCode.get(prodRaw.toLowerCase()) || pByName.get(norm(prodRaw)) || null;
    if (!prod) { g.errors.push(`Dòng ${line}: không tìm thấy sản phẩm "${prodRaw}" trong danh mục`); continue; }
    // Giá luôn lấy theo bảng giá của tài chính; chỉ người có quyền tài chính mới nhập giá riêng trong file
    const priceRaw = cell('price');
    const price = canPrice && priceRaw !== '' ? parseNum(priceRaw) : undefined;
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) { g.errors.push(`Dòng ${line}: đơn giá không hợp lệ`); continue; }
    const dup = g.items.find((x) => x.product_id === prod.id);
    if (dup) dup.qty += qty; else g.items.push({ product_id: prod.id, qty, price });
    const note = String(cell('note')).trim();
    if (note && !g.note.includes(note)) g.note = (g.note ? g.note + '; ' : '') + note;
  }

  const orders = [];
  const newCustomers = new Set();
  for (const g of groups.values()) {
    const c = byCode.get(g.customer_text.toLowerCase()) || byName.get(norm(g.customer_text)) || null;
    if (!c) {
      if (createCustomers) newCustomers.add(g.customer_text);
      else g.errors.push(`Không tìm thấy khách hàng "${g.customer_text}"`);
    } else if (!c.active) g.errors.push(`Khách hàng "${c.name}" đã ngừng giao dịch`);
    if (g.delivery_date < g.order_date) g.errors.push('Ngày giao trước ngày đặt');
    if (!g.items.length && !g.errors.length) g.errors.push('Đơn không có dòng hàng hợp lệ');
    let total = 0;
    if (c && g.items.length) {
      try { total = L.cleanItems(g.items, { customerId: c.id, canPrice, allowFree: false }).reduce((s2, x) => s2 + x.amount, 0); } catch (e) { g.errors.push(e.message); }
    }
    orders.push({
      key: g.key, row: g.first_row, customer_id: c ? c.id : null, customer_text: g.customer_text, customer_name: c ? c.name : g.customer_text,
      new_customer: !c && createCustomers, order_date: g.order_date, delivery_date: g.delivery_date,
      address: g.address || (c ? c.address : ''), note: g.note, items: g.items.map((x) => ({ ...x, name: (products.find((p) => p.id === x.product_id) || {}).name || '' })), total, errors: g.errors,
    });
  }
  return { orders, errors, new_customers: [...newCustomers] };
}

module.exports = (app) => {
  const base = [auth(), need('orders', 'delivery', 'finance', 'warehouse'), hideMoney];
  const write = [auth(), need('orders'), hideMoney];
  const floor = [auth(), need('warehouse', 'orders'), hideMoney];

  // ---------- Mẫu và nhập từ Excel (đăng ký trước các đường dẫn có :id) ----------
  app.get('/api/orders/template', ...write, (req, res) => {
    const head = ['Mã đơn (nhóm)', 'Khách hàng', 'Ngày giao', 'Địa chỉ giao', 'Sản phẩm (mã hoặc tên)', 'Số lượng', 'Ghi chú'];
    const d = U.addDays(U.today(), 1).split('-').reverse().join('/');
    const rows = [
      head.map((h) => ({ v: h, s: STYLE.header })),
      ['A1', 'Đại lý ABC', d, '12 Lê Lợi, Quận 1', 'SP01', 10, 'Giao trước 7h'],
      ['A1', '', '', '', 'BÚN BÒ', 5, ''],
      ['A2', 'Đại lý XYZ', d, '45 Nguyễn Huệ, Quận 1', 'SP15', 20, ''],
    ];
    const guide = [
      [{ v: 'HƯỚNG DẪN NHẬP ĐƠN TỪ EXCEL', s: STYLE.title }],
      ['- Mỗi dòng là một dòng hàng. Các dòng có cùng "Mã đơn (nhóm)" sẽ gộp thành một đơn.'],
      ['- Nếu để trống "Mã đơn (nhóm)": các dòng cùng khách hàng, cùng ngày giao, cùng địa chỉ được gộp thành một đơn.'],
      ['- Cột Khách hàng nhập mã (KH000001) hoặc tên đúng như trong danh mục. Dòng sau để trống sẽ lấy khách hàng của dòng trên.'],
      ['- Ngày giao định dạng dd/mm/yyyy. Để trống thì lấy ngày hôm nay.'],
      ['- Sản phẩm nhập mã (SP01...) hoặc tên đúng như trong danh mục. Số lượng theo đơn vị tính của sản phẩm: hàng gói tính KG (bội của 0,5), nui tươi tính HỘP, hàng rời tính KG.'],
      ['- Không nhập giá: giá do bộ phận tài chính đặt, hệ thống tự áp.'],
      ['- Cột bắt buộc: Khách hàng, Sản phẩm, Số lượng. Hệ thống cho xem trước và báo lỗi từng dòng trước khi tạo đơn.'],
    ];
    const buf = buildXlsx([{ name: 'Đơn hàng', rows, widths: [14, 26, 12, 30, 28, 10, 24], freeze: { rows: 1 } }, { name: 'Hướng dẫn', rows: guide, widths: [110] }]);
    res.send(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, { 'Content-Disposition': 'attachment; filename="mau-nhap-don.xlsx"', 'Cache-Control': 'no-store' });
  });

  // Nhận file dạng base64 trong JSON. commit=false: chỉ xem trước. commit=true: tạo các đơn hợp lệ.
  app.post('/api/orders/import', ...write, (req, res) => {
    const b64 = String(req.body.data || '');
    if (!b64) throw bad('Chưa chọn file');
    let buf;
    try { buf = Buffer.from(b64, 'base64'); } catch { throw bad('File không hợp lệ'); }
    let rows;
    try { rows = readSheet(buf, req.body.filename); } catch (e) { throw bad(e.message); }
    const create = !!req.body.create_customers;
    const parsed = parseImport(rows, create, seesMoney(req.user));
    if (!req.body.commit) return res.json({ preview: true, ...parsed });

    const created = [];
    const skipped = [];
    for (const o of parsed.orders) {
      if (o.errors.length) { skipped.push({ row: o.row, customer: o.customer_name, errors: o.errors }); continue; }
      try {
        const r = L.atomic(() => {
          let cid = o.customer_id;
          if (!cid) {
            const code = nextCode('KH');
            cid = Number(q.run('INSERT INTO customers(code,name,address,created_at) VALUES(?,?,?,?)', code, text(o.customer_text, 150), o.address, Date.now()).lastInsertRowid);
          }
          return L.createOrder({ customer_id: cid, order_date: o.order_date, delivery_date: o.delivery_date, address: o.address, note: o.note, items: o.items.map(({ product_id, qty, price }) => ({ product_id, qty, price })) }, req.user, 'excel', { canPrice: seesMoney(req.user), allowFree: false });
        });
        created.push(r);
      } catch (e) { skipped.push({ row: o.row, customer: o.customer_name, errors: [e.message] }); }
    }
    audit(req.user, 'Nhập đơn từ Excel', `${created.length} đơn, bỏ qua ${skipped.length}`);
    res.json({ committed: true, created, skipped, row_errors: parsed.errors });
  });

  app.get('/api/orders/export', ...base, (req, res) => {
    const money = seesMoney(req.user);
    const { where, params } = filters(req.query);
    const rows = q.all(`SELECT o.*, c.code AS customer_code, c.name AS customer_name FROM orders o JOIN customers c ON c.id=o.customer_id ${where} ORDER BY o.id DESC LIMIT 20000`, ...params);
    const S = settings();
    const head = ['Mã đơn', 'Ngày đặt', 'Ngày giao', 'Mã KH', 'Khách hàng', 'Địa chỉ giao', 'Nguồn', 'Trạng thái', ...(money ? ['Tạm tính', 'Chiết khấu', 'Thành tiền'] : []), 'Ghi chú'];
    const data = [[{ v: `DANH SÁCH ĐƠN HÀNG - ${S.company_name}`, s: STYLE.title }], head.map((h) => ({ v: h, s: STYLE.header }))];
    let sum = 0;
    for (const o of rows) {
      if (o.status !== 'cancelled') sum += o.total;
      data.push([{ v: o.code, s: STYLE.text }, { v: o.order_date, s: STYLE.center }, { v: o.delivery_date, s: STYLE.center }, { v: o.customer_code, s: STYLE.text }, { v: o.customer_name, s: STYLE.text },
        { v: o.address, s: STYLE.text }, { v: SOURCE_LABEL[o.source] || o.source, s: STYLE.text }, { v: L.STATUS_LABEL[o.status], s: STYLE.text },
        ...(money ? [{ v: o.subtotal, s: STYLE.int }, { v: o.discount, s: STYLE.int }, { v: o.total, s: STYLE.int }] : []), { v: o.note, s: STYLE.text }]);
    }
    if (money) data.push([null, null, null, null, null, null, null, { v: 'Tổng (không tính đơn huỷ)', s: STYLE.bold }, null, null, { v: sum, s: STYLE.int }]);
    const buf = buildXlsx([{ name: 'Đơn hàng', rows: data, freeze: { rows: 2 }, widths: [12, 11, 11, 11, 26, 32, 10, 14, ...(money ? [13, 11, 14] : []), 24] }]);
    res.send(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, { 'Content-Disposition': 'attachment; filename="don-hang.xlsx"', 'Cache-Control': 'no-store' });
  });

  // In phiếu giao hàng: trả dữ liệu nhiều đơn một lần và tăng số lần in (lần in thứ hai trở đi là "in lại"). Phiếu không in giá.
  app.post('/api/orders/print', ...base, (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 200);
    if (!ids.length) throw bad('Chưa chọn đơn nào để in');
    const out = [];
    for (const id of ids) {
      const o = L.orderFull(id);
      if (!o) continue;
      out.push({ ...o, reprint: o.print_count > 0 });
      if (req.body.count !== false) {
        q.run('UPDATE orders SET print_count=print_count+1 WHERE id=?', id);
        L.addEvent(id, 'printed', o.print_count > 0 ? `In lại phiếu (lần ${o.print_count + 1})` : 'In phiếu', req.user);
      }
    }
    const S = settings();
    res.json({ company: { name: S.company_name }, orders: out });
  });

  // ---------- Làm hàng, soạn hàng, check in ----------
  // Các đơn cần làm cho ngày giao đã chọn (kể cả đơn trễ hẹn chưa xong), kèm tổng hợp số lượng theo sản phẩm
  function productionData(day, ids) {
    const rows = ids
      ? q.all(`SELECT id FROM orders WHERE id IN (${ids.map(() => '?').join(',')}) AND status<>'cancelled' ORDER BY delivery_date, id`, ...ids)
      : q.all(`SELECT id FROM orders WHERE status NOT IN ('cancelled','delivered') AND (delivery_date=? OR (delivery_date<? AND status IN ('new','producing')))
               ORDER BY delivery_date, id`, day, day);
    const orders = rows.map((r) => L.orderFull(r.id));
    const sum = new Map();
    for (const o of orders) {
      if (o.checked_at || o.status === 'delivering') continue;
      for (const i of o.items) {
        const k = i.product_id || 'n:' + i.name;
        const cur = sum.get(k) || { product_id: i.product_id, name: i.name, unit: i.unit, spec: i.spec || '', pack_kg: i.pack_kg || 0, pack_noun: i.pack_noun, qty: 0, orders: 0, group_name: '', sort_no: 0 };
        cur.qty = Math.round((cur.qty + i.qty) * 1000) / 1000;
        cur.orders += 1;
        sum.set(k, cur);
      }
    }
    const grp = Object.fromEntries(q.all('SELECT id, group_name, sort_no FROM products').map((p) => [p.id, p]));
    const summary = [...sum.values()].map((x) => ({ ...x, group_name: (grp[x.product_id] || {}).group_name || '', sort_no: (grp[x.product_id] || {}).sort_no || 9999, pack_text: L.packText(x) }))
      .sort((a, b2) => a.sort_no - b2.sort_no);
    return { orders, summary };
  }

  app.get('/api/production', ...floor, (req, res) => {
    const day = U.isYmd(req.query.date) ? req.query.date : U.today();
    const d = productionData(day, null);
    res.json({ date: day, ...d, orders: d.orders.map((o) => ({ ...o, events: undefined })) });
  });

  // In phiếu làm hàng (tổng hợp theo sản phẩm + phiếu soạn từng đơn). start=true: đơn mới chuyển sang "Đang làm hàng".
  app.post('/api/production/print', ...floor, (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 300);
    if (!ids.length) throw bad('Chưa chọn đơn nào để in');
    const d = productionData(null, ids);
    if (req.body.start !== false) {
      for (const o of d.orders) {
        if (o.status === 'new') L.setStatus(o, 'producing', req.user, 'In phiếu làm hàng');
        else L.addEvent(o.id, 'printed', 'In phiếu làm hàng', req.user);
      }
    }
    res.json({ company: { name: settings().company_name }, date: req.body.date || U.today(), orders: d.orders, summary: d.summary });
  });

  const loadOrder = (id) => {
    const o = q.get('SELECT * FROM orders WHERE id=?', Number(id));
    if (!o) throw notFound('Không tìm thấy đơn hàng');
    return o;
  };
  app.get('/api/orders/by-code/:code', ...floor, (req, res) => {
    const r = q.get('SELECT id FROM orders WHERE code=?', String(req.params.code).trim().toUpperCase());
    if (!r) throw notFound('Không tìm thấy đơn ' + String(req.params.code).toUpperCase());
    res.json(L.orderFull(r.id));
  });
  app.post('/api/orders/:id/checkin', ...floor, (req, res) => {
    const o = loadOrder(req.params.id);
    L.checkin(o, req.user);
    res.json(L.orderFull(o.id));
  });
  app.post('/api/orders/:id/uncheck', ...floor, (req, res) => {
    const o = loadOrder(req.params.id);
    L.uncheck(o, req.user);
    res.json(L.orderFull(o.id));
  });

  // ---------- Danh sách ----------
  function filters(qs) {
    const where = [];
    const params = [];
    if (qs.status) {
      const st = String(qs.status).split(',').filter((s) => L.STATUS.includes(s));
      if (st.length) { where.push(`o.status IN (${st.map(() => '?').join(',')})`); params.push(...st); }
    }
    if (U.isYmd(qs.from)) { where.push('o.order_date>=?'); params.push(qs.from); }
    if (U.isYmd(qs.to)) { where.push('o.order_date<=?'); params.push(qs.to); }
    if (U.isYmd(qs.delivery_date)) { where.push('o.delivery_date=?'); params.push(qs.delivery_date); }
    if (qs.customer_id) { where.push('o.customer_id=?'); params.push(Number(qs.customer_id)); }
    if (qs.unassigned === '1') where.push('o.trip_id IS NULL');
    if (['manual', 'excel', 'app'].includes(qs.source)) { where.push('o.source=?'); params.push(qs.source); }
    if (qs.checked === '1') where.push('o.checked_at IS NOT NULL');
    if (qs.checked === '0') where.push('o.checked_at IS NULL');
    if (U.isYmd(qs.delivery_from)) { where.push('o.delivery_date>=?'); params.push(qs.delivery_from); }
    if (U.isYmd(qs.delivery_to)) { where.push('o.delivery_date<=?'); params.push(qs.delivery_to); }
    if (qs.q) {
      const s = like(text(qs.q, 60));
      where.push("(o.code LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' OR o.address LIKE ? ESCAPE '\\')");
      params.push(s, s, s, s);
    }
    return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
  }

  app.get('/api/orders', ...base, (req, res) => {
    const { where, params } = filters(req.query);
    const pg = page(req);
    const from = 'FROM orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN trips t ON t.id=o.trip_id';
    const agg = q.get(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN o.status<>'cancelled' THEN o.total END),0) s ${from} ${where}`, ...params);
    const rows = q.all(`SELECT o.id, o.code, o.order_date, o.delivery_date, o.status, o.total, o.address, o.print_count, o.trip_id, o.source, o.checked_at, t.code AS trip_code,
        c.id AS customer_id, c.code AS customer_code, c.name AS customer_name, c.phone AS customer_phone,
        (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) AS item_count
      ${from} ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...params, pg.per, pg.offset);
    res.json({ rows, count: agg.n, sum: agg.s, page: pg.page, per: pg.per });
  });

  app.get('/api/orders/:id', ...base, (req, res) => {
    const key = String(req.params.id);
    const id = /^\d+$/.test(key) ? Number(key) : (q.get('SELECT id FROM orders WHERE code=?', key.toUpperCase()) || {}).id;
    const o = id ? L.orderFull(id) : null;
    if (!o) throw notFound('Không tìm thấy đơn hàng');
    o.events = q.all('SELECT ts, kind, detail, actor_name FROM order_events WHERE order_id=? ORDER BY id DESC LIMIT 100', o.id);
    if (!seesMoney(req.user)) o.events = o.events.map((e) => (e.kind === 'payment' ? { ...e, detail: 'Đã thu tiền khi giao' } : e));
    res.json(o);
  });

  // ---------- Tạo, sửa ----------
  app.post('/api/orders', ...write, (req, res) => {
    const r = L.createOrder(req.body, req.user, 'manual', { canPrice: seesMoney(req.user), allowFree: false });
    audit(req.user, 'Tạo đơn hàng', r.code);
    res.json(L.orderFull(r.id));
  });

  app.put('/api/orders/:id', ...write, (req, res) => {
    const o = q.get('SELECT * FROM orders WHERE id=?', Number(req.params.id));
    if (!o) throw notFound('Không tìm thấy đơn hàng');
    if (o.status === 'cancelled') throw bad('Đơn đã huỷ, không sửa được');
    if (L.invoiceOf(o.id)) throw bad('Đơn đã nằm trong hoá đơn, không sửa được. Huỷ hoá đơn trước.');
    if (o.status === 'delivered' && req.user.role !== 'admin') throw new HttpError(403, 'Đơn đã giao chỉ quản trị viên mới sửa được', 'FORBIDDEN');
    if (o.status === 'delivering' && req.user.role === 'employee') throw new HttpError(403, 'Đơn đang giao, hãy nhờ quản lý chỉnh sửa', 'FORBIDDEN');
    L.updateOrder(o, req.body, req.user, { canPrice: seesMoney(req.user) });
    audit(req.user, 'Sửa đơn hàng', o.code);
    res.json(L.orderFull(o.id));
  });

  // ---------- Trạng thái, huỷ, khôi phục ----------
  const load = (req) => {
    const o = q.get('SELECT * FROM orders WHERE id=?', Number(req.params.id));
    if (!o) throw notFound('Không tìm thấy đơn hàng');
    return o;
  };
  app.post('/api/orders/:id/status', ...write, (req, res) => {
    const o = load(req);
    L.setStatus(o, String(req.body.status || ''), req.user, text(req.body.note, 200));
    res.json(L.orderFull(o.id));
  });
  // Đổi trạng thái hàng loạt (ví dụ chuyển nhiều đơn sang "Đang sản xuất")
  app.post('/api/orders/bulk-status', ...write, (req, res) => {
    const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 300);
    const status = String(req.body.status || '');
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      const o = q.get('SELECT * FROM orders WHERE id=?', id);
      if (!o) continue;
      try { L.setStatus(o, status, req.user, ''); ok++; } catch (e) { failed.push({ code: o.code, error: e.message }); }
    }
    res.json({ ok, failed });
  });
  app.post('/api/orders/:id/cancel', ...write, (req, res) => {
    const o = load(req);
    L.cancelOrder(o, req.body.reason, req.user);
    audit(req.user, 'Huỷ đơn hàng', o.code);
    res.json(L.orderFull(o.id));
  });
  app.post('/api/orders/:id/restore', ...write, (req, res) => {
    const o = load(req);
    if (o.status !== 'cancelled') throw bad('Đơn chưa bị huỷ');
    q.run("UPDATE orders SET status='new', cancel_reason='', updated_at=? WHERE id=?", Date.now(), o.id);
    L.addEvent(o.id, 'restored', 'Khôi phục đơn đã huỷ', req.user);
    audit(req.user, 'Khôi phục đơn hàng', o.code);
    res.json(L.orderFull(o.id));
  });
  // Xoá hẳn: chỉ quản trị viên và chỉ với đơn đã huỷ
  app.del('/api/orders/:id', auth('admin'), need('orders'), (req, res) => {
    const o = load(req);
    if (o.status !== 'cancelled') throw bad('Chỉ xoá được đơn đã huỷ. Hãy huỷ đơn trước.');
    if (L.invoiceOf(o.id)) throw bad('Đơn nằm trong hoá đơn');
    q.run('DELETE FROM orders WHERE id=?', o.id);
    audit(req.user, 'Xoá đơn hàng', o.code);
    res.json({ ok: true });
  });
};
