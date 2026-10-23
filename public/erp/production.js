'use strict';
/* Làm hàng & soạn hàng: tổng hợp số lượng cần làm theo sản phẩm, in phiếu làm hàng; Check in hàng: kiểm đủ từng dòng rồi đẩy sang giao hàng.
   Màn hình không có giá: nhân viên kho chỉ thấy sản phẩm, số lượng và quy cách. */
(function () {
  const { h, mount, GET, POST, toast } = CC;
  const E = ERP;
  const fmtQ = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
  const itemsText = (o) => o.items.map((i) => `${i.name} ${fmtQ(i.qty)} ${i.unit}`).join(' · ');

  E.page('production', {
    title: 'Làm hàng & soạn hàng', allow: () => E.can('warehouse', 'orders'),
    async render(el, arg) {
      let day = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : CC.todayStr();
      let tab = 'todo';
      const sel = new Set();
      const body = h('div', { style: { display: 'contents' } });
      const dateIn = h('input', { class: 'in', type: 'date', value: day, 'aria-label': 'Ngày giao', onchange: (e) => { if (e.target.value) { day = e.target.value; sel.clear(); load(); } } });
      const shift = (n) => { day = CC.addDays(day, n); dateIn.value = day; sel.clear(); load(); };
      let data = null;

      async function load() {
        mount(body, E.loading());
        try { data = await GET('/api/production?date=' + day); draw(); } catch (e) { mount(body, E.errorBox(e, load)); }
      }
      function print(ids) {
        if (!ids.length) return toast('Không có đơn nào để in', 'err');
        E.printOpen('prod', { ids: ids.join(','), date: day });
        setTimeout(load, 1800);
      }
      function draw() {
        const todo = data.orders.filter((o) => !o.checked_at && (o.status === 'new' || o.status === 'producing'));
        const done = data.orders.filter((o) => o.checked_at || o.status === 'delivering');
        const rows = tab === 'todo' ? todo : tab === 'done' ? done : data.orders;
        const newCount = todo.filter((o) => o.status === 'new').length;
        const summary = h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, `Tổng hợp cần làm (${data.summary.length} sản phẩm)`),
          h('button', { class: 'btn sm primary', type: 'button', disabled: !todo.length, onclick: () => print(todo.map((o) => o.id)) }, E.ico('print'), `In phiếu làm hàng tất cả (${todo.length} đơn)`)),
          E.table({ rows: data.summary, empty: 'Không còn hàng nào cần làm cho ngày này', cols: [
            { label: 'Nhóm', render: (r) => r.group_name }, { label: 'Sản phẩm', render: (r) => h('b', null, r.name) }, { label: 'Quy cách', render: (r) => r.spec },
            { label: 'Tổng số lượng', cls: 'r nw', render: (r) => h('b', null, `${fmtQ(r.qty)} ${r.unit}`) }, { label: 'Quy đổi', render: (r) => r.pack_text }, { label: 'Số đơn', cls: 'r', render: (r) => String(r.orders) }] }));
        const all = rows.length && rows.every((o) => sel.has(o.id));
        const list = h('div', { class: 'panel' },
          E.tabs([{ id: 'todo', label: 'Cần làm', n: todo.length }, { id: 'done', label: 'Đã check in', n: done.length }, { id: 'all', label: 'Tất cả', n: data.orders.length }], tab, (t) => { tab = t; sel.clear(); draw(); }),
          sel.size ? h('div', { class: 'callout', style: { margin: '10px 14px 0', flexWrap: 'wrap' } }, h('b', null, `Đã chọn ${sel.size} đơn`), h('button', { class: 'btn sm primary', type: 'button', onclick: () => print([...sel]) }, E.ico('print'), 'In phiếu làm hàng'), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { sel.clear(); draw(); } }, 'Bỏ chọn')) : null,
          E.table({ rows, empty: tab === 'todo' ? 'Không còn đơn nào cần làm' : 'Chưa có đơn nào', cols: [
            { label: h('input', { type: 'checkbox', checked: all, 'aria-label': 'Chọn tất cả', onchange: (e) => { rows.forEach((o) => (e.target.checked ? sel.add(o.id) : sel.delete(o.id))); draw(); } }), cls: 'c', w: '36px', render: (o) => h('input', { type: 'checkbox', checked: sel.has(o.id), 'aria-label': 'Chọn ' + o.code, onchange: (e) => { if (e.target.checked) sel.add(o.id); else sel.delete(o.id); draw(); } }) },
            { label: 'Đơn', cls: 'nw', render: (o) => h('div', null, h('a', { class: 'lnk', href: '#/order/' + o.code }, o.code), o.delivery_date < day ? h('span', { class: 'sub2 neg' }, 'Trễ hẹn ' + E.dmy(o.delivery_date)) : null) },
            { label: 'Đại lý', render: (o) => h('div', null, o.customer_name, ' ', E.srcChip(o.source), o.customer_area ? h('span', { class: 'sub2' }, o.customer_area) : null) },
            { label: 'Hàng hoá', render: (o) => itemsText(o) },
            { label: 'Trạng thái', render: (o) => h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, E.statusChip(o.status), E.checkChip(o), o.trip_code ? E.chip(o.trip_code) : null) },
            { label: '', render: (o) => h('div', { class: 'acts' },
              h('button', { class: 'btn sm ghost icon', type: 'button', title: 'In phiếu làm hàng', 'aria-label': 'In phiếu làm hàng', onclick: () => print([o.id]) }, E.ico('print')),
              !o.checked_at && (o.status === 'new' || o.status === 'producing') ? h('a', { class: 'btn sm primary', href: '#/checkin/' + o.code }, 'Check in') : null) },
          ] }));
        mount(body, h('div', { class: 'stats' },
          h('div', { class: 'stat' + (newCount ? ' warn' : '') }, h('span', null, 'Đơn mới chưa in phiếu'), h('b', null, String(newCount))),
          h('div', { class: 'stat' }, h('span', null, 'Đang làm, chờ check in'), h('b', null, String(todo.length - newCount))),
          h('div', { class: 'stat' }, h('span', null, 'Đã check in'), h('b', null, String(done.length)))), summary, list);
      }

      mount(el, E.head('Làm hàng & soạn hàng', 'Theo ngày giao. In phiếu làm hàng thì đơn chuyển sang "Đang làm hàng"; soạn xong thì check in.',
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Ngày trước', onclick: () => shift(-1) }, E.ico('left')), dateIn,
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Ngày sau', onclick: () => shift(1) }, E.ico('right')),
          h('button', { class: 'btn', type: 'button', onclick: () => { day = CC.todayStr(); dateIn.value = day; load(); } }, 'Hôm nay')),
        h('a', { class: 'btn primary', href: '#/checkin' }, E.ico('check'), 'Check in hàng')), body);
      await load();
      E.st.timers.push(setInterval(() => { if (!sel.size && location.hash.startsWith('#/production')) load(); }, 60000));
    },
  });

  /* ---------- Check in hàng ---------- */
  E.page('checkin', {
    title: 'Check in hàng', allow: () => E.can('warehouse', 'orders'),
    async render(el, arg) {
      const scan = h('input', { class: 'in', type: 'text', placeholder: 'Quét mã vạch hoặc gõ mã đơn (DH000123) rồi Enter', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', style: { fontSize: '18px', minHeight: '52px' }, 'aria-label': 'Mã đơn' });
      const work = h('div');
      const waiting = h('div');
      async function loadWaiting() {
        try {
          const d = await GET('/api/production?date=' + CC.todayStr());
          const rows = d.orders.filter((o) => !o.checked_at && (o.status === 'new' || o.status === 'producing'));
          mount(waiting, E.table({ rows, empty: 'Không còn đơn nào chờ check in hôm nay', cols: [
            { label: 'Đơn', cls: 'nw', render: (o) => o.code }, { label: 'Đại lý', render: (o) => o.customer_name }, { label: 'Hàng hoá', render: (o) => itemsText(o) },
            { label: 'Trạng thái', render: (o) => E.statusChip(o.status) },
            { label: '', render: (o) => h('div', { class: 'acts' }, h('button', { class: 'btn sm primary', type: 'button', onclick: () => open(o.code) }, 'Kiểm hàng')) }] }));
        } catch (e) { mount(waiting, E.errorBox(e, loadWaiting)); }
      }
      async function open(code) {
        code = String(code || '').trim().toUpperCase();
        if (!code) return;
        mount(work, E.loading());
        let o;
        try { o = await GET('/api/orders/by-code/' + encodeURIComponent(code)); } catch (e) { mount(work, h('div', { class: 'callout err' }, e.message)); scan.select(); return; }
        const ticks = o.items.map(() => false);
        const btn = h('button', { class: 'btn primary', type: 'button', style: { minHeight: '50px', fontSize: '16px' } }, E.ico('check'), 'Xác nhận check in');
        const done = !!o.checked_at || o.status === 'delivering' || o.status === 'delivered' || o.status === 'cancelled';
        const refreshBtn = () => { btn.disabled = done || ticks.some((t) => !t); };
        const lines = o.items.map((i, n) => {
          const cb = h('input', { type: 'checkbox', disabled: done, style: { width: '24px', height: '24px' }, onchange: (e) => { ticks[n] = e.target.checked; refreshBtn(); } });
          return h('label', { class: 'ocard', style: { cursor: done ? 'default' : 'pointer', alignItems: 'center' } }, cb,
            h('div', { class: 'body2' }, h('b', null, i.name), h('span', null, `${i.spec || ''}${i.spec ? ' · ' : ''}${fmtQ(i.qty)} ${i.unit}`)), h('b', { style: { fontSize: '16px', whiteSpace: 'nowrap' } }, i.pack_text));
        });
        const allBtn = h('button', { class: 'btn sm', type: 'button', disabled: done, onclick: () => { work.querySelectorAll('.ocard input[type=checkbox]').forEach((c, n) => { c.checked = true; ticks[n] = true; }); refreshBtn(); } }, 'Đánh dấu đủ tất cả');
        btn.onclick = () => E.busy(btn, async () => {
          const r = await POST(`/api/orders/${o.id}/checkin`);
          toast(r.status === 'delivering' ? `Đã check in ${r.code}, hàng đã chuyển sang tài xế` : `Đã check in ${r.code}${r.trip_code ? ' (chuyến ' + r.trip_code + ')' : ', chờ gán chuyến giao'}`, 'ok');
          mount(work, h('div', { class: 'callout ok' }, E.ico('check'), `${r.code} · ${r.customer_name}: đã check in.`));
          scan.value = ''; scan.focus(); loadWaiting();
        });
        refreshBtn();
        const state = o.status === 'cancelled' ? h('div', { class: 'callout err' }, 'Đơn đã huỷ, không check in.')
          : o.checked_at ? h('div', { class: 'callout ok' }, `Đơn đã check in lúc ${CC.fmtDateTime(o.checked_at)}.`, E.can('orders', 'warehouse') && o.status === 'producing' ? h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await POST(`/api/orders/${o.id}/uncheck`); toast('Đã bỏ check in', 'ok'); open(o.code); loadWaiting(); } catch (e) { toast(e.message, 'err'); } } }, 'Bỏ check in') : null)
          : o.status === 'delivering' || o.status === 'delivered' ? h('div', { class: 'callout ok' }, 'Đơn đã giao cho tài xế.') : null;
        mount(work, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, `${o.code} · ${o.customer_name}`), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } }, E.statusChip(o.status), o.trip_code ? E.chip(`Chuyến ${o.trip_code}${o.driver_name ? ' · ' + o.driver_name : ''}`) : E.chip('Chưa gán chuyến', 'warn'))),
          h('div', { class: 'pb', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, state,
            o.note ? h('div', { class: 'callout' }, 'Ghi chú: ' + o.note) : null,
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, h('span', { class: 'muted' }, 'Kiểm từng dòng hàng đã soạn đủ rồi đánh dấu:'), allBtn),
            h('div', { class: 'panel' }, lines), btn)));
      }
      scan.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(scan.value); } });
      mount(el, E.head('Check in hàng', 'Kiểm hàng đã soạn trước khi giao. Đơn thuộc chuyến đang chạy sẽ được đẩy sang tài xế ngay.', h('a', { class: 'btn', href: '#/production' }, 'Làm hàng & soạn hàng')),
        h('div', { class: 'panel' }, h('div', { class: 'pb', style: { display: 'flex', gap: '10px', alignItems: 'center' } }, E.ico('search'), scan, h('button', { class: 'btn primary', type: 'button', onclick: () => open(scan.value) }, 'Mở đơn'))),
        work, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Đơn chờ check in hôm nay')), waiting));
      loadWaiting();
      if (arg) { scan.value = arg; open(arg); } else setTimeout(() => scan.focus(), 50);
    },
  });
})();
