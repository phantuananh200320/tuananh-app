'use strict';
const { q } = require('./db');

// Số ngày phép năm còn lại (đơn chờ duyệt cũng được giữ chỗ)
function leaveBalance(emp, year) {
  const y = String(year);
  const sum = (status) =>
    q.get(
      `SELECT COALESCE(SUM(r.days),0) AS d FROM requests r JOIN leave_types lt ON lt.id=r.leave_type_id
       WHERE r.employee_id=? AND r.type='leave' AND lt.deduct_balance=1 AND r.status=? AND substr(r.start_date,1,4)=?`,
      emp.id, status, y
    ).d;
  const used = sum('approved');
  const pending = sum('pending');
  const total = emp.annual_leave || 0;
  return { year: Number(year), total, used, pending, remaining: Math.round((total - used - pending) * 100) / 100 };
}

module.exports = { leaveBalance };
