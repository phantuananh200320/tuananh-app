'use strict';
// Gói cập nhật ứng dụng: tar.gz tự đóng/đọc (không cần thư viện ngoài), có manifest kiểm tra toàn vẹn và chữ ký tuỳ chọn.
// Cấu trúc gói: update.json (manifest: app, version, files{đường dẫn: sha256}), update.sig (tuỳ chọn), cùng các file của ứng dụng.
const zlib = require('zlib');
const crypto = require('crypto');

const MANIFEST = 'update.json';
const SIG = 'update.sig';
const LIMITS = { files: 3000, total: 120 * 1024 * 1024, one: 30 * 1024 * 1024 };

// Những gì gói được phép chứa. Thư viện nhận diện khuôn mặt (vendor, models) là dữ liệu tải riêng, không bao giờ bị gói đụng tới.
// Tệp khởi động và hướng dẫn cài đặt ở thư mục gốc cũng được cập nhật qua gói (có hiệu lực ở lần khởi động sau)
const LAUNCH_FILES = ['start.js', 'start.bat', 'start.sh', 'stop.bat', 'stop.sh', 'install-linux.sh', 'cai-dat-windows.bat', 'INSTALL.md'];
const ROOT_FILES = new Set(['package.json', 'README.md', '.env.example', 'Dockerfile', 'docker-compose.yml', '.dockerignore', ...LAUNCH_FILES]);
const DIRS = ['server/', 'public/', 'scripts/', 'deploy/'];
const PROTECTED = ['public/vendor/', 'public/models/'];
// Tệp hạ tầng: nằm trong ảnh Docker, chép vào đây không có tác dụng nên chỉ báo "cần build lại"
const INFRA = (rel) => rel === 'Dockerfile' || rel === 'docker-compose.yml' || rel === '.dockerignore' || rel.startsWith('deploy/');

