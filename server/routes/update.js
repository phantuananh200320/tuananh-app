'use strict';
// Cập nhật phiên bản ứng dụng ngay trong giao diện quản trị (xem server/updater.js).
// Bật sẵn: quản trị viên tải file lên là cập nhật (phải nhập lại mật khẩu để xác nhận). Tắt hẳn bằng ALLOW_ONLINE_UPDATE=0.
const { q, audit } = require('../db');
const { HttpError, bad } = require('../lib/http');
const { checkPassword } = require('../lib/security');
const { auth } = require('../auth');
const U = require('../updater');

const fails = new Map(); // userId -> { n, reset }: giới hạn đoán mật khẩu xác nhận

function confirmPassword(req) {
  const f = fails.get(req.user.id);
  if (f && Date.now() < f.reset && f.n >= 5) throw new HttpError(429, 'Nhập sai mật khẩu quá nhiều lần, hãy thử lại sau 10 phút', 'RATE_LIMIT');
  const row = q.get('SELECT password_hash FROM employees WHERE id=?', req.user.id);
  const pw = String((req.body && req.body.password) || '');
  if (!row || !pw || !checkPassword(pw, row.password_hash)) {
    const cur = f && Date.now() < f.reset ? f : { n: 0, reset: Date.now() + 10 * 60 * 1000 };
    cur.n++; fails.set(req.user.id, cur);
    throw new HttpError(403, 'Mật khẩu xác nhận không đúng', 'BAD_PASSWORD');
  }
  fails.delete(req.user.id);
}
function needEnabled() {
  if (!U.enabled()) throw new HttpError(403, 'Cập nhật trên web đang bị tắt (ALLOW_ONLINE_UPDATE=0). Xoá dòng đó trong file .env rồi chạy lại phần mềm để bật.', 'UPDATE_DISABLED');
}

module.exports = (app) => {
  // Công khai: các trang so số phiên bản này để biết khi nào cần tải lại giao diện
  app.get('/api/version', (req, res) => res.json({ version: U.version(), started_at: U.status().started_at }));

  app.get('/api/update/status', auth('admin'), (req, res) => res.json(U.status()));

  // Tải gói lên để xem trước: chưa thay đổi gì trên hệ thống
  app.post('/api/update/upload', auth('admin'), (req, res) => {
    needEnabled();
    if (!req.raw || !req.raw.length) throw bad('Chưa chọn file');
    const plan = U.stage(req.raw);
    audit(req.user, 'Tải gói cập nhật lên', `${plan.current} -> ${plan.version}, ${plan.total} tệp thay đổi`);
    res.json(plan);
  });

  app.post('/api/update/apply', auth('admin'), (req, res) => {
    needEnabled();
    confirmPassword(req);
    const b = req.body || {};
    const r = U.apply({ user: req.user, token: String(b.token || ''), allowDowngrade: b.allow_downgrade === true });
    audit(req.user, 'Cập nhật phiên bản', `${r.from} -> ${r.version}, ${r.changed} tệp, ${r.hot_reloaded ? 'nạp nóng' : r.restarted ? 'tự khởi động lại' : 'cần khởi động lại thủ công'}`);
    res.json(r);
  });

  app.post('/api/update/rollback', auth('admin'), (req, res) => {
    needEnabled();
    confirmPassword(req);
    const r = U.rollback({ user: req.user });
    audit(req.user, 'Quay lại phiên bản trước', `${r.from} -> ${r.version}`);
    res.json(r);
  });
};
