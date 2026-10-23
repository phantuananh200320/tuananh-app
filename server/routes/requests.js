'use strict';
// Đơn từ: nghỉ phép, làm thêm giờ (OT), công tác, làm việc từ xa (WFH), giải trình chấm công.
const { q, tx, audit } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { auth } = require('../auth');
const { workingDates } = require('../calc');
const { leaveBalance } = require('../leave');

const TYPES = ['leave', 'ot', 'trip', 'wfh', 'explain'];

function canApprove(user, emp) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager' || emp.id === user.id) return false;
  return emp.manager_id === user.id || (!!user.department_id && emp.department_id === user.department_id);
}

// Điều kiện phạm vi người duyệt (alias e = employees)
function scopeSql(user) {
  if (user.role === 'admin') return { sql: '1=1', params: [] };
  return {
    sql: 'e.id<>? AND (e.manager_id=? OR (e.department_id IS NOT NULL AND e.department_id=?))',
    params: [user.id, user.id, user.department_id || -1],
  };
}

const SELECT_REQ = `
  SELECT r.*, e.code AS emp_code, e.full_name AS emp_name, e.department_id, d.name AS dept_name,
         lt.name AS leave_name, lt.paid AS leave_paid, a.full_name AS approver_name
  FROM requests r
  JOIN employees e ON e.id=r.employee_id
  LEFT JOIN departments d ON d.id=e.department_id
  LEFT JOIN leave_types lt ON lt.id=r.leave_type_id
  LEFT JOIN employees a ON a.id=r.approver_id`;

function overlapExists(empId, types, start, end, excludeId = 0) {
  return !!q.get(
    `SELECT 1 AS x FROM requests WHERE employee_id=? AND type IN (${types.map(() => '?').join(',')}) AND status IN ('pending','approved')
     AND start_date<=? AND end_date>=? AND id<>? LIMIT 1`,
    empId, ...types, end, start, excludeId
  );
}

