'use strict';
// Toàn bộ route của ứng dụng. Tách riêng để bộ cập nhật có thể nạp lại mà không phải tắt máy chủ.
const db = require('./db');

module.exports = (app) => {
  app.get('/api/health', (req, res) => {
    db.q.get('SELECT 1 AS ok');
    res.json({ ok: true, time: Date.now() });
  });

  require('./routes/auth')(app);
  require('./routes/kiosk')(app);
  require('./routes/me')(app);
  require('./routes/face')(app);
  require('./routes/requests')(app);
  require('./routes/manage')(app);
  require('./routes/reports')(app);
  require('./routes/update')(app);
  // Các phân hệ ERP: tổng quan, nhập đơn, giao hàng, tài chính
  require('./routes/erp-core')(app);
  require('./routes/erp-orders')(app);
  require('./routes/erp-delivery')(app);
  require('./routes/erp-finance')(app);
  require('./routes/erp-app')(app); // app đặt hàng của khách đại lý
};
