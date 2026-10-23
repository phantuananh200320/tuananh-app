'use strict';
// JWT (HS256) và băm mật khẩu (scrypt) chỉ dùng thư viện có sẵn của Node.
const crypto = require('crypto');

const b64u = (x) => Buffer.from(x).toString('base64url');

function signJwt(payload, secret, ttlSec) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec }));
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expect = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  let got;
  try { got = Buffer.from(s, 'base64url'); } catch { return null; }
  if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
  try {
    const pl = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!pl.exp || pl.exp < Date.now() / 1000) return null;
    return pl;
  } catch {
    return null;
  }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function checkPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return test.length === orig.length && crypto.timingSafeEqual(test, orig);
}

const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString('hex');
const randomPin = (n = 6) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');

module.exports = { signJwt, verifyJwt, hashPassword, checkPassword, randomToken, randomPin };
