'use strict';
const { q, settings, audit, logoUrl } = require('../db');
const { HttpError, bad } = require('../lib/http');
const { checkPassword, hashPassword } = require('../lib/security');
const { auth, publicUser, issueToken, issuePhotoToken, loginGuard, loginFail, loginOk } = require('../auth');

module.exports = (app) => {
  // Thông tin công khai cho màn hình đăng nhập
  app.get('/api/public-info', (req, res) => {
    const S = settings();
    res.json({ company_name: S.company_name, logo: logoUrl(S), version: require('../updater').version(), tz: process.env.TZ || 'Asia/Ho_Chi_Minh' });
  });

  app.post('/api/auth/login', (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) throw bad('Vui lòng nhập tài khoản và mật khẩu');
    const key = `${req.ip}|${username.toLowerCase()}`;
    loginGuard(key);
    const u = q.get(
      `SELECT * FROM employees WHERE active=1 AND (lower(code)=lower(?) OR (phone<>'' AND phone=?)) ORDER BY (lower(code)=lower(?)) DESC LIMIT 1`,
      username, username, username
    );
    if (!u || !checkPassword(password, u.password_hash)) {
      loginFail(key);
      throw new HttpError(401, 'Sai tài khoản hoặc mật khẩu', 'BAD_CREDENTIALS');
    }
    loginOk(key);
    res.json({ token: issueToken(u), user: publicUser(u) });
  });

  app.get('/api/auth/me', auth(), (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  app.post('/api/auth/change-password', auth(), (req, res) => {
    const oldPw = String(req.body.old_password || '');
    const newPw = String(req.body.new_password || '');
    if (!checkPassword(oldPw, req.user.password_hash)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng', 'BAD_PASSWORD');
    if (newPw.length < 6) throw bad('Mật khẩu mới phải có ít nhất 6 ký tự');
    if (newPw === oldPw) throw bad('Mật khẩu mới phải khác mật khẩu cũ');
    q.run('UPDATE employees SET password_hash=?, must_change_password=0, tv=tv+1 WHERE id=?', hashPassword(newPw), req.user.id);
    const u = q.get('SELECT * FROM employees WHERE id=?', req.user.id);
    audit(u, 'Đổi mật khẩu');
    res.json({ token: issueToken(u), user: publicUser(u) });
  });

  // Token ngắn hạn để xem ảnh chấm công (thẻ <img> không gửi được header Authorization)
  app.get('/api/photo-token', auth('admin', 'manager'), (req, res) => {
    res.json({ token: issuePhotoToken(req.user) });
  });
};
