#!/usr/bin/env node
'use strict';
// Sao lưu cơ sở dữ liệu SQLite khi server đang chạy (không cần dừng).
//   node scripts/backup.js                  -> data/backups/chamcong-YYYYMMDD-HHMMSS.db
//   node scripts/backup.js --keep=30        -> giữ 30 bản mới nhất (mặc định 14, 0 = giữ hết)
//   node scripts/backup.js --out=/mnt/nas   -> ghi sang thư mục khác
// Ảnh chấm công nằm ở data/photos — sao lưu riêng bằng rsync/tar nếu bạn bật chụp ảnh.
const fs = require('fs');
const path = require('path');
const C = require('../server/config');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const dbFile = path.join(C.DATA_DIR, 'chamcong.db');
if (!fs.existsSync(dbFile)) {
  console.error(`Không tìm thấy cơ sở dữ liệu: ${dbFile}\nKiểm tra biến DATA_DIR.`);
  process.exit(1);
}

const { backupTo } = require('../server/db');

const outDir = path.resolve(arg('out', process.env.BACKUP_DIR || path.join(C.DATA_DIR, 'backups')));
const keep = Number(arg('keep', process.env.BACKUP_KEEP || 14));
fs.mkdirSync(outDir, { recursive: true });

const p = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
let dest = path.join(outDir, `chamcong-${stamp}.db`);
for (let i = 2; fs.existsSync(dest); i++) dest = path.join(outDir, `chamcong-${stamp}-${i}.db`);

backupTo(dest);
const mb = (fs.statSync(dest).size / 1048576).toFixed(2);
console.log(`Đã sao lưu: ${dest} (${mb} MB)`);

if (keep > 0) {
  const old = fs.readdirSync(outDir).filter((f) => /^chamcong-\d{8}-\d{6}(-\d+)?\.db$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) {
    fs.unlinkSync(path.join(outDir, f));
    console.log(`Xoá bản cũ: ${f}`);
  }
}
process.exit(0);
