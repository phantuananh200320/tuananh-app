'use strict';
// Quản trị danh mục: phòng ban, chi nhánh, ca làm, loại phép, thông báo, nhân viên, xếp ca, ngày lễ, cài đặt.
const fs = require('fs');
const path = require('path');
const C = require('../config');
const { q, tx, settings, setSetting, logoUrl, audit, newBranchSecrets, DEFAULT_SETTINGS } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { hashPassword, randomPin, randomToken } = require('../lib/security');
const { auth } = require('../auth');
const { listEmployees, EMP_SELECT, teamWhere } = require('../scope');

function dbGuard(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const m = String((e && e.message) || '');
    if (m.includes('UNIQUE')) {
      if (m.includes('employees.code')) throw bad('Mã nhân viên đã tồn tại');
      if (m.includes('departments.name')) throw bad('Tên phòng ban đã tồn tại');
      throw bad('Dữ liệu bị trùng');
    }
    if (m.includes('FOREIGN KEY')) throw bad('Dữ liệu liên kết không hợp lệ (phòng ban/chi nhánh/ca làm không tồn tại)');
    if (m.includes('CHECK')) throw bad('Giá trị không hợp lệ');
    throw e;
  }
}

function makeCleaner(spec) {
  const cols = Object.keys(spec);
  return (b, partial) => {
    const o = {};
    for (const c of cols) {
      const f = spec[c];
      if (!(c in b)) {
        if (!partial && f.required) throw bad(`Vui lòng nhập ${f.label || c}`);
        continue;
      }
      let v = b[c];
      const t = f.type || 'text';
      const empty = v === '' || v === null || v === undefined;
      if (empty) {
        if (f.required) throw bad(`Vui lòng nhập ${f.label || c}`);
        v = f.nullable ? null : t === 'text' ? '' : 0;
      } else if (t === 'int') {
        v = Math.round(Number(v));
        if (!Number.isFinite(v)) throw bad(`${f.label || c} không hợp lệ`);
      } else if (t === 'num') {
        v = Number(v);
        if (!Number.isFinite(v)) throw bad(`${f.label || c} không hợp lệ`);
      } else if (t === 'bool') {
        v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
      } else {
        v = String(v).trim();
      }
      if (f.check && v !== null && v !== '') f.check(v);
      o[c] = v;
    }
    return o;
  };
}

const range = (label, min, max) => (v) => {
  if (v < min || v > max) throw bad(`${label} phải từ ${min} đến ${max}`);
};
const hm = (label) => (v) => {
  if (!U.isHm(v)) throw bad(`${label} không hợp lệ (định dạng HH:MM)`);
};

function crud(app, base, table, spec, opt = {}) {
  const clean = makeCleaner(spec);
  const order = opt.order || 'id';
  const row = (id) => q.get(`SELECT * FROM ${table} WHERE id=?`, id);
  const label = opt.label || table;

  app.get(base, auth('admin', 'manager'), (req, res) => {
    res.json(opt.list ? opt.list(req.user) : q.all(`SELECT * FROM ${table} ORDER BY ${order}`));
  });
  app.post(base, auth('admin'), (req, res) => {
    const o = clean(req.body || {}, false);
    if (opt.extra) Object.assign(o, opt.extra(req.user));
    const keys = Object.keys(o);
    const r = dbGuard(() => q.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => o[k])));
    audit(req.user, `Thêm ${label}`, o.name || o.title || '');
    res.json(row(Number(r.lastInsertRowid)));
  });
  app.put(`${base}/:id`, auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!row(id)) throw notFound();
    const o = clean(req.body || {}, true);
    const keys = Object.keys(o);
    if (keys.length) dbGuard(() => q.run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => o[k]), id));
    audit(req.user, `Sửa ${label}`, `#${id} ${o.name || o.title || ''}`);
    res.json(row(id));
  });
  app.del(`${base}/:id`, auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!row(id)) throw notFound();
    if (opt.onDelete) {
      const r = opt.onDelete(id);
      if (r) {
        audit(req.user, `Xoá ${label}`, `#${id}`);
        return res.json(r);
      }
    }
    dbGuard(() => q.run(`DELETE FROM ${table} WHERE id=?`, id));
    audit(req.user, `Xoá ${label}`, `#${id}`);
    res.json({ ok: true });
  });
}