module.exports = (app) => {
  app.post('/api/requests', auth(), (req, res) => {
    const u = req.user;
    const b = req.body || {};
    const type = b.type;
    if (!TYPES.includes(type)) throw bad('Loại đơn không hợp lệ');
    const reason = String(b.reason || '').trim().slice(0, 500);
    const start = b.start_date;
    const end = b.end_date || b.start_date;
    if (!U.isYmd(start) || !U.isYmd(end)) throw bad('Ngày không hợp lệ');
    if (end < start) throw bad('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu');
    if (U.dateList(start, end).length > 120) throw bad('Khoảng thời gian quá dài');

    let leaveTypeId = null;
    let session = 'full';
    let hours = null;
    let inTime = null;
    let outTime = null;
    let days = 0;

    if (type === 'leave') {
      const lt = q.get('SELECT * FROM leave_types WHERE id=? AND active=1', Number(b.leave_type_id));
      if (!lt) throw bad('Vui lòng chọn loại nghỉ');
      leaveTypeId = lt.id;
      session = start === end && ['am', 'pm'].includes(b.session) ? b.session : 'full';
      const wd = workingDates(u, start, end).length;
      if (!wd) throw bad('Khoảng thời gian chọn không có ngày làm việc nào');
      days = wd * (session === 'full' ? 1 : 0.5);
      if (overlapExists(u.id, ['leave', 'trip'], start, end)) throw bad('Bạn đã có đơn nghỉ/công tác trùng thời gian này');
      if (lt.deduct_balance) {
        const bal = leaveBalance(u, Number(start.slice(0, 4)));
        if (days > bal.remaining) throw bad(`Bạn chỉ còn ${bal.remaining} ngày phép năm (đã tính cả đơn đang chờ duyệt)`);
      }
    } else if (type === 'trip') {
      days = workingDates(u, start, end).length;
      if (!days) throw bad('Khoảng thời gian chọn không có ngày làm việc nào');
      if (overlapExists(u.id, ['leave', 'trip'], start, end)) throw bad('Bạn đã có đơn nghỉ/công tác trùng thời gian này');
    } else if (type === 'wfh') {
      days = workingDates(u, start, end).length;
      if (!days) throw bad('Khoảng thời gian chọn không có ngày làm việc nào');
      if (overlapExists(u.id, ['wfh'], start, end)) throw bad('Bạn đã có đơn làm việc từ xa trùng thời gian này');
    } else if (type === 'ot') {
      if (start !== end) throw bad('Đơn làm thêm giờ chỉ áp dụng cho 1 ngày');
      hours = Number(b.hours);
      if (!Number.isFinite(hours) || hours < 0.5 || hours > 12) throw bad('Số giờ làm thêm phải từ 0.5 đến 12');
      hours = Math.round(hours * 2) / 2;
      days = 0;
    } else if (type === 'explain') {
      if (start !== end) throw bad('Giải trình chấm công chỉ áp dụng cho 1 ngày');
      if (start > U.today()) throw bad('Không thể giải trình cho ngày trong tương lai');
      inTime = b.in_time || null;
      outTime = b.out_time || null;
      if (!inTime && !outTime) throw bad('Vui lòng nhập giờ vào và/hoặc giờ ra cần bổ sung');
      if ((inTime && !U.isHm(inTime)) || (outTime && !U.isHm(outTime))) throw bad('Giờ không hợp lệ (định dạng HH:MM)');
      if (!reason) throw bad('Vui lòng nhập lý do giải trình');
    }

    const r = q.run(
      `INSERT INTO requests(employee_id,type,leave_type_id,start_date,end_date,session,hours,in_time,out_time,days,reason,status,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
      u.id, type, leaveTypeId, start, end, session, hours, inTime, outTime, days, reason, Date.now()
    );
    res.json(q.get(`${SELECT_REQ} WHERE r.id=?`, Number(r.lastInsertRowid)));
  });

  app.get('/api/requests/mine', auth(), (req, res) => {
    const rows = q.all(`${SELECT_REQ} WHERE r.employee_id=? ORDER BY r.id DESC LIMIT 100`, req.user.id);
    res.json(rows);
  });

  app.post('/api/requests/:id/cancel', auth(), (req, res) => {
    const r = q.get('SELECT * FROM requests WHERE id=? AND employee_id=?', Number(req.params.id), req.user.id);
    if (!r) throw notFound('Không tìm thấy đơn');
    if (r.status !== 'pending') throw bad('Chỉ có thể huỷ đơn đang chờ duyệt');
    q.run("UPDATE requests SET status='cancelled', decided_at=? WHERE id=?", Date.now(), r.id);
    res.json({ ok: true });
  });

  // Danh sách đơn cho người duyệt
  app.get('/api/requests', auth('admin', 'manager'), (req, res) => {
    const sc = scopeSql(req.user);
    const where = [sc.sql];
    const params = [...sc.params];
    if (req.query.status) {
      where.push('r.status=?');
      params.push(String(req.query.status));
    }
    if (req.query.type) {
      where.push('r.type=?');
      params.push(String(req.query.type));
    }
    if (req.query.employee_id) {
      where.push('r.employee_id=?');
      params.push(Number(req.query.employee_id));
    }
    if (U.isMonth(req.query.month)) {
      const { from, to } = U.monthRange(req.query.month);
      where.push('r.start_date<=? AND r.end_date>=?');
      params.push(to, from);
    }
    res.json(q.all(`${SELECT_REQ} WHERE ${where.join(' AND ')} ORDER BY (r.status='pending') DESC, r.id DESC LIMIT 500`, ...params));
  });

  app.get('/api/requests/pending-count', auth('admin', 'manager'), (req, res) => {
    const sc = scopeSql(req.user);
    const r = q.get(`SELECT COUNT(*) AS n FROM requests r JOIN employees e ON e.id=r.employee_id WHERE r.status='pending' AND ${sc.sql}`, ...sc.params);
    res.json({ count: r.n });
  });

  function decide(status) {
    return (req, res) => {
      const r = q.get('SELECT * FROM requests WHERE id=?', Number(req.params.id));
      if (!r) throw notFound('Không tìm thấy đơn');
      if (r.status !== 'pending') throw bad('Đơn này đã được xử lý');
      const emp = q.get('SELECT * FROM employees WHERE id=?', r.employee_id);
      if (!canApprove(req.user, emp)) throw new HttpError(403, 'Bạn không có quyền duyệt đơn này', 'FORBIDDEN');
      const note = String(req.body.note || '').trim().slice(0, 300);
      tx(() => {
        q.run('UPDATE requests SET status=?, approver_id=?, approver_note=?, decided_at=? WHERE id=?', status, req.user.id, note, Date.now(), r.id);
        if (status === 'approved' && r.type === 'explain') {
          const ins = (type, ts) =>
            q.run(
              `INSERT INTO logs(employee_id,ts,work_date,type,method,note,created_by) VALUES(?,?,?,?, 'manual', ?, ?)`,
              r.employee_id, ts, r.start_date, type, `Giải trình #${r.id}`, req.user.id
            );
          if (r.in_time) ins('in', U.tsAt(r.start_date, r.in_time));
          if (r.out_time) {
            let ts = U.tsAt(r.start_date, r.out_time);
            if (r.in_time && ts <= U.tsAt(r.start_date, r.in_time)) ts += 86400000; // ca đêm
            ins('out', ts);
          }
        }
      });
      audit(req.user, status === 'approved' ? 'Duyệt đơn' : 'Từ chối đơn', `#${r.id} ${r.type} - ${emp.code}`);
      res.json(q.get(`${SELECT_REQ} WHERE r.id=?`, r.id));
    };
  }
  app.post('/api/requests/:id/approve', auth('admin', 'manager'), decide('approved'));
  app.post('/api/requests/:id/reject', auth('admin', 'manager'), decide('rejected'));
};

module.exports.scopeSql = scopeSql;
module.exports.canApprove = canApprove;
