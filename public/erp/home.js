'use strict';
/* Trang chủ: banner, 4 chỉ số, biểu đồ doanh thu 7 ngày, đơn mới nhất, tình trạng đơn, thông báo, chấm công hôm nay và 6 ô chức năng. */
(function () {
  const { h, mount, GET, svgEl, fmtMoney } = CC;
  const E = ERP;

  const shortMoney = (n) => (n >= 1e9 ? (n / 1e9).toFixed(n % 1e9 ? 1 : 0) + ' tỷ' : n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 1 : 0) + 'tr' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n)).replace('.', ',');

  function kpi(cls, icon, label, value, small, route, smallCls) {
    return h('a', { class: 'kpi ' + cls, href: '#/' + route }, h('span', { class: 'ic2' }, E.ico(icon)),
      h('div', { style: { minWidth: 0 } }, h('span', { class: 'l' }, label), h('b', { class: value.length > 9 ? 'sm' : '' }, value), small ? h('small', { class: smallCls || '' }, small) : null));
  }

  function barChart(days) {
    const box = h('div', { class: 'chart' });
    const draw = () => {
      const W = Math.max(220, box.clientWidth || 300), H = 200, L = 42, B = 24, T = 10;
      const max = Math.max(1, ...days.map((d) => d.total));
      const step = (() => { const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw)); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
      const top = step * 4;
      const y = (v) => T + (H - T - B) * (1 - v / top);
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'bars', role: 'img', 'aria-label': 'Doanh thu 7 ngày gần đây' });
      svg.append(svgEl('defs', null, svgEl('linearGradient', { id: 'bg', x1: 0, x2: 0, y1: 0, y2: 1 }, svgEl('stop', { offset: '0', 'stop-color': '#e5242b' }), svgEl('stop', { offset: '1', 'stop-color': '#b3121a' }))));
      for (let i = 0; i <= 4; i++) {
        const v = step * i;
        svg.append(svgEl('line', { x1: L, x2: W - 4, y1: y(v), y2: y(v), stroke: '#e3e8f1' }), svgEl('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#78818f' }, v ? shortMoney(v) : '0'));
      }
      const bw = (W - L - 6) / days.length;
      days.forEach((d, i) => {
        const x = L + i * bw + bw * 0.2;
        const bh = Math.max(d.total ? 2 : 0, (H - T - B) * (d.total / top));
        svg.append(svgEl('rect', { x, y: H - B - bh, width: bw * 0.6, height: bh, rx: 3, fill: 'url(#bg)' }, svgEl('title', null, `${d.date.slice(8)}/${d.date.slice(5, 7)}: ${E.money(d.total)}`)),
          svgEl('text', { x: x + bw * 0.3, y: H - 7, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#78818f' }, `${d.date.slice(8)}/${d.date.slice(5, 7)}`));
      });
      mount(box, svg);
    };
    requestAnimationFrame(draw);
    if (window.ResizeObserver) { let w = 0; new ResizeObserver(() => { if (box.clientWidth && Math.abs(box.clientWidth - w) > 8) { w = box.clientWidth; draw(); } }).observe(box); }
    return box;
  }

  function donut(sd) {
    const items = [['new', 'Mới', '#e0262c'], ['producing', 'Đang sản xuất', '#1f6fe0'], ['delivering', 'Đang giao', '#f58a1f'], ['delivered', 'Đã giao', '#1ea35a']];
    const total = items.reduce((s, [k]) => s + sd[k], 0);
    const R = 46, C = 2 * Math.PI * R;
    const svg = svgEl('svg', { viewBox: '0 0 120 120', width: 150, height: 150, role: 'img', 'aria-label': 'Tình trạng đơn hàng' });
    svg.append(svgEl('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: '#eef1f7', 'stroke-width': 16 }));
    let off = 0;
    if (total) {
      for (const [k, , col] of items) {
        if (!sd[k]) continue;
        const len = (sd[k] / total) * C;
        svg.append(svgEl('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: col, 'stroke-width': 16, 'stroke-dasharray': `${Math.max(0, len - 1.5)} ${C - len + 1.5}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 60 60)' }));
        off += len;
      }
    }
    svg.append(svgEl('text', { x: 60, y: 55, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#78818f' }, 'Tổng đơn'), svgEl('text', { x: 60, y: 74, 'text-anchor': 'middle', 'font-size': 20, 'font-weight': 800, fill: '#17202b' }, String(total)));
    const legend = h('div', { class: 'legend' }, items.map(([k, l, col]) => h('div', null, h('i', { style: { background: col } }), l, h('b', null, String(sd[k])), h('em', null, total ? Math.round((sd[k] / total) * 100) + '%' : '0%'))));
    return h('div', { class: 'donutwrap' }, svg, legend);
  }

  const TILES = [
    { n: 1, title: 'Quản lý', desc: 'Khách hàng · Nhân viên', desc2: 'Hồ sơ · Đơn từ', icon: 'users', cls: 'red', route: 'customers', need: () => E.can('manage', 'orders', 'delivery', 'finance') || E.isMgr(), alt: 'e/employees' },
    { n: 2, title: 'Nhập đơn', desc: 'App khách · Nhập tay · Excel', desc2: 'Phiếu làm hàng · Check in', icon: 'doc', cls: 'blue', route: 'orders', need: () => E.can('orders', 'delivery', 'finance', 'warehouse') },
    { n: 3, title: 'Điều hành giao hàng', desc: 'Phân bổ hàng hoá · Điều đơn', desc2: 'Gán tuyến cho tài xế', icon: 'truck', cls: 'orange', route: 'delivery', need: () => E.can('delivery') || E.isDriver(), alt: 'my-trips' },
    { n: 4, title: 'Chấm công', desc: 'Nhận diện khuôn mặt', desc2: 'qua camera iPad · Bảng công', icon: 'calcheck', cls: 'green', route: 'e/dashboard', need: () => true, alt: '/cc/' },
    { n: 5, title: 'Hệ thống', desc: 'Cập nhật phiên bản · Sao lưu', desc2: 'Phân quyền · Nhật ký', icon: 'settings', cls: 'purple', route: 'e/update', need: E.isAdmin },
    { n: 6, title: 'Tài chính kế toán', desc: 'Bảng giá · Chốt công nợ', desc2: 'Xuất hoá đơn · Thu tiền', icon: 'invoice', cls: 'teal', route: 'debts', need: () => E.can('finance') },
  ];

  function tile(t) {
    const ok = t.need();
    // Chấm công: quản lý xem tổng quan, nhân viên mở thẳng app chấm công
    let href = '#/' + t.route;
    let ext = false;
    if (t.n === 4 && !E.isMgr()) { href = '/cc/'; ext = true; }
    if (t.n === 1 && !E.can('manage', 'orders', 'delivery', 'finance')) href = '#/' + t.alt;
    if (t.n === 3 && !E.can('delivery') && E.isDriver()) href = '#/' + t.alt;
    const kids = [h('span', { class: 'ic2' }, E.ico(t.icon)), h('div', { style: { minWidth: 0 } }, h('h3', null, `${t.n}. ${t.title}`), h('p', null, t.desc, h('br'), t.desc2)), h('span', { class: 'go' }, E.ico('right'))];
    if (!ok) return h('button', { class: 'tile ' + t.cls + ' lock', type: 'button', title: 'Bạn chưa được cấp quyền', onclick: () => CC.toast('Bạn chưa được cấp quyền dùng chức năng này', 'err') }, kids);
    return ext ? h('a', { class: 'tile ' + t.cls, href, target: '_blank', rel: 'noopener' }, kids) : h('a', { class: 'tile ' + t.cls, href }, kids);
  }

  E.page('home', {
    title: 'Trang chủ',
    async render(el) {
      const d = await GET('/api/erp/dashboard');
      const o = d.orders;
      const name = E.st.info.company_name;

      const banner = h('section', { class: 'banner' }, h('div', { class: 'txt' },
        h('div', { class: 'hi' }, 'Chào mừng bạn đến với'), h('h2', null, 'Hệ thống quản lý'), h('h3', null, name),
        h('div', { class: 'tag' }, 'Hiệu quả hơn', h('i', null, '·'), 'Chính xác hơn', h('i', null, '·'), 'Phát triển bền vững')));

      const left = [];
      if (o) {
        const delta = o.yesterday ? Math.round(((o.today - o.yesterday) / o.yesterday) * 100) : null;
        const dl = delta === null ? (o.today ? 'Hôm qua chưa có đơn' : '') : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% so với hôm qua`;
        left.push(h('section', { class: 'kpis' },
          kpi('red', 'calendar', 'Đơn hàng hôm nay', String(o.today), dl, 'orders', delta !== null && delta < 0 ? 'down' : 'up'),
          kpi('green', 'box', 'Đang làm hàng', String(o.producing), o.new_open ? `${o.new_open} đơn mới chờ in phiếu làm hàng` : 'Không có đơn mới chờ', 'production'),
          kpi('orange', 'truck', 'Đang giao hàng', String(o.delivering), o.unassigned ? `${o.unassigned} đơn cần giao chưa gán chuyến` : 'Đã gán hết chuyến', 'delivery'),
          d.receivable ? kpi('blue', 'invoice', 'Công nợ phải thu', E.money(d.receivable.total), `${d.receivable.customers} khách hàng còn nợ`, 'debts') : kpi('blue', 'check', 'Chờ check in hàng', String(o.to_check), o.checked_wait ? `${o.checked_wait} đơn đã check in chờ giao` : 'Hàng soạn xong thì check in', 'checkin')));
        const todo = [
          ['Đơn mới từ app khách', o.from_app_new, 'orders'], ['Đơn mới chờ in phiếu làm hàng', o.new_open, 'production'], ['Đơn đang làm, chờ check in', o.to_check, 'checkin'],
          ['Đã check in, chờ giao', o.checked_wait, 'delivery'], ['Cần giao hôm nay chưa gán chuyến', o.unassigned, 'delivery'],
        ];
        const todoBox = h('div', { class: 'panel chartbox' }, h('h3', null, 'Việc cần làm hôm nay'), h('div', { class: 'notes' }, todo.map(([t, n, r]) => h('a', { href: '#/' + r, style: { gridTemplateColumns: '1fr auto' } }, h('span', null, t), h('b', { class: n ? 'neg' : 'muted' }, String(n || 0))))));

        const latest = o.latest.length
          ? h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Mã đơn', 'Khách hàng', E.sees() ? 'Tổng tiền' : null, 'Trạng thái', 'Giờ'].filter(Boolean).map((x) => h('th', null, x)))),
            h('tbody', null, o.latest.map((r) => h('tr', null, h('td', null, h('a', { class: 'lnk', href: '#/order/' + r.code }, r.code)), h('td', null, r.customer_name), E.sees() ? h('td', { class: 'r nw' }, E.money(r.total)) : null, h('td', null, E.statusChip(r.status)), h('td', { class: 'nw' }, CC.hhmm(r.created_at)))))))
          : h('div', { class: 'empty' }, 'Chưa có đơn hàng nào');
        left.push(h('section', { class: 'charts' },
          o.revenue7 ? h('div', { class: 'panel chartbox' }, h('h3', null, 'Doanh thu 7 ngày gần đây'), barChart(o.revenue7)) : todoBox,
          h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Đơn hàng mới nhất'), h('a', { href: '#/orders' }, 'Xem tất cả ›')), latest),
          h('div', { class: 'panel chartbox' }, h('h3', null, 'Tình trạng đơn hàng hôm nay'), donut(o.status_today))));
      } else {
        left.push(h('div', { class: 'panel pb' }, h('p', { class: 'muted' }, 'Tài khoản của bạn chưa được cấp quyền xem số liệu đơn hàng. Hãy dùng các ô chức năng bên dưới.')));
      }

      const notes = h('div', { class: 'notes' }, h('div', { class: 'empty', style: { padding: '14px' } }, E.loading()));
      const att = d.attendance;
      const attBox = h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Chấm công hôm nay'), att.checked_in ? E.chip('Đã điểm danh', 'ok') : att.tracked ? E.chip('Chưa điểm danh', 'warn') : null),
        h('div', { class: 'pb att' }, h('span', { class: 'avatar' }, CC.initials(E.st.user.full_name)),
          h('div', { class: 't' }, h('b', null, E.st.user.full_name), h('span', null, att.first_in ? CC.hhmm(att.first_in) : att.tracked ? 'Chưa có lượt chấm công' : 'Không theo dõi chấm công')),
          h('a', { class: 'btn sm', href: '/cc/', target: '_blank', rel: 'noopener' }, 'Chấm công')));
      const right = h('aside', { class: 'right' },
        h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Thông báo mới'), h('a', { href: '#/home', onclick: (e) => { e.preventDefault(); document.querySelector('[aria-label="Thông báo"]').click(); } }, 'Xem tất cả ›')), h('div', { class: 'pb', style: { padding: '4px 14px' } }, notes)),
        attBox);
      mount(el, banner, h('div', { class: 'home' }, h('div', { class: 'left' }, left), right), h('section', { class: 'tiles', 'aria-label': 'Chức năng' }, TILES.map(tile)));

      E.loadNotes().then(() => {
        const items = E.st.notes.slice(0, 5);
        mount(notes, items.length ? items.map(E.noteEl) : h('div', { class: 'empty', style: { padding: '14px' } }, 'Chưa có thông báo'));
      });
      E.st.timers.push(setInterval(() => { if (location.hash === '#/home' || location.hash === '') E.route(); }, 120000));
    },
  });
})();