const EMP_SPEC = {
  code: { required: true, label: 'Mã nhân viên', check: (v) => { if (!/^[A-Za-z0-9._-]{1,30}$/.test(v)) throw bad('Mã nhân viên chỉ gồm chữ, số, . _ - (tối đa 30 ký tự)'); } },
  full_name: { required: true, label: 'Họ tên' },
  phone: { label: 'Số điện thoại', check: (v) => { if (!/^[0-9+ .-]{6,20}$/.test(v)) throw bad('Số điện thoại không hợp lệ'); } },
  email: { label: 'Email' },
  role: { label: 'Vai trò', check: (v) => { if (!['admin', 'manager', 'employee'].includes(v)) throw bad('Vai trò không hợp lệ'); } },
  department_id: { type: 'int', nullable: true },
  branch_id: { type: 'int', nullable: true },
  shift_id: { type: 'int', nullable: true },
  manager_id: { type: 'int', nullable: true },
  position: { label: 'Chức vụ' },
  base_salary: { type: 'int', label: 'Lương cơ bản', check: range('Lương cơ bản', 0, 1e10) },
  allowance: { type: 'int', label: 'Phụ cấp', check: range('Phụ cấp', 0, 1e10) },
  annual_leave: { type: 'num', label: 'Số ngày phép năm', check: range('Số ngày phép năm', 0, 60) },
  allow_remote: { type: 'bool' },
  track: { type: 'bool' },
  hired_date: { nullable: true, label: 'Ngày vào làm', check: (v) => { if (!U.isYmd(v)) throw bad('Ngày vào làm không hợp lệ'); } },
  note: { label: 'Ghi chú' },
  active: { type: 'bool' },
};
const cleanEmp = makeCleaner(EMP_SPEC);

function otherActiveAdmins(exceptId) {
  return q.get("SELECT COUNT(*) AS n FROM employees WHERE role='admin' AND active=1 AND id<>?", exceptId).n;
}

const SET_RULES = {
  company_name: (v) => { v = String(v).trim().slice(0, 100); if (!v) throw bad('Tên công ty không được để trống'); return v; },
  default_shift_id: (v) => { if (!q.get('SELECT 1 AS x FROM shifts WHERE id=?', Number(v))) throw bad('Ca mặc định không tồn tại'); return String(Number(v)); },
  allow_gps: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  allow_wifi: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  allow_qr: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  require_photo: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  bind_device: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  allow_face: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  face_liveness: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  face_threshold: (v) => { v = Number(v); range('Ngưỡng nhận diện khuôn mặt', 0.3, 0.7)(v); return String(Math.round(v * 100) / 100); },
  max_accuracy: (v) => { v = Number(v); range('Sai số GPS tối đa', 20, 1000)(v); return String(Math.round(v)); },
  min_gap_seconds: (v) => { v = Number(v); range('Khoảng cách giữa 2 lần chấm', 0, 3600)(v); return String(Math.round(v)); },
  full_day_ratio: (v) => { v = Number(v); range('Tỷ lệ đủ công', 0.5, 1)(v); return String(v); },
  half_day_ratio: (v) => { v = Number(v); range('Tỷ lệ nửa công', 0.1, 0.8)(v); return String(v); },
  std_days: (v) => { v = Number(v); range('Công chuẩn', 0, 31)(v); return String(v); },
  ot_multiplier: (v) => { v = Number(v); range('Hệ số OT', 1, 5)(v); return String(v); },
  ot_base_hours: (v) => { v = Number(v); range('Số giờ/ngày tính OT', 1, 24)(v); return String(v); },
  late_penalty_per_minute: (v) => { v = Number(v); range('Phạt đi muộn', 0, 1e6)(v); return String(Math.round(v)); },
  screensaver_on: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  screensaver_announce: (v) => (v === true || v === '1' || v === 1 ? '1' : '0'),
  screensaver_idle_min: (v) => { v = Number(v); if (!Number.isFinite(v)) throw bad('Số phút chờ không hợp lệ'); range('Số phút chờ trước khi vào màn hình chờ', 1, 240)(v); return String(Math.round(v)); },
  screensaver_slide_sec: (v) => { v = Number(v); if (!Number.isFinite(v)) throw bad('Số giây mỗi hình không hợp lệ'); range('Số giây mỗi hình', 3, 300)(v); return String(Math.round(v)); },
  public_url: (v) => { v = String(v || '').trim().replace(/\/+$/, ''); if (v && !/^https?:\/\/[^\s]+$/.test(v)) throw bad('Địa chỉ website phải bắt đầu bằng http:// hoặc https://'); return v; },
};

