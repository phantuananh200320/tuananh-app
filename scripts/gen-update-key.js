#!/usr/bin/env node
'use strict';
// Tạo cặp khoá ký gói cập nhật (Ed25519):  node scripts/gen-update-key.js [update-private.pem]
// - File khoá riêng: CHỈ giữ trên máy của người đóng gói, dùng với  make-update.js --sign=...
// - Dòng UPDATE_PUBLIC_KEY=...: đặt vào môi trường của ứng dụng. Từ đó chỉ nhận gói có chữ ký đúng,
//   nên dù tài khoản quản trị bị lộ, kẻ xấu cũng không thể đưa mã lạ lên máy chủ.
const fs = require('fs');
const path = require('path');
const { generateKeyPairSync } = require('crypto');

const out = path.resolve(process.argv[2] || 'update-private.pem');
if (fs.existsSync(out)) { console.error(`File ${out} đã tồn tại, không ghi đè. Hãy chọn tên khác.`); process.exit(1); }
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(`Khoá riêng đã lưu ở ${out} (đừng đưa lên máy chủ hay kho mã).`);
console.log('\nThêm dòng này vào .env / biến môi trường của ứng dụng:\n');
console.log('UPDATE_PUBLIC_KEY=' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
