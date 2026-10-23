'use strict';
// Tổng quan, nhật ký chấm công, bảng công, bảng lương, xuất Excel, sao lưu, ảnh chấm công.
const fs = require('fs');
const path = require('path');
const C = require('../config');
const { q, tx, settings, setSetting, audit, backupTo } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { verifyJwt } = require('../lib/security');
const { buildXlsx, STYLE } = require('../lib/xlsx');
const { auth } = require('../auth');
const { listEmployees, teamWhere } = require('../scope');
const { computeRange, standardDays, payrollFor } = require('../calc');
const { scopeSql } = require('./requests');

const STATUS_LABEL = {
  present: 'Đủ công', late: 'Đi muộn', early: 'Về sớm', late_early: 'Muộn & sớm', half: 'Nửa công', short: 'Thiếu giờ',
  missing_out: 'Thiếu giờ ra', missing_in: 'Thiếu giờ vào', absent: 'Vắng', leave: 'Nghỉ phép', unpaid_leave: 'Nghỉ không lương',
  half_leave: 'Nghỉ nửa ngày', half_unpaid: 'Nghỉ nửa ngày KL', holiday: 'Ngày lễ', trip: 'Công tác', off: 'Ngày nghỉ',
  pending: 'Chưa chấm', working: 'Đang làm', future: '', 'n/a': 'Chưa vào làm',
};
const STATUS_SYMBOL = {
  present: 'X', late: 'M', early: 'S', late_early: 'MS', half: '1/2', short: '<', missing_out: '?', missing_in: '?', absent: 'V',
  leave: 'P', unpaid_leave: 'KL', half_leave: 'P/2', half_unpaid: 'KL/2', holiday: 'L', trip: 'CT', working: '..',
};
const DOW_LABEL = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function monthParam(req) {
  const m = req.query.month || U.currentMonth();
  if (!U.isMonth(m)) throw bad('Tháng không hợp lệ');
  return m;
}

function timesheetData(req) {
  const month = monthParam(req);
  const { from, to } = U.monthRange(month);
  const emps = listEmployees(req.user, {
    tracked: true,
    departmentId: req.query.department_id || null,
    employeeId: req.query.employee_id || null,
    search: req.query.search || '',
  });
  const calc = computeRange(emps, from, to);
  return { month, from, to, emps, calc, std: standardDays(month) };
}

