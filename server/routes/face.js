'use strict';
// Chấm công bằng nhận diện khuôn mặt tại màn hình QR (/kiosk/).
// Trình duyệt dùng face-api.js tính "vector khuôn mặt" (128 số) rồi gửi lên đây; MÁY CHỦ so khớp với các mẫu đã đăng ký.
// Vector của nhân viên không bao giờ được gửi xuống màn hình kiosk, nên kiosk không tự khai được "tôi là ai".
const fs = require('fs');
const path = require('path');
const C = require('../config');
const { q, settings, audit } = require('../db');
const U = require('../lib/util');
const { HttpError, bad, notFound } = require('../lib/http');
const { auth } = require('../auth');
const { computeRange } = require('../calc');
const { EMP_SELECT } = require('../scope');
const { openIn, savePhoto } = require('./me');

const DIM = 128;
const MAX_SAMPLES = 5;
const AMBIGUOUS_MARGIN = 0.03; // hai người gần giống nhau hơn mức này thì từ chối, tránh chấm nhầm

// Các file cần có (tải bằng: node scripts/get-face-models.js)
const LIB = 'vendor/face-api.min.js';
const MANIFESTS = ['tiny_face_detector_model-weights_manifest.json', 'face_landmark_68_tiny_model-weights_manifest.json', 'face_recognition_model-weights_manifest.json'];

let assetCache = { at: 0, val: null };
function assets() {
  if (assetCache.val && Date.now() - assetCache.at < 15000) return assetCache.val;
  const missing = [];
  const need = (rel) => { if (!fs.existsSync(path.join(C.PUBLIC_DIR, rel))) missing.push(rel); };
  need(LIB);
  for (const m of MANIFESTS) {
    const p = path.join(C.PUBLIC_DIR, 'models', m);
    if (!fs.existsSync(p)) { missing.push('models/' + m); continue; }
    try {
      for (const g of JSON.parse(fs.readFileSync(p, 'utf8'))) for (const f of g.paths || []) need('models/' + f);
    } catch { missing.push('models/' + m + ' (hỏng)'); }
  }
  assetCache = { at: Date.now(), val: { ready: missing.length === 0, missing } };
  return assetCache.val;
}

function cleanDescriptor(d) {
  if (!Array.isArray(d) || d.length !== DIM) throw bad('Dữ liệu khuôn mặt không hợp lệ');
  const out = d.map(Number);
  if (out.some((x) => !Number.isFinite(x) || Math.abs(x) > 5)) throw bad('Dữ liệu khuôn mặt không hợp lệ');
  return out;
}
function dist(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) { const t = a[i] - b[i]; s += t * t; }
  return Math.sqrt(s);
}

// Giới hạn số lần thử theo địa chỉ IP (chống dò khuôn mặt bằng cách gửi hàng loạt vector)
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now > h.reset) { hits.set(ip, { n: 1, reset: now + 60000 }); return; }
  if (++h.n > 90) throw new HttpError(429, 'Gửi quá nhiều yêu cầu, hãy đợi một phút', 'RATE_LIMIT');
}

// Tìm nhân viên khớp nhất. Trả về { emp_id, d } hoặc ném lỗi.
function match(descriptor, threshold) {
  const rows = q.all(`SELECT f.employee_id, f.descriptor FROM face_templates f JOIN employees e ON e.id=f.employee_id WHERE e.active=1 AND e.track=1`);
  const best = new Map();
  for (const r of rows) {
    let v;
    try { v = JSON.parse(r.descriptor); } catch { continue; }
    const d = dist(descriptor, v);
    if (!best.has(r.employee_id) || d < best.get(r.employee_id)) best.set(r.employee_id, d);
  }
  const ranked = [...best.entries()].map(([id, d]) => ({ id, d })).sort((a, b) => a.d - b.d);
  if (!ranked.length || ranked[0].d > threshold) throw new HttpError(404, 'Không nhận ra khuôn mặt. Hãy thử lại hoặc quét mã QR.', 'FACE_UNKNOWN');
  if (ranked[1] && ranked[1].d <= threshold && ranked[1].d - ranked[0].d < AMBIGUOUS_MARGIN) {
    throw new HttpError(409, 'Chưa phân biệt được khuôn mặt. Hãy nhìn thẳng vào camera hoặc quét mã QR.', 'FACE_AMBIGUOUS');
  }
  return ranked[0];
}

