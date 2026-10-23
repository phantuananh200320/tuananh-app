'use strict';
const C = require('./config');
const { q } = require('./db');
const { signJwt, verifyJwt } = require('./lib/security');
const { HttpError } = require('./lib/http');

function publicUser(u) {
  if (!u) return null;
  // eslint-disable-next-line no-unused-vars
  const { password_hash, tv, device_id, ...rest } = u;
  return { ...rest, device_bound: !!device_id };
}

const issueToken = (u) => signJwt({ id: u.id, v: u.tv }, C.JWT_SECRET, C.TOKEN_TTL);
const issuePhotoToken = (u) => signJwt({ ph: 1, id: u.id }, C.JWT_SECRET, 1800);

// Middleware: auth() = chỉ cần đăng nhập, auth('admin','manager') = giới hạn vai trò
function auth(...roles) {
  return (req) => {
    const h = String(req.headers.authorization || '');
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const p = token ? verifyJwt(token, C.JWT_SECRET) : null;
    if (!p || !p.id || p.ph) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', 'UNAUTHORIZED');
    const u = q.get('SELECT * FROM employees WHERE id=? AND active=1', p.id);
    if (!u || u.tv !== p.v) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại', 'UNAUTHORIZED');
    if (roles.length && !roles.includes(u.role)) throw new HttpError(403, 'Bạn không có quyền thực hiện thao tác này', 'FORBIDDEN');
    req.user = u;
  };
}

// Chặn dò mật khẩu: tối đa 8 lần sai / 10 phút cho mỗi (IP + tài khoản)
const attempts = new Map();
const LIMIT = 8;
const WINDOW = 10 * 60 * 1000;
function loginGuard(key) {
  const now = Date.now();
  if (attempts.size > 5000) for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  const a = attempts.get(key);
  if (a && a.reset > now && a.count >= LIMIT) throw new HttpError(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 10 phút.', 'RATE_LIMIT');
}
function loginFail(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) attempts.set(key, { count: 1, reset: now + WINDOW });
  else a.count += 1;
}
const loginOk = (key) => attempts.delete(key);

module.exports = { publicUser, issueToken, issuePhotoToken, auth, loginGuard, loginFail, loginOk };
