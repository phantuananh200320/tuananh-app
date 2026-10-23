'use strict';
// Phạm vi dữ liệu theo vai trò: admin xem tất cả, quản lý chỉ xem nhân viên thuộc quyền.
const { q } = require('./db');

function teamWhere(user) {
  if (user.role === 'admin') return { sql: '1=1', params: [] };
  return {
    sql: '(e.id=? OR e.manager_id=? OR (e.department_id IS NOT NULL AND e.department_id=?))',
    params: [user.id, user.id, user.department_id || -1],
  };
}

const EMP_SELECT = `
  SELECT e.id, e.code, e.full_name, e.phone, e.email, e.role, e.department_id, e.branch_id, e.shift_id, e.manager_id,
         e.position, e.base_salary, e.allowance, e.annual_leave, e.allow_remote, e.track, e.hired_date, e.note, e.active,
         e.must_change_password, (e.device_id IS NOT NULL) AS device_bound,
         (SELECT COUNT(*) FROM face_templates f WHERE f.employee_id=e.id) AS face_count,
         d.name AS dept_name, b.name AS branch_name, s.name AS shift_name, m.full_name AS manager_name
  FROM employees e
  LEFT JOIN departments d ON d.id=e.department_id
  LEFT JOIN branches b ON b.id=e.branch_id
  LEFT JOIN shifts s ON s.id=e.shift_id
  LEFT JOIN employees m ON m.id=e.manager_id`;

function listEmployees(user, { all = false, search = '', departmentId = null, employeeId = null, tracked = false } = {}) {
  const sc = teamWhere(user);
  const where = [sc.sql];
  const params = [...sc.params];
  if (!all) where.push('e.active=1');
  if (tracked) where.push('e.track=1');
  if (departmentId) {
    where.push('e.department_id=?');
    params.push(Number(departmentId));
  }
  if (employeeId) {
    where.push('e.id=?');
    params.push(Number(employeeId));
  }
  if (search) {
    where.push('(lower(e.full_name) LIKE ? OR lower(e.code) LIKE ? OR e.phone LIKE ?)');
    const like = `%${String(search).toLowerCase()}%`;
    params.push(like, like, `%${search}%`);
  }
  return q.all(`${EMP_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.code COLLATE NOCASE`, ...params);
}

module.exports = { teamWhere, listEmployees, EMP_SELECT };
