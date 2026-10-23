'use strict';
// Kiểm thử các phân hệ ERP: node scripts/smoke-erp.js
// Tự khởi động máy chủ tạm với dữ liệu riêng, không đụng vào dữ liệu thật.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { buildXlsx } = require('../server/lib/xlsx');

const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-test-'));
const results = [];

async function api(method, url, body, token) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}
async function step(name, fn) {
  try { await fn(); results.push([true, name]); console.log('  ✓', name); } catch (e) { results.push([false, name]); console.log('  ✗', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); }
}
const ok = (r, msg) => assert.strictEqual(r.status, 200, `${msg || ''} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
const pad = (n) => String(n).padStart(2, '0');
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; })();
const dmy = today.split('-').reverse().join('/');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1', ADMIN_CODE: 'admin', ADMIN_PASSWORD: 'admin123', TZ: 'Asia/Ho_Chi_Minh' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* chờ */ } await new Promise((r) => setTimeout(r, 100)); }

  let A = '', M = '', D = '', K = '';
  let P = {}; let cus1, cus2, drv, route, o1, o2, o3, trip, inv, mgr;
  console.log('Kiểm thử ERP trên cổng', PORT);

  await step('đăng nhập quản trị, đổi mật khẩu, phân quyền mặc định', async () => {
    const r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' }); ok(r);
    const c = await api('POST', '/api/auth/change-password', { old_password: 'admin123', new_password: 'Admin#12345' }, r.data.token); ok(c);
    A = c.data.token;
    assert.deepStrictEqual((await api('GET', '/api/erp/me', null, A)).data.modules, ['manage', 'orders', 'warehouse', 'delivery', 'finance']);
  });

  await step('danh mục 28 sản phẩm nạp sẵn đúng quy cách; tạo khách, tài xế, tuyến', async () => {
    let r = await api('GET', '/api/products?all=1', null, A); ok(r);
    assert.strictEqual(r.data.length, 28);
    for (const p of r.data) P[p.code] = p;
    assert.strictEqual(P.SP01.name, 'BÚN SỢI NHUYỄN'); assert.strictEqual(P.SP01.qty_step, 0.5); assert.strictEqual(P.SP01.pack_kg, 0.5); assert.strictEqual(P.SP01.unit, 'KG');
    assert.strictEqual(P.SP13.pack_kg, 5); assert.strictEqual(P.SP13.qty_step, 5); assert.strictEqual(P.SP15.unit, 'HỘP'); assert.strictEqual(P.SP23.pack_kg, 0); assert.strictEqual(P.SP23.spec, 'Rời (xá)');
    assert.ok(r.data.every((p) => p.price === 0), 'chưa có giá: tài chính sẽ đặt');
    r = await api('POST', '/api/customers', { name: 'Đại lý Nguyễn Văn A', phone: '0901000001', address: '12 Lê Lợi', credit_limit: 1000000, opening_debt: 50000, area: 'Quận 1' }, A); ok(r); cus1 = r.data;
    assert.match(cus1.code, /^KH\d{6}$/); assert.strictEqual(cus1.debt, 50000);
    r = await api('POST', '/api/customers', { name: 'Đại lý B', code: 'ctyb', phone: '0902' }, A); ok(r); cus2 = r.data; assert.strictEqual(cus2.code, 'CTYB');
    assert.strictEqual((await api('POST', '/api/customers', { name: 'Trùng mã', code: 'CTYB' }, A)).status, 400);
    r = await api('POST', '/api/products', { name: 'Sản phẩm mới', unit: 'kg', qty_step: 1, price: 1000 }, A); ok(r); assert.strictEqual(r.data.code, 'SP29', 'mã tự sinh nối tiếp, không trùng mã nạp sẵn');
    r = await api('POST', '/api/drivers', { name: 'Trần Tài Xế', phone: '0903', plate: '51a-123.45' }, A); ok(r); drv = r.data;
    r = await api('POST', '/api/delivery-routes', { name: 'Tuyến Quận 1' }, A); ok(r); route = r.data;
  });

  await step('tài chính đặt giá chung và bảng giá theo khu vực', async () => {
    for (const [code, price] of [['SP01', 40000], ['SP03', 50000], ['SP15', 30000], ['SP13', 200000]]) ok(await api('PUT', `/api/prices/product/${P[code].id}`, { price }, A));
    let r = await api('POST', '/api/price-lists', { name: 'Quận 7' }, A); ok(r); const lid = r.data.id;
    ok(await api('PUT', '/api/prices/item', { list_id: lid, product_id: P.SP01.id, price: 35000 }, A));
    ok(await api('PUT', `/api/customers/${cus2.id}/price-list`, { price_list_id: lid }, A));
    r = await api('GET', `/api/prices/for-customer/${cus2.id}`, null, A); ok(r); assert.strictEqual(r.data[P.SP01.id], 35000); assert.strictEqual(r.data[P.SP03.id], 50000, 'sản phẩm không có trong bảng giá riêng dùng giá chung');
    assert.strictEqual((await api('POST', '/api/price-lists', { name: 'Quận 7' }, A)).status, 400);
  });

  await step('tạo đơn: giá từ bảng giá, bước đặt hàng, không nhập tự do', async () => {
    let r = await api('POST', '/api/orders', { customer_id: cus1.id, delivery_date: today, discount: 5000, items: [{ product_id: P.SP01.id, qty: 10 }, { product_id: P.SP15.id, qty: 5 }] }, A);
    ok(r); o1 = r.data;
    assert.match(o1.code, /^DH\d{6}$/); assert.strictEqual(o1.subtotal, 10 * 40000 + 5 * 30000); assert.strictEqual(o1.total, 545000); assert.strictEqual(o1.status, 'new'); assert.strictEqual(o1.address, '12 Lê Lợi');
    assert.strictEqual(o1.items[0].pack_text, '20 gói 500gr', '10 kg bún = 20 gói 500gr');
    const bad = (items) => api('POST', '/api/orders', { customer_id: cus1.id, items }, A);
    assert.strictEqual((await bad([{ product_id: P.SP01.id, qty: 0.3 }])).status, 400, 'bún gói phải là bội của 0,5kg');
    assert.strictEqual((await bad([{ product_id: P.SP13.id, qty: 7 }])).status, 400, 'hủ tiếu dai bịch 5kg');
    assert.strictEqual((await bad([{ product_id: P.SP15.id, qty: 1.5 }])).status, 400, 'nui tươi tính theo hộp nguyên');
    assert.strictEqual((await bad([{ name: 'Hàng tự gõ', qty: 1, price: 1 }])).status, 400, 'phải chọn sản phẩm trong danh mục');
    assert.strictEqual((await bad([{ product_id: P.SP01.id, qty: 1 }, { product_id: P.SP01.id, qty: 1 }])).status, 400, 'trùng sản phẩm');
    assert.strictEqual((await bad([])).status, 400);
    assert.strictEqual((await api('POST', '/api/orders', { customer_id: cus1.id, order_date: today, delivery_date: '2000-01-01', items: [{ product_id: P.SP01.id, qty: 1 }] }, A)).status, 400, 'ngày giao trước ngày đặt');
    r = await api('POST', '/api/orders', { customer_id: cus1.id, items: [{ product_id: P.SP23.id, qty: 2 }] }, A); ok(r); assert.strictEqual(r.data.total, 0, 'chưa có giá thì 0, áp giá sau'); o3 = r.data;
  });

  await step('sửa đơn, đổi trạng thái, in và in lại, huỷ, khôi phục', async () => {
    let r = await api('PUT', `/api/orders/${o1.id}`, { customer_id: cus1.id, delivery_date: today, address: '99 Hai Bà Trưng', items: [{ product_id: P.SP01.id, qty: 20 }] }, A); ok(r);
    assert.strictEqual(r.data.total, 800000); assert.strictEqual(r.data.address, '99 Hai Bà Trưng');
    r = await api('POST', `/api/orders/${o1.id}/status`, { status: 'producing' }, A); ok(r); assert.strictEqual(r.data.status, 'producing');
    r = await api('POST', '/api/orders/print', { ids: [o1.id] }, A); ok(r); assert.strictEqual(r.data.orders[0].reprint, false);
    r = await api('POST', '/api/orders/print', { ids: [o1.id] }, A); ok(r); assert.strictEqual(r.data.orders[0].reprint, true, 'lần in thứ hai là in lại');
    r = await api('POST', `/api/orders/${o1.id}/cancel`, { reason: 'Khách đổi ý' }, A); ok(r); assert.strictEqual(r.data.status, 'cancelled');
    assert.strictEqual((await api('PUT', `/api/orders/${o1.id}`, { customer_id: cus1.id, items: [{ product_id: P.SP01.id, qty: 1 }] }, A)).status, 400, 'không sửa đơn đã huỷ');
    r = await api('POST', `/api/orders/${o1.id}/restore`, {}, A); ok(r); assert.strictEqual(r.data.status, 'new');
  });

  await step('áp lại giá cho đơn đến trước lúc có giá', async () => {
    ok(await api('PUT', `/api/prices/product/${P.SP23.id}`, { price: 60000 }, A));
    assert.strictEqual((await api('GET', `/api/orders/${o3.id}`, null, A)).data.total, 0, 'đơn cũ giữ giá lúc đặt cho tới khi áp lại');
    const r = await api('POST', '/api/prices/apply', {}, A); ok(r); assert.ok(r.data.updated >= 1);
    assert.strictEqual((await api('GET', `/api/orders/${o3.id}`, null, A)).data.total, 120000);
  });

  await step('nhập Excel: chỉ nhận sản phẩm trong danh mục, giá theo bảng giá', async () => {
    const t = await api('GET', '/api/orders/template', null, A); assert.strictEqual(t.status, 200); assert.ok(Buffer.isBuffer(t.data) && t.data[0] === 0x50);
    const xl = buildXlsx([{ name: 'Đơn', rows: [
      ['Mã đơn (nhóm)', 'Khách hàng', 'Ngày giao', 'Địa chỉ giao', 'Sản phẩm', 'Số lượng', 'Ghi chú'],
      ['X1', cus2.code, dmy, '45 Nguyễn Huệ', 'SP01', 3, 'gấp'],
      ['X1', '', '', '', 'NUI TƯƠI TRẮNG', 2, ''],
      ['X2', 'Khách chưa có', dmy, '', 'SP03', 4, ''],
      ['X3', cus1.name, dmy, '', 'Món không có trong danh mục', 1, ''],
      ['X4', cus1.name, dmy, '', 'SP01', 0.3, ''],
    ] }]);
    const b64 = xl.toString('base64');
    let r = await api('POST', '/api/orders/import', { filename: 'a.xlsx', data: b64 }, A); ok(r);
    const by = Object.fromEntries(r.data.orders.map((o) => [o.key, o]));
    assert.strictEqual(by['g:X1'].items.length, 2); assert.strictEqual(by['g:X1'].total, 3 * 35000 + 2 * 30000, 'khách có bảng giá Quận 7');
    assert.ok(by['g:X2'].errors.some((e) => /Không tìm thấy khách hàng/.test(e)));
    assert.ok(by['g:X3'].errors.some((e) => /không tìm thấy sản phẩm/.test(e)));
    assert.ok(by['g:X4'].errors.some((e) => /bội số/.test(e)));
    r = await api('POST', '/api/orders/import', { filename: 'a.xlsx', data: b64, commit: true, create_customers: true }, A); ok(r);
    assert.strictEqual(r.data.created.length, 2, JSON.stringify(r.data)); assert.strictEqual(r.data.skipped.length, 2);
    o2 = r.data.created[0];
    const csv = 'Khách hàng;Sản phẩm;Số lượng\n' + `${cus2.code};SP15;5\n`;
    r = await api('POST', '/api/orders/import', { filename: 'a.csv', data: Buffer.from(csv).toString('base64'), commit: true }, A); ok(r);
    assert.strictEqual(r.data.created.length, 1);
  });

  await step('danh sách, lọc theo nguồn, tìm kiếm, xuất Excel', async () => {
    let r = await api('GET', '/api/orders?status=new', null, A); ok(r); assert.ok(r.data.count >= 3);
    r = await api('GET', '/api/orders?source=excel', null, A); ok(r); assert.ok(r.data.rows.every((o) => o.source === 'excel') && r.data.count >= 3);
    r = await api('GET', '/api/orders/export', null, A); assert.strictEqual(r.status, 200); assert.strictEqual(r.data[0], 0x50);
    r = await api('GET', `/api/erp/search?q=${encodeURIComponent('Nguyễn')}`, null, A); ok(r); assert.ok(r.data.customers.length >= 1);
  });

  await step('nhân viên thường không thấy giá; quản lý chỉ làm được việc của mình', async () => {
    let r = await api('POST', '/api/employees', { code: 'QL01', full_name: 'Quản Lý', password: '123456', role: 'manager', track: false }, A); ok(r); mgr = r.data;
    r = await api('POST', '/api/auth/login', { username: 'QL01', password: '123456' }); ok(r); M = r.data.token;
    assert.deepStrictEqual((await api('GET', '/api/erp/me', null, M)).data.modules, ['manage', 'orders', 'warehouse', 'delivery']);
    r = await api('GET', `/api/orders/${o2.id}`, null, M); ok(r);
    for (const k of ['total', 'subtotal', 'discount']) assert.ok(!has(r.data, k), 'đơn không được lộ ' + k);
    assert.ok(r.data.items.every((i) => !has(i, 'price') && !has(i, 'amount')), 'dòng hàng không lộ giá');
    r = await api('GET', '/api/orders', null, M); ok(r); assert.ok(r.data.rows.length && r.data.rows.every((o) => !has(o, 'total')) && !has(r.data, 'sum') && r.data.count > 0);
    r = await api('GET', '/api/products', null, M); ok(r); assert.ok(r.data.length && r.data.every((p) => !has(p, 'price')));
    r = await api('GET', '/api/customers', null, M); ok(r); assert.ok(r.data.every((c) => !has(c, 'debt') && !has(c, 'credit_limit') && !has(c, 'opening_debt') && !has(c, 'app_hash')));
    r = await api('GET', '/api/erp/dashboard', null, M); ok(r); assert.ok(!has(r.data, 'receivable') && !has(r.data.orders, 'revenue7') && r.data.orders.latest.every((o) => !has(o, 'total')));
    assert.strictEqual((await api('PUT', `/api/prices/product/${P.SP01.id}`, { price: 1 }, M)).status, 403, 'không tự đặt giá');
    assert.strictEqual((await api('GET', '/api/prices', null, M)).status, 403);
    assert.strictEqual((await api('GET', '/api/finance/summary', null, M)).status, 403);
    // quản lý đặt đơn: gửi giá cũng bị bỏ qua, hệ thống tự áp giá
    r = await api('POST', '/api/orders', { customer_id: cus1.id, discount: 99999, items: [{ product_id: P.SP01.id, qty: 2, price: 1 }] }, M); ok(r);
    const mo = (await api('GET', `/api/orders/${r.data.id}`, null, A)).data;
    assert.strictEqual(mo.total, 80000, 'giá tự áp 40.000 x 2, bỏ qua giá và chiết khấu quản lý gửi lên');
    // sửa đơn không làm mất giá đã đặt
    ok(await api('PUT', `/api/orders/${r.data.id}`, { customer_id: cus1.id, items: [{ product_id: P.SP01.id, qty: 4 }] }, M));
    assert.strictEqual((await api('GET', `/api/orders/${r.data.id}`, null, A)).data.total, 160000);
    ok(await api('POST', `/api/orders/${r.data.id}/cancel`, { reason: 'thử' }, M));
    const ex = await api('GET', '/api/orders/export', null, M); assert.strictEqual(ex.status, 200);
  });

  await step('làm hàng: tổng hợp theo sản phẩm, in phiếu làm hàng, nhân viên kho chỉ thấy phần của mình', async () => {
    let r = await api('POST', '/api/employees', { code: 'KHO01', full_name: 'Nhân viên kho', password: '123456', role: 'employee', track: false }, A); ok(r);
    ok(await api('PUT', `/api/erp/perms/${r.data.id}`, { modules: ['warehouse'] }, A));
    r = await api('POST', '/api/auth/login', { username: 'KHO01', password: '123456' }); ok(r); K = r.data.token;
    r = await api('GET', `/api/production?date=${today}`, null, K); ok(r);
    const sp01 = r.data.summary.find((x) => x.product_id === P.SP01.id);
    assert.ok(sp01 && sp01.qty >= 23, 'tổng bún sợi nhuyễn cần làm'); assert.match(sp01.pack_text, /^\d+ gói 500gr$/);
    assert.ok(!has(r.data.orders[0], 'total') && r.data.orders[0].items.every((i) => !has(i, 'price')));
    assert.strictEqual((await api('POST', '/api/orders', { customer_id: cus1.id, items: [{ product_id: P.SP01.id, qty: 1 }] }, K)).status, 403, 'kho không lên đơn');
    assert.strictEqual((await api('GET', '/api/prices', null, K)).status, 403);
    assert.strictEqual((await api('GET', '/api/finance/summary', null, K)).status, 403);
    r = await api('POST', '/api/production/print', { ids: [o1.id, o2.id], date: today }, K); ok(r);
    assert.ok(r.data.summary.length >= 2);
    assert.strictEqual((await api('GET', `/api/orders/${o2.id}`, null, A)).data.status, 'producing', 'in phiếu làm hàng thì đơn chuyển sang đang làm hàng');
  });

  await step('giao hàng: chuyến, điều đơn, phân bổ; chưa check in thì không xuất phát; check in rồi đẩy sang tài xế', async () => {
    let r = await api('POST', '/api/trips', { trip_date: today, driver_id: drv.id, route_id: route.id }, A); ok(r); trip = r.data; assert.match(trip.code, /^CH\d{6}$/);
    r = await api('GET', `/api/delivery/board?date=${today}`, null, A); ok(r); assert.ok(r.data.unassigned.length >= 3);
    r = await api('POST', `/api/trips/${trip.id}/assign`, { order_ids: [o1.id, o2.id] }, A); ok(r); assert.strictEqual(r.data.assigned, 2);
    r = await api('GET', `/api/trips/${trip.id}`, null, A); ok(r);
    assert.strictEqual(r.data.allocation.lines.find((l) => l.name === 'BÚN SỢI NHUYỄN').qty, 23, 'phân bổ: 20 + 3 kg');
    ok(await api('POST', `/api/trips/${trip.id}/reorder`, { order_ids: [o2.id, o1.id] }, A));
    r = await api('POST', `/api/trips/${trip.id}/start`, {}, A); assert.strictEqual(r.status, 400); assert.strictEqual(r.data.code, 'NOT_CHECKED');
    r = await api('POST', `/api/orders/${o1.id}/checkin`, {}, K); ok(r); assert.ok(r.data.checked); assert.strictEqual(r.data.status, 'producing');
    assert.strictEqual((await api('POST', `/api/orders/${o1.id}/checkin`, {}, K)).status, 400, 'check in hai lần');
    assert.strictEqual((await api('GET', `/api/orders/by-code/${o2.code}`, null, K)).status, 200);
    ok(await api('POST', `/api/orders/${o2.id}/checkin`, {}, K));
    r = await api('POST', `/api/trips/${trip.id}/start`, {}, A); ok(r); assert.strictEqual(r.data.status, 'running');
    assert.strictEqual((await api('GET', `/api/orders/${o1.id}`, null, A)).data.status, 'delivering');
    assert.strictEqual((await api('POST', `/api/trips/${trip.id}/finish`, {}, A)).status, 400);
    assert.strictEqual((await api('DELETE', `/api/trips/${trip.id}`, null, A)).status, 400);
    // đơn thêm vào chuyến đang chạy: chưa check in thì chờ, check in xong tự đẩy sang tài xế
    r = await api('POST', '/api/orders', { customer_id: cus1.id, items: [{ product_id: P.SP03.id, qty: 1 }] }, A); ok(r);
    ok(await api('POST', `/api/trips/${trip.id}/assign`, { order_ids: [r.data.id] }, A));
    assert.strictEqual((await api('GET', `/api/orders/${r.data.id}`, null, A)).data.status, 'new');
    const r2 = await api('POST', `/api/orders/${r.data.id}/checkin`, {}, K); ok(r2); assert.strictEqual(r2.data.status, 'delivering', 'check in xong hệ thống đẩy hàng sang tài xế');
    ok(await api('POST', `/api/trips/${trip.id}/unassign`, { order_id: r.data.id }, A));
    ok(await api('POST', `/api/orders/${r.data.id}/cancel`, { reason: 'thử' }, A));
  });

  await step('tài xế dùng app giao hàng, không thấy giá', async () => {
    let r = await api('POST', '/api/employees', { code: 'TX01', full_name: 'Trần Tài Xế', password: '123456', role: 'employee', track: false }, A); ok(r);
    r = await api('PUT', `/api/drivers/${drv.id}`, { name: drv.name, phone: drv.phone, plate: drv.plate, employee_id: r.data.id }, A); ok(r);
    r = await api('POST', '/api/auth/login', { username: 'TX01', password: '123456' }); ok(r); D = r.data.token;
    assert.strictEqual((await api('GET', '/api/orders', null, D)).status, 403, 'tài xế không xem được danh sách đơn');
    r = await api('GET', '/api/my/trips', null, D); ok(r); assert.strictEqual(r.data.trips[0].orders.length, 2);
    assert.ok(r.data.trips[0].orders.every((o) => !has(o, 'total') && !has(o, 'paid')), 'tài xế không thấy tiền hàng');
    ok(await api('POST', `/api/my/orders/${o2.id}/delivered`, { collected: 100000 }, D));
    ok(await api('POST', `/api/my/orders/${o1.id}/delivered`, {}, D));
    assert.strictEqual((await api('POST', `/api/my/orders/${o3.id}/delivered`, {}, D)).status, 404);
    assert.strictEqual((await api('GET', `/api/trips/${trip.id}`, null, A)).data.status, 'done');
  });

  await step('công nợ, thu tiền, chốt công nợ và hoá đơn', async () => {
    let r = await api('GET', '/api/finance/debts?only_debt=1', null, A); ok(r);
    const a = r.data.find((x) => x.id === cus1.id);
    assert.strictEqual(a.debt, 50000 + 800000); assert.strictEqual(a.unbilled, 800000);
    const b = r.data.find((x) => x.id === cus2.id); assert.strictEqual(b.debt, 3 * 35000 + 2 * 30000 - 100000);
    r = await api('POST', '/api/payments', { customer_id: cus1.id, amount: 200000, method: 'transfer' }, A); ok(r); const pay = r.data;
    r = await api('GET', `/api/finance/ledger/${cus1.id}`, null, A); ok(r); assert.strictEqual(r.data.closing, 650000);
    ok(await api('POST', `/api/payments/${pay.id}/void`, { reason: 'nhập nhầm' }, A));
    assert.strictEqual((await api('GET', '/api/finance/debts', null, A)).data.find((x) => x.id === cus1.id).debt, 850000);
    r = await api('POST', '/api/invoices', { customer_id: cus1.id, from: today, to: today }, A); ok(r); inv = r.data;
    assert.strictEqual((await api('PUT', `/api/orders/${o1.id}`, { customer_id: cus1.id, items: [{ product_id: P.SP01.id, qty: 1 }] }, A)).status, 400, 'đơn đã vào hoá đơn không sửa');
    ok(await api('POST', '/api/payments', { customer_id: cus1.id, invoice_id: inv.id, amount: 300000 }, A));
    r = await api('GET', `/api/invoices/${inv.id}`, null, A); assert.strictEqual(r.data.state, 'partial'); assert.strictEqual(r.data.balance, 500000);
    ok(await api('POST', `/api/invoices/${inv.id}/void`, { reason: 'lập sai' }, A));
    r = await api('POST', '/api/invoices/preview', { customer_id: cus1.id, from: today, to: today }, A); assert.strictEqual(r.data.orders.length, 1);
    r = await api('GET', '/api/erp/dashboard', null, A); ok(r); assert.ok(r.data.receivable.total > 0 && r.data.orders.revenue7.length === 7);
    assert.strictEqual((await api('GET', '/api/finance/debts/export', null, A)).status, 200);
  });

  await step('app khách đại lý: tài khoản, đăng nhập, đặt hàng, theo dõi, huỷ', async () => {
    let r = await api('PUT', `/api/customers/${cus1.id}/app-account`, { login: 'daily1' }, A); ok(r); assert.match(r.data.password, /^\d{6}$/); const pw1 = r.data.password;
    r = await api('PUT', `/api/customers/${cus2.id}/app-account`, { login: 'daily1' }, A); assert.strictEqual(r.status, 400, 'trùng tên đăng nhập');
    r = await api('PUT', `/api/customers/${cus2.id}/app-account`, { login: 'daily2', password: 'matkhau2' }, A); ok(r);
    assert.strictEqual((await api('POST', '/api/dl/login', { login: 'daily1', password: 'sai' })).status, 401);
    r = await api('POST', '/api/dl/login', { login: 'DAILY1 ', password: pw1 }); ok(r); const T1 = r.data.token;
    r = await api('POST', '/api/dl/login', { login: 'daily2', password: 'matkhau2' }); ok(r); const T2 = r.data.token;
    r = await api('GET', '/api/dl/catalog', null, T1); ok(r); assert.strictEqual(r.data.products.length, 29, 'danh mục đang bán'); assert.ok(r.data.products.every((p) => !has(p, 'price')), 'khách không thấy giá khi chưa được bật');
    const me = (await api('GET', '/api/dl/me', null, T1)).data; assert.strictEqual(me.show_price, false);
    assert.strictEqual((await api('POST', '/api/dl/orders', { items: [{ product_id: P.SP01.id, qty: 0.3 }] }, T1)).status, 400);
    assert.strictEqual((await api('POST', '/api/dl/orders', { items: [] }, T1)).status, 400);
    assert.strictEqual((await api('POST', '/api/dl/orders', { items: [{ product_id: P.SP01.id, qty: 1 }], delivery_date: '2000-01-01' }, T1)).status, 400);
    r = await api('POST', '/api/dl/orders', { delivery_date: today, items: [{ product_id: P.SP01.id, qty: 10, price: 1 }, { product_id: P.SP15.id, qty: 3 }], note: 'Giao sớm' }, T1); ok(r);
    const code = r.data.code; assert.strictEqual(r.data.status, 'new'); assert.ok(!has(r.data, 'total'));
    r = await api('POST', '/api/dl/orders', { delivery_date: today, items: [{ product_id: P.SP15.id, qty: 3 }, { product_id: P.SP01.id, qty: 10 }] }, T1); ok(r); assert.strictEqual(r.data.code, code); assert.ok(r.data.duplicate, 'bấm gửi hai lần không tạo đơn trùng');
    const staff = (await api('GET', `/api/orders/${code}`, null, A)).data;
    assert.strictEqual(staff.source, 'app'); assert.strictEqual(staff.total, 10 * 40000 + 3 * 30000, 'giá do hệ thống áp, bỏ qua giá khách gửi'); assert.ok(staff.events.some((e) => /app/.test(e.detail)));
    assert.strictEqual((await api('GET', `/api/dl/orders/${code}`, null, T2)).status, 404, 'khách khác không xem được đơn');
    r = await api('GET', '/api/dl/orders', null, T1); assert.ok(r.data.some((o) => o.code === code) && r.data.every((o) => !has(o, 'total')), 'khách thấy cả đơn do nhân viên lên cho mình');
    assert.strictEqual((await api('GET', '/api/dl/me', null, A)).status, 401, 'token nhân viên không dùng được ở app khách');
    assert.strictEqual((await api('GET', '/api/orders', null, T1)).status, 401, 'token khách không dùng được ở hệ thống nhân viên');
    // huỷ khi chưa vào làm hàng; sau khi in phiếu làm hàng thì không tự huỷ được
    ok(await api('POST', `/api/dl/orders/${code}/cancel`, {}, T1));
    r = await api('POST', '/api/dl/orders', { delivery_date: today, items: [{ product_id: P.SP03.id, qty: 2 }] }, T1); ok(r); const code2 = r.data.code;
    ok(await api('POST', '/api/production/print', { ids: [(await api('GET', `/api/orders/${code2}`, null, A)).data.id] }, A));
    assert.strictEqual((await api('POST', `/api/dl/orders/${code2}/cancel`, {}, T1)).status, 400);
    assert.strictEqual((await api('GET', `/api/dl/orders/${code2}`, null, T1)).data.status_text, 'Đang làm hàng');
    // tài chính bật hiển thị giá cho khách; quản lý thì không được
    assert.strictEqual((await api('PUT', '/api/erp/app-config', { app_show_price: true }, M)).status, 403);
    ok(await api('PUT', '/api/erp/app-config', { app_show_price: true }, A));
    r = await api('GET', '/api/dl/catalog', null, T1); assert.strictEqual(r.data.products.find((p) => p.code === 'SP01').price, 40000);
    assert.strictEqual((await api('GET', '/api/dl/catalog', null, T2)).data.products.find((p) => p.code === 'SP01').price, 35000, 'khách thấy giá theo bảng giá của mình');
    ok(await api('PUT', '/api/erp/app-config', { app_show_price: false }, A));
    // đổi mật khẩu, khoá tài khoản
    r = await api('POST', '/api/dl/password', { old_password: pw1, new_password: 'moi12345' }, T1); ok(r);
    assert.strictEqual((await api('GET', '/api/dl/me', null, T1)).status, 401, 'đổi mật khẩu thì token cũ hết hạn');
    ok(await api('PUT', `/api/customers/${cus1.id}/app-account`, { active: false }, A));
    assert.strictEqual((await api('POST', '/api/dl/login', { login: 'daily1', password: 'moi12345' })).status, 401);
  });

  await step('phân quyền ERP: chỉnh quyền, thu hồi quyền', async () => {
    assert.strictEqual((await api('PUT', `/api/erp/perms/${mgr.id}`, { modules: ['orders', 'finance'] }, M)).status, 403, 'chỉ quản trị viên phân quyền');
    ok(await api('PUT', `/api/erp/perms/${mgr.id}`, { modules: ['orders', 'finance'] }, A));
    assert.strictEqual((await api('GET', '/api/finance/summary', null, M)).status, 200);
    const o = await api('GET', `/api/orders/${o2.id}`, null, M); assert.ok(has(o.data, 'total'), 'có quyền tài chính thì thấy giá');
    assert.strictEqual((await api('POST', '/api/trips', { trip_date: today }, M)).status, 403);
    assert.strictEqual((await api('POST', '/api/customers', { name: 'x' }, M)).status, 403);
    ok(await api('PUT', `/api/erp/perms/${mgr.id}`, { reset: true }, A));
    assert.strictEqual((await api('GET', '/api/orders', null, '')).status, 401);
  });

  await step('trang chủ, app khách và trang in được phục vụ', async () => {
    for (const p of ['/', '/erp/main.js', '/erp/erp.css', '/print/', '/print/print.js', '/dl/', '/dl/dl.js', '/dl/dl.css', '/dl/manifest.webmanifest']) {
      const r = await fetch(BASE + p); assert.strictEqual(r.status, 200, p);
    }
    assert.strictEqual((await fetch(BASE + '/portal.js')).status, 404, 'trang chủ cũ đã xoá');
    assert.strictEqual((await fetch(BASE + '/admin/')).status, 200); assert.strictEqual((await fetch(BASE + '/cc/')).status, 200);
  });

  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  const failed = results.filter((r) => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} bước đạt`);
  if (failed.length) { console.log('\n--- log server ---\n' + log.slice(-3000)); process.exit(1); }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
})();
