'use strict';
// Màn hình chấm công tại chi nhánh: mã QR + mã 6 số tự đổi mỗi 30 giây.
const crypto = require('crypto');
const C = require('../config');
const { q, settings, logoUrl } = require('../db');
const QR = require('../lib/qr');
const { HttpError } = require('../lib/http');
const U = require('../lib/util');

const WIN = 30000;

function codeFor(secret, w) {
  const h = crypto.createHmac('sha256', secret).update(String(w)).digest();
  return String(h.readUInt32BE(h.length - 4) % 1000000).padStart(6, '0');
}
function currentCode(branch) {
  const now = Date.now();
  return { code: codeFor(branch.qr_secret, Math.floor(now / WIN)), expires_in: WIN - (now % WIN) };
}
// Chấp nhận mã hiện tại và 2 chu kỳ trước (tối đa ~90 giây) để bù độ trễ khi quét
function verifyCode(branch, code) {
  const w = Math.floor(Date.now() / WIN);
  return [w, w - 1, w - 2].some((x) => codeFor(branch.qr_secret, x) === String(code));
}

function baseUrl(req, S) {
  if (S.public_url) return S.public_url.replace(/\/+$/, '');
  if (C.PUBLIC_URL) return C.PUBLIC_URL;
  const proto = C.TRUST_PROXY && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0].trim() : 'http';
  return `${proto}://${req.headers.host}`;
}

// Cấu hình màn hình chờ gửi kèm trạng thái kiosk: hình, thông báo và thời gian. null = đã tắt.
function screensaverFor(S) {
  if (S.screensaver_on !== '1') return null;
  const images = q.all('SELECT token FROM screen_images ORDER BY id').map((x) => `/api/screensaver/img/${x.token}`);
  const announcements = S.screensaver_announce === '1'
    ? q.all('SELECT title, body FROM announcements WHERE active=1 ORDER BY pinned DESC, id DESC LIMIT 5')
    : [];
  return {
    idle_ms: Math.max(1, Number(S.screensaver_idle_min) || 5) * 60000,
    slide_ms: Math.max(3, Number(S.screensaver_slide_sec) || 8) * 1000,
    images,
    announcements,
  };
}

module.exports = (app) => {
  app.get('/api/kiosk/state', (req, res) => {
    const key = String(req.query.key || '');
    const br = key ? q.get('SELECT * FROM branches WHERE kiosk_key=? AND active=1', key) : null;
    if (!br) throw new HttpError(404, 'Liên kết màn hình chấm công không hợp lệ', 'BAD_KIOSK');
    const S = settings();
    const { code, expires_in } = currentCode(br);
    const url = `${baseUrl(req, S)}/cc/#/scan/${br.id}/${code}`;
    const recent = q.all(
      `SELECT e.full_name, l.ts, l.type FROM logs l JOIN employees e ON e.id=l.employee_id
       WHERE l.branch_id=? AND l.work_date=? ORDER BY l.ts DESC LIMIT 8`,
      br.id, U.today()
    );
    res.json({
      company: S.company_name,
      logo: logoUrl(S),
      // Chỉ bật khung nhận diện khi quản trị đã bật và thư viện đã được cài
      face: S.allow_face === '1' && require('./face').assets().ready,
      face_liveness: S.face_liveness === '1',
      branch: br.name,
      code,
      expires_in,
      url,
      svg: QR.toSvg(QR.encode(url), { margin: 2 }),
      now: Date.now(),
      recent,
      screensaver: screensaverFor(S),
    });
  });
};

module.exports.verifyCode = verifyCode;
module.exports.currentCode = currentCode;
