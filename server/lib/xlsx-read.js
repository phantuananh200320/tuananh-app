'use strict';
// Đọc file .xlsx (trang tính đầu tiên) và .csv, không cần thư viện ngoài. Trả về mảng các dòng, mỗi dòng là mảng ô (chuỗi hoặc số).
const zlib = require('zlib');

const MAX_UNZIPPED = 40 * 1024 * 1024;

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('File không phải định dạng Excel (.xlsx) hợp lệ');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('File Excel bị hỏng');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('File Excel bị hỏng');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED }) : null;
    if (!data) throw new Error('File Excel dùng kiểu nén không hỗ trợ');
    total += data.length;
    if (total > MAX_UNZIPPED) throw new Error('File Excel quá lớn');
    files.set(name, data.toString('utf8'));
  }
  return files;
}

const unesc = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attrs = (s) => { const o = {}; for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = unesc(m[2]); return o; };
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function readXlsx(buf) {
  const files = unzip(buf);
  let sheetFile = null;
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = /<sheet\s([^>]*)\/?>/.exec(wb);
    const rid = first && attrs(first[1])['r:id'];
    for (const m of rels.matchAll(/<Relationship\s([^>]*)\/?>/g)) {
      const a = attrs(m[1]);
      if (a.Id === rid && a.Target) sheetFile = 'xl/' + a.Target.replace(/^\/?(xl\/)?/, '');
    }
  }
  if (!sheetFile || !files.has(sheetFile)) sheetFile = [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort()[0];
  if (!sheetFile) throw new Error('File Excel không có trang tính nào');
  const shared = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const rows = [];
  const xml = files.get(sheetFile);
  for (const rm of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cm[1]);
      if (!a.r || cm[2] === undefined) continue;
      const body = cm[2];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      let val = '';
      if (a.t === 's') val = v ? shared[Number(v[1])] || '' : '';
      else if (a.t === 'inlineStr') val = textOf(body);
      else if (a.t === 'str' || a.t === 'e') val = v ? unesc(v[1]) : '';
      else if (a.t === 'b') val = v && v[1] === '1' ? 1 : 0;
      else if (v) { const n = Number(v[1]); val = Number.isFinite(n) ? n : unesc(v[1]); }
      const ci = colIndex(a.r);
      if (ci > 200) continue;
      while (row.length < ci) row.push('');
      row[ci] = val;
    }
    rows.push(row);
    if (rows.length > 20000) throw new Error('File có quá nhiều dòng (tối đa 20.000)');
  }
  return rows;
}

function readCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split('\n')[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inq = false; } else cur += c;
    } else if (c === '"') inq = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function readSheet(buf, filename) {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) return readXlsx(buf);
  if (/\.xls$/i.test(filename || '')) throw new Error('Định dạng .xls cũ chưa được hỗ trợ. Hãy lưu lại thành .xlsx hoặc .csv');
  return readCsv(buf.toString('utf8'));
}

module.exports = { readSheet, readXlsx, readCsv };
