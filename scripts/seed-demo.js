'use strict';
// Tạo dữ liệu mẫu để xem thử hệ thống: node scripts/seed-demo.js [--force]
// Cảnh báo: dùng cho bản chạy thử. Đừng chạy trên hệ thống đã có dữ liệu thật.
const C = require('../server/config');
const { q, tx, setSetting, newBranchSecrets } = require('../server/db');
const { hashPassword } = require('../server/lib/security');
const U = require('../server/lib/util');

const force = process.argv.includes('--force');
const existing = q.get("SELECT COUNT(*) AS n FROM employees WHERE role<>'admin'").n;
if (existing > 0 && !force) {
  console.error(`Đã có ${existing} nhân viên. Thêm --force nếu bạn thật sự muốn tạo thêm dữ liệu mẫu.`);
  process.exit(1);
}

let seed = 20261017;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));

tx(() => {
  const dept = {};
  for (const n of ['Sản xuất', 'Kho', 'Giao hàng', 'Kinh doanh', 'Văn phòng']) dept[n] = Number(q.run('INSERT OR IGNORE INTO departments(name) VALUES(?)', n).lastInsertRowid) || q.get('SELECT id FROM departments WHERE name=?', n).id;

  const s = newBranchSecrets();
  const branchId = Number(q.run('INSERT INTO branches(name,address,lat,lng,radius,qr_secret,kiosk_key) VALUES(?,?,?,?,?,?,?)',
    'Nhà máy chính', '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', 10.7769, 106.7009, 150, s.qr_secret, s.kiosk_key).lastInsertRowid);

  const defShift = q.get('SELECT id FROM shifts ORDER BY id LIMIT 1').id;
  const morning = Number(q.run("INSERT INTO shifts(name,start_time,end_time,break_minutes,late_grace,work_days) VALUES('Ca sáng','05:00','13:00',30,5,'1,2,3,4,5,6')").lastInsertRowid);
  const afternoon = Number(q.run("INSERT INTO shifts(name,start_time,end_time,break_minutes,late_grace,work_days) VALUES('Ca chiều','13:00','21:00',30,5,'1,2,3,4,5,6')").lastInsertRowid);

  const people = [
    ['QL01', 'Trần Minh Quân', 'manager', 'Sản xuất', 'Quản đốc', defShift, 16000000],
    ['NV001', 'Nguyễn Văn An', 'employee', 'Sản xuất', 'Công nhân', morning, 9500000],
    ['NV002', 'Lê Thị Bích', 'employee', 'Sản xuất', 'Công nhân', morning, 9500000],
    ['NV003', 'Phạm Quốc Cường', 'employee', 'Sản xuất', 'Công nhân', afternoon, 9500000],
    ['NV004', 'Hoàng Thị Dung', 'employee', 'Sản xuất', 'Công nhân', afternoon, 9500000],
    ['NV005', 'Võ Thanh Hải', 'employee', 'Kho', 'Thủ kho', defShift, 11000000],
    ['NV006', 'Đặng Thị Lan', 'employee', 'Kho', 'Nhân viên kho', defShift, 9000000],
    ['NV007', 'Bùi Văn Phúc', 'employee', 'Giao hàng', 'Tài xế', defShift, 12000000],
    ['NV008', 'Ngô Văn Sơn', 'employee', 'Giao hàng', 'Phụ xe', defShift, 9000000],
    ['NV009', 'Đỗ Thị Thu', 'employee', 'Kinh doanh', 'Nhân viên kinh doanh', defShift, 13000000],
    ['NV010', 'Trương Văn Tâm', 'employee', 'Kinh doanh', 'Nhân viên kinh doanh', defShift, 13000000],
    ['NV011', 'Lý Thị Uyên', 'employee', 'Văn phòng', 'Kế toán', defShift, 14000000],
    ['NV012', 'Mai Văn Vinh', 'employee', 'Văn phòng', 'Hành chính nhân sự', defShift, 12500000],
  ];
  const pw = hashPassword('123456');
  const ids = {};
  let mgrId = null;
  people.forEach(([code, name, role, d, pos, shift, salary], i) => {
    const r = q.run(
      `INSERT INTO employees(code,full_name,phone,password_hash,role,department_id,branch_id,shift_id,manager_id,position,base_salary,allowance,annual_leave,hired_date,created_at,must_change_password)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,12,?,?,0)`,
      code, name, `09${String(10000000 + i * 1357911).slice(0, 8)}`, pw, role, dept[d], branchId, shift, role === 'employee' && d === 'Sản xuất' ? mgrId : null, pos, salary, role === 'employee' ? 500000 : 1000000, `20${between(19, 25)}-0${between(1, 9)}-1${between(0, 9)}`, Date.now());
    ids[code] = Number(r.lastInsertRowid);
    if (code === 'QL01') mgrId = ids[code];
  });
  q.run("UPDATE employees SET manager_id=? WHERE department_id=? AND role='employee'", mgrId, dept['Sản xuất']);

  // Ngày lễ
  const y = new Date().getFullYear();
  for (const [d, n] of [[`${y}-01-01`, 'Tết Dương lịch'], [`${y}-04-30`, 'Ngày Giải phóng miền Nam'], [`${y}-05-01`, 'Ngày Quốc tế Lao động'], [`${y}-09-02`, 'Quốc khánh']]) q.run('INSERT OR IGNORE INTO holidays(date,name) VALUES(?,?)', d, n);

  // Chấm công 35 ngày gần nhất
  const today = U.today();
  const shifts = { [defShift]: ['08:00', '17:00'], [morning]: ['05:00', '13:00'], [afternoon]: ['13:00', '21:00'] };
  const hols = new Set(q.all('SELECT date FROM holidays').map((h) => h.date));
  const nowMs = Date.now();
  const insLog = q.run.bind(q);
  for (const p of people) {
    const eid = ids[p[0]];
    const [st, en] = shifts[p[5]];
    const lateProne = rnd() < 0.3;
    for (let k = 35; k >= 0; k--) {
      const date = U.addDays(today, -k);
      if (U.dow(date) === 0 || hols.has(date)) continue;
      const roll = rnd();
      if (k > 0 && roll < 0.03) continue; // vắng
      let inMin = U.hmToMin(st) + (lateProne ? between(-8, 25) : between(-12, 6));
      let outMin = U.hmToMin(en) + between(-4, 35);
      if (k > 0 && roll > 0.97) outMin = null; // quên chấm ra
      const inTs = U.tsAt(date, '00:00') + inMin * 60000;
      if (k === 0 && inTs > nowMs) continue;
      insLog('INSERT INTO logs(employee_id,ts,work_date,type,method,branch_id,lat,lng,accuracy,ip) VALUES(?,?,?,?,?,?,?,?,?,?)',
        eid, inTs, date, 'in', pick(['gps', 'gps', 'gps', 'qr']), branchId, 10.7769 + (rnd() - 0.5) * 0.0008, 106.7009 + (rnd() - 0.5) * 0.0008, between(8, 30), '10.0.0.' + between(2, 200));
      if (outMin !== null) {
        const outTs = U.tsAt(date, '00:00') + outMin * 60000;
        if (k === 0 && outTs > nowMs) continue;
        insLog('INSERT INTO logs(employee_id,ts,work_date,type,method,branch_id,lat,lng,accuracy,ip) VALUES(?,?,?,?,?,?,?,?,?,?)',
          eid, outTs, date, 'out', pick(['gps', 'gps', 'qr']), branchId, 10.7769 + (rnd() - 0.5) * 0.0008, 106.7009 + (rnd() - 0.5) * 0.0008, between(8, 30), '10.0.0.' + between(2, 200));
      }
    }
  }

  // Đơn từ
  const reqIns = (emp, type, start, end, extra) => q.run(
    `INSERT INTO requests(employee_id,type,leave_type_id,start_date,end_date,session,hours,in_time,out_time,days,reason,status,approver_id,approver_note,created_at,decided_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ids[emp], type, extra.lt || null, start, end, extra.session || 'full', extra.hours || null, extra.in || null, extra.out || null, extra.days || 0, extra.reason || '', extra.status || 'pending', extra.status && extra.status !== 'pending' ? mgrId : null, extra.note || '', Date.now() - 86400000, extra.status && extra.status !== 'pending' ? Date.now() : null);
  const annual = q.get('SELECT id FROM leave_types WHERE deduct_balance=1').id;
  const sick = q.get("SELECT id FROM leave_types WHERE name='Nghỉ ốm'").id;
  const d3 = U.addDays(today, 3);
  reqIns('NV002', 'leave', d3, U.addDays(d3, 1), { lt: annual, days: 2, reason: 'Về quê có việc gia đình' });
  reqIns('NV005', 'ot', today, today, { hours: 2, reason: 'Kiểm kho cuối tháng' });
  reqIns('NV009', 'trip', U.addDays(today, 1), U.addDays(today, 2), { days: 2, reason: 'Gặp khách hàng tại Đồng Nai' });
  reqIns('NV003', 'leave', U.addDays(today, -9), U.addDays(today, -9), { lt: sick, days: 1, reason: 'Ốm', status: 'approved', note: 'Chúc bạn mau khoẻ' });
  reqIns('NV007', 'explain', U.addDays(today, -4), U.addDays(today, -4), { in: '07:55', out: '17:10', reason: 'Quên chấm công do kẹt xe trên đường giao hàng' });

  q.run('INSERT INTO announcements(title,body,pinned,created_at) VALUES(?,?,?,?)', 'Chấm công bằng điện thoại', 'Từ nay nhân viên chấm công trên ứng dụng này. Hãy bật định vị (GPS) khi chấm công, hoặc quét mã QR đặt tại cổng nhà máy.', 1, Date.now());
  q.run('INSERT INTO announcements(title,body,pinned,created_at) VALUES(?,?,?,?)', 'Lịch nghỉ lễ Quốc khánh', 'Công ty nghỉ ngày 2/9. Ca sản xuất làm bù theo thông báo của quản đốc.', 0, Date.now() - 3 * 86400000);
  setSetting('company_name', 'Công ty TNHH Thực phẩm Bún Việt');
  setSetting('public_url', '');
});

const b = q.get('SELECT * FROM branches ORDER BY id DESC LIMIT 1');
console.log('Đã tạo dữ liệu mẫu.');
console.log('  Tài khoản quản trị :', C.ADMIN_CODE, '(mật khẩu bạn đã đặt)');
console.log('  Quản lý           : QL01 / 123456');
console.log('  Nhân viên         : NV001 ... NV012 / 123456');
console.log('  Màn hình QR       : /kiosk/?key=' + b.kiosk_key);
