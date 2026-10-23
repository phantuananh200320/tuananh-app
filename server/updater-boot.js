'use strict';
// Chạy ngay khi khởi động, TRƯỚC mọi thứ khác.
// Trong Docker, bản cập nhật được áp vào hệ thống tệp của container, nên khi container được tạo lại từ ảnh cũ thì các tệp đó mất.
// Bản cập nhật gần nhất được giữ trong thư mục dữ liệu (/data/updates): nếu nó mới hơn mã đang có thì áp lại ở đây.
const fs = require('fs');
const path = require('path');
const pkg = require('./lib/pkg');

(function bootApply() {
  const ROOT = path.resolve(__dirname, '..');
  const DIR = path.join(path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')), 'updates');
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(DIR, 'installed.json'), 'utf8')); } catch { return; }
  const last = state.history && state.history[state.history.length - 1];
  if (!last || !last.package) return;
  try {
    const have = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    if (pkg.cmpVersion(last.version, have) <= 0) return; // mã hiện có đã mới bằng hoặc hơn
    const opened = pkg.open(fs.readFileSync(path.join(DIR, last.package)), { publicKey: process.env.UPDATE_PUBLIC_KEY });
    let selfChanged = false;
    for (const [rel, data] of opened.files) {
      if (pkg.INFRA(rel)) continue;
      const full = path.join(ROOT, rel);
      if (fs.existsSync(full) && pkg.sha256(fs.readFileSync(full)) === pkg.sha256(data)) continue;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const tmp = full + '.tmp-' + process.pid;
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, full);
      if (['server/index.js', 'server/updater-boot.js', 'server/lib/pkg.js'].includes(rel)) selfChanged = true;
    }
    console.log(`[chamcong] Đã áp lại bản cập nhật ${last.version} từ thư mục dữ liệu (ảnh cài đặt là bản ${have}).`);
    if (selfChanged) { console.log('[chamcong] Phần khởi động vừa đổi, khởi động lại một lần để chạy mã mới.'); process.exit(0); }
  } catch (e) {
    console.error('[chamcong] Không áp lại được bản cập nhật đã lưu, tiếp tục với mã hiện có:', e.message);
  }
})();
