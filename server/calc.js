'use strict';
// Bộ máy tính công: từ log chấm công + ca + đơn từ + ngày lễ -> trạng thái từng ngày, tổng hợp tháng, lương.
const { q, settings } = require('./db');
const U = require('./lib/util');

function parseWorkDays(s) {
  return new Set(String(s || '').split(',').map((x) => Number(x.trim())).filter((x) => x >= 0 && x <= 6));
}

function loadShifts() {
  const m = new Map();
  for (const s of q.all('SELECT * FROM shifts')) {
    s._wd = parseWorkDays(s.work_days);
    m.set(s.id, s);
  }
  return m;
}

// Công chuẩn của tháng: cài tay (std_days > 0) hoặc tự đếm số ngày làm việc theo ca mặc định.
function standardDays(month, S = settings()) {
  const n = Number(S.std_days) || 0;
  if (n > 0) return n;
  const { from, to } = U.monthRange(month);
  const def = q.get('SELECT work_days FROM shifts WHERE id=?', Number(S.default_shift_id)) || { work_days: '1,2,3,4,5,6' };
  const wd = parseWorkDays(def.work_days);
  return U.dateList(from, to).filter((d) => wd.has(U.dow(d))).length || 26;
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

const inList = (ids) => ids.map(() => '?').join(',');

// Ngày làm việc (có ca, không phải ngày lễ) của 1 nhân viên trong khoảng.
function workingDates(emp, from, to) {
  const S = settings();
  const shifts = loadShifts();
  const def = shifts.get(Number(S.default_shift_id)) || null;
  const sch = new Map(
    q.all('SELECT * FROM schedules WHERE employee_id=? AND work_date BETWEEN ? AND ?', emp.id, from, to).map((r) => [r.work_date, r])
  );
  const hol = new Set(q.all('SELECT date FROM holidays WHERE date BETWEEN ? AND ?', from, to).map((h) => h.date));
  const out = [];
  for (const d of U.dateList(from, to)) {
    if (hol.has(d)) continue;
    let shift;
    const o = sch.get(d);
    if (o) shift = o.shift_id ? shifts.get(o.shift_id) : null;
    else {
      const s = shifts.get(emp.shift_id) || def;
      shift = s && s._wd.has(U.dow(d)) ? s : null;
    }
    if (shift) out.push(d);
  }
  return out;
}

/**
 * Tính từng ngày cho danh sách nhân viên trong [from, to].
 * Trả về Map(employeeId -> { days: [...], summary: {...} })
 */
function computeRange(emps, from, to, opts = {}) {
  const out = new Map();
  if (!emps.length) return out;
  const S = opts.settings || settings();
  const shifts = loadShifts();
  const defShift = shifts.get(Number(S.default_shift_id)) || null;
  const ids = emps.map((e) => e.id);
  const ph = inList(ids);

  const logs = groupBy(
    q.all(`SELECT * FROM logs WHERE work_date BETWEEN ? AND ? AND employee_id IN (${ph}) ORDER BY ts, id`, from, to, ...ids),
    (l) => `${l.employee_id}|${l.work_date}`
  );
  const sch = new Map(
    q.all(`SELECT * FROM schedules WHERE work_date BETWEEN ? AND ? AND employee_id IN (${ph})`, from, to, ...ids)
      .map((r) => [`${r.employee_id}|${r.work_date}`, r])
  );
  const reqs = groupBy(
    q.all(
      `SELECT r.*, COALESCE(lt.paid,1) AS paid FROM requests r LEFT JOIN leave_types lt ON lt.id=r.leave_type_id
       WHERE r.status='approved' AND r.type IN ('leave','trip','wfh','ot') AND r.start_date<=? AND r.end_date>=? AND r.employee_id IN (${ph})`,
      to, from, ...ids
    ),
    (r) => r.employee_id
  );
  const hol = new Map(q.all('SELECT * FROM holidays WHERE date BETWEEN ? AND ?', from, to).map((h) => [h.date, h.name]));

  const todayStr = U.today();
  const fullR = Number(S.full_day_ratio) || 0.9;
  const halfR = Number(S.half_day_ratio) || 0.4;
  const dates = U.dateList(from, to);

  for (const e of emps) {
    const myReq = reqs.get(e.id) || [];
    const days = [];
    for (const date of dates) {
      const dw = U.dow(date);
      let shift;
      const o = sch.get(`${e.id}|${date}`);
      if (o) shift = o.shift_id ? shifts.get(o.shift_id) || null : null;
      else {
        const s = shifts.get(e.shift_id) || defShift;
        shift = s && s._wd.has(dw) ? s : null;
      }

      const dl = logs.get(`${e.id}|${date}`) || [];
      const firstIn = dl.find((l) => l.type === 'in') || null;
      let lastOut = null;
      if (firstIn) for (const l of dl) if (l.type === 'out' && l.ts > firstIn.ts) lastOut = l;
      const holiday = hol.get(date) || null;
      const leave = myReq.find((r) => r.type === 'leave' && r.start_date <= date && r.end_date >= date) || null;
      const trip = myReq.some((r) => r.type === 'trip' && r.start_date <= date && r.end_date >= date);
      const wfh = myReq.some((r) => r.type === 'wfh' && r.start_date <= date && r.end_date >= date);
      const otHours = myReq.filter((r) => r.type === 'ot' && r.start_date === date).reduce((a, r) => a + (r.hours || 0), 0);
      const leaveFrac = leave ? (leave.start_date === leave.end_date && leave.session !== 'full' ? 0.5 : 1) : 0;

      let sched = 0;
      let worked = 0;
      let late = 0;
      let early = 0;
      let credit = 0;
      let overnight = false;
      if (shift) {
        const s = U.hmToMin(shift.start_time);
        const en = U.hmToMin(shift.end_time);
        overnight = en <= s;
        const dur = overnight ? en + 1440 - s : en - s;
        sched = Math.max(30, dur - shift.break_minutes);
      }
      if (firstIn && lastOut) {
        const span = Math.round((lastOut.ts - firstIn.ts) / 60000);
        worked = Math.max(0, span - (shift && span >= 300 ? shift.break_minutes : 0));
      }
      if (shift && firstIn && leaveFrac === 0) {
        const diff = Math.round((firstIn.ts - U.tsAt(date, shift.start_time)) / 60000);
        late = diff > shift.late_grace ? diff : 0;
      }
      if (shift && lastOut && leaveFrac === 0) {
        const endMs = U.tsAt(date, shift.end_time) + (overnight ? 86400000 : 0);
        const diff = Math.round((endMs - lastOut.ts) / 60000);
        early = diff > shift.early_grace ? diff : 0;
      }
      if (shift && firstIn && lastOut && leaveFrac < 1) {
        const scale = 1 - leaveFrac;
        if (worked >= sched * scale * fullR) credit = scale;
        else if (leaveFrac === 0 && worked >= sched * halfR) credit = 0.5;
      }

      const paidLeave = leave && leave.paid ? leaveFrac : 0;
      const unpaidLeave = leave && !leave.paid ? leaveFrac : 0;
      const holidayPaid = holiday && shift ? 1 : 0;
      const tripPaid = trip && shift ? 1 : 0;
      const hired = !e.hired_date || date >= e.hired_date;

      let status;
      if (!hired) status = 'n/a';
      else if (holiday) status = 'holiday';
      else if (trip && shift) status = 'trip';
      else if (leaveFrac === 1) status = leave.paid ? 'leave' : 'unpaid_leave';
      else if (!shift) status = 'off';
      else if (date > todayStr) status = 'future';
      else if (!firstIn) {
        if (leaveFrac > 0) status = leave.paid ? 'half_leave' : 'half_unpaid';
        else if (dl.length) status = 'missing_in';
        else status = date === todayStr ? 'pending' : 'absent';
      } else if (!lastOut) status = date === todayStr ? 'working' : 'missing_out';
      else if (credit === 0) status = 'short';
      else if (credit === 0.5 && leaveFrac === 0) status = 'half';
      else status = late > 0 && early > 0 ? 'late_early' : late > 0 ? 'late' : early > 0 ? 'early' : 'present';

      const total = hired ? Math.min(1, holidayPaid + paidLeave + tripPaid + credit) : 0;

      days.push({
        date,
        dow: dw,
        status,
        shift: shift ? { id: shift.id, name: shift.name, start: shift.start_time, end: shift.end_time } : null,
        first_in: firstIn ? firstIn.ts : null,
        last_out: lastOut ? lastOut.ts : null,
        worked_min: worked,
        sched_min: sched,
        late_min: late,
        early_min: early,
        ot_hours: otHours,
        credit,
        paid_leave: paidLeave,
        unpaid_leave: unpaidLeave,
        total,
        holiday,
        wfh,
        log_count: dl.length,
      });
    }
    out.set(e.id, { days, summary: summarize(days) });
  }
  return out;
}

function summarize(days) {
  const s = {
    paid_days: 0, work_days: 0, leave_days: 0, unpaid_leave_days: 0, holiday_days: 0, trip_days: 0,
    absent_days: 0, incomplete_days: 0, late_count: 0, late_minutes: 0, early_count: 0, early_minutes: 0,
    ot_hours: 0, worked_hours: 0,
  };
  for (const d of days) {
    s.paid_days += d.total;
    s.work_days += d.credit;
    s.leave_days += d.paid_leave;
    s.unpaid_leave_days += d.unpaid_leave;
    if (d.status === 'holiday' && d.shift) s.holiday_days += 1;
    if (d.status === 'trip') s.trip_days += 1;
    if (d.status === 'absent') s.absent_days += 1;
    if (['missing_in', 'missing_out', 'short'].includes(d.status)) s.incomplete_days += 1;
    if (d.late_min > 0) {
      s.late_count += 1;
      s.late_minutes += d.late_min;
    }
    if (d.early_min > 0) {
      s.early_count += 1;
      s.early_minutes += d.early_min;
    }
    s.ot_hours += d.ot_hours;
    s.worked_hours += d.worked_min / 60;
  }
  for (const k of ['paid_days', 'work_days', 'leave_days', 'unpaid_leave_days', 'ot_hours', 'worked_hours']) s[k] = Math.round(s[k] * 100) / 100;
  return s;
}

// Lương đơn giản: lương theo công + OT + phụ cấp - phạt đi muộn. Chưa gồm BHXH/thuế TNCN.
function payrollFor(emp, summary, std, S = settings()) {
  const base = emp.base_salary || 0;
  const allowance = emp.allowance || 0;
  const perDay = std ? base / std : 0;
  const salaryDays = Math.round(perDay * summary.paid_days);
  const otRate = (perDay / (Number(S.ot_base_hours) || 8)) * (Number(S.ot_multiplier) || 1.5);
  const otPay = Math.round(otRate * summary.ot_hours);
  const lateFine = Math.round((Number(S.late_penalty_per_minute) || 0) * summary.late_minutes);
  return {
    base_salary: base,
    allowance,
    std_days: std,
    paid_days: summary.paid_days,
    salary_by_days: salaryDays,
    ot_hours: summary.ot_hours,
    ot_pay: otPay,
    late_minutes: summary.late_minutes,
    late_fine: lateFine,
    net: salaryDays + otPay + allowance - lateFine,
  };
}

module.exports = { computeRange, summarize, payrollFor, standardDays, workingDates, loadShifts, parseWorkDays };