module.exports = (app) => {
  crud(app, '/api/departments', 'departments', { name: { required: true, label: 'Tên phòng ban' } }, { order: 'name COLLATE NOCASE', label: 'phòng ban' });

  crud(
    app,
    '/api/branches',
    'branches',
    {
      name: { required: true, label: 'Tên chi nhánh' },
      address: { label: 'Địa chỉ' },
      lat: { type: 'num', nullable: true, label: 'Vĩ độ', check: range('Vĩ độ', -90, 90) },
      lng: { type: 'num', nullable: true, label: 'Kinh độ', check: range('Kinh độ', -180, 180) },
      radius: { type: 'int', label: 'Bán kính', check: range('Bán kính', 10, 5000) },
      allowed_ips: { label: 'IP WiFi' },
      active: { type: 'bool' },
    },
    {
      label: 'chi nhánh',
      order: 'id',
      extra: () => newBranchSecrets(),
      list: (user) => q.all('SELECT * FROM branches ORDER BY id').map((b) => (user.role === 'admin' ? b : { ...b, qr_secret: undefined, kiosk_key: undefined })),
    }
  );
  app.post('/api/branches/:id/regen-key', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    if (!q.get('SELECT 1 AS x FROM branches WHERE id=?', id)) throw notFound();
    const s = newBranchSecrets();
    q.run('UPDATE branches SET qr_secret=?, kiosk_key=? WHERE id=?', s.qr_secret, s.kiosk_key, id);
    audit(req.user, 'Tạo lại liên kết màn hình QR', `chi nhánh #${id}`);
    res.json(q.get('SELECT * FROM branches WHERE id=?', id));
  });

  crud(
    app,
    '/api/shifts',
    'shifts',
    {
      name: { required: true, label: 'Tên ca' },
      start_time: { required: true, label: 'Giờ bắt đầu', check: hm('Giờ bắt đầu') },
      end_time: { required: true, label: 'Giờ kết thúc', check: hm('Giờ kết thúc') },
      break_minutes: { type: 'int', label: 'Nghỉ giữa ca', check: range('Nghỉ giữa ca', 0, 480) },
      late_grace: { type: 'int', label: 'Cho phép đi muộn', check: range('Cho phép đi muộn', 0, 120) },
      early_grace: { type: 'int', label: 'Cho phép về sớm', check: range('Cho phép về sớm', 0, 120) },
      work_days: { required: true, label: 'Ngày làm việc', check: (v) => { if (!/^[0-6](,[0-6])*$/.test(v)) throw bad('Ngày làm việc không hợp lệ'); } },
      active: { type: 'bool' },
    },
    {
      label: 'ca làm',
      order: 'start_time, id',
      onDelete: (id) => {
        if (String(id) === String(settings().default_shift_id)) throw bad('Không thể xoá ca mặc định. Hãy chọn ca mặc định khác trong Cài đặt trước.');
        return null;
      },
    }
  );

  crud(
    app,
    '/api/leave-types',
    'leave_types',
    {
      name: { required: true, label: 'Tên loại nghỉ' },
      paid: { type: 'bool' },
      deduct_balance: { type: 'bool' },
      active: { type: 'bool' },
    },
    {
      label: 'loại nghỉ',
      onDelete: (id) => {
        if (q.get('SELECT 1 AS x FROM requests WHERE leave_type_id=? LIMIT 1', id)) {
          q.run('UPDATE leave_types SET active=0 WHERE id=?', id);
          return { ok: true, deactivated: true };
        }
        return null;
      },
    }
  );

  crud(
    app,
    '/api/announcement-admin',
    'announcements',
    {
      title: { required: true, label: 'Tiêu đề' },
      body: { label: 'Nội dung' },
      pinned: { type: 'bool' },
      active: { type: 'bool' },
    },
    {
      label: 'thông báo',
      order: 'pinned DESC, id DESC',
      extra: (u) => ({ created_by: u.id, created_at: Date.now() }),
    }
  );

  // ---------- Nhân viên ----------
  app.get('/api/employees', auth('admin', 'manager'), (req, res) => {
    res.json(
      listEmployees(req.user, {
        all: req.query.all === '1',
        search: req.query.search || '',
        departmentId: req.query.department_id || null,
      })
    );
  });

  app.post('/api/employees', auth('admin'), (req, res) => {
    const b = req.body || {};
    const o = cleanEmp(b, false);
    if (q.get('SELECT 1 AS x FROM employees WHERE lower(code)=lower(?)', o.code)) throw bad('Mã nhân viên đã tồn tại');
    const pw = b.password ? String(b.password) : '123456';
    if (pw.length < 6) throw bad('Mật khẩu phải có ít nhất 6 ký tự');
    o.password_hash = hashPassword(pw);
    o.must_change_password = 1;
    o.created_at = Date.now();
    if (o.role === undefined) o.role = 'employee';
    if (o.track === undefined) o.track = 1;
    if (o.active === undefined) o.active = 1;
    const keys = Object.keys(o);
    const r = dbGuard(() => q.run(`INSERT INTO employees(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => o[k])));
    audit(req.user, 'Thêm nhân viên', `${o.code} - ${o.full_name}`);
    res.json(q.get(`${EMP_SELECT} WHERE e.id=?`, Number(r.lastInsertRowid)));
  });

  app.put('/api/employees/:id', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const cur = q.get('SELECT * FROM employees WHERE id=?', id);
    if (!cur) throw notFound('Không tìm thấy nhân viên');
    const o = cleanEmp(req.body || {}, true);
    if (o.code && o.code.toLowerCase() !== cur.code.toLowerCase() && q.get('SELECT 1 AS x FROM employees WHERE lower(code)=lower(?) AND id<>?', o.code, id)) throw bad('Mã nhân viên đã tồn tại');
    if (o.manager_id === id) throw bad('Không thể chọn chính mình làm quản lý');
    const newRole = o.role !== undefined ? o.role : cur.role;
    const newActive = o.active !== undefined ? o.active : cur.active;
    if (cur.role === 'admin' && cur.active && (newRole !== 'admin' || !newActive) && otherActiveAdmins(id) === 0) {
      throw bad('Phải còn ít nhất một quản trị viên đang hoạt động');
    }
    if (id === req.user.id && !newActive) throw bad('Bạn không thể tự khoá tài khoản của mình');
    const keys = Object.keys(o);
    if (keys.length) {
      const bump = newRole !== cur.role || newActive !== cur.active ? ', tv=tv+1' : '';
      dbGuard(() => q.run(`UPDATE employees SET ${keys.map((k) => `${k}=?`).join(',')}${bump} WHERE id=?`, ...keys.map((k) => o[k]), id));
    }
    audit(req.user, 'Sửa nhân viên', `${cur.code}`);
    res.json(q.get(`${EMP_SELECT} WHERE e.id=?`, id));
  });

  // Xoá nhân viên.
  //  - mặc định (DELETE /api/employees/:id): khoá tài khoản, giữ lịch sử chấm công
  //  - DELETE /api/employees/:id?permanent=1: xoá hẳn nhân viên cùng toàn bộ chấm công, đơn từ, ca làm của người đó
  app.del('/api/employees/:id', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const cur = q.get('SELECT * FROM employees WHERE id=?', id);
    if (!cur) throw notFound('Không tìm thấy nhân viên');
    const permanent = req.query.permanent === '1';
    const verb = permanent ? 'xoá' : 'khoá';
    if (id === req.user.id) throw bad(`Bạn không thể tự ${verb} tài khoản của mình`);
    if (cur.role === 'admin' && cur.active && otherActiveAdmins(id) === 0) throw bad('Phải còn ít nhất một quản trị viên đang hoạt động');
    if (!permanent) {
      q.run('UPDATE employees SET active=0, tv=tv+1 WHERE id=?', id);
      audit(req.user, 'Khoá nhân viên', cur.code);
      res.json({ ok: true });
      return;
    }
    const photos = q.all('SELECT photo FROM logs WHERE employee_id=? AND photo IS NOT NULL', id).map((r) => r.photo);
    tx(() => {
      // Các bảng schedules, logs, requests tự xoá theo (ON DELETE CASCADE); manager_id của cấp dưới tự về rỗng
      q.run('DELETE FROM employees WHERE id=?', id);
    });
    for (const rel of photos) {
      if (!/^\d{4}-\d{2}\/[\w.-]+$/.test(rel)) continue;
      try { fs.unlinkSync(path.join(C.DATA_DIR, 'photos', rel)); } catch { /* ảnh đã mất thì thôi */ }
    }
    audit(req.user, 'Xoá nhân viên', `${cur.code} - ${cur.full_name}`);
    res.json({ ok: true });
  });

  app.post('/api/employees/:id/reset-password', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const cur = q.get('SELECT * FROM employees WHERE id=?', id);
    if (!cur) throw notFound('Không tìm thấy nhân viên');
    const pw = req.body.password ? String(req.body.password) : randomPin(6);
    if (pw.length < 6) throw bad('Mật khẩu phải có ít nhất 6 ký tự');
    q.run('UPDATE employees SET password_hash=?, must_change_password=1, tv=tv+1 WHERE id=?', hashPassword(pw), id);
    audit(req.user, 'Đặt lại mật khẩu', cur.code);
    res.json({ ok: true, password: pw });
  });

  app.post('/api/employees/:id/reset-device', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const cur = q.get('SELECT * FROM employees WHERE id=?', id);
    if (!cur) throw notFound('Không tìm thấy nhân viên');
    q.run('UPDATE employees SET device_id=NULL WHERE id=?', id);
    audit(req.user, 'Gỡ liên kết thiết bị', cur.code);
    res.json({ ok: true });
  });

  // Nhập hàng loạt: rows = [{code, full_name, phone, department, position, base_salary, hired_date}]
  app.post('/api/employees/import', auth('admin'), (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) throw bad('Không có dòng dữ liệu nào');
    if (rows.length > 2000) throw bad('Tối đa 2000 dòng mỗi lần nhập');
    const created = [];
    const skipped = [];
    tx(() => {
      rows.forEach((r, i) => {
        const line = i + 1;
        try {
          const code = String(r.code || '').trim();
          const name = String(r.full_name || '').trim();
          if (!code || !name) throw new Error('Thiếu mã hoặc họ tên');
          if (q.get('SELECT 1 AS x FROM employees WHERE lower(code)=lower(?)', code)) throw new Error('Mã đã tồn tại');
          let deptId = null;
          const dn = String(r.department || '').trim();
          if (dn) {
            const d = q.get('SELECT id FROM departments WHERE lower(name)=lower(?)', dn);
            deptId = d ? d.id : Number(q.run('INSERT INTO departments(name) VALUES(?)', dn).lastInsertRowid);
          }
          const o = cleanEmp(
            {
              code, full_name: name, phone: r.phone || '', position: r.position || '', department_id: deptId,
              base_salary: Number(String(r.base_salary || '0').replace(/[^\d]/g, '')) || 0,
              hired_date: r.hired_date && U.isYmd(String(r.hired_date).trim()) ? String(r.hired_date).trim() : null,
            },
            false
          );
          o.password_hash = hashPassword(r.password ? String(r.password) : '123456');
          o.must_change_password = 1;
          o.created_at = Date.now();
          const keys = Object.keys(o);
          q.run(`INSERT INTO employees(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => o[k]));
          created.push(code);
        } catch (e) {
          skipped.push({ line, code: r.code || '', reason: e.message });
        }
      });
    });
    audit(req.user, 'Nhập nhân viên hàng loạt', `${created.length} thành công, ${skipped.length} bỏ qua`);
    res.json({ created: created.length, skipped });
  });

  // ---------- Xếp ca ----------
  app.get('/api/schedules', auth('admin', 'manager'), (req, res) => {
    const { from, to } = req.query;
    if (!U.isYmd(from) || !U.isYmd(to)) throw bad('Khoảng ngày không hợp lệ');
    if (U.dateList(from, to).length > 62) throw bad('Chỉ xem tối đa 62 ngày');
    const sc = teamWhere(req.user);
    res.json(
      q.all(
        `SELECT s.employee_id, s.work_date, s.shift_id FROM schedules s JOIN employees e ON e.id=s.employee_id
         WHERE s.work_date BETWEEN ? AND ? AND ${sc.sql}`,
        from, to, ...sc.params
      )
    );
  });

  // shift_id: số (id ca) | 'off' (nghỉ) | 'default' (theo ca mặc định của nhân viên)
  app.put('/api/schedules', auth('admin'), (req, res) => {
    const b = req.body || {};
    const ids = Array.isArray(b.employee_ids) ? b.employee_ids.map(Number).filter(Number.isFinite) : [];
    if (!ids.length) throw bad('Chưa chọn nhân viên');
    if (!U.isYmd(b.from) || !U.isYmd(b.to) || b.to < b.from) throw bad('Khoảng ngày không hợp lệ');
    const dows = Array.isArray(b.dows) && b.dows.length ? b.dows.map(Number) : null;
    const dates = U.dateList(b.from, b.to).filter((d) => !dows || dows.includes(U.dow(d)));
    if (ids.length * dates.length > 6000) throw bad('Quá nhiều ô cần cập nhật (tối đa 6000)');
    const sv = b.shift_id;
    if (sv !== 'off' && sv !== 'default' && !q.get('SELECT 1 AS x FROM shifts WHERE id=?', Number(sv))) throw bad('Ca làm không tồn tại');
    dbGuard(() =>
      tx(() => {
        for (const id of ids) {
          for (const d of dates) {
            if (sv === 'default') q.run('DELETE FROM schedules WHERE employee_id=? AND work_date=?', id, d);
            else {
              q.run(
                'INSERT INTO schedules(employee_id,work_date,shift_id) VALUES(?,?,?) ON CONFLICT(employee_id,work_date) DO UPDATE SET shift_id=excluded.shift_id',
                id, d, sv === 'off' ? null : Number(sv)
              );
            }
          }
        }
      })
    );
    audit(req.user, 'Xếp ca', `${ids.length} nhân viên, ${dates.length} ngày`);
    res.json({ ok: true, count: ids.length * dates.length });
  });

  // ---------- Ngày lễ ----------
  app.get('/api/holidays', auth(), (req, res) => {
    const year = String(req.query.year || new Date().getFullYear());
    res.json(q.all('SELECT * FROM holidays WHERE substr(date,1,4)=? ORDER BY date', year));
  });
  app.put('/api/holidays', auth('admin'), (req, res) => {
    const date = req.body.date;
    const name = String(req.body.name || '').trim();
    if (!U.isYmd(date)) throw bad('Ngày không hợp lệ');
    if (!name) throw bad('Vui lòng nhập tên ngày lễ');
    q.run('INSERT INTO holidays(date,name) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name', date, name);
    audit(req.user, 'Lưu ngày lễ', `${date} ${name}`);
    res.json({ date, name });
  });
  app.del('/api/holidays/:date', auth('admin'), (req, res) => {
    q.run('DELETE FROM holidays WHERE date=?', req.params.date);
    audit(req.user, 'Xoá ngày lễ', req.params.date);
    res.json({ ok: true });
  });
  // Chỉ thêm các ngày lễ dương lịch cố định; ngày âm lịch (Tết, Giỗ Tổ) và ngày nghỉ bù cần nhập tay hằng năm.
  app.post('/api/holidays/seed-vn', auth('admin'), (req, res) => {
    const year = Number(req.body.year) || new Date().getFullYear();
    const list = [
      [`${year}-01-01`, 'Tết Dương lịch'],
      [`${year}-04-30`, 'Ngày Giải phóng miền Nam'],
      [`${year}-05-01`, 'Ngày Quốc tế Lao động'],
      [`${year}-09-02`, 'Quốc khánh'],
    ];
    let n = 0;
    for (const [d, name] of list) n += q.run('INSERT OR IGNORE INTO holidays(date,name) VALUES(?,?)', d, name).changes;
    audit(req.user, 'Thêm ngày lễ dương lịch', `${year}`);
    res.json({ ok: true, added: n });
  });

  // ---------- Cài đặt ----------
  app.get('/api/settings', auth('admin'), (req, res) => {
    res.json(settings());
  });
  app.put('/api/settings', auth('admin'), (req, res) => {
    const b = req.body || {};
    const changed = [];
    for (const k of Object.keys(b)) {
      if (!(k in SET_RULES) || !(k in DEFAULT_SETTINGS)) continue;
      const v = SET_RULES[k](b[k]);
      setSetting(k, v);
      changed.push(k);
    }
    audit(req.user, 'Đổi cài đặt', changed.join(', '));
    res.json(settings());
  });

  // Giúp quản trị viên điền "IP WiFi công ty": hiện địa chỉ IP mà máy chủ nhìn thấy khi bạn đang dùng WiFi đó
  app.get('/api/my-ip', auth('admin'), (req, res) => {
    res.json({ ip: req.ip });
  });

  // ---------- Logo công ty ----------
  // Xem logo: công khai (hiện ở màn hình đăng nhập, app, màn hình QR)
  app.get('/api/logo', (req, res) => {
    const row = q.get("SELECT mime, data FROM assets WHERE name='logo'");
    if (!row) throw notFound('Chưa có logo');
    res.send(Buffer.from(row.data), row.mime, 200, { 'Cache-Control': 'public, max-age=31536000, immutable' });
  });

  const MAGIC = {
    'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  };
  app.put('/api/logo', auth('admin'), (req, res) => {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.data) || ''));
    if (!m) throw bad('Logo phải là ảnh PNG, JPG hoặc WebP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1024 * 1024) throw bad('Logo quá lớn (tối đa 1 MB)');
    if (!MAGIC[m[1]](buf)) throw bad('Nội dung file không phải ảnh hợp lệ');
    const ver = String(Date.now());
    tx(() => {
      q.run("INSERT INTO assets(name,mime,data,updated_at) VALUES('logo',?,?,?) ON CONFLICT(name) DO UPDATE SET mime=excluded.mime, data=excluded.data, updated_at=excluded.updated_at", m[1], buf, Date.now());
      setSetting('logo_version', ver);
    });
    audit(req.user, 'Đổi logo công ty', `${Math.round(buf.length / 1024)} KB`);
    res.json({ ok: true, logo: logoUrl({ logo_version: ver }) });
  });

  app.del('/api/logo', auth('admin'), (req, res) => {
    tx(() => {
      q.run("DELETE FROM assets WHERE name='logo'");
      setSetting('logo_version', '');
    });
    audit(req.user, 'Xoá logo công ty');
    res.json({ ok: true, logo: '' });
  });

  // ---------- Hình ảnh màn hình chờ (kiosk) ----------
  const MAX_SCREEN_IMAGES = 20;
  const screenImgUrl = (token) => `/api/screensaver/img/${token}`;
  // Xem ảnh: công khai nhưng địa chỉ chứa mã ngẫu nhiên không đoán được; mã đổi khi ảnh bị xoá và tải lại
  app.get('/api/screensaver/img/:token', (req, res) => {
    const row = q.get('SELECT mime, data FROM screen_images WHERE token=?', String(req.params.token));
    if (!row) throw notFound('Không có hình này');
    res.send(Buffer.from(row.data), row.mime, 200, { 'Cache-Control': 'public, max-age=31536000, immutable' });
  });
  app.get('/api/screensaver-images', auth('admin'), (req, res) => {
    res.json(q.all('SELECT id, token, length(data) AS size, created_at FROM screen_images ORDER BY id').map((x) => ({ id: x.id, size: x.size, created_at: x.created_at, url: screenImgUrl(x.token) })));
  });
  app.post('/api/screensaver-images', auth('admin'), (req, res) => {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body && req.body.data) || ''));
    if (!m) throw bad('Hình phải là ảnh PNG, JPG hoặc WebP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 3 * 1024 * 1024) throw bad('Hình quá lớn (tối đa 3 MB)');
    if (!MAGIC[m[1]](buf)) throw bad('Nội dung file không phải ảnh hợp lệ');
    const id = tx(() => {
      if (q.get('SELECT COUNT(*) AS n FROM screen_images').n >= MAX_SCREEN_IMAGES) throw bad(`Tối đa ${MAX_SCREEN_IMAGES} hình. Hãy xoá bớt hình cũ trước khi thêm.`);
      return q.run('INSERT INTO screen_images(token,mime,data,created_at) VALUES(?,?,?,?)', randomToken(12), m[1], buf, Date.now()).lastInsertRowid;
    });
    audit(req.user, 'Thêm hình màn hình chờ', `${Math.round(buf.length / 1024)} KB`);
    const row = q.get('SELECT id, token, length(data) AS size, created_at FROM screen_images WHERE id=?', Number(id));
    res.json({ id: row.id, size: row.size, created_at: row.created_at, url: screenImgUrl(row.token) });
  });
  app.del('/api/screensaver-images/:id', auth('admin'), (req, res) => {
    const r = q.run('DELETE FROM screen_images WHERE id=?', Number(req.params.id));
    if (!r.changes) throw notFound('Không có hình này');
    audit(req.user, 'Xoá hình màn hình chờ', `#${req.params.id}`);
    res.json({ ok: true });
  });

  app.get('/api/audit', auth('admin'), (req, res) => {
    res.json(q.all('SELECT * FROM audit ORDER BY id DESC LIMIT 200'));
  });
};

module.exports.makeCleaner = makeCleaner;
