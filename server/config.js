'use strict';
// Múi giờ phải đặt TRƯỚC khi dùng Date. Mặc định giờ Việt Nam; đổi bằng biến APP_TZ (ví dụ Asia/Bangkok).
process.env.TZ = process.env.APP_TZ || 'Asia/Ho_Chi_Minh';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(path.join(DATA_DIR, 'photos'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

function loadSecret() {
  const env = process.env.JWT_SECRET;
  if (env && env.length >= 16) return env;
  const file = path.join(DATA_DIR, '.jwt_secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 16) return s;
  } catch { /* chưa có */ }
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

module.exports = {
  ROOT,
  DATA_DIR,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  // Đặt TRUST_PROXY=1 khi chạy sau Caddy/Nginx để lấy đúng IP người dùng
  TRUST_PROXY: ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase()),
  JWT_SECRET: loadSecret(),
  TOKEN_TTL: 60 * 60 * 24 * 30, // 30 ngày (app điện thoại)
  ADMIN_CODE: process.env.ADMIN_CODE || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  PUBLIC_URL: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
};
