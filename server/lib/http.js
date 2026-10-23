'use strict';
// Máy chủ HTTP tối giản: router, đọc JSON, phục vụ file tĩnh. Không cần Express.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { clientIp } = require('./util');

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}
const bad = (m, c) => new HttpError(400, m, c);
const notFound = (m = 'Không tìm thấy') => new HttpError(404, m, 'NOT_FOUND');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg)/;

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function createServer({ publicDir, trustProxy = false, maxBody = 8 * 1024 * 1024, swVersion = () => 'dev' }) {
  const routes = [];

  function add(method, pattern, handlers) {
    const keys = [];
    const re = new RegExp(
      '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === ':' ? c : '\\' + c)).replace(/:([A-Za-z_]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) + '/?$'
    );
    routes.push({ method, re, keys, handlers });
  }
  const app = {
    get: (p, ...h) => add('GET', p, h),
    post: (p, ...h) => add('POST', p, h),
    put: (p, ...h) => add('PUT', p, h),
    del: (p, ...h) => add('DELETE', p, h),
    // Dùng khi nạp lại ứng dụng đang chạy (cập nhật phiên bản không cần khởi động lại)
    reset: () => { routes.length = 0; },
    snapshot: () => routes.slice(),
    restore: (saved) => { routes.length = 0; routes.push(...saved); },
  };

  function readBody(req, limit = maxBody) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'Dữ liệu gửi lên quá lớn'));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function decorate(req, res) {
    res.sent = false;
    res.statusCode = 200;
    res.send = (body, type = 'text/plain; charset=utf-8', status = 200, headers = {}) => {
      if (res.sent) return;
      res.sent = true;
      let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const h = { 'Content-Type': type, ...headers };
      if (COMPRESSIBLE.test(type) && buf.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        buf = zlib.gzipSync(buf);
        h['Content-Encoding'] = 'gzip';
        h.Vary = 'Accept-Encoding';
      }
      h['Content-Length'] = buf.length;
      res.writeHead(status, h);
      res.end(req.method === 'HEAD' ? undefined : buf);
    };
    res.json = (data, status = 200) => res.send(JSON.stringify(data), 'application/json; charset=utf-8', status, { 'Cache-Control': 'no-store' });
    res.status = (n) => {
      res.statusCode = n;
      return res;
    };
  }

  // Địa chỉ cũ /app/... chuyển sang app nhân viên mới tại /cc/, giữ nguyên phần #...
  const LEGACY_SW = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',(e)=>e.waitUntil((async()=>{
  for(const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for(const c of await self.clients.matchAll({type:'window'})) c.navigate(c.url);
})()));
`;
  function serveStatic(req, res) {
    let p = req.path;
    if (p === '/app' || p.startsWith('/app/')) {
      // Service worker cũ của /app/: tự gỡ để app cài trước đây chuyển sang địa chỉ mới
      if (p === '/app/sw.js') return res.send(LEGACY_SW, MIME['.js'], 200, { 'Cache-Control': 'no-cache' });
      const rest = p.slice('/app'.length).replace(/^\/+/, '');
      const qs = new URL(req.url, 'http://localhost').search;
      res.sent = true;
      res.writeHead(301, { Location: rest.startsWith('icons/') ? '/' + rest + qs : '/cc/' + qs });
      res.end();
      return;
    }
    // Trước đây app nhân viên nằm ở trang gốc và đăng ký service worker tại /sw.js: gỡ nó đi để app cài trước đây chuyển sang /cc/
    if (p === '/sw.js') return res.send(LEGACY_SW, MIME['.js'], 200, { 'Cache-Control': 'no-cache' });
    // Service worker của app nhân viên mang số phiên bản của ứng dụng: cập nhật phiên bản thì bộ nhớ đệm của app trên điện thoại tự làm mới
    if (p === '/cc/sw.js') {
      let src;
      try { src = fs.readFileSync(path.join(publicDir, 'cc', 'sw.js'), 'utf8'); } catch { throw notFound('Không tìm thấy trang'); }
      res.send(src.replace(/__V__/g, String(swVersion())), MIME['.js'], 200, { 'Cache-Control': 'no-cache' });
      return;
    }
    if (p === '/') p = '/index.html';
    const full = path.normalize(path.join(publicDir, p));
    if (!full.startsWith(publicDir)) throw new HttpError(403, 'Forbidden');
    let st;
    try { st = fs.statSync(full); } catch { throw notFound('Không tìm thấy trang'); }
    let file = full;
    if (st.isDirectory()) {
      if (!p.endsWith('/')) {
        res.sent = true;
        res.writeHead(301, { Location: p + '/' });
        res.end();
        return;
      }
      file = path.join(full, 'index.html');
      try { st = fs.statSync(file); } catch { throw notFound('Không tìm thấy trang'); }
    }
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    const cache = p.startsWith('/icons/') ? 'public, max-age=604800' : 'no-cache';
    if (req.headers['if-none-match'] === etag) {
      res.sent = true;
      res.writeHead(304, { ETag: etag, 'Cache-Control': cache });
      res.end();
      return;
    }
    res.send(fs.readFileSync(file), type, 200, { ETag: etag, 'Cache-Control': cache });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try { req.path = decodeURIComponent(url.pathname); } catch { throw bad('Đường dẫn không hợp lệ'); }
    req.query = Object.fromEntries(url.searchParams);
    req.ip = clientIp(req, trustProxy);
    req.params = {};
    req.body = {};

    if (req.path.startsWith('/api/')) {
      let matched = null;
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(req.path);
        if (m) {
          matched = r;
          r.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1])));
          break;
        }
      }
      if (!matched) throw notFound('API không tồn tại');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        // Tải file dữ liệu cũ lên: nhận nguyên file nhị phân, tối đa 300 MB
        const rawUpload = req.path === '/api/backups/upload' || req.path === '/api/update/upload';
        const raw = await readBody(req, req.path === '/api/update/upload' ? 60 * 1024 * 1024 : rawUpload ? 300 * 1024 * 1024 : maxBody);
        if (rawUpload) req.raw = raw;
        else if (raw.length) {
          try { req.body = JSON.parse(raw.toString('utf8')); } catch { throw bad('JSON không hợp lệ'); }
        }
      }
      for (const h of matched.handlers) {
        await h(req, res);
        if (res.sent) break;
      }
      if (!res.sent) res.json({ ok: true });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method Not Allowed');
    serveStatic(req, res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    // Một số bản TensorFlow.js trong face-api.js cần 'unsafe-eval'. Chỉ bật khi đặt FACE_UNSAFE_EVAL=1, và chỉ cho trang quản lý và màn hình QR.
    const needEval = process.env.FACE_UNSAFE_EVAL === '1' && /^\/(admin|kiosk)\//.test(req.url.split('?')[0]);
    res.setHeader('Content-Security-Policy', needEval ? CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'") : CSP);
    decorate(req, res);
    try {
      await handle(req, res);
    } catch (e) {
      if (res.sent || res.headersSent) {
        try { res.end(); } catch { /* bỏ qua */ }
        return;
      }
      if (e instanceof HttpError) {
        if (req.path && req.path.startsWith('/api/')) res.json({ error: e.message, code: e.code }, e.status);
        else res.send(e.message, 'text/plain; charset=utf-8', e.status);
      } else {
        console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}`, e);
        res.json({ error: 'Lỗi hệ thống, vui lòng thử lại', code: 'SERVER_ERROR' }, 500);
      }
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 20000;

  return { app, server };
}

module.exports = { createServer, HttpError, bad, notFound };
