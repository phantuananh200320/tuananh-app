#!/usr/bin/env node
'use strict';
// Đóng gói phát hành: node scripts/make-release.js [--notes="..."] [--sign=update-private.pem]
// Tạo trong dist/:
//   chamcong-<phiên bản>-cai-dat.zip     gói cài đặt đầy đủ (Windows, Linux, macOS): giải nén rồi chạy start.bat / install-linux.sh
//   chamcong-<phiên bản>-cai-dat.tar.gz  như trên, dạng tar.gz cho máy chủ Linux (giữ quyền chạy của .sh)
//   chamcong-update-<phiên bản>.tgz      file cập nhật: tải lên ở Hệ thống, Cập nhật phần mềm
//   SHA256SUMS.txt                       mã kiểm tra các file trên
// Không chứa dữ liệu (thư mục data), không chứa .env. Không cần thư viện ngoài.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const TOP = 'chamcong';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const SKIP_DIRS = new Set(['node_modules', 'data', 'dist', '.git', '.github', '.vscode', '.idea']);
const SKIP_FILES = /(^|\/)(\.env|\.DS_Store|Thumbs\.db|.*\.tmp-\d+|.*\.log)$/;
const EXEC = /(\.sh|^start\.js)$/;

// ---------- danh sách tệp ----------
const files = [];
function collect() { files.length = 0; walk(''); return files; }
function walk(rel) {
  const full = path.join(ROOT, rel);
  const st = fs.statSync(full);
  if (st.isDirectory()) {
    if (rel && SKIP_DIRS.has(path.basename(rel))) return;
    for (const n of fs.readdirSync(full).sort()) walk(rel ? rel + '/' + n : n);
  } else if (!SKIP_FILES.test(rel)) {
    files.push({ rel, data: fs.readFileSync(full), mtime: st.mtime, exec: EXEC.test(rel) });
  }
}
module.exports = { collect, makeZip: (l) => makeZip(l), makeTarGz: (l) => makeTarGz(l) };
if (require.main !== module) return;
collect();
for (const need of ['start.js', 'start.bat', 'start.sh', 'install-linux.sh', 'INSTALL.md', 'package.json', 'server/index.js']) {
  if (!files.some((f) => f.rel === need)) { console.error('Thiếu tệp bắt buộc: ' + need); process.exit(1); }
}

// ---------- zip (UTF-8, deflate, giữ quyền chạy cho Linux/macOS) ----------
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function makeZip(list) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const entry = (name, data, mtime, mode, isDir) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = isDir ? Buffer.alloc(0) : zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = !isDir && comp.length < data.length;
    const body = isDir ? Buffer.alloc(0) : useDeflate ? comp : data;
    const crc = isDir ? 0 : zlib.crc32(data);
    const { time, date } = dosTime(mtime);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(isDir ? 0 : data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(isDir ? 0 : data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(((((isDir ? 0o040755 : mode) & 0xffff) << 16) | (isDir ? 0x10 : 0)) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  };
  entry(TOP + '/', null, new Date(), 0, true);
  for (const f of list) entry(`${TOP}/${f.rel}`, f.data, f.mtime, f.exec ? 0o100755 : 0o100644, false);
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length + 1, 8); end.writeUInt16LE(list.length + 1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- tar.gz (ustar, giữ quyền chạy) ----------
function makeTarGz(list) {
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  const parts = [];
  const head = (name, size, mode, mtime, type) => {
    const b = Buffer.alloc(512);
    let nm = name, prefix = '';
    if (Buffer.byteLength(name) > 100) { const k = name.lastIndexOf('/', name.length - 2); prefix = name.slice(0, k); nm = name.slice(k + 1); }
    b.write(nm, 0, 'utf8'); b.write(oct(mode, 8), 100); b.write(oct(0, 8), 108); b.write(oct(0, 8), 116); b.write(oct(size, 12), 124);
    b.write(oct(Math.floor(mtime.getTime() / 1000), 12), 136); b.write('        ', 148); b.write(type, 156); b.write('ustar\0', 257); b.write('00', 263); b.write(prefix, 345, 'utf8');
    let sum = 0; for (const v of b) sum += v;
    b.write(oct(sum, 7).slice(0, 6) + '\0 ', 148);
    return b;
  };
  parts.push(head(TOP + '/', 0, 0o755, new Date(), '5'));
  for (const f of list) {
    parts.push(head(`${TOP}/${f.rel}`, f.data.length, f.exec ? 0o755 : 0o644, f.mtime, '0'), f.data);
    const pad = (512 - (f.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

fs.mkdirSync(OUT, { recursive: true });
const outputs = [];
const zipPath = path.join(OUT, `chamcong-${version}-cai-dat.zip`);
fs.writeFileSync(zipPath, makeZip(files)); outputs.push(zipPath);
const tgzPath = path.join(OUT, `chamcong-${version}-cai-dat.tar.gz`);
fs.writeFileSync(tgzPath, makeTarGz(files)); outputs.push(tgzPath);

// File cập nhật dùng chung công cụ make-update.js
const pass = process.argv.slice(2).filter((a) => a.startsWith('--notes=') || a.startsWith('--sign='));
const r = spawnSync(process.execPath, [path.join(__dirname, 'make-update.js'), `--out=${OUT}`, ...pass], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
outputs.push(path.join(OUT, `chamcong-update-${version}.tgz`));

const sums = outputs.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')}  ${path.basename(f)}`).join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'SHA256SUMS.txt'), sums);
console.log(`\nĐã đóng gói phiên bản ${version} (${files.length} tệp):`);
for (const f of outputs) console.log(`  ${path.basename(f).padEnd(40)} ${Math.round(fs.statSync(f).size / 1024)} KB`);
console.log('  SHA256SUMS.txt');