module.exports = (app) => {
  // Trạng thái thư viện nhận diện (trang Cài đặt dùng để nhắc cài)
  app.get('/api/face/assets', auth('admin'), (req, res) => res.json(assets()));

  // Đăng ký (thay thế) mẫu khuôn mặt của một nhân viên. Bắt buộc có xác nhận nhân viên đã đồng ý.
  app.post('/api/employees/:id/faces', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const emp = q.get('SELECT id, code, full_name FROM employees WHERE id=?', id);
    if (!emp) throw notFound('Không tìm thấy nhân viên');
    const b = req.body || {};
    if (b.consent !== true) throw bad('Cần xác nhận nhân viên đã đồng ý cho thu thập dữ liệu khuôn mặt');
    if (!Array.isArray(b.descriptors) || !b.descriptors.length || b.descriptors.length > MAX_SAMPLES) throw bad(`Cần từ 1 đến ${MAX_SAMPLES} mẫu khuôn mặt`);
    const list = b.descriptors.map(cleanDescriptor);
    const now = Date.now();
    q.exec('BEGIN IMMEDIATE');
    try {
      q.run('DELETE FROM face_templates WHERE employee_id=?', id);
      for (const d of list) q.run('INSERT INTO face_templates(employee_id,descriptor,created_at,created_by) VALUES(?,?,?,?)', id, JSON.stringify(d.map((x) => Math.round(x * 1e6) / 1e6)), now, req.user.id);
      q.exec('COMMIT');
    } catch (e) { try { q.exec('ROLLBACK'); } catch { /* đã rollback */ } throw e; }
    audit(req.user, 'Đăng ký khuôn mặt', `${emp.code} - ${emp.full_name}: ${list.length} mẫu, nhân viên đã đồng ý`);
    res.json({ ok: true, face_count: list.length });
  });

  app.del('/api/employees/:id/faces', auth('admin'), (req, res) => {
    const id = Number(req.params.id);
    const emp = q.get('SELECT code, full_name FROM employees WHERE id=?', id);
    if (!emp) throw notFound('Không tìm thấy nhân viên');
    q.run('DELETE FROM face_templates WHERE employee_id=?', id);
    audit(req.user, 'Xoá dữ liệu khuôn mặt', `${emp.code} - ${emp.full_name}`);
    res.json({ ok: true, face_count: 0 });
  });

  // Màn hình QR gửi vector khuôn mặt vừa chụp để chấm công
  app.post('/api/kiosk/face', (req, res) => {
    rateLimit(req.ip);
    const b = req.body || {};
    const br = b.key ? q.get('SELECT * FROM branches WHERE kiosk_key=? AND active=1', String(b.key)) : null;
    if (!br) throw new HttpError(404, 'Liên kết màn hình chấm công không hợp lệ', 'BAD_KIOSK');
    const S = settings();
    if (S.allow_face !== '1') throw new HttpError(403, 'Chấm công bằng khuôn mặt đang tắt', 'FACE_DISABLED');
    const descriptor = cleanDescriptor(b.descriptor);
    const hit = match(descriptor, Number(S.face_threshold) || 0.5);

    const emp = q.get(`${EMP_SELECT} WHERE e.id=?`, hit.id);
    if (emp.branch_id && emp.branch_id !== br.id) throw new HttpError(403, `${emp.full_name} được giao chấm công ở chi nhánh khác`, 'OTHER_BRANCH');

    const now = Date.now();
    const gap = (Number(S.min_gap_seconds) || 0) * 1000;
    const last = q.get('SELECT ts FROM logs WHERE employee_id=? ORDER BY ts DESC LIMIT 1', emp.id);
    if (last && now - last.ts < gap) {
      res.json({ ok: false, code: 'TOO_FAST', name: emp.full_name, message: `${emp.full_name} vừa chấm công lúc ${U.hhmm(last.ts)}` });
      return;
    }

    const date = U.today();
    const open = openIn(emp.id, now);
    const type = open ? 'out' : 'in';
    const workDate = open ? open.work_date : date;
    let photo = null;
    if (b.photo) { try { photo = savePhoto(emp.id, now, b.photo); } catch { photo = null; } } // ảnh chỉ để đối chiếu, lỗi ảnh không chặn chấm công
    q.run(
      `INSERT INTO logs(employee_id,ts,work_date,type,method,branch_id,ip,photo,note) VALUES(?,?,?,?,?,?,?,?,?)`,
      emp.id, now, workDate, type, 'face', br.id, req.ip, photo, `Nhận diện khuôn mặt (độ lệch ${hit.d.toFixed(2)})`
    );
    const day = computeRange([emp], workDate, workDate).get(emp.id).days[0];
    let message = type === 'in' ? `Vào ca lúc ${U.hhmm(now)}` : `Ra ca lúc ${U.hhmm(now)}`;
    if (type === 'in' && day.late_min > 0) message += ` (đi muộn ${day.late_min} phút)`;
    if (type === 'out' && day.early_min > 0) message += ` (về sớm ${day.early_min} phút)`;
    res.json({ ok: true, name: emp.full_name, type, time: U.hhmm(now), message, distance: Math.round(hit.d * 1000) / 1000 });
  });
};

module.exports.assets = assets;
