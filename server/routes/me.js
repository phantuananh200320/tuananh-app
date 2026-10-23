'use strict';
// API dành cho nhân viên (app chấm công)
const fs = require('fs');
const path = require('path');
const C = require('../config');
const { q, settings, logoUrl } = require('../db');
const U = require('../lib/util');
const { HttpError, bad } = require('../lib/http');
const { auth } = require('../auth');
const { computeRange, standardDays } = require('../calc');
const { leaveBalance } = require('../leave');
const { verifyCode } = require('./kiosk');

const OPEN_WINDOW = 20 * 3600 * 1000; // giờ vào "mở" trong vòng 20 giờ (hỗ trợ ca đêm)

function openIn(userId, now) {
  const last = q.get('SELECT * FROM logs WHERE employee_id=? ORDER BY ts DESC, id DESC LIMIT 1', userId);
  return last && last.type === 'in' && now - last.ts < OPEN_WINDOW ? last : null;
}

function wfhToday(userId, date) {
  return !!q.get("SELECT 1 AS x FROM requests WHERE employee_id=? AND type='wfh' AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1", userId, date, date);
}

function parseQr(text) {
  const s = String(text || '').trim();
  let m = s.match(/#\/scan\/(\d+)\/(\d{6})/);
  if (m) return { branchId: Number(m[1]), code: m[2] };
  m = s.match(/^ACK\|(\d+)\|(\d{6})$/);
  if (m) return { branchId: Number(m[1]), code: m[2] };
  m = s.match(/^(\d{6})$/);
  if (m) return { branchId: null, code: m[1] };
  return null;
}

// Xác thực vị trí/hình thức chấm công. Trả về { method, branch_id }.
function verifyLocation(u, S, b, ip, date) {
  if (u.allow_remote || wfhToday(u.id, date)) return { method: 'remote', branch_id: u.branch_id || null };

  const branches = q.all(`SELECT * FROM branches WHERE active=1${u.branch_id ? ' AND id=?' : ''}`, ...(u.branch_id ? [u.branch_id] : []));

  if (b.method === 'qr' || b.qr) {
    if (S.allow_qr !== '1') throw new HttpError(403, 'Chấm công bằng QR đang bị tắt', 'QR_DISABLED');
    const p = parseQr(b.qr);
    if (!p) throw new HttpError(400, 'Mã QR không hợp lệ', 'QR_INVALID');
    const cand = p.branchId ? branches.filter((x) => x.id === p.branchId) : branches;
    const hit = cand.find((x) => verifyCode(x, p.code));
    if (!hit) throw new HttpError(400, 'Mã QR không đúng hoặc đã hết hạn. Hãy quét lại mã đang hiển thị tại điểm chấm công.', 'QR_INVALID');
    return { method: 'qr', branch_id: hit.id };
  }

  const ipBranches = branches.filter((x) => x.allowed_ips && x.allowed_ips.trim());
  const geoBranches = branches.filter((x) => x.lat !== null && x.lng !== null);
  if (!ipBranches.length && !geoBranches.length) return { method: 'open', branch_id: u.branch_id || null };

  if (S.allow_wifi === '1') {
    const hit = ipBranches.find((x) => U.ipAllowed(ip, x.allowed_ips));
    if (hit) return { method: 'wifi', branch_id: hit.id };
  }

  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const hasGps = b.lat !== undefined && b.lat !== null && b.lng !== undefined && b.lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  if (S.allow_gps === '1' && geoBranches.length) {
    if (!hasGps) throw new HttpError(400, 'Chưa lấy được vị trí. Hãy bật GPS/định vị cho trình duyệt hoặc quét mã QR tại chi nhánh.', 'NO_GPS');
    const acc = Number(b.accuracy) || 0;
    const maxAcc = Number(S.max_accuracy) || 150;
    if (acc > maxAcc) throw new HttpError(400, `Tín hiệu GPS yếu (sai số ±${Math.round(acc)}m). Hãy ra nơi thoáng hơn hoặc quét mã QR.`, 'GPS_WEAK');
    let best = null;
    for (const br of geoBranches) {
      const d = U.distM(lat, lng, br.lat, br.lng);
      if (!best || d < best.d) best = { br, d };
    }
    if (best.d <= best.br.radius) return { method: 'gps', branch_id: best.br.id };
    throw new HttpError(403, `Bạn đang cách "${best.br.name}" khoảng ${Math.round(best.d)}m (cho phép trong ${best.br.radius}m). Hãy đến đúng nơi làm việc hoặc quét mã QR.`, 'OUTSIDE');
  }
  throw new HttpError(403, 'Không xác định được vị trí hợp lệ. Hãy kết nối WiFi công ty hoặc quét mã QR.', 'LOCATION_FAILED');
}

function savePhoto(empId, ts, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Ảnh chụp không hợp lệ');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw bad('Ảnh quá lớn');
  const d = new Date(ts);
  const sub = `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}`;
  const dir = path.join(C.DATA_DIR, 'photos', sub);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${empId}_${ts}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return `${sub}/${name}`;
}

module.exports = (app) => {
  app.get('/api/me/today', auth(), (req, res) => {
    const u = req.user;
    const S = settings();
    const t = U.today();
    const now = Date.now();
    const day = computeRange([u], t, t).get(u.id).days[0];
    const logs = q.all('SELECT id, ts, type, method, branch_id FROM logs WHERE employee_id=? AND work_date=? ORDER BY ts', u.id, t);
    const open = openIn(u.id, now);
    const branches = q.all('SELECT id, name, address, lat, lng, radius FROM branches WHERE active=1');
    const announcements = q.all('SELECT id, title, body, pinned, created_at FROM announcements WHERE active=1 ORDER BY pinned DESC, id DESC LIMIT 5');
    res.json({
      date: t,
      now,
      day,
      logs,
      open_in: open ? { ts: open.ts, work_date: open.work_date } : null,
      next_type: open ? 'out' : 'in',
      remote: !!u.allow_remote || day.wfh,
      settings: {
        company_name: S.company_name,
        logo: logoUrl(S),
        require_photo: S.require_photo === '1',
        allow_gps: S.allow_gps === '1',
        allow_wifi: S.allow_wifi === '1',
        allow_qr: S.allow_qr === '1',
        bind_device: S.bind_device === '1',
      },
      branches,
      announcements,
      balance: leaveBalance(u, new Date().getFullYear()),
    });
  });

  app.post('/api/me/checkin', auth(), (req, res) => {
    const u = req.user;
    const S = settings();
    const b = req.body || {};
    const now = Date.now();
    const date = U.today();

    const deviceId = String(b.device_id || '').slice(0, 100) || null;
    if (S.bind_device === '1') {
      if (!deviceId) throw new HttpError(400, 'Thiếu mã thiết bị', 'NO_DEVICE');
      if (!u.device_id) q.run('UPDATE employees SET device_id=? WHERE id=?', deviceId, u.id);
      else if (u.device_id !== deviceId) throw new HttpError(403, 'Tài khoản đã gắn với điện thoại khác. Hãy liên hệ quản trị để đổi thiết bị.', 'DEVICE_MISMATCH');
    }

    const last = q.get('SELECT ts FROM logs WHERE employee_id=? ORDER BY ts DESC LIMIT 1', u.id);
    const gap = Number(S.min_gap_seconds) || 0;
    if (last && now - last.ts < gap * 1000) {
      throw new HttpError(429, `Bạn vừa chấm công, vui lòng đợi ${Math.ceil((gap * 1000 - (now - last.ts)) / 1000)} giây`, 'TOO_FAST');
    }

    const open = openIn(u.id, now);
    const type = b.type === 'in' || b.type === 'out' ? b.type : open ? 'out' : 'in';
    if (type === 'out' && !open) throw new HttpError(400, 'Bạn chưa chấm giờ vào. Hãy tạo đơn "Giải trình chấm công" để bổ sung.', 'NO_OPEN_IN');
    if (type === 'in' && open) throw new HttpError(400, `Bạn đã chấm vào lúc ${U.hhmm(open.ts)}. Hãy chấm giờ ra trước.`, 'ALREADY_IN');

    const v = verifyLocation(u, S, b, req.ip, date);
    if (S.require_photo === '1' && !b.photo) throw new HttpError(400, 'Cần chụp ảnh khuôn mặt để chấm công', 'PHOTO_REQUIRED');
    const photo = b.photo ? savePhoto(u.id, now, b.photo) : null;
    const workDate = type === 'out' ? open.work_date : date;
    const lat = Number.isFinite(Number(b.lat)) && b.lat !== null && b.lat !== '' ? Number(b.lat) : null;
    const lng = Number.isFinite(Number(b.lng)) && b.lng !== null && b.lng !== '' ? Number(b.lng) : null;
    const acc = Number.isFinite(Number(b.accuracy)) && b.accuracy !== null && b.accuracy !== '' ? Number(b.accuracy) : null;

    q.run(
      `INSERT INTO logs(employee_id,ts,work_date,type,method,branch_id,lat,lng,accuracy,ip,photo,device_id,note)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      u.id, now, workDate, type, v.method, v.branch_id, lat, lng, acc, req.ip, photo, deviceId, String(b.note || '').slice(0, 200)
    );

    const day = computeRange([u], workDate, workDate).get(u.id).days[0];
    let message = type === 'in' ? `Đã chấm công VÀO lúc ${U.hhmm(now)}` : `Đã chấm công RA lúc ${U.hhmm(now)}`;
    if (type === 'in' && day.late_min > 0) message += ` (đi muộn ${day.late_min} phút)`;
    if (type === 'out' && day.early_min > 0) message += ` (về sớm ${day.early_min} phút)`;
    res.json({ ok: true, type, ts: now, time: U.hhmm(now), method: v.method, message, day });
  });

  app.get('/api/me/month', auth(), (req, res) => {
    const month = req.query.month || U.currentMonth();
    if (!U.isMonth(month)) throw bad('Tháng không hợp lệ');
    const { from, to } = U.monthRange(month);
    const r = computeRange([req.user], from, to).get(req.user.id);
    res.json({ month, standard_days: standardDays(month), days: r.days, summary: r.summary });
  });

  app.get('/api/me/day', auth(), (req, res) => {
    const date = req.query.date;
    if (!U.isYmd(date)) throw bad('Ngày không hợp lệ');
    const logs = q.all('SELECT id, ts, type, method, note FROM logs WHERE employee_id=? AND work_date=? ORDER BY ts', req.user.id, date);
    const day = computeRange([req.user], date, date).get(req.user.id).days[0];
    res.json({ date, day, logs });
  });

  app.get('/api/me/balance', auth(), (req, res) => {
    res.json(leaveBalance(req.user, Number(req.query.year) || new Date().getFullYear()));
  });

  app.get('/api/announcements', auth(), (req, res) => {
    res.json(q.all('SELECT id, title, body, pinned, created_at FROM announcements WHERE active=1 ORDER BY pinned DESC, id DESC LIMIT 50'));
  });

  // Nhân viên chỉ thấy loại nghỉ đang dùng; quản trị/quản lý thêm ?all=1 để xem cả loại đã ẩn
  app.get('/api/leave-types', auth(), (req, res) => {
    const all = req.query.all === '1' && req.user.role !== 'employee';
    res.json(q.all(`SELECT id, name, paid, deduct_balance, active FROM leave_types ${all ? '' : 'WHERE active=1'} ORDER BY id`));
  });
};

module.exports.openIn = openIn;
module.exports.savePhoto = savePhoto;
