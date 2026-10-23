'use strict';
// Service worker: giúp app mở được khi mạng chậm/mất. Dữ liệu (API) luôn lấy từ máy chủ, không lưu cache.
const CACHE = 'chamcong-__V__';
const SHELL = ['./', './app.css', './app.js', './manifest.webmanifest', '../shared/base.css', '../shared/common.js', '../icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Không can thiệp vào API, trang quản lý và màn hình QR
  if (req.method !== 'GET' || url.origin !== location.origin || /^\/(api|admin|kiosk)(\/|$)/.test(url.pathname)) return;
  // Ưu tiên bản mới từ mạng, mất mạng thì dùng bản đã lưu
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./')))
  );
});
