#!/usr/bin/env node
'use strict';
// Đóng gói bản cập nhật từ thư mục mã hiện tại:  node scripts/make-update.js [--notes="Nội dung thay đổi"] [--sign=update-private.pem] [--out=dist]
// Tạo ra  dist/chamcong-update-<phiên bản>.tgz  để tải lên ở Cài đặt, Cập nhật ứng dụng.
// Trước khi đóng gói hãy TĂNG số "version" trong package.json (gói cùng phiên bản với bản đang chạy sẽ bị từ chối).
const fs = require('fs');
const path = require('path');
const pkg = require('../server/lib/pkg');

const ROOT = path.resolve(__dirname, '..');
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : ''; };
const outDir = path.resolve(arg('out') || path.join(ROOT, 'dist'));

const files = [];
function walk(rel) {
  const full = path.join(ROOT, rel);
  const st = fs.statSync(full);
  if (st.isDirectory()) {
    if (['node_modules', 'data', 'dist', '.git'].includes(path.basename(rel))) return;
    for (const n of fs.readdirSync(full).sort()) walk(rel ? rel + '/' + n : n);
  } else if (pkg.allowed(rel) && !/\.tmp-\d+$/.test(rel)) {
    files.push({ path: rel, data: fs.readFileSync(full) });
  }
}
for (const d of ['server', 'public', 'scripts', 'deploy']) if (fs.existsSync(path.join(ROOT, d))) walk(d);
for (const f of ['package.json', 'README.md', '.env.example', 'Dockerfile', 'docker-compose.yml', '.dockerignore', ...pkg.LAUNCH_FILES]) if (fs.existsSync(path.join(ROOT, f))) walk(f);

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const manifest = pkg.makeManifest(files, { version, notes: arg('notes') });
const mbuf = Buffer.from(JSON.stringify(manifest, null, 2));
const entries = [{ path: pkg.MANIFEST, data: mbuf }];
if (arg('sign')) entries.push({ path: pkg.SIG, data: Buffer.from(pkg.sign(mbuf, fs.readFileSync(arg('sign'), 'utf8'))) });
entries.push(...files);

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `chamcong-update-${version}.tgz`);
const gz = pkg.tarWrite(entries);
fs.writeFileSync(out, gz);
console.log(`Đã tạo ${out}`);
console.log(`  Phiên bản ${version}, ${files.length} tệp, ${Math.round(gz.length / 1024)} KB, ${arg('sign') ? 'ĐÃ ký' : 'chưa ký'}`);
console.log(`  sha256: ${pkg.sha256(gz)}`);
