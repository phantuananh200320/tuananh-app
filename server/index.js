'use strict';
require('./updater-boot'); // áp bản cập nhật đã lưu (nếu ảnh Docker cũ hơn bản đã cập nhật), phải chạy đầu tiên
const C = require('./config'); // đặt múi giờ — phải nạp sau đó
const { createServer } = require('./lib/http');
const db = require('./db');

const { app, server } = createServer({ publicDir: C.PUBLIC_DIR, trustProxy: C.TRUST_PROXY, swVersion: () => require('./updater').version() });
require('./updater').init({ app });
require('./app-routes')(app);

server.listen(C.PORT, C.HOST, () => {
  require('./backup').start();
  console.log(`[chamcong] Đang chạy tại http://${C.HOST === '0.0.0.0' ? 'localhost' : C.HOST}:${C.PORT}  (múi giờ ${process.env.TZ})`);
  console.log('[chamcong]   Trang chủ    : /');
  console.log('[chamcong]   App nhân viên: /cc/');
  console.log('[chamcong]   Web quản lý : /admin/');
  console.log('[chamcong]   Tự sao lưu   : 02:00 mỗi đêm (xem Cài đặt)');
});

let closing = false;
function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(`[chamcong] Nhận ${sig}, đang tắt...`);
  server.close(() => {
    try { db.db.close(); } catch { /* đã đóng */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// start.js gửi lệnh tắt êm qua kênh IPC (trên Windows không có tín hiệu SIGTERM thật)
if (process.send) process.on('message', (m) => { if (m && m.cmd === 'shutdown') shutdown('lệnh tắt từ start.js'); });
process.on('unhandledRejection', (e) => console.error('[chamcong] unhandledRejection', e));
