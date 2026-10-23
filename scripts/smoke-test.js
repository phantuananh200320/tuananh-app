'use strict';
const V0 = require('../package.json').version; // phiên bản đang đóng gói: các bản vá thử nghiệm đánh số tiếp theo
const [VMA, VMI, VPA] = V0.split('.').map(Number);
const V1 = `${VMA}.${VMI}.${VPA + 1}`;
const V2 = `${VMA}.${VMI}.${VPA + 2}`;
// Kiểm thử nhanh toàn bộ API: node scripts/smoke-test.js
// Tự khởi động server tạm với dữ liệu riêng, không đụng vào dữ liệu thật.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-test-'));
const results = [];

async function api(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}
async function step(name, fn) {
  try {
    await fn();
    results.push([true, name]);
    console.log('  ✓', name);
  } catch (e) {
    results.push([false, name]);
    console.log('  ✗', name, '\n     ', e.message);
  }
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

(async () => {
  // Chạy máy chủ từ BẢN SAO của mã nguồn để bài test cập nhật phiên bản không ghi đè lên thư mục thật
  const SRC = path.join(__dirname, '..');
  const APP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-app-'));
  for (const d of ['server', 'public', 'scripts']) fs.cpSync(path.join(SRC, d), path.join(APP_ROOT, d), { recursive: true });
  for (const f of ['package.json', 'README.md']) fs.copyFileSync(path.join(SRC, f), path.join(APP_ROOT, f));
  const child = spawn(process.execPath, [path.join(APP_ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1', ADMIN_CODE: 'admin', ADMIN_PASSWORD: 'admin123', TZ: 'Asia/Ho_Chi_Minh', ALLOW_ONLINE_UPDATE: '1', AUTO_RESTART: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => (serverLog += d));
  child.stderr.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) break;
    } catch { /* chờ */ }
    await new Promise((r) => setTimeout(r, 100));
  }

  let admin = '';
  let emp = '';
  let empId = 0;
  let branchId = 0;
  let kioskKey = '';
  const ctx = {};

  console.log('Kiểm thử API chấm công\n');

  await step('đăng nhập sai bị từ chối', async () => {
    const r = await api('POST', '/api/auth/login', { username: 'admin', password: 'sai' });
    assert.strictEqual(r.status, 401);
  });
  await step('đăng nhập admin + buộc đổi mật khẩu', async () => {
    const r = await api('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.user.must_change_password, 1);
    assert.ok(!('password_hash' in r.data.user));
    admin = r.data.token;
    const c = await api('POST', '/api/auth/change-password', { old_password: 'admin123', new_password: 'matkhau-moi-1' }, admin);
    assert.strictEqual(c.status, 200);
    admin = c.data.token;
    const old = await api('GET', '/api/auth/me', null, r.data.token);
    assert.strictEqual(old.status, 401, 'token cũ phải bị vô hiệu');
  });
  await step('không có token -> 401, nhân viên không vào được API admin', async () => {
    assert.strictEqual((await api('GET', '/api/employees')).status, 401);
  });

  await step('tạo phòng ban, chi nhánh, ca làm', async () => {
    const d = await api('POST', '/api/departments', { name: 'Sản xuất' }, admin);
    assert.strictEqual(d.status, 200);
    ctx.dept = d.data.id;
    const dup = await api('POST', '/api/departments', { name: 'Sản xuất' }, admin);
    assert.strictEqual(dup.status, 400);
    const b = await api('POST', '/api/branches', { name: 'Nhà máy 1', address: 'Q.1', lat: 10.7769, lng: 106.7009, radius: 150 }, admin);
    assert.strictEqual(b.status, 200);
    branchId = b.data.id;
    kioskKey = b.data.kiosk_key;
    assert.ok(kioskKey && b.data.qr_secret);
    const bad = await api('POST', '/api/branches', { name: 'X', lat: 999, lng: 1 }, admin);
    assert.strictEqual(bad.status, 400);
    const s = await api('POST', '/api/shifts', { name: 'Ca đêm', start_time: '22:00', end_time: '06:00', break_minutes: 30, work_days: '1,2,3,4,5' }, admin);
    assert.strictEqual(s.status, 200);
    ctx.nightShift = s.data.id;
  });

  await step('tạo nhân viên, đăng nhập, đổi mật khẩu lần đầu', async () => {
    const r = await api('POST', '/api/employees', { code: 'NV001', full_name: 'Nguyễn Văn A', phone: '0901234567', department_id: ctx.dept, base_salary: 10400000, hired_date: '2020-01-01' }, admin);
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    empId = r.data.id;
    const dup = await api('POST', '/api/employees', { code: 'nv001', full_name: 'Trùng mã' }, admin);
    assert.strictEqual(dup.status, 400);
    const l = await api('POST', '/api/auth/login', { username: '0901234567', password: '123456' });
    assert.strictEqual(l.status, 200, 'đăng nhập bằng SĐT');
    assert.strictEqual(l.data.user.must_change_password, 1);
    const c = await api('POST', '/api/auth/change-password', { old_password: '123456', new_password: 'abcdef' }, l.data.token);
    emp = c.data.token;
    assert.strictEqual((await api('GET', '/api/employees', null, emp)).status, 403);
  });

  await step('chấm công GPS: ngoài bán kính bị chặn, trong bán kính thành công', async () => {
    await api('PUT', '/api/settings', { min_gap_seconds: 0 }, admin);
    const far = await api('POST', '/api/me/checkin', { lat: 10.80, lng: 106.70, accuracy: 20 }, emp);
    assert.strictEqual(far.status, 403);
    assert.strictEqual(far.data.code, 'OUTSIDE');
    const weak = await api('POST', '/api/me/checkin', { lat: 10.7769, lng: 106.7009, accuracy: 500 }, emp);
    assert.strictEqual(weak.data.code, 'GPS_WEAK');
    const nogps = await api('POST', '/api/me/checkin', {}, emp);
    assert.strictEqual(nogps.data.code, 'NO_GPS');
    const ok = await api('POST', '/api/me/checkin', { lat: 10.7770, lng: 106.7010, accuracy: 15 }, emp);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.strictEqual(ok.data.type, 'in');
    assert.strictEqual(ok.data.method, 'gps');
    const again = await api('POST', '/api/me/checkin', { type: 'in', lat: 10.7770, lng: 106.7010, accuracy: 15 }, emp);
    assert.strictEqual(again.data.code, 'ALREADY_IN');
  });

  await step('chấm công QR (mã tự đổi) + ra', async () => {
    const k = await api('GET', `/api/kiosk/state?key=${kioskKey}`);
    assert.strictEqual(k.status, 200);
    assert.match(k.data.code, /^\d{6}$/);
    assert.ok(k.data.svg.startsWith('<svg'));
    const badQr = await api('POST', '/api/me/checkin', { method: 'qr', qr: `ACK|${branchId}|000000` }, emp);
    assert.strictEqual(badQr.data.code, 'QR_INVALID');
    const ok = await api('POST', '/api/me/checkin', { method: 'qr', qr: k.data.url }, emp);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.strictEqual(ok.data.type, 'out');
    assert.strictEqual(ok.data.method, 'qr');
    assert.strictEqual((await api('GET', '/api/kiosk/state?key=sai')).status, 404);
  });

  await step('chụp ảnh bắt buộc + lưu ảnh + xem bằng token ảnh', async () => {
    await api('PUT', '/api/settings', { require_photo: true }, admin);
    const k = await api('GET', `/api/kiosk/state?key=${kioskKey}`);
    const no = await api('POST', '/api/me/checkin', { method: 'qr', qr: k.data.code }, emp);
    assert.strictEqual(no.data.code, 'PHOTO_REQUIRED');
    const jpg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    const ok = await api('POST', '/api/me/checkin', { method: 'qr', qr: k.data.code, photo: jpg }, emp);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    const logs = await api('GET', '/api/logs', null, admin);
    const withPhoto = logs.data.find((l) => l.photo);
    assert.ok(withPhoto, 'log có ảnh');
    const pt = await api('GET', '/api/photo-token', null, admin);
    const img = await api('GET', `/api/photos/${withPhoto.photo}?t=${pt.data.token}`);
    assert.strictEqual(img.status, 200);
    assert.strictEqual((await api('GET', `/api/photos/${withPhoto.photo}?t=xxx`)).status, 401);
    assert.strictEqual((await api('GET', `/api/photos/..%2F..%2Fetc/passwd?t=${pt.data.token}`)).status, 404);
    await api('PUT', '/api/settings', { require_photo: false }, admin);
    // đưa về trạng thái "đã ra" để các bước sau sạch sẽ
    const out = await api('POST', '/api/me/checkin', { method: 'qr', qr: k.data.code }, emp);
    assert.ok([200, 400].includes(out.status));
  });

  await step('hôm nay: dữ liệu màn hình chính của app', async () => {
    const t = await api('GET', '/api/me/today', null, emp);
    assert.strictEqual(t.status, 200);
    assert.ok(Array.isArray(t.data.logs) && t.data.logs.length >= 2);
    assert.ok(t.data.balance.total === 12);
  });

  // ---- Kiểm tra tính công với dữ liệu ngày cố định (tháng trước) ----
  const now = new Date();
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = `${pm.getFullYear()}-${pad(pm.getMonth() + 1)}`;
  const monthDays = [];
  for (let d = new Date(pm); d.getMonth() === pm.getMonth(); d.setDate(d.getDate() + 1)) monthDays.push({ date: ymd(d), dow: d.getDay() });
  const workdays = monthDays.filter((d) => d.dow >= 1 && d.dow <= 6).map((d) => d.date);

  await step('tính công: muộn, đủ công, nửa công, thiếu giờ ra, vắng', async () => {
    const [d1, d2, d3, d4, d5] = workdays;
    const man = (date, i, o) => api('POST', '/api/logs/manual', { employee_id: empId, date, in_time: i, out_time: o }, admin);
    assert.strictEqual((await man(d1, '08:12', '17:30')).status, 200);
    assert.strictEqual((await man(d2, '07:58', '17:05')).status, 200);
    assert.strictEqual((await man(d3, '08:00', '12:00')).status, 200);
    assert.strictEqual((await man(d4, '08:00', null)).status, 200);
    const ts = await api('GET', `/api/timesheet?month=${month}&employee_id=${empId}`, null, admin);
    assert.strictEqual(ts.status, 200);
    const days = Object.fromEntries(ts.data.employees[0].days.map((d) => [d.date, d]));
    assert.strictEqual(days[d1].status, 'late');
    assert.strictEqual(days[d1].late_min, 12);
    assert.strictEqual(days[d1].total, 1);
    assert.strictEqual(days[d2].status, 'present');
    assert.strictEqual(days[d3].status, 'half');
    assert.strictEqual(days[d3].total, 0.5);
    assert.strictEqual(days[d4].status, 'missing_out');
    assert.strictEqual(days[d5].status, 'absent');
    const sunday = monthDays.find((d) => d.dow === 0).date;
    assert.strictEqual(days[sunday].status, 'off');
    ctx.d = { d1, d2, d3, d4, d5, sunday };
  });

  await step('đơn giải trình được duyệt -> bổ sung giờ ra', async () => {
    const r = await api('POST', '/api/requests', { type: 'explain', start_date: ctx.d.d4, in_time: '08:00', out_time: '17:00', reason: 'Quên chấm ra' }, emp);
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const pc = await api('GET', '/api/requests/pending-count', null, admin);
    assert.ok(pc.data.count >= 1);
    const ap = await api('POST', `/api/requests/${r.data.id}/approve`, { note: 'OK' }, admin);
    assert.strictEqual(ap.data.status, 'approved');
    assert.strictEqual((await api('POST', `/api/requests/${r.data.id}/approve`, {}, admin)).status, 400);
    const ts = await api('GET', `/api/timesheet?month=${month}&employee_id=${empId}`, null, admin);
    const day = ts.data.employees[0].days.find((d) => d.date === ctx.d.d4);
    assert.strictEqual(day.status, 'present');
  });

  await step('nghỉ phép: trừ phép năm, vắng -> nghỉ phép, không vượt số dư', async () => {
    const lt = await api('GET', '/api/leave-types', null, emp);
    const annual = lt.data.find((x) => x.deduct_balance === 1);
    const r = await api('POST', '/api/requests', { type: 'leave', leave_type_id: annual.id, start_date: ctx.d.d5, end_date: ctx.d.d5, reason: 'Việc nhà' }, emp);
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.days, 1);
    const dupe = await api('POST', '/api/requests', { type: 'leave', leave_type_id: annual.id, start_date: ctx.d.d5, end_date: ctx.d.d5 }, emp);
    assert.strictEqual(dupe.status, 400, 'đơn trùng');
    const bal = await api('GET', '/api/me/balance', null, emp);
    assert.strictEqual(bal.data.pending >= 1 || bal.data.year !== now.getFullYear(), true);
    await api('POST', `/api/requests/${r.data.id}/approve`, {}, admin);
    const ts = await api('GET', `/api/timesheet?month=${month}&employee_id=${empId}`, null, admin);
    const day = ts.data.employees[0].days.find((d) => d.date === ctx.d.d5);
    assert.strictEqual(day.status, 'leave');
    assert.strictEqual(day.total, 1);
    const huge = await api('POST', '/api/requests', { type: 'leave', leave_type_id: annual.id, start_date: workdays[6], end_date: workdays[workdays.length - 1] }, emp);
    assert.strictEqual(huge.status, 400, 'vượt phép năm phải bị chặn: ' + JSON.stringify(huge.data));
    const sunReq = await api('POST', '/api/requests', { type: 'leave', leave_type_id: annual.id, start_date: ctx.d.sunday }, emp);
    assert.strictEqual(sunReq.status, 400, 'chủ nhật không có ngày làm việc');
  });

  await step('OT + ngày lễ + công tác', async () => {
    const ot = await api('POST', '/api/requests', { type: 'ot', start_date: ctx.d.d2, hours: 2, reason: 'Tăng ca' }, emp);
    assert.strictEqual(ot.status, 200);
    await api('POST', `/api/requests/${ot.data.id}/approve`, {}, admin);
    const badOt = await api('POST', '/api/requests', { type: 'ot', start_date: ctx.d.d2, hours: 20 }, emp);
    assert.strictEqual(badOt.status, 400);
    const d6 = workdays[5];
    await api('PUT', '/api/holidays', { date: d6, name: 'Nghỉ thử' }, admin);
    const d7 = workdays[6];
    const trip = await api('POST', '/api/requests', { type: 'trip', start_date: d7, end_date: d7, reason: 'Gặp khách' }, emp);
    await api('POST', `/api/requests/${trip.data.id}/approve`, {}, admin);
    const ts = await api('GET', `/api/timesheet?month=${month}&employee_id=${empId}`, null, admin);
    const days = Object.fromEntries(ts.data.employees[0].days.map((d) => [d.date, d]));
    assert.strictEqual(days[ctx.d.d2].ot_hours, 2);
    assert.strictEqual(days[d6].status, 'holiday');
    assert.strictEqual(days[d6].total, 1);
    assert.strictEqual(days[d7].status, 'trip');
    const s = ts.data.employees[0].summary;
    assert.strictEqual(s.late_count, 1);
    assert.strictEqual(s.late_minutes, 12);
    assert.strictEqual(s.ot_hours, 2);
  });

  await step('bảng lương + xuất Excel (bảng công, bảng lương) là file xlsx hợp lệ', async () => {
    const p = await api('GET', `/api/payroll?month=${month}`, null, admin);
    assert.strictEqual(p.status, 200);
    const row = p.data.rows[0];
    assert.ok(row.pay.net > 0);
    assert.strictEqual(row.pay.base_salary, 10400000);
    const x1 = await api('GET', `/api/timesheet/export?month=${month}`, null, admin);
    assert.strictEqual(x1.status, 200);
    assert.strictEqual(x1.data.slice(0, 2).toString(), 'PK');
    fs.writeFileSync(path.join(DATA_DIR, 'bang-cong.xlsx'), x1.data);
    const x2 = await api('GET', `/api/payroll/export?month=${month}`, null, admin);
    assert.strictEqual(x2.data.slice(0, 2).toString(), 'PK');
    fs.writeFileSync(path.join(DATA_DIR, 'bang-luong.xlsx'), x2.data);
    assert.strictEqual((await api('GET', `/api/payroll?month=${month}`, null, emp)).status, 403);
  });

  await step('tổng quan, xếp ca, import, thiết bị, thông báo, sao lưu', async () => {
    const dash = await api('GET', '/api/dashboard', null, admin);
    assert.strictEqual(dash.status, 200);
    assert.strictEqual(dash.data.trend.length, 7);
    const today = ymd(new Date());
    const sc = await api('PUT', '/api/schedules', { employee_ids: [empId], from: today, to: today, shift_id: ctx.nightShift }, admin);
    assert.strictEqual(sc.status, 200);
    const got = await api('GET', `/api/schedules?from=${today}&to=${today}`, null, admin);
    assert.strictEqual(got.data.length, 1);
    const imp = await api('POST', '/api/employees/import', { rows: [{ code: 'NV002', full_name: 'Trần B', department: 'Kho', base_salary: '8.000.000' }, { code: 'NV001', full_name: 'Trùng' }, { code: '', full_name: 'Thiếu mã' }] }, admin);
    assert.strictEqual(imp.data.created, 1);
    assert.strictEqual(imp.data.skipped.length, 2);
    await api('PUT', '/api/settings', { bind_device: true }, admin);
    const c1 = await api('POST', '/api/me/checkin', { type: 'in', method: 'qr', qr: (await api('GET', `/api/kiosk/state?key=${kioskKey}`)).data.code, device_id: 'dev-A' }, emp);
    assert.ok([200, 400].includes(c1.status));
    const c2 = await api('POST', '/api/me/checkin', { device_id: 'dev-B' }, emp);
    assert.strictEqual(c2.data.code, 'DEVICE_MISMATCH');
    assert.strictEqual((await api('POST', `/api/employees/${empId}/reset-device`, {}, admin)).status, 200);
    await api('PUT', '/api/settings', { bind_device: false }, admin);
    const an = await api('POST', '/api/announcement-admin', { title: 'Nghỉ lễ', body: 'Nghỉ 2/9', pinned: true }, admin);
    assert.strictEqual(an.status, 200);
    const list = await api('GET', '/api/announcements', null, emp);
    assert.strictEqual(list.data.length, 1);
    const bk = await api('GET', '/api/backup', null, admin);
    assert.strictEqual(bk.data.slice(0, 15).toString(), 'SQLite format 3');
    const rp = await api('POST', `/api/employees/${empId}/reset-password`, {}, admin);
    assert.match(rp.data.password, /^\d{6}$/);
    assert.strictEqual((await api('GET', '/api/auth/me', null, emp)).status, 401, 'token cũ vô hiệu sau khi reset mật khẩu');
    assert.strictEqual((await api('GET', '/api/audit', null, admin)).data.length > 5, true);
  });

  await step('không thể khoá quản trị viên cuối cùng; xoá ca mặc định bị chặn', async () => {
    const me = await api('GET', '/api/auth/me', null, admin);
    assert.strictEqual((await api('DELETE', `/api/employees/${me.data.user.id}`, null, admin)).status, 400);
    const st = await api('GET', '/api/settings', null, admin);
    assert.strictEqual((await api('DELETE', `/api/shifts/${st.data.default_shift_id}`, null, admin)).status, 400);
  });

  await step('file tĩnh + bảo mật header + chống path traversal', async () => {
    const r = await fetch(`${BASE}/`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.headers.get('content-security-policy'));
    const t = await fetch(`${BASE}/..%2f..%2fserver%2fconfig.js`);
    assert.ok([403, 404].includes(t.status), 'traversal bị chặn: ' + t.status);
    const nf = await fetch(`${BASE}/khong-ton-tai.js`);
    assert.strictEqual(nf.status, 404);
  });

  await step('trang chủ là cổng đăng nhập + chức năng; app nhân viên ở /cc/; /app/ cũ chuyển sang /cc/', async () => {
    const home = await (await fetch(`${BASE}/`)).text();
    assert.ok(home.includes('erp/main.js') && home.includes('erp/erp.css'), 'trang chủ phải là khung ERP');
    const menu = await (await fetch(`${BASE}/erp/core.js`)).text();
    for (const m of ["href: '/cc/'", "route: 'e/employees'", "route: 'orders'", "route: 'delivery'", "route: 'debts'", "route: 'e/settings'"]) assert.ok(menu.includes(m), 'menu thiếu ' + m);
    const cc = await (await fetch(`${BASE}/cc/`)).text();
    assert.ok(cc.includes('manifest.webmanifest') && cc.includes('app.js'), '/cc/ phải là app nhân viên');
    for (const f of ['erp/main.js', 'erp/erp.css', 'erp/banner-art.jpg', 'print/', 'cc/app.js', 'cc/app.css', 'cc/manifest.webmanifest', 'icons/icon-192.png', 'admin/', 'kiosk/']) {
      assert.strictEqual((await fetch(`${BASE}/${f}`)).status, 200, f);
    }
    const old = await fetch(`${BASE}/app/?x=1`, { redirect: 'manual' });
    assert.strictEqual(old.status, 301);
    assert.strictEqual(new URL(old.headers.get('location'), BASE).pathname + new URL(old.headers.get('location'), BASE).search, '/cc/?x=1');
    for (const u of ['/app/sw.js', '/sw.js']) assert.ok((await (await fetch(`${BASE}${u}`)).text()).includes('unregister'), 'service worker cũ phải tự gỡ: ' + u);
    const k = await api('GET', `/api/kiosk/state?key=${kioskKey}`);
    assert.ok(k.data.url.includes('/cc/#/scan/'), 'QR trỏ vào app nhân viên /cc/: ' + k.data.url);
  });

  await step('nhân viên: thêm, sửa, khoá, xoá vĩnh viễn (kèm chấm công), không tự xoá mình', async () => {
    // nhân viên thường mới (token của `emp` đã bị vô hiệu ở bước đặt lại mật khẩu phía trên)
    const pl = await api('POST', '/api/employees', { code: 'THUONG01', full_name: 'Nhân viên thường' }, admin);
    const pl1 = await api('POST', '/api/auth/login', { username: 'THUONG01', password: '123456' });
    ctx.plain = (await api('POST', '/api/auth/change-password', { old_password: '123456', new_password: 'abcdef' }, pl1.data.token)).data.token;
    assert.ok(pl.status === 200 && ctx.plain, 'tạo được nhân viên thường để kiểm tra phân quyền');
    const mk = await api('POST', '/api/employees', { code: 'XOA01', full_name: 'Người sẽ bị xoá' }, admin);
    assert.strictEqual(mk.status, 200);
    const id = mk.data.id;
    const up = await api('PUT', `/api/employees/${id}`, { full_name: 'Đã sửa tên', position: 'Tạp vụ' }, admin);
    assert.strictEqual(up.data.full_name, 'Đã sửa tên');
    assert.strictEqual((await api('POST', '/api/logs/manual', { employee_id: id, date: ymd(new Date()), in_time: '08:00', out_time: '17:00' }, admin)).status, 200);
    const { DatabaseSync } = require('node:sqlite');
    const countLogs = () => { const d = new DatabaseSync(path.join(DATA_DIR, 'chamcong.db'), { readOnly: true }); try { return d.prepare('SELECT COUNT(*) AS n FROM logs WHERE employee_id=?').get(id).n; } finally { d.close(); } };
    assert.strictEqual(countLogs(), 2, 'đã có 2 lượt chấm công trước khi xoá');
    const soft = await api('DELETE', `/api/employees/${id}`, null, admin);
    assert.strictEqual(soft.status, 200);
    const all = await api('GET', '/api/employees?all=1', null, admin);
    assert.strictEqual(all.data.find((e) => e.id === id).active, 0, 'xoá thường chỉ khoá');
    const selfId = all.data.find((e) => e.code === 'admin').id;
    assert.strictEqual((await api('DELETE', `/api/employees/${selfId}?permanent=1`, null, admin)).status, 400, 'không tự xoá mình');
    assert.strictEqual((await api('DELETE', `/api/employees/${id}?permanent=1`, null, admin)).status, 200);
    const after = await api('GET', '/api/employees?all=1', null, admin);
    assert.ok(!after.data.find((e) => e.id === id), 'nhân viên phải biến mất');
    assert.strictEqual(countLogs(), 0, 'chấm công của người bị xoá cũng bị xoá theo');
    assert.strictEqual((await api('DELETE', `/api/employees/${id}?permanent=1`, null, admin)).status, 404);
    assert.strictEqual((await api('DELETE', `/api/employees/${empId}?permanent=1`, null, ctx.plain)).status, 403, 'nhân viên thường không được xoá');
  });

  await step('logo công ty: tải lên, hiện ở public-info/kiosk, từ chối file giả, xoá', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const url = (b, t = 'image/png') => `data:${t};base64,${b.toString('base64')}`;
    assert.strictEqual((await api('GET', '/api/logo')).status, 404);
    assert.strictEqual((await api('PUT', '/api/logo', { data: url(png) }, ctx.plain)).status, 403, 'nhân viên không được đổi logo');
    assert.strictEqual((await api('PUT', '/api/logo', { data: url(png) })).status, 401);
    assert.strictEqual((await api('PUT', '/api/logo', { data: url(Buffer.from('khong phai anh'), 'image/png') }, admin)).status, 400, 'file giả bị từ chối');
    assert.strictEqual((await api('PUT', '/api/logo', { data: url(Buffer.from('<svg/>'), 'image/svg+xml') }, admin)).status, 400, 'SVG bị từ chối');
    assert.strictEqual((await api('PUT', '/api/logo', { data: url(Buffer.alloc(1100 * 1024, 7)) }, admin)).status, 400, 'quá 1 MB bị từ chối');
    const ok = await api('PUT', '/api/logo', { data: url(png) }, admin);
    assert.strictEqual(ok.status, 200);
    const info = await api('GET', '/api/public-info');
    assert.ok(info.data.logo.startsWith('/api/logo?v='), 'public-info có logo');
    const img = await fetch(BASE + info.data.logo);
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await img.arrayBuffer()).equals(png), 'ảnh trả về đúng nội dung');
    assert.ok((await api('GET', `/api/kiosk/state?key=${kioskKey}`)).data.logo, 'màn hình QR có logo');
    assert.strictEqual((await api('DELETE', '/api/logo', null, admin)).status, 200);
    assert.strictEqual((await api('GET', '/api/logo')).status, 404);
    assert.strictEqual((await api('GET', '/api/public-info')).data.logo, '');
  });

  await step('màn hình chờ kiosk: cấu hình, thêm/xoá hình, thông báo, phân quyền, kiểm tra file giả', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const url = (b, t = 'image/png') => `data:${t};base64,${b.toString('base64')}`;
    const st = () => api('GET', `/api/kiosk/state?key=${kioskKey}`);
    let sv = (await st()).data.screensaver;
    assert.ok(sv && sv.idle_ms === 5 * 60000 && sv.slide_ms === 8000, 'mặc định: bật, 5 phút, 8 giây');
    assert.deepStrictEqual(sv.images, []);
    assert.strictEqual((await api('POST', '/api/screensaver-images', { data: url(png) })).status, 401);
    assert.strictEqual((await api('POST', '/api/screensaver-images', { data: url(png) }, ctx.plain)).status, 403, 'nhân viên không được thêm hình');
    assert.strictEqual((await api('POST', '/api/screensaver-images', { data: url(Buffer.from('khong phai anh')) }, admin)).status, 400, 'file giả bị từ chối');
    assert.strictEqual((await api('POST', '/api/screensaver-images', { data: url(Buffer.from('<svg/>'), 'image/svg+xml') }, admin)).status, 400, 'SVG bị từ chối');
    assert.strictEqual((await api('POST', '/api/screensaver-images', { data: url(Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)])) }, admin)).status, 400, 'quá 3 MB bị từ chối');
    const up = await api('POST', '/api/screensaver-images', { data: url(png) }, admin);
    assert.strictEqual(up.status, 200);
    assert.ok(up.data.url.startsWith('/api/screensaver/img/'));
    const raw = await fetch(BASE + up.data.url);
    assert.strictEqual(raw.status, 200);
    assert.strictEqual(raw.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await raw.arrayBuffer()).equals(png), 'ảnh trả về đúng nội dung');
    assert.strictEqual((await api('GET', '/api/screensaver/img/khong-co')).status, 404);
    assert.strictEqual((await api('GET', '/api/screensaver-images', null, ctx.plain)).status, 403);
    assert.deepStrictEqual((await st()).data.screensaver.images, [up.data.url], 'kiosk nhận danh sách hình');
    // thông báo của công ty hiện trên màn hình chờ, thông báo đã ẩn thì không
    const a1 = await api('POST', '/api/announcement-admin', { title: 'Họp toàn công ty', body: '9h sáng thứ Hai', pinned: true, active: true }, admin);
    const a2 = await api('POST', '/api/announcement-admin', { title: 'Đã ẩn', body: '', pinned: false, active: false }, admin);
    let ann = (await st()).data.screensaver.announcements;
    assert.strictEqual(ann[0].title, 'Họp toàn công ty', 'thông báo ghim nằm đầu');
    assert.ok(!ann.some((x) => x.title === 'Đã ẩn'), 'thông báo đã ẩn không hiện');
    // cài đặt: kiểm tra giá trị, đổi thời gian, tắt thông báo, tắt hẳn
    assert.strictEqual((await api('PUT', '/api/settings', { screensaver_idle_min: 0 }, admin)).status, 400);
    assert.strictEqual((await api('PUT', '/api/settings', { screensaver_idle_min: 'abc' }, admin)).status, 400);
    assert.strictEqual((await api('PUT', '/api/settings', { screensaver_slide_sec: 2 }, admin)).status, 400);
    assert.strictEqual((await api('PUT', '/api/settings', { screensaver_idle_min: 10, screensaver_slide_sec: 12, screensaver_announce: false }, admin)).status, 200);
    sv = (await st()).data.screensaver;
    assert.ok(sv.idle_ms === 10 * 60000 && sv.slide_ms === 12000 && sv.announcements.length === 0, 'đổi thời gian, ẩn thông báo');
    assert.strictEqual((await api('PUT', '/api/settings', { screensaver_on: false }, admin)).status, 200);
    assert.strictEqual((await st()).data.screensaver, null, 'tắt tính năng thì kiosk không nhận cấu hình');
    await api('PUT', '/api/settings', { screensaver_on: true, screensaver_idle_min: 5, screensaver_slide_sec: 8, screensaver_announce: true }, admin);
    // xoá hình
    assert.strictEqual((await api('DELETE', `/api/screensaver-images/${up.data.id}`, null, ctx.plain)).status, 403);
    assert.strictEqual((await api('DELETE', `/api/screensaver-images/${up.data.id}`, null, admin)).status, 200);
    assert.strictEqual((await api('DELETE', `/api/screensaver-images/${up.data.id}`, null, admin)).status, 404);
    assert.strictEqual((await fetch(BASE + up.data.url)).status, 404, 'xoá rồi thì địa chỉ ảnh không còn');
    // giới hạn số hình
    for (let i = 0; i < 20; i++) assert.strictEqual((await api('POST', '/api/screensaver-images', { data: url(png) }, admin)).status, 200);
    assert.strictEqual((await api('POST', '/api/screensaver-images', { data: url(png) }, admin)).status, 400, 'quá 20 hình bị từ chối');
    for (const x of (await api('GET', '/api/screensaver-images', null, admin)).data) await api('DELETE', `/api/screensaver-images/${x.id}`, null, admin);
    await api('DELETE', `/api/announcement-admin/${a1.data.id}`, null, admin);
    await api('DELETE', `/api/announcement-admin/${a2.data.id}`, null, admin);
    // tệp giao diện được phục vụ
    for (const f of ['/kiosk/kiosk-saver.js', '/kiosk/']) assert.strictEqual((await api('GET', f)).status, 200, f);
    assert.ok((await fetch(BASE + '/kiosk/')).headers.get('content-type').includes('html'));
    assert.ok((await (await fetch(BASE + '/kiosk/')).text()).includes('kiosk-saver.js'), 'index.html nạp kiosk-saver.js');
  });

  await step('sao lưu: tạo, liệt kê, tải lên dữ liệu cũ, khôi phục, từ chối file hỏng và đường dẫn lạ', async () => {
    const mk = await api('POST', '/api/employees', { code: 'BK01', full_name: 'Có trong bản sao lưu' }, admin);
    const b = await api('POST', '/api/backups', {}, admin);
    assert.strictEqual(b.status, 200);
    assert.ok(b.data.items.some((x) => x.name === b.data.name && x.kind === 'thu-cong'));
    assert.strictEqual((await api('GET', '/api/backups', null, ctx.plain)).status, 403, 'nhân viên không xem được sao lưu');
    assert.strictEqual((await api('PUT', '/api/backups/settings', { auto: true, keep: 0 }, admin)).status, 400);
    const st = await api('PUT', '/api/backups/settings', { auto: true, keep: 10 }, admin);
    assert.ok(st.data.auto && st.data.keep === 10 && st.data.next > Date.now(), 'có lịch tự động kế tiếp');
    await api('DELETE', `/api/employees/${mk.data.id}?permanent=1`, null, admin);
    const post = (u, body, type) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': type, Authorization: 'Bearer ' + admin }, body });
    const bad = await post('/api/backups/upload', Buffer.from('không phải dữ liệu'), 'application/octet-stream');
    assert.strictEqual(bad.status, 400, 'file hỏng bị từ chối');
    const file = fs.readFileSync(path.join(DATA_DIR, 'backups', b.data.name));
    const up = await post('/api/backups/upload', file, 'application/octet-stream');
    const info = await up.json();
    assert.strictEqual(up.status, 200);
    assert.ok(info.employees >= 1 && info.name.startsWith('tai-len-'));
    assert.ok([400, 404].includes((await api('POST', '/api/backups/..%2F..%2Fx.db/restore', {}, admin)).status), 'đường dẫn lạ bị chặn');
    assert.strictEqual((await api('POST', '/api/backups/khong-co.db/restore', {}, admin)).status, 404);
    const rs = await api('POST', `/api/backups/${info.name}/restore`, {}, admin);
    assert.strictEqual(rs.status, 200);
    assert.ok(rs.data.safety.startsWith('truoc-khoi-phuc-'), 'có bản dự phòng trước khi khôi phục');
    const re = await api('POST', '/api/auth/login', { username: 'admin', password: 'matkhau-moi-1' });
    admin = re.data.token;
    const codes = (await api('GET', '/api/employees?all=1', null, admin)).data.map((e) => e.code);
    assert.ok(codes.includes('BK01'), 'nhân viên đã xoá phải quay lại sau khi khôi phục');
    assert.strictEqual((await api('DELETE', `/api/backups/${info.name}`, null, admin)).status, 200);
  });

  await step('khuôn mặt: bật/tắt, đăng ký có đồng ý, so khớp ở máy chủ, chống chấm nhầm và chấm lặp', async () => {
    // vector giả có độ dài ~1: hai "người" khác nhau cách nhau ~1.4, cùng một người chụp lại cách nhau ~0.2
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const person = () => Array.from({ length: 128 }, () => gauss() * 0.088);
    const near = (v, amount) => { const n = Array.from({ length: 128 }, () => gauss()); const l = Math.hypot(...n); return v.map((x, i) => x + (n[i] / l) * amount); };
    const mkEmp = async (code) => (await api('POST', '/api/employees', { code, full_name: 'Mặt ' + code }, admin)).data.id;
    const A = person(); const B = person();
    const idA = await mkEmp('FACEA'); const idB = await mkEmp('FACEB');
    const scan = (d, extra = {}) => api('POST', '/api/kiosk/face', { key: kioskKey, descriptor: d, ...extra });
    const { DatabaseSync } = require('node:sqlite');
    const sql = (text, ...a) => { const d = new DatabaseSync(path.join(DATA_DIR, 'chamcong.db'), { readOnly: true }); try { return d.prepare(text).get(...a); } finally { d.close(); } };

    assert.strictEqual((await scan(A)).status, 403, 'mặc định tắt');
    assert.strictEqual((await api('PUT', '/api/settings', { allow_face: true, min_gap_seconds: 60 }, admin)).status, 200);
    assert.strictEqual((await api('POST', `/api/employees/${idA}/faces`, { descriptors: [A] }, admin)).status, 400, 'thiếu xác nhận đồng ý');
    assert.strictEqual((await api('POST', `/api/employees/${idA}/faces`, { descriptors: [[1, 2, 3]], consent: true }, admin)).status, 400, 'vector sai độ dài');
    assert.strictEqual((await api('POST', `/api/employees/${idA}/faces`, { descriptors: [A, A, A, A, A, A], consent: true }, admin)).status, 400, 'quá 5 mẫu');
    assert.strictEqual((await api('POST', `/api/employees/${idA}/faces`, { descriptors: [A], consent: true }, ctx.plain)).status, 403, 'nhân viên thường không đăng ký được');
    assert.strictEqual((await api('POST', `/api/employees/${idA}/faces`, { descriptors: [A, near(A, 0.15), near(A, 0.15)], consent: true }, admin)).data.face_count, 3);
    assert.strictEqual((await api('POST', `/api/employees/${idB}/faces`, { descriptors: [B], consent: true }, admin)).status, 200);
    const listed = (await api('GET', '/api/employees?all=1', null, admin)).data;
    assert.strictEqual(listed.find((e) => e.id === idA).face_count, 3);

    assert.strictEqual((await api('POST', '/api/kiosk/face', { key: 'sai-khoa', descriptor: A })).status, 404, 'sai khoá kiosk');
    const ok = await scan(near(A, 0.2));
    assert.ok(ok.data.ok && ok.data.type === 'in' && ok.data.name === 'Mặt FACEA', JSON.stringify(ok.data));
    assert.strictEqual(sql("SELECT method FROM logs WHERE employee_id=?", idA).method, 'face');
    const again = await scan(near(A, 0.2));
    assert.ok(again.data.ok === false && again.data.code === 'TOO_FAST', 'chấm lặp bị chặn');
    const unknown = await scan(person());
    assert.strictEqual(unknown.status, 404); assert.strictEqual(unknown.data.code, 'FACE_UNKNOWN');
    assert.strictEqual((await scan(near(A, 0.2))).data.ok, false);
    assert.strictEqual((await scan(Array(128).fill(0.01), { photo: 'khong-phai-anh' })).status, 404, 'vector lạ không khớp');

    // ra ca: bỏ giãn cách rồi chấm lại -> thành "ra"
    await api('PUT', '/api/settings', { min_gap_seconds: 0 }, admin);
    const out = await scan(near(A, 0.2));
    assert.strictEqual(out.data.type, 'out');

    // hai người quá giống nhau -> từ chối thay vì đoán
    const idC = await mkEmp('FACEC');
    await api('POST', `/api/employees/${idC}/faces`, { descriptors: [near(A, 0.02)], consent: true }, admin);
    const amb = await scan(A);
    assert.strictEqual(amb.status, 409); assert.strictEqual(amb.data.code, 'FACE_AMBIGUOUS');
    await api('DELETE', `/api/employees/${idC}/faces`, null, admin);
    assert.ok((await scan(near(A, 0.2))).data.ok, 'hết nhập nhằng thì nhận lại');

    // nhân viên bị giao chi nhánh khác
    const br2 = await api('POST', '/api/branches', { name: 'Chi nhánh khác' }, admin);
    await api('PUT', `/api/employees/${idB}`, { branch_id: br2.data.id }, admin);
    const other = await scan(B);
    assert.strictEqual(other.status, 403); assert.strictEqual(other.data.code, 'OTHER_BRANCH');

    // trạng thái kiosk: chưa cài thư viện thì không hiện khung camera
    const st = await api('GET', `/api/kiosk/state?key=${kioskKey}`);
    assert.strictEqual(st.data.face, false, 'chưa có thư viện thì kiosk chỉ dùng QR');
    assert.strictEqual((await api('GET', '/api/face/assets', null, admin)).data.ready, false);

    // xoá dữ liệu khuôn mặt và xoá nhân viên đều xoá mẫu
    await api('DELETE', `/api/employees/${idA}/faces`, null, admin);
    assert.strictEqual((await scan(near(A, 0.2))).status, 404, 'xoá mẫu thì không còn nhận ra');
    assert.strictEqual(sql('SELECT COUNT(*) AS n FROM face_templates WHERE employee_id=?', idA).n, 0);
    await api('DELETE', `/api/employees/${idB}?permanent=1`, null, admin);
    assert.strictEqual(sql('SELECT COUNT(*) AS n FROM face_templates WHERE employee_id=?', idB).n, 0, 'xoá nhân viên xoá luôn mẫu khuôn mặt');
    await api('PUT', '/api/settings', { allow_face: false, min_gap_seconds: 60 }, admin);
    assert.strictEqual((await scan(A)).status, 403);
  });

  await step('cập nhật phiên bản: nạp nóng không tắt máy chủ, tự khôi phục khi lỗi, quay lại bản trước', async () => {
    const pkgLib = require(path.join(SRC, 'server', 'lib', 'pkg.js'));
    const mkPkg = (version, edit, extra = []) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-pkg-'));
      for (const d of ['server', 'public', 'scripts']) fs.cpSync(path.join(SRC, d), path.join(root, d), { recursive: true });
      for (const f of ['package.json', 'README.md']) fs.copyFileSync(path.join(SRC, f), path.join(root, f));
      const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); pj.version = version;
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pj, null, 2));
      const sub = (rel, from, to) => { const f = path.join(root, rel); const t = fs.readFileSync(f, 'utf8'); assert.ok(t.includes(from), rel + ': không thấy đoạn cần sửa'); fs.writeFileSync(f, t.replace(from, to)); };
      edit({ root, sub });
      const out = path.join(root, 'out');
      execFileSync(process.execPath, [path.join(root, 'scripts', 'make-update.js'), '--out=' + out, '--notes=thử nghiệm'], { stdio: 'pipe' });
      const buf = fs.readFileSync(path.join(out, `chamcong-update-${version}.tgz`));
      fs.rmSync(root, { recursive: true, force: true });
      return buf;
    };
    const HEALTH = 'res.json({ ok: true, time: Date.now() });';
    const patch1 = ({ root, sub }) => {
      sub('server/app-routes.js', HEALTH, `res.json({ ok: true, time: Date.now(), patch: 'v${V1}' });`);
      fs.appendFileSync(path.join(root, 'public/kiosk/kiosk.css'), `\n/* patched-${V1} */\n`);
      fs.writeFileSync(path.join(root, 'public/hello-update.txt'), 'xin chao ban moi');
    };
    const send = (u, body, type, tok = admin) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': type, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body });
    const upload = async (buf, tok = admin) => { const r = await send('/api/update/upload', buf, 'application/octet-stream', tok); return { status: r.status, data: await r.json().catch(() => ({})) }; };
    const apply = (token, extra = {}, password = 'matkhau-moi-1') => api('POST', '/api/update/apply', { token, password, ...extra }, admin);
    const text = async (u) => (await fetch(BASE + u)).text();

    const st0 = await api('GET', '/api/update/status', null, admin);
    assert.ok(st0.data.enabled && st0.data.version === V0 && !st0.data.can_rollback);
    const v0 = (await api('GET', '/api/version')).data;
    assert.strictEqual(v0.version, V0);

    // ---- bản vá nóng V1 ----
    const p1 = mkPkg(V1, patch1);
    assert.strictEqual((await upload(p1, ctx.plain)).status, 403, 'nhân viên thường không được tải gói');
    assert.strictEqual((await upload(p1, '')).status, 401);
    assert.strictEqual((await upload(Buffer.from('không phải gói'))).status, 400);
    const plan1 = await upload(p1);
    assert.strictEqual(plan1.status, 200, JSON.stringify(plan1.data));
    assert.ok(plan1.data.version === V1 && plan1.data.restart_required === false);
    assert.ok(plan1.data.added.includes('public/hello-update.txt') && plan1.data.changed.includes('server/app-routes.js') && plan1.data.changed.includes('package.json'));
    assert.strictEqual((await apply(plan1.data.token, {}, 'sai-mat-khau')).data.code, 'BAD_PASSWORD');
    assert.strictEqual((await apply('khong-dung')).status, 400, 'sai mã gói');
    const done1 = await apply(plan1.data.token);
    assert.strictEqual(done1.status, 200, JSON.stringify(done1.data));
    assert.ok(done1.data.hot_reloaded && !done1.data.restarted && done1.data.version === V1);
    const h = (await api('GET', '/api/health')).data;
    assert.strictEqual(h.patch, `v${V1}`, 'mã máy chủ mới đã chạy');
    const v1 = (await api('GET', '/api/version')).data;
    assert.ok(v1.version === V1 && v1.started_at === v0.started_at, 'cùng một tiến trình, không khởi động lại');
    assert.strictEqual((await api('GET', '/api/employees', null, admin)).status, 200, 'đăng nhập và các route khác vẫn dùng được');
    assert.strictEqual(await text('/hello-update.txt'), 'xin chao ban moi');
    assert.ok((await text('/kiosk/kiosk.css')).includes(`patched-${V1}`), 'giao diện đổi ngay');
    assert.ok((await text('/cc/sw.js')).includes(`'chamcong-${V1}'`), 'service worker mang số phiên bản mới');
    assert.ok((await api('GET', '/api/backups', null, admin)).data.items.some((x) => x.kind === 'truoc-cap-nhat'), 'có bản sao lưu CSDL trước khi cập nhật');
    assert.strictEqual((await upload(p1)).status, 400, 'cùng phiên bản bị từ chối');

    // ---- container được tạo lại từ ảnh cũ (bản gốc): bản cập nhật tự được áp lại từ thư mục dữ liệu ----
    {
      const R3 = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-img-')); const D3 = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-data3-'));
      for (const d of ['server', 'public', 'scripts']) fs.cpSync(path.join(SRC, d), path.join(R3, d), { recursive: true });
      for (const f of ['package.json', 'README.md']) fs.copyFileSync(path.join(SRC, f), path.join(R3, f));
      fs.cpSync(path.join(DATA_DIR, 'updates'), path.join(D3, 'updates'), { recursive: true });
      const P3 = 4800 + Math.floor(Math.random() * 90);
      const re = spawn(process.execPath, [path.join(R3, 'server', 'index.js')], { env: { ...process.env, PORT: String(P3), DATA_DIR: D3, HOST: '127.0.0.1', ADMIN_CODE: 'admin', ADMIN_PASSWORD: 'admin123' }, stdio: 'ignore' });
      try {
        let hh = null;
        for (let i = 0; i < 60 && !hh; i++) { try { const r = await fetch(`http://127.0.0.1:${P3}/api/health`); if (r.ok) hh = await r.json(); } catch { /* chờ */ } if (!hh) await new Promise((r) => setTimeout(r, 100)); }
        assert.ok(hh && hh.patch === `v${V1}`, 'ảnh cũ + thư mục dữ liệu: tự áp lại bản vá đầu tiên');
        assert.strictEqual((await (await fetch(`http://127.0.0.1:${P3}/api/version`)).json()).version, V1);
        assert.strictEqual(await (await fetch(`http://127.0.0.1:${P3}/hello-update.txt`)).text(), 'xin chao ban moi');
      } finally { re.kill('SIGTERM'); fs.rmSync(R3, { recursive: true, force: true }); fs.rmSync(D3, { recursive: true, force: true }); }
    }

    // ---- gói xấu bị từ chối, hệ thống không đổi ----
    const e = (v, files) => { const m = pkgLib.makeManifest(files, { version: v }); return pkgLib.tarWrite([{ path: 'update.json', data: Buffer.from(JSON.stringify(m)) }, ...files]); };
    const pj = (v) => ({ path: 'package.json', data: Buffer.from(JSON.stringify({ name: 'chamcong', version: v })) });
    const tampered = (() => { const files = [pj('9.0.0'), { path: 'server/x.js', data: Buffer.from('1') }]; const m = pkgLib.makeManifest(files, { version: '9.0.0' }); files[1].data = Buffer.from('2'); return pkgLib.tarWrite([{ path: 'update.json', data: Buffer.from(JSON.stringify(m)) }, ...files]); })();
    assert.strictEqual((await upload(tampered)).status, 400, 'tệp không khớp mã kiểm tra');
    assert.strictEqual((await upload(e('9.0.0', [pj('9.0.0'), { path: 'public/vendor/lạ.js', data: Buffer.from('1') }]))).status, 400, 'không được đụng vào thư viện nhận diện');
    assert.strictEqual((await upload(e('9.0.0', [pj('9.0.0'), { path: 'data/chamcong.db', data: Buffer.from('1') }]))).status, 400, 'không được ghi ra ngoài vùng cho phép');
    const syn = await upload(mkPkg(V2, (c) => { patch1(c); fs.appendFileSync(path.join(c.root, 'server/routes/kiosk.js'), '\n}}}} lỗi cú pháp\n'); }));
    assert.strictEqual(syn.status, 400); assert.ok(String(syn.data.error).includes('cú pháp'), 'lỗi cú pháp bị chặn trước khi áp dụng');
    const deps = await upload(mkPkg(V2, (c) => { patch1(c); const f = path.join(c.root, 'package.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.dependencies = { lodash: '4.0.0' }; fs.writeFileSync(f, JSON.stringify(j)); }));
    assert.strictEqual(deps.status, 400, 'đổi thư viện phụ thuộc thì không cập nhật nóng được');

    // ---- lỗi lúc nạp (cú pháp đúng nhưng chạy là văng lỗi): tự khôi phục ----
    const boom = await upload(mkPkg(V2, (c) => { patch1(c); fs.appendFileSync(path.join(c.root, 'server/routes/kiosk.js'), "\nthrow new Error('hỏng khi nạp');\n"); }));
    assert.strictEqual(boom.status, 200);
    const boomApply = await apply(boom.data.token);
    assert.strictEqual(boomApply.status, 400); assert.ok(String(boomApply.data.error).includes('khôi phục'));
    assert.strictEqual((await api('GET', '/api/health')).data.patch, `v${V1}`, 'vẫn chạy bản cũ sau khi nạp lỗi');
    assert.strictEqual((await api('GET', '/api/version')).data.version, V1);
    assert.ok(!fs.readFileSync(path.join(APP_ROOT, 'server/routes/kiosk.js'), 'utf8').includes('hỏng khi nạp'), 'tệp đã được trả về nguyên trạng');

    // ---- gói đổi phần lõi: cần khởi động lại tiến trình ----
    const p2 = mkPkg(V2, (c) => { patch1(c); fs.appendFileSync(path.join(c.root, 'server/config.js'), '\n// chỉnh phần lõi\n'); fs.appendFileSync(path.join(c.root, 'Dockerfile'), '\n# đổi hạ tầng\n'); });
    const plan2 = await upload(p2);
    assert.ok(plan2.data.restart_required && plan2.data.infra_changed.includes('Dockerfile'), 'báo cần khởi động lại và cần build lại cho tệp hạ tầng');
    const done2 = await apply(plan2.data.token);
    assert.ok(done2.status === 200 && done2.data.restart_required && !done2.data.restarted && !done2.data.hot_reloaded, 'không tự tắt máy chủ khi không chạy dưới Docker/systemd: ' + JSON.stringify(done2.data));
    assert.ok(fs.readFileSync(path.join(APP_ROOT, 'server/config.js'), 'utf8').includes('chỉnh phần lõi'));
    assert.ok(!fs.existsSync(path.join(APP_ROOT, 'Dockerfile')), 'tệp hạ tầng không bị ghi vào');
    assert.strictEqual((await api('GET', '/api/version')).data.version, V2);

    // ---- quay lại từng bước ----
    const rb1 = await api('POST', '/api/update/rollback', { password: 'matkhau-moi-1' }, admin);
    assert.ok(rb1.status === 200 && rb1.data.version === V1 && rb1.data.restart_required, JSON.stringify(rb1.data));
    assert.ok(!fs.readFileSync(path.join(APP_ROOT, 'server/config.js'), 'utf8').includes('chỉnh phần lõi'));
    assert.strictEqual((await api('POST', '/api/update/rollback', { password: 'sai' }, admin)).status, 403);
    const rb2 = await api('POST', '/api/update/rollback', { password: 'matkhau-moi-1' }, admin);
    assert.ok(rb2.status === 200 && rb2.data.version === V0 && rb2.data.hot_reloaded, JSON.stringify(rb2.data));
    assert.strictEqual((await api('GET', '/api/health')).data.patch, undefined, 'mã máy chủ đã về bản cũ');
    assert.strictEqual((await fetch(BASE + '/hello-update.txt')).status, 404, 'tệp thêm mới đã được gỡ');
    assert.ok(!(await text('/kiosk/kiosk.css')).includes(`patched-${V1}`));
    const st1 = (await api('GET', '/api/update/status', null, admin)).data;
    assert.ok(st1.version === V0 && !st1.can_rollback);
    assert.strictEqual((await api('POST', '/api/update/rollback', { password: 'matkhau-moi-1' }, admin)).status, 400, 'hết bản để quay lại');

    // ---- chữ ký ----
    const { generateKeyPairSync } = require('crypto');
    const kp = generateKeyPairSync('ed25519');
    const pub = kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const files = [pj('2.0.0'), { path: 'server/a.js', data: Buffer.from('1') }];
    const mb = Buffer.from(JSON.stringify(pkgLib.makeManifest(files, { version: '2.0.0' })));
    const signedPkg = pkgLib.tarWrite([{ path: 'update.json', data: mb }, { path: 'update.sig', data: Buffer.from(pkgLib.sign(mb, kp.privateKey.export({ type: 'pkcs8', format: 'pem' }))) }, ...files]);
    assert.ok(pkgLib.open(signedPkg, { publicKey: pub }).signed, 'chữ ký đúng được chấp nhận');
    assert.throws(() => pkgLib.open(pkgLib.tarWrite([{ path: 'update.json', data: mb }, ...files]), { publicKey: pub }), /chưa được ký/);
    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    assert.throws(() => pkgLib.open(signedPkg, { publicKey: other }), /Chữ ký/, 'chữ ký của người khác bị từ chối');

    // ---- tắt bằng ALLOW_ONLINE_UPDATE=0 ----
    const P2 = 4900 + Math.floor(Math.random() * 90); const D2 = fs.mkdtempSync(path.join(os.tmpdir(), 'chamcong-off-'));
    const off = spawn(process.execPath, [path.join(APP_ROOT, 'server', 'index.js')], { env: { ...process.env, PORT: String(P2), DATA_DIR: D2, HOST: '127.0.0.1', ADMIN_CODE: 'admin', ADMIN_PASSWORD: 'admin123', ALLOW_ONLINE_UPDATE: '0' }, stdio: 'ignore' });
    try {
      for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${P2}/api/health`)).ok) break; } catch { /* chờ */ } await new Promise((r) => setTimeout(r, 100)); }
      const call = async (m, u, b, t) => { const r = await fetch(`http://127.0.0.1:${P2}${u}`, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
      let t2 = (await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })).data.token;
      t2 = (await call('POST', '/api/auth/change-password', { old_password: 'admin123', new_password: 'Admin#12345' }, t2)).data.token;
      assert.strictEqual((await call('GET', '/api/update/status', null, t2)).data.enabled, false);
      const r = await fetch(`http://127.0.0.1:${P2}/api/update/upload`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + t2 }, body: p1 });
      assert.strictEqual(r.status, 403); assert.strictEqual((await r.json()).code, 'UPDATE_DISABLED', 'tắt bằng ALLOW_ONLINE_UPDATE=0');
      assert.strictEqual((await call('POST', '/api/update/apply', { token: 'x', password: 'Admin#12345' }, t2)).status, 403);
    } finally { off.kill('SIGTERM'); fs.rmSync(D2, { recursive: true, force: true }); }
  });

  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(APP_ROOT, { recursive: true, force: true });
  const failed = results.filter((r) => !r[0]);
  console.log(`\n${results.length - failed.length}/${results.length} bước đạt`);
  if (failed.length) {
    console.log('\n--- log server ---\n' + serverLog.slice(-3000));
    console.log('Thư mục dữ liệu tạm:', DATA_DIR);
    process.exit(1);
  }
  console.log('Thư mục dữ liệu tạm (có xlsx mẫu):', DATA_DIR);
})();