function sendXlsx(res, buf, filename) {
  res.send(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 200, {
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
}

module.exports = (app) => {
  // ---------- Tổng quan ----------
  app.get('/api/dashboard', auth('admin', 'manager'), (req, res) => {
    const emps = listEmployees(req.user, { tracked: true });
    const t = U.today();
    const from = U.addDays(t, -6);
    const calc = computeRange(emps, from, t);
    const dates = U.dateList(from, t);
    const trend = dates.map((d, i) => {
      let expected = 0;
      let attended = 0;
      let late = 0;
      for (const e of emps) {
        const day = calc.get(e.id).days[i];
        if (day.shift && !['holiday', 'leave', 'unpaid_leave', 'trip', 'n/a'].includes(day.status)) expected++;
        if (day.first_in) attended++;
        if (day.late_min > 0) late++;
      }
      return { date: d, expected, attended, late };
    });
    const todayCounts = { total: emps.length, expected: 0, checked_in: 0, late: 0, on_leave: 0, not_yet: 0, absent: 0, off: 0 };
    const lists = { late: [], not_yet: [], on_leave: [] };
    for (const e of emps) {
      const day = calc.get(e.id).days[calc.get(e.id).days.length - 1];
      const brief = { id: e.id, code: e.code, name: e.full_name, dept: e.dept_name, first_in: day.first_in, late_min: day.late_min };
      if (['leave', 'unpaid_leave', 'half_leave', 'half_unpaid', 'trip'].includes(day.status)) {
        todayCounts.on_leave++;
        lists.on_leave.push({ ...brief, status: day.status });
        continue;
      }
      if (!day.shift || day.status === 'holiday' || day.status === 'n/a') {
        todayCounts.off++;
        continue;
      }
      todayCounts.expected++;
      if (day.first_in) {
        todayCounts.checked_in++;
        if (day.late_min > 0) {
          todayCounts.late++;
          lists.late.push(brief);
        }
      } else {
        todayCounts.not_yet++;
        lists.not_yet.push(brief);
      }
    }
    let recent = [];
    if (emps.length) {
      const ids = emps.map((e) => e.id);
      recent = q.all(
        `SELECT l.id, l.ts, l.type, l.method, l.photo, e.full_name, e.code, b.name AS branch_name
         FROM logs l JOIN employees e ON e.id=l.employee_id LEFT JOIN branches b ON b.id=l.branch_id
         WHERE l.employee_id IN (${ids.map(() => '?').join(',')}) ORDER BY l.ts DESC LIMIT 12`,
        ...ids
      );
    }
    const sc = scopeSql(req.user);
    const pending = q.get(`SELECT COUNT(*) AS n FROM requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='pending' AND ${sc.sql}`, ...sc.params).n;
    res.json({ date: t, today: todayCounts, lists, trend, recent, pending_requests: pending });
  });

  // ---------- Nhật ký chấm công ----------
  app.get('/api/logs', auth('admin', 'manager'), (req, res) => {
    const sc = teamWhere(req.user);
    const where = [sc.sql];
    const params = [...sc.params];
    const date = req.query.date;
    const from = req.query.from || date;
    const to = req.query.to || date;
    if (from && U.isYmd(from)) {
      where.push('l.work_date>=?');
      params.push(from);
    }
    if (to && U.isYmd(to)) {
      where.push('l.work_date<=?');
      params.push(to);
    }
    if (!from && !to) {
      where.push('l.work_date=?');
      params.push(U.today());
    }
    if (req.query.employee_id) {
      where.push('l.employee_id=?');
      params.push(Number(req.query.employee_id));
    }
    if (req.query.department_id) {
      where.push('e.department_id=?');
      params.push(Number(req.query.department_id));
    }
    if (req.query.method) {
      where.push('l.method=?');
      params.push(String(req.query.method));
    }
    res.json(
      q.all(
        `SELECT l.*, e.code, e.full_name, d.name AS dept_name, b.name AS branch_name
         FROM logs l JOIN employees e ON e.id=l.employee_id
         LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN branches b ON b.id=l.branch_id
         WHERE ${where.join(' AND ')} ORDER BY l.ts DESC LIMIT 1500`,
        ...params
      )
    );
  });

  // Quản trị viên bổ sung/chỉnh sửa công thủ công
  app.post('/api/logs/manual', auth('admin'), (req, res) => {
    const b = req.body || {};
    const emp = q.get('SELECT * FROM employees WHERE id=?', Number(b.employee_id));
    if (!emp) throw bad('Không tìm thấy nhân viên');
    if (!U.isYmd(b.date)) throw bad('Ngày không hợp lệ');
    const inT = b.in_time || null;
    const outT = b.out_time || null;
    if (!inT && !outT) throw bad('Nhập giờ vào và/hoặc giờ ra');
    if ((inT && !U.isHm(inT)) || (outT && !U.isHm(outT))) throw bad('Giờ không hợp lệ (HH:MM)');
    const note = String(b.note || 'Quản trị viên điều chỉnh').slice(0, 200);
    tx(() => {
      const ins = (type, ts) =>
        q.run("INSERT INTO logs(employee_id,ts,work_date,type,method,note,created_by) VALUES(?,?,?,?, 'manual', ?, ?)", emp.id, ts, b.date, type, note, req.user.id);
      if (inT) ins('in', U.tsAt(b.date, inT));
      if (outT) {
        let ts = U.tsAt(b.date, outT);
        if (inT && ts <= U.tsAt(b.date, inT)) ts += 86400000;
        ins('out', ts);
      }
    });
    audit(req.user, 'Chấm công thủ công', `${emp.code} ${b.date} ${inT || '--'}→${outT || '--'}: ${note}`);
    res.json({ ok: true });
  });

  app.del('/api/logs/:id', auth('admin'), (req, res) => {
    const l = q.get('SELECT l.*, e.code FROM logs l JOIN employees e ON e.id=l.employee_id WHERE l.id=?', Number(req.params.id));
    if (!l) throw notFound();
    q.run('DELETE FROM logs WHERE id=?', l.id);
    audit(req.user, 'Xoá bản ghi chấm công', `${l.code} ${l.work_date} ${l.type} ${U.hhmm(l.ts)}`);
    res.json({ ok: true });
  });

  // ---------- Bảng công ----------
  app.get('/api/timesheet', auth('admin', 'manager'), (req, res) => {
    const { month, emps, calc, std } = timesheetData(req);
    res.json({
      month,
      standard_days: std,
      employees: emps.map((e) => ({
        employee: { id: e.id, code: e.code, full_name: e.full_name, dept_name: e.dept_name, position: e.position },
        days: calc.get(e.id).days,
        summary: calc.get(e.id).summary,
      })),
    });
  });

  app.get('/api/timesheet/export', auth('admin', 'manager'), (req, res) => {
    const { month, from, to, emps, calc, std } = timesheetData(req);
    const S = settings();
    const dates = U.dateList(from, to);
    const head = ['STT', 'Mã NV', 'Họ và tên', 'Phòng ban', ...dates.map((d) => `${Number(d.slice(8))}\n${DOW_LABEL[U.dow(d)]}`),
      'Công thực tế', 'Nghỉ phép', 'Lễ', 'Công tác', 'Tổng công hưởng lương', 'Vắng', 'Thiếu giờ', 'Đi muộn (lần)', 'Đi muộn (phút)', 'Về sớm (lần)', 'OT (giờ)'];
    const rows = [
      [{ v: `BẢNG CHẤM CÔNG THÁNG ${month.slice(5)}/${month.slice(0, 4)} - ${S.company_name}`, s: STYLE.title }],
      [{ v: `Công chuẩn: ${std} ngày`, s: STYLE.bold }],
      head.map((h) => ({ v: h, s: STYLE.header })),
    ];
    emps.forEach((e, i) => {
      const r = calc.get(e.id);
      const sm = r.summary;
      rows.push([
        { v: i + 1, s: STYLE.center },
        { v: e.code, s: STYLE.text },
        { v: e.full_name, s: STYLE.text },
        { v: e.dept_name || '', s: STYLE.text },
        ...r.days.map((d) => ({ v: STATUS_SYMBOL[d.status] || '', s: STYLE.center })),
        { v: sm.work_days, s: STYLE.dec }, { v: sm.leave_days, s: STYLE.dec }, { v: sm.holiday_days, s: STYLE.int },
        { v: sm.trip_days, s: STYLE.int }, { v: sm.paid_days, s: STYLE.dec }, { v: sm.absent_days, s: STYLE.int },
        { v: sm.incomplete_days, s: STYLE.int }, { v: sm.late_count, s: STYLE.int }, { v: sm.late_minutes, s: STYLE.int },
        { v: sm.early_count, s: STYLE.int }, { v: sm.ot_hours, s: STYLE.dec },
      ]);
    });
    rows.push([]);
    rows.push([{ v: 'Ký hiệu: X đủ công | M đi muộn | S về sớm | MS muộn & sớm | 1/2 nửa công | < thiếu giờ | ? thiếu giờ vào/ra | V vắng | P nghỉ phép | KL nghỉ không lương | L lễ | CT công tác', s: STYLE.normal }]);

    const detail = [['Mã NV', 'Họ tên', 'Ngày', 'Thứ', 'Ca', 'Giờ vào', 'Giờ ra', 'Giờ làm', 'Muộn (phút)', 'Về sớm (phút)', 'OT (giờ)', 'Trạng thái'].map((h) => ({ v: h, s: STYLE.header }))];
    for (const e of emps) {
      for (const d of calc.get(e.id).days) {
        if (['future', 'n/a'].includes(d.status) || (d.status === 'off' && !d.first_in)) continue;
        detail.push([
          { v: e.code, s: STYLE.text }, { v: e.full_name, s: STYLE.text }, { v: d.date, s: STYLE.center }, { v: DOW_LABEL[d.dow], s: STYLE.center },
          { v: d.shift ? d.shift.name : '', s: STYLE.text }, { v: d.first_in ? U.hhmm(d.first_in) : '', s: STYLE.center },
          { v: d.last_out ? U.hhmm(d.last_out) : '', s: STYLE.center }, { v: Math.round((d.worked_min / 60) * 100) / 100, s: STYLE.dec },
          { v: d.late_min, s: STYLE.int }, { v: d.early_min, s: STYLE.int }, { v: d.ot_hours, s: STYLE.dec },
          { v: STATUS_LABEL[d.status] + (d.holiday ? ` (${d.holiday})` : ''), s: STYLE.text },
        ]);
      }
    }
    const buf = buildXlsx([
      { name: 'Bảng công', rows, freeze: { cols: 4, rows: 3 }, widths: [5, 11, 24, 16, ...dates.map(() => 4.5), 11, 10, 7, 9, 14, 7, 9, 10, 11, 10, 9], merges: [`A1:${'H'}1`] },
      { name: 'Chi tiết', rows: detail, freeze: { rows: 1 }, widths: [11, 24, 12, 6, 16, 9, 9, 9, 11, 13, 9, 22] },
    ]);
    sendXlsx(res, buf, `bang-cong-${month}.xlsx`);
  });

  // ---------- Bảng lương ----------
  function payrollData(req) {
    const t = timesheetData(req);
    const S = settings();
    const rows = t.emps.map((e) => {
      const r = t.calc.get(e.id);
      return { employee: { id: e.id, code: e.code, full_name: e.full_name, dept_name: e.dept_name }, summary: r.summary, pay: payrollFor(e, r.summary, t.std, S) };
    });
    return { month: t.month, standard_days: t.std, rows, settings: S };
  }
  app.get('/api/payroll', auth('admin'), (req, res) => {
    const d = payrollData(req);
    res.json({ month: d.month, standard_days: d.standard_days, rows: d.rows });
  });
  app.get('/api/payroll/export', auth('admin'), (req, res) => {
    const d = payrollData(req);
    const head = ['STT', 'Mã NV', 'Họ và tên', 'Phòng ban', 'Lương cơ bản', 'Công chuẩn', 'Công hưởng lương', 'Lương theo công', 'OT (giờ)', 'Tiền OT', 'Phụ cấp', 'Đi muộn (phút)', 'Phạt đi muộn', 'Thực nhận (tạm tính)'];
    const rows = [
      [{ v: `BẢNG LƯƠNG TẠM TÍNH THÁNG ${d.month.slice(5)}/${d.month.slice(0, 4)} - ${d.settings.company_name}`, s: STYLE.title }],
      [{ v: 'Chưa bao gồm BHXH, BHYT, BHTN, thuế TNCN và các khoản khấu trừ khác.', s: STYLE.normal }],
      head.map((h) => ({ v: h, s: STYLE.header })),
    ];
    let total = 0;
    d.rows.forEach((r, i) => {
      const p = r.pay;
      total += p.net;
      rows.push([
        { v: i + 1, s: STYLE.center }, { v: r.employee.code, s: STYLE.text }, { v: r.employee.full_name, s: STYLE.text }, { v: r.employee.dept_name || '', s: STYLE.text },
        { v: p.base_salary, s: STYLE.int }, { v: p.std_days, s: STYLE.int }, { v: p.paid_days, s: STYLE.dec }, { v: p.salary_by_days, s: STYLE.int },
        { v: p.ot_hours, s: STYLE.dec }, { v: p.ot_pay, s: STYLE.int }, { v: p.allowance, s: STYLE.int }, { v: p.late_minutes, s: STYLE.int },
        { v: p.late_fine, s: STYLE.int }, { v: p.net, s: STYLE.int },
      ]);
    });
    rows.push([null, null, { v: 'TỔNG CỘNG', s: STYLE.bold }, null, null, null, null, null, null, null, null, null, null, { v: total, s: STYLE.int }]);
    const buf = buildXlsx([{ name: 'Bảng lương', rows, freeze: { cols: 3, rows: 3 }, widths: [5, 11, 24, 16, 14, 10, 12, 14, 9, 12, 12, 11, 12, 16] }]);
    sendXlsx(res, buf, `bang-luong-${d.month}.xlsx`);
  });

  // ---------- Ảnh chấm công ----------
  app.get('/api/photos/:sub/:name', (req, res) => {
    const p = verifyJwt(req.query.t, C.JWT_SECRET);
    if (!p || !p.ph) throw new HttpError(401, 'Không có quyền xem ảnh', 'UNAUTHORIZED');
    const { sub, name } = req.params;
    if (!/^\d{4}-\d{2}$/.test(sub) || !/^[\w.-]+$/.test(name)) throw notFound();
    const file = path.join(C.DATA_DIR, 'photos', sub, name);
    let buf;
    try { buf = fs.readFileSync(file); } catch { throw notFound('Không tìm thấy ảnh'); }
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.send(buf, type, 200, { 'Cache-Control': 'private, max-age=3600' });
  });

  // ---------- Sao lưu tự động, danh sách bản sao lưu, nạp dữ liệu cũ ----------
  const BK = require('../backup');
  app.get('/api/backups', auth('admin'), (req, res) => res.json(BK.status()));

  app.put('/api/backups/settings', auth('admin'), (req, res) => {
    const b = req.body || {};
    const keep = Math.round(Number(b.keep));
    if (!(keep >= 1 && keep <= 365)) throw bad('Số bản giữ lại phải từ 1 đến 365');
    setSetting('auto_backup', b.auto ? '1' : '0');
    setSetting('backup_keep', String(keep));
    BK.prune();
    audit(req.user, 'Đổi cài đặt sao lưu', `${b.auto ? 'bật' : 'tắt'} tự động, giữ ${keep} bản`);
    res.json(BK.status());
  });

  app.post('/api/backups', auth('admin'), (req, res) => {
    const name = BK.create('thu-cong');
    audit(req.user, 'Sao lưu thủ công', name);
    res.json({ name, ...BK.status() });
  });

  // Tải một file dữ liệu cũ (.db) lên để xem trước; chưa thay đổi dữ liệu hiện tại
  app.post('/api/backups/upload', auth('admin'), (req, res) => {
    const buf = req.raw;
    if (!buf || !buf.length) throw bad('Chưa chọn file');
    const name = `tai-len-${BK.stamp()}.db`;
    const file = path.join(BK.DIR, name);
    fs.writeFileSync(file, buf);
    try {
      const info = BK.inspect(file);
      BK.prune();
      audit(req.user, 'Tải dữ liệu cũ lên', `${name}, ${info.employees} nhân viên, ${info.logs} lượt chấm công`);
      res.json({ name, ...info });
    } catch (e) {
      try { fs.unlinkSync(file); } catch { /* bỏ qua */ }
      throw e;
    }
  });

  app.get('/api/backups/:name/download', auth('admin'), (req, res) => {
    const file = BK.safeName(req.params.name);
    audit(req.user, 'Tải bản sao lưu', req.params.name);
    res.send(fs.readFileSync(file), 'application/octet-stream', 200, { 'Content-Disposition': `attachment; filename="${req.params.name}"`, 'Cache-Control': 'no-store' });
  });

  app.del('/api/backups/:name', auth('admin'), (req, res) => {
    fs.unlinkSync(BK.safeName(req.params.name));
    audit(req.user, 'Xoá bản sao lưu', req.params.name);
    res.json({ ok: true });
  });

  // Khôi phục: thay TOÀN BỘ dữ liệu hiện tại bằng dữ liệu của bản sao lưu (tự lưu bản hiện tại trước)
  app.post('/api/backups/:name/restore', auth('admin'), (req, res) => {
    const file = BK.safeName(req.params.name);
    const r = BK.restore(file);
    try { audit({ id: null, code: req.user.code, full_name: req.user.full_name }, 'Khôi phục dữ liệu', `${req.params.name}; bản dự phòng ${r.safety}`); } catch { /* người dùng có thể không còn trong dữ liệu mới */ }
    res.json({ ok: true, ...r });
  });

  // ---------- Sao lưu ----------
  app.get('/api/backup', auth('admin'), (req, res) => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${U.pad(d.getMonth() + 1)}${U.pad(d.getDate())}-${U.pad(d.getHours())}${U.pad(d.getMinutes())}${U.pad(d.getSeconds())}`;
    const file = path.join(C.DATA_DIR, 'backups', `chamcong-${stamp}.db`);
    backupTo(file);
    const buf = fs.readFileSync(file);
    fs.unlinkSync(file);
    audit(req.user, 'Tải bản sao lưu');
    res.send(buf, 'application/octet-stream', 200, { 'Content-Disposition': `attachment; filename="chamcong-${stamp}.db"`, 'Cache-Control': 'no-store' });
  });
};

module.exports.STATUS_LABEL = STATUS_LABEL;
