'use strict';
/* Trang in chứng từ: phiếu giao hàng (nhiều đơn), bảng kê chuyến, hoá đơn, sổ công nợ.
   Dữ liệu lấy bằng API với phiên đăng nhập hiện tại; mọi chữ đều đi qua textContent. */
(function () {
  const { h, mount, GET, POST, fmtMoney, fmtDate } = CC;
  const p = new URLSearchParams(location.search);
  const type = p.get('type');
  const doc = document.getElementById('doc');
  const msg = document.getElementById('msg');
  const money = (n) => fmtMoney(n) + 'đ';
  const dmy = (s) => (s ? fmtDate(s) : '');
  document.getElementById('btn-print').onclick = () => window.print();
  document.getElementById('btn-close').onclick = () => window.close();

  const header = (company, right) => h('div', { class: 'hd' }, h('div', { class: 'co' }, company), h('div', { class: 'meta' }, right));
  const sign = (a, b, c) => h('div', { class: 'sign' }, [a, b, c].map((x) => h('div', null, h('b', null, x), h('i', null, '(Ký, ghi rõ họ tên)'))));
  const fq = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
  // Phiếu giao hàng không in giá: giá chỉ có trên hoá đơn/bảng kê của bộ phận tài chính
  const itemsTable = (items) => h('table', null,
    h('thead', null, h('tr', null, ['STT', 'Tên hàng', 'Quy cách', 'ĐVT', 'Số lượng', 'Quy đổi', 'Thực nhận'].map((x) => h('th', null, x)))),
    h('tbody', null, items.map((i, n) => h('tr', null, h('td', { class: 'c' }, String(n + 1)), h('td', null, i.name), h('td', { class: 'c' }, i.spec || ''), h('td', { class: 'c' }, i.unit), h('td', { class: 'r' }, fq(i.qty)), h('td', null, i.pack_text || ''), h('td', { style: { width: '80px' } })))));

  function orderSheet(company, o) {
    return h('section', { class: 'sheet' }, o.reprint ? h('div', { class: 'stamp' }, 'In lại') : null,
      header(company, [h('div', null, 'Số: ', h('b', null, o.code)), h('div', null, 'Ngày đặt: ' + dmy(o.order_date))]),
      h('h1', null, 'Phiếu giao hàng'), h('div', { class: 'sub' }, 'Ngày giao: ' + dmy(o.delivery_date)),
      h('div', { class: 'info' }, h('div', null, h('b', null, 'Khách hàng:'), `${o.customer_name} (${o.customer_code})`), h('div', null, h('b', null, 'Điện thoại:'), o.customer_phone || ''),
        h('div', { style: { gridColumn: '1 / -1' } }, h('b', null, 'Địa chỉ giao:'), o.address || ''),
        o.trip_code ? h('div', null, h('b', null, 'Chuyến:'), `${o.trip_code}${o.route_name ? ' · ' + o.route_name : ''}`) : null, o.driver_name ? h('div', null, h('b', null, 'Tài xế:'), `${o.driver_name}${o.driver_plate ? ' · ' + o.driver_plate : ''}`) : null),
      itemsTable(o.items),
      o.note ? h('div', { class: 'note' }, 'Ghi chú: ' + o.note) : null, sign('Người lập phiếu', 'Người giao hàng', 'Người nhận hàng'));
  }

  // Phiếu làm hàng: trang tổng hợp theo sản phẩm + phiếu soạn cho từng đơn (không có giá)
  function prodSheets(company, r) {
    const day = r.date ? dmy(r.date) : dmy(CC.todayStr());
    const out = [h('section', { class: 'sheet' }, header(company, [h('div', null, 'In lúc ' + CC.fmtDateTime(Date.now()))]),
      h('h1', null, 'Phiếu làm hàng tổng hợp'), h('div', { class: 'sub' }, `${r.orders.length} đơn · in ngày ${day}`),
      h('table', null, h('thead', null, h('tr', null, ['STT', 'Nhóm', 'Sản phẩm', 'Quy cách', 'Tổng SL', 'Quy đổi', 'Số đơn', 'Đã làm'].map((x) => h('th', null, x)))),
        h('tbody', null, r.summary.map((l, i) => h('tr', null, h('td', { class: 'c' }, String(i + 1)), h('td', null, l.group_name || ''), h('td', null, h('b', null, l.name)), h('td', { class: 'c' }, l.spec || ''),
          h('td', { class: 'r' }, h('b', null, `${fq(l.qty)} ${l.unit}`)), h('td', null, l.pack_text), h('td', { class: 'c' }, String(l.orders)), h('td', { class: 'c' }, '☐'))))),
      sign('Người lập', 'Tổ trưởng làm hàng', 'Thủ kho'))];
    for (const o of r.orders) {
      out.push(h('section', { class: 'sheet slip' }, header(company, [h('div', null, h('b', { style: { fontSize: '20px', letterSpacing: '.06em' } }, o.code)), h('div', null, 'Giao ngày ' + dmy(o.delivery_date))]),
        h('h1', { style: { fontSize: '17px' } }, 'Phiếu soạn hàng'),
        h('div', { class: 'info' }, h('div', null, h('b', null, 'Đại lý:'), `${o.customer_name}${o.customer_area ? ' · ' + o.customer_area : ''}`), h('div', null, h('b', null, 'Chuyến:'), o.trip_code ? `${o.trip_code}${o.driver_name ? ' · ' + o.driver_name : ''}` : 'chưa gán'),
          h('div', { style: { gridColumn: '1 / -1' } }, h('b', null, 'Địa chỉ:'), o.address || '')),
        h('table', null, h('thead', null, h('tr', null, ['☐', 'Sản phẩm', 'Quy cách', 'Số lượng', 'Quy đổi'].map((x) => h('th', null, x)))),
          h('tbody', null, o.items.map((i) => h('tr', null, h('td', { class: 'c', style: { width: '28px' } }, '☐'), h('td', null, i.name), h('td', { class: 'c' }, i.spec || ''), h('td', { class: 'r' }, `${fq(i.qty)} ${i.unit}`), h('td', null, h('b', null, i.pack_text)))))),
        o.note ? h('div', { class: 'note' }, 'Ghi chú: ' + o.note) : null,
        h('div', { class: 'sign', style: { gridTemplateColumns: '1fr 1fr', marginTop: '8px' } }, h('div', null, h('b', null, 'Người soạn')), h('div', null, h('b', null, 'Người kiểm (check in)')))));
    }
    return out;
  }

  async function run() {
    if (!CC.getToken()) throw new Error('Bạn chưa đăng nhập. Hãy đăng nhập ở trang chủ rồi in lại.');
    const info = await CC.loadPublicInfo();
    const company = info.company_name;
    if (type === 'order') {
      const ids = (p.get('ids') || '').split(',').map(Number).filter(Boolean);
      const r = await POST('/api/orders/print', { ids });
      if (!r.orders.length) throw new Error('Không tìm thấy đơn hàng');
      document.title = r.orders.length === 1 ? 'Phiếu ' + r.orders[0].code : `Phiếu giao hàng (${r.orders.length} đơn)`;
      mount(doc, r.orders.map((o) => orderSheet(company, o)));
      msg.textContent = `${r.orders.length} phiếu${r.orders.some((o) => o.reprint) ? ' · có phiếu in lại' : ''}`;
    } else if (type === 'prod') {
      const ids = (p.get('ids') || '').split(',').map(Number).filter(Boolean);
      const r = await POST('/api/production/print', { ids, date: p.get('date') || CC.todayStr() });
      document.title = `Phiếu làm hàng (${r.orders.length} đơn)`;
      mount(doc, prodSheets(company, r));
      msg.textContent = `${r.summary.length} sản phẩm · ${r.orders.length} phiếu soạn hàng`;
    } else if (type === 'trip') {
      const r = await GET('/api/trips/' + encodeURIComponent(p.get('id')) + '/sheet');
      const t = r.trip;
      document.title = 'Bảng kê chuyến ' + t.code;
      const sheets = [h('section', { class: 'sheet' }, header(company, [h('div', null, 'Chuyến: ', h('b', null, t.code)), h('div', null, 'Ngày giao: ' + dmy(t.trip_date))]),
        h('h1', null, 'Bảng kê chuyến giao hàng'),
        h('div', { class: 'info' }, h('div', null, h('b', null, 'Tài xế:'), t.driver_name || '—'), h('div', null, h('b', null, 'Biển số:'), t.driver_plate || ''), h('div', null, h('b', null, 'Tuyến:'), t.route_name || '—'), h('div', null, h('b', null, 'Điện thoại:'), t.driver_phone || '')),
        h('h3', null, 'I. Hàng hoá cần chuẩn bị'),
        h('table', null, h('thead', null, h('tr', null, ['STT', 'Sản phẩm', 'ĐVT', 'Tổng SL'].map((x) => h('th', null, x)))), h('tbody', null, r.allocation.lines.map((l, i) => h('tr', null, h('td', { class: 'c' }, String(i + 1)), h('td', null, l.name), h('td', { class: 'c' }, l.unit), h('td', { class: 'r' }, fmtMoney(l.qty)))))),
        h('h3', null, 'II. Danh sách điểm giao'),
        h('table', null, h('thead', null, h('tr', null, ['TT', 'Đơn', 'Khách hàng / Địa chỉ', 'Hàng hoá', 'Thu hộ', 'Ký nhận'].map((x) => h('th', null, x)))),
          h('tbody', null, r.orders.map((o, i) => h('tr', null, h('td', { class: 'c' }, String(i + 1)), h('td', null, o.code), h('td', null, h('b', null, o.customer_name), h('div', null, o.address || ''), h('div', null, o.customer_phone || '')),
            h('td', null, o.items.map((x) => `${x.name} ×${fmtMoney(x.qty)}`).join(', ')), h('td', { class: 'r' }, money(o.total)), h('td', { style: { width: '70px' } })))),
          h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, `Tổng ${r.orders.length} điểm giao`), h('td', { class: 'r' }, money(t.total)), h('td')))),
        t.note ? h('div', { class: 'note' }, 'Ghi chú: ' + t.note) : null, sign('Người lập bảng kê', 'Tài xế', 'Thủ kho'))];
      mount(doc, sheets);
      msg.textContent = `${r.orders.length} điểm giao`;
    } else if (type === 'invoice') {
      const i = await GET('/api/invoices/' + encodeURIComponent(p.get('id')));
      document.title = 'Hoá đơn ' + i.code;
      mount(doc, h('section', { class: 'sheet' }, i.status === 'void' ? h('div', { class: 'stamp' }, 'Đã huỷ') : null,
        header(i.company, [h('div', null, 'Số: ', h('b', null, i.code)), i.external_no ? h('div', null, 'Số HĐ VAT: ' + i.external_no) : null, h('div', null, 'Ngày lập: ' + dmy(i.issue_date))]),
        h('h1', null, 'Bảng kê công nợ / hoá đơn'), h('div', { class: 'sub' }, `Kỳ ${dmy(i.period_from)} – ${dmy(i.period_to)}`),
        h('div', { class: 'info' }, h('div', null, h('b', null, 'Khách hàng:'), i.customer_name), h('div', null, h('b', null, 'Mã số thuế:'), i.customer_tax || ''), h('div', { style: { gridColumn: '1 / -1' } }, h('b', null, 'Địa chỉ:'), i.customer_address || '')),
        h('table', null, h('thead', null, h('tr', null, ['STT', 'Đơn hàng', 'Ngày giao', 'Hàng hoá', 'Thành tiền'].map((x) => h('th', null, x)))),
          h('tbody', null, i.orders.map((o, n) => h('tr', null, h('td', { class: 'c' }, String(n + 1)), h('td', null, o.code), h('td', { class: 'c' }, dmy(o.delivered_date || o.delivery_date)), h('td', null, o.items.map((x) => `${x.name} ×${fmtMoney(x.qty)}`).join(', ')), h('td', { class: 'r' }, money(o.total))))),
          h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, 'Tổng cộng'), h('td', { class: 'r' }, money(i.total))))),
        h('div', { class: 'tot' }, h('div', null, h('span', null, 'Đã thu'), h('span', null, money(i.paid))), h('div', { class: 'g' }, h('span', null, 'Còn phải thu'), h('span', null, money(i.balance)))),
        i.note ? h('div', { class: 'note' }, 'Ghi chú: ' + i.note) : null, sign('Người lập', 'Kế toán', 'Khách hàng xác nhận')));
    } else if (type === 'ledger') {
      const q = new URLSearchParams({ from: p.get('from') || '', to: p.get('to') || '' });
      const r = await GET(`/api/finance/ledger/${encodeURIComponent(p.get('id'))}?${q}`);
      document.title = 'Sổ công nợ ' + r.customer.name;
      mount(doc, h('section', { class: 'sheet' }, header(r.company, h('div', null, 'In ngày ' + dmy(CC.todayStr()))),
        h('h1', null, 'Sổ chi tiết công nợ phải thu'), h('div', { class: 'sub' }, `Từ ${dmy(r.from)} đến ${dmy(r.to)}`),
        h('div', { class: 'info' }, h('div', null, h('b', null, 'Khách hàng:'), `${r.customer.name} (${r.customer.code})`), h('div', null, h('b', null, 'Điện thoại:'), r.customer.phone || ''), h('div', { style: { gridColumn: '1 / -1' } }, h('b', null, 'Địa chỉ:'), r.customer.address || '')),
        h('table', null, h('thead', null, h('tr', null, ['Ngày', 'Chứng từ', 'Diễn giải', 'Ghi nợ', 'Ghi có', 'Số dư'].map((x) => h('th', null, x)))),
          h('tbody', null, h('tr', null, h('td', { colspan: 5 }, h('i', null, 'Số dư đầu kỳ')), h('td', { class: 'r' }, money(r.opening))),
            r.entries.map((e) => h('tr', null, h('td', { class: 'c' }, dmy(e.date)), h('td', null, e.ref), h('td', null, e.text), h('td', { class: 'r' }, e.debit ? money(e.debit) : ''), h('td', { class: 'r' }, e.credit ? money(e.credit) : ''), h('td', { class: 'r' }, money(e.balance))))),
          h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, 'Cộng phát sinh / Số dư cuối kỳ'), h('td', { class: 'r' }, money(r.debit)), h('td', { class: 'r' }, money(r.credit)), h('td', { class: 'r' }, money(r.closing))))),
        sign('Người lập', 'Kế toán trưởng', 'Khách hàng xác nhận')));
    } else throw new Error('Loại chứng từ không hợp lệ');
    // Tự mở hộp thoại in khi trang đã dựng xong
    setTimeout(() => window.print(), 400);
  }
  run().catch((e) => mount(doc, h('div', { style: { padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' } }, h('h2', null, 'Không in được'), h('p', null, e.message))));
})();