function allowed(rel) {
  if (PROTECTED.some((p) => rel.startsWith(p))) return false;
  return ROOT_FILES.has(rel) || DIRS.some((d) => rel.startsWith(d));
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function cmpVersion(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
  return 0;
}

function cleanPath(p) {
  let s = String(p).replace(/^\.\//, '');
  if (!s || s.length > 200 || s.startsWith('/') || s.includes('\\') || s.includes('\0') || s.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')) {
    throw new Error('Gói chứa đường dẫn không hợp lệ: ' + JSON.stringify(String(p).slice(0, 80)));
  }
  return s;
}

// ---------- tar ----------
function octal(n, len) { return n.toString(8).padStart(len - 1, '0') + '\0'; }

function header(rel, size) {
  const b = Buffer.alloc(512);
  let name = rel, prefix = '';
  if (Buffer.byteLength(rel) > 100) {
    const i = rel.lastIndexOf('/', rel.length - 1);
    let cut = -1;
    for (let k = 0; k < rel.length; k++) if (rel[k] === '/' && Buffer.byteLength(rel.slice(k + 1)) <= 100 && Buffer.byteLength(rel.slice(0, k)) <= 155) { cut = k; break; }
    if (cut < 0 || i < 0) throw new Error('Đường dẫn quá dài: ' + rel);
    prefix = rel.slice(0, cut); name = rel.slice(cut + 1);
  }
  b.write(name, 0, 'utf8'); b.write('0000644\0', 100); b.write('0000000\0', 108); b.write('0000000\0', 116);
  b.write(octal(size, 12), 124); b.write(octal(0, 12), 136);
  b.write('        ', 148); b.write('0', 156); b.write('ustar\0', 257); b.write('00', 263); b.write(prefix, 345, 'utf8');
  let sum = 0; for (const v of b) sum += v;
  b.write(octal(sum, 7).slice(0, 6) + '\0 ', 148);
  return b;
}

function tarWrite(entries) {
  const parts = [];
  for (const e of entries) {
    const rel = cleanPath(e.path);
    parts.push(header(rel, e.data.length), e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

function str(b, off, len) { const s = b.toString('utf8', off, off + len); const z = s.indexOf('\0'); return z < 0 ? s : s.slice(0, z); }

function tarRead(gz) {
  let tar;
  try { tar = zlib.gunzipSync(gz, { maxOutputLength: LIMITS.total }); } catch { throw new Error('File không phải gói cập nhật hợp lệ (giải nén lỗi hoặc quá lớn)'); }
  const out = [];
  let off = 0, total = 0, longName = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((v) => v === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== parseInt(str(h, 148, 8).trim() || 'x', 8)) throw new Error('Gói cập nhật bị hỏng (sai mã kiểm tra)');
    const size = parseInt(str(h, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0 || size > LIMITS.one) throw new Error('Gói chứa tệp quá lớn hoặc hỏng');
    const type = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(off + 512, off + 512 + size);
    if (body.length < size) throw new Error('Gói cập nhật bị cắt cụt');
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = str(body, 0, body.length); continue; }
    if (type === '5') { longName = null; continue; }
    if (type !== '0') throw new Error('Gói chứa mục không được phép (liên kết hoặc loại đặc biệt)');
    const prefix = str(h, 345, 155);
    const rel = cleanPath(longName || (prefix ? prefix + '/' : '') + str(h, 0, 100));
    longName = null;
    total += size;
    if (out.length >= LIMITS.files || total > LIMITS.total) throw new Error('Gói cập nhật quá lớn');
    out.push({ path: rel, data: Buffer.from(body) });
  }
  return out;
}

// ---------- zip (gói cài đặt đầy đủ .zip cũng tải lên cập nhật được) ----------
function zipRead(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('File .zip bị hỏng');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('File .zip bị hỏng');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const ext = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const raw = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? raw.toString('utf8') : raw.toString('latin1')).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // thư mục
    if (((ext >>> 16) & 0o170000) === 0o120000) throw new Error('Gói chứa liên kết (symlink), không được phép');
    if (flags & 1) throw new Error('File .zip có mật khẩu, không đọc được');
    if (usize > LIMITS.one) throw new Error('Gói chứa tệp quá lớn: ' + name);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('File .zip bị hỏng');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const comp = buf.subarray(start, start + csize);
    const data = method === 0 ? Buffer.from(comp) : method === 8 ? zlib.inflateRawSync(comp, { maxOutputLength: LIMITS.one }) : null;
    if (!data) throw new Error('File .zip dùng kiểu nén không hỗ trợ');
    total += data.length;
    if (out.length >= LIMITS.files || total > LIMITS.total) throw new Error('Gói quá lớn');
    out.push({ path: cleanPath(name), data });
  }
  return out;
}

// Nhận cả gói cập nhật (.tgz có update.json) lẫn gói cài đặt đầy đủ (.zip hoặc .tar.gz chứa thư mục phần mềm)
function readArchive(buf) {
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 3 && buf[3] === 4) return zipRead(buf);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return tarRead(buf);
  throw new Error('File không đúng định dạng. Hãy chọn file cập nhật .tgz hoặc gói cài đặt .zip của phần mềm');
}

// Gói cài đặt đầy đủ không có update.json: tìm thư mục chứa package.json của phần mềm, lấy các tệp được phép cập nhật
function fromFullArchive(entries) {
  const cands = entries.filter((e) => e.path === 'package.json' || e.path.endsWith('/package.json'))
    .map((e) => ({ e, prefix: e.path.slice(0, -'package.json'.length) }))
    .filter(({ e }) => { try { return JSON.parse(e.data.toString('utf8')).name === 'chamcong'; } catch { return false; } })
    .sort((a, b) => a.prefix.length - b.prefix.length);
  if (!cands.length) throw new Error('Không phải gói của phần mềm này (không tìm thấy package.json của chamcong)');
  const { prefix } = cands[0];
  const files = [];
  for (const e of entries) {
    if (!e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    if (!rel || rel === MANIFEST || rel === SIG || !allowed(rel)) continue; // bỏ qua dữ liệu, thư viện khuôn mặt...
    files.push({ path: rel, data: e.data });
  }
  const version = JSON.parse(cands[0].e.data.toString('utf8')).version;
  return { files, version };
}

// ---------- manifest và chữ ký ----------
function makeManifest(files, meta) {
  const m = { app: 'chamcong', version: meta.version, created: meta.created || new Date().toISOString(), notes: meta.notes || '', files: {} };
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) m.files[f.path] = sha256(f.data);
  return m;
}

function publicKeyObject(k) {
  const s = String(k).trim();
  return crypto.createPublicKey(s.includes('BEGIN') ? s : { key: Buffer.from(s, 'base64'), format: 'der', type: 'spki' });
}
function sign(manifestBuf, privateKeyPem) { return crypto.sign(null, manifestBuf, crypto.createPrivateKey(privateKeyPem)).toString('base64'); }

// Đọc và kiểm tra toàn bộ gói. publicKey (nếu có) bắt buộc chữ ký hợp lệ.
function open(gz, { publicKey } = {}) {
  const entries = readArchive(gz);
  const byPath = new Map(entries.map((e) => [e.path, e.data]));
  if (byPath.size !== entries.length) throw new Error('Gói chứa tệp trùng tên');
  if (!byPath.has(MANIFEST)) {
    // Gói cài đặt đầy đủ: tự lập manifest từ chính các tệp trong gói
    if (publicKey) throw new Error('Hệ thống đang bắt buộc chữ ký (UPDATE_PUBLIC_KEY): hãy dùng file cập nhật .tgz đã ký, không dùng gói cài đặt');
    const full = fromFullArchive(entries);
    if (!/^\d+\.\d+\.\d+$/.test(String(full.version))) throw new Error('package.json trong gói không có số phiên bản hợp lệ');
    const m = makeManifest(full.files, { version: full.version, notes: 'Cập nhật từ gói cài đặt đầy đủ' });
    const files = new Map(full.files.map((f) => [f.path, f.data]));
    if (!files.has('package.json')) throw new Error('Gói thiếu package.json');
    return { manifest: m, manifestBuf: Buffer.from(JSON.stringify(m)), files, signed: false, hasSignature: false, full: true };
  }
  const mbuf = byPath.get(MANIFEST);
  let m;
  try { m = JSON.parse(mbuf.toString('utf8')); } catch { throw new Error('update.json bị hỏng'); }
  if (m.app !== 'chamcong' || !/^\d+\.\d+\.\d+$/.test(String(m.version)) || !m.files || typeof m.files !== 'object') throw new Error('update.json không hợp lệ');
  let signed = false;
  const sig = byPath.get(SIG);
  if (publicKey) {
    if (!sig) throw new Error('Gói chưa được ký, trong khi hệ thống yêu cầu chữ ký (UPDATE_PUBLIC_KEY)');
    let ok = false;
    try { ok = crypto.verify(null, mbuf, publicKeyObject(publicKey), Buffer.from(sig.toString('utf8').trim(), 'base64')); } catch { ok = false; }
    if (!ok) throw new Error('Chữ ký của gói không đúng, từ chối cập nhật');
    signed = true;
  }
  const files = new Map();
  for (const [rel, data] of byPath) {
    if (rel === MANIFEST || rel === SIG) continue;
    if (!allowed(rel)) throw new Error('Gói chứa tệp không được phép cập nhật: ' + rel);
    if (m.files[rel] !== sha256(data)) throw new Error('Tệp không khớp mã kiểm tra (gói bị sửa hoặc hỏng): ' + rel);
    files.set(rel, data);
  }
  for (const rel of Object.keys(m.files)) if (!files.has(rel)) throw new Error('Gói thiếu tệp: ' + rel);
  if (!files.has('package.json')) throw new Error('Gói thiếu package.json');
  return { manifest: m, manifestBuf: mbuf, files, signed, hasSignature: !!sig };
}

module.exports = { MANIFEST, SIG, INFRA, LAUNCH_FILES, allowed, zipRead, readArchive, sha256, cmpVersion, cleanPath, tarWrite, tarRead, makeManifest, sign, open, publicKeyObject };
