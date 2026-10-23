'use strict';
/* Nhập đơn: danh sách đơn hàng, nhập/sửa đơn, chi tiết đơn, nhập từ Excel, in phiếu. */
(function () {
  const { h, mount, GET, POST, PUT, DEL, toast, dialog, confirmBox, promptBox, field, fmtMoney } = CC;
  const E = ERP;
  const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));
  const STEPS = ['new', 'producing', 'delivering', 'delivered'];

  // Bộ lọc nhớ lại khi quay về từ trang chi tiết
  const F = { status: '', q: '', from: '', to: '', page: 1, per: 30 };

  const canEditRow = (o) => ['new', 'producing'].includes(o.status) || (o.status === 'delivering' && E.st.user.role !== 'employee') || (o.status === 'delivered' && E.isAdmin());

  async function cancelFlow(o, done) {
    const reason = await promptBox('Huỷ đơn ' + o.code, 'Lý do huỷ', { okText: 'Huỷ đơn', hint: 'Đơn huỷ không tính vào doanh thu và công nợ. Có thể khôi phục sau.' });
    if (reason === null) return;
    try { await POST(`/api/orders/${o.id}/cancel`, { reason }); toast('Đã huỷ đơn ' + o.code, 'ok'); done(); } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- Danh sách ---------- */
  E.page('orders', {
    title: 'Quản lý đơn hàng',
    allow: () => E.can('orders', 'delivery', 'finance', 'warehouse'),
    async render(el) {
      const sel = new Set();
      const holder = h('div');
      const bulk = h('div', { class: 'callout', hidden: true, style: { margin: '10px 14px 0' } });
      const canWrite = E.can('orders');
      let rowsNow = [];
      let last = null;

      function drawBulk() {
        bulk.hidden = !sel.size;
        if (!sel.size) return;
        const st = E.select(STEPS.map((s) => ({ v: s, l: E.ST_LONG[s] })), '', { placeholder: 'Chuyển trạng thái...', cls: 'sm' });
        mount(bulk, h('b', null, `Đã chọn ${sel.size} đơn`),
          E.can('warehouse', 'orders') ? h('button', { class: 'btn sm', type: 'button', onclick: () => { E.printOpen('prod', { ids: [...sel].join(',') }); setTimeout(load, 1500); } }, E.ico('print'), 'In phiếu làm hàng') : null,
          h('button', { class: 'btn sm', type: 'button', onclick: () => E.printOpen('order', { ids: [...sel].join(',') }) }, E.ico('print'), 'In phiếu giao hàng'),
          canWrite ? [st, h('button', { class: 'btn sm primary', type: 'button', onclick: async () => {
            if (!st.value) return toast('Hãy chọn trạng thái', 'err');
            try { const r = await POST('/api/orders/bulk-status', { ids: [...sel], status: st.value }); toast(`Đã cập nhật ${r.ok} đơn${r.failed.length ? `, ${r.failed.length} đơn không đổi được: ${r.failed[0].error}` : ''}`, r.failed.length ? 'err' : 'ok'); sel.clear(); load(); } catch (e) { toast(e.message, 'err'); }
          } }, 'Áp dụng')] : null,
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { sel.clear(); draw(); } }, 'Bỏ chọn'));
      }

      function draw(r) {
        if (r) { rowsNow = r.rows; last = r; }
        const all = rowsNow.length && rowsNow.every((o) => sel.has(o.id));
        drawBulk();
        const cols = [
          { label: h('input', { type: 'checkbox', checked: all, 'aria-label': 'Chọn tất cả', onchange: (e) => { rowsNow.forEach((o) => (e.target.checked ? sel.add(o.id) : sel.delete(o.id))); draw(); } }), cls: 'c', w: '36px', render: (o) => h('input', { type: 'checkbox', checked: sel.has(o.id), 'aria-label': 'Chọn ' + o.code, onchange: (e) => { if (e.target.checked) sel.add(o.id); else sel.delete(o.id); drawBulk(); } }) },
          { label: 'Mã đơn', cls: 'nw', render: (o) => h('div', null, h('a', { class: 'lnk', href: '#/order/' + o.code }, o.code), o.print_count ? h('span', { class: 'sub2' }, `đã in ${o.print_count} lần`) : null) },
          { label: 'Khách hàng', render: (o) => h('div', null, o.customer_name, ' ', E.srcChip(o.source), h('span', { class: 'sub2' }, o.address || o.customer_phone)) },
          { label: 'Ngày đặt', cls: 'nw', render: (o) => E.dmy(o.order_date) },
          { label: 'Ngày giao', cls: 'nw', render: (o) => E.dmy(o.delivery_date) },
          ...(E.sees() ? [{ label: 'Tổng tiền', cls: 'r nw', render: (o) => E.money(o.total) }] : [{ label: 'Mặt hàng', cls: 'r', render: (o) => String(o.item_count) }]),
          { label: 'Trạng thái', render: (o) => h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, E.statusChip(o.status), E.checkChip(o)) },
          { label: 'Chuyến', cls: 'nw', render: (o) => o.trip_code || '' },
          { label: '', render: (o) => h('div', { class: 'acts' },
            h('button', { class: 'btn sm ghost icon', type: 'button', title: o.print_count ? 'In lại phiếu' : 'In phiếu', 'aria-label': 'In phiếu', onclick: () => E.printOpen('order', { ids: o.id }) }, E.ico('print')),
            canWrite && canEditRow(o) ? h('a', { class: 'btn sm ghost icon', href: '#/order-edit/' + o.id, title: 'Sửa đơn', 'aria-label': 'Sửa đơn' }, E.ico('edit')) : null,
            canWrite && o.status !== 'cancelled' ? h('button', { class: 'btn sm ghost icon', type: 'button', title: 'Huỷ đơn', 'aria-label': 'Huỷ đơn', onclick: () => cancelFlow(o, load) }, E.ico('x')) : null) },
        ];
        mount(holder, E.table({ cols, rows: rowsNow, empty: 'Không có đơn hàng nào phù hợp', rowClass: (o) => (o.status === 'cancelled' ? 'off' : '') }),
          last ? E.pager({ total: last.count, page: last.page, per: last.per, onPage: (p) => { F.page = p; load(); } }) : null);
        if (last) summary.textContent = E.sees() ? `Tổng giá trị (không tính đơn huỷ): ${E.money(last.sum)}` : `${last.count} đơn`;
      }

      const qs = () => {
        const p = new URLSearchParams({ page: F.page, per: F.per });
        if (F.status) p.set('status', F.status);
        if (F.source) p.set('source', F.source);
        if (F.q) p.set('q', F.q);
        if (F.from) p.set('from', F.from);
        if (F.to) p.set('to', F.to);
        return p.toString();
      };
      async function load() {
        mount(holder, E.loading());
        try { draw(await GET('/api/orders?' + qs())); } catch (e) { mount(holder, E.errorBox(e, load)); }
        drawTabs();
      }

      const summary = h('span', { class: 'muted' });
      const tabsBox = h('div');
      const drawTabs = () => mount(tabsBox, E.tabs([{ id: '', label: 'Tất cả' }, ...STEPS.map((s) => ({ id: s, label: E.ST_LONG[s] })), { id: 'cancelled', label: 'Đã huỷ' }], F.status, (id) => { F.status = id; F.page = 1; sel.clear(); load(); }));
      const qIn = h('input', { class: 'in', type: 'search', placeholder: 'Mã đơn, khách hàng, địa chỉ...', value: F.q, 'aria-label': 'Tìm đơn hàng' });
      qIn.addEventListener('input', CC.debounce(() => { F.q = qIn.value.trim(); F.page = 1; load(); }, 300));
      const fromIn = h('input', { class: 'in', type: 'date', value: F.from, onchange: (e) => { F.from = e.target.value; F.page = 1; load(); } });
      const toIn = h('input', { class: 'in', type: 'date', value: F.to, onchange: (e) => { F.to = e.target.value; F.page = 1; load(); } });
      const srcIn = E.select([{ v: 'app', l: 'App khách' }, { v: 'manual', l: 'Nhân viên nhập' }, { v: 'excel', l: 'File Excel' }], F.source || '', { placeholder: 'Tất cả nguồn', onchange: (e) => { F.source = e.target.value; F.page = 1; load(); } });
      const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => E.busy(exportBtn, () => CC.download('/api/orders/export?' + qs(), 'don-hang.xlsx')) }, E.ico('download'), 'Xuất Excel');

      mount(el,
        E.head('Quản lý đơn hàng', 'Đơn từ app khách, nhân viên nhập và file Excel: in phiếu, sửa, huỷ, theo dõi trạng thái',
          exportBtn,
          canWrite ? h('a', { class: 'btn', href: '#/order-import' }, E.ico('upload'), 'Nhập từ Excel') : null,
          canWrite ? h('a', { class: 'btn primary', href: '#/order-new' }, E.ico('plus'), 'Nhập đơn mới') : null),
        h('div', { class: 'panel' }, tabsBox,
          h('div', { class: 'filters' }, h('div', { class: 'field grow' }, h('label', null, 'Tìm kiếm'), qIn), h('div', { class: 'field' }, h('label', null, 'Từ ngày đặt'), fromIn), h('div', { class: 'field' }, h('label', null, 'Đến ngày'), toIn), h('div', { class: 'field' }, h('label', null, 'Nguồn đơn'), srcIn),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => { F.q = ''; F.from = ''; F.to = ''; F.status = ''; F.source = ''; F.page = 1; E.route(); } }, 'Xoá lọc')),
          bulk, holder, h('div', { class: 'pager' }, summary)));
      await load();
    },
  });

  /* ---------- Nhập / sửa đơn ---------- */
  // Chỉ chọn sản phẩm trong danh mục. Số lượng theo bước của sản phẩm (0,5 kg với hàng gói 500gr, 1 hộp, 5 kg với bịch 5kg...).
  // Giá do hệ thống áp theo bảng giá của tài chính; nhân viên không có quyền tài chính không thấy và không sửa được giá.
  const fmtQ = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
  const kgText = (kg) => (kg < 1 ? `${Math.round(kg * 1000)}gr` : `${fmtQ(kg)}kg`);
  function packText(p, qty) {
    if (!p || !qty) return '';
    if (!p.pack_kg) return `${fmtQ(qty)} kg rời`;
    if (p.unit === 'KG') return `${fmtQ(qty / p.pack_kg)} ${p.pack_noun} ${kgText(p.pack_kg)}`;
    return `${fmtQ(qty)} ${p.pack_noun} ${kgText(p.pack_kg)}`;
  }

  async function orderForm(el, order, presetCustomerId) {
    const sees = E.sees();
    const [customers, products] = await Promise.all([E.refs.customers(), E.refs.products()]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const isEdit = !!order;
    const today = CC.todayStr();
    const blank = () => ({ product_id: null, name: '', qty: '', price: '', manual: false });
    const S = {
      customer: isEdit ? customers.find((c) => c.id === order.customer_id) || { id: order.customer_id, name: order.customer_name, code: order.customer_code } : customers.find((c) => c.id === Number(presetCustomerId)) || null,
      items: isEdit ? order.items.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, price: sees ? i.price : '', manual: false })) : [],
      prices: {},
    };
    S.items.push(blank());
    async function loadPrices() {
      if (!sees || !S.customer) return;
      try { S.prices = await GET('/api/prices/for-customer/' + S.customer.id); } catch { S.prices = {}; }
      for (const it of S.items) if (it.product_id && !it.manual && !isEdit) it.price = S.prices[it.product_id] || 0;
      drawLines();
    }

    const inputs = {
      order_date: h('input', { class: 'in', type: 'date', value: isEdit ? order.order_date : today }),
      delivery_date: h('input', { class: 'in', type: 'date', value: isEdit ? order.delivery_date : CC.addDays(today, 1) }),
      address: h('input', { class: 'in', value: isEdit ? order.address : '', placeholder: 'Địa chỉ giao hàng' }),
      note: h('textarea', { class: 'in', style: { minHeight: '64px' } }, isEdit ? order.note : ''),
      discount: h('input', { class: 'in sm', type: 'number', min: 0, step: '1000', value: isEdit && sees ? order.discount : 0, style: { width: '130px', textAlign: 'right' } }),
    };
    const info = h('div');
    function drawInfo() {
      const c = S.customer;
      if (!c) { mount(info); return; }
      if (!sees) { mount(info, h('div', { class: 'callout ok' }, E.ico('user'), h('span', null, `${c.code}${c.area ? ' · ' + c.area : ''}${c.phone ? ' · ' + c.phone : ''}`))); return; }
      const over = c.credit_limit > 0 && c.debt > c.credit_limit;
      mount(info, h('div', { class: 'callout' + (over ? ' err' : ' ok') }, E.ico('user'), h('span', null, `${c.code} · công nợ hiện tại `, h('b', null, E.money(c.debt || 0)), c.credit_limit ? ` / hạn mức ${E.money(c.credit_limit)}` : '', over ? ' — đã vượt hạn mức.' : '')));
    }
    const cus = E.combo({
      items: () => customers.filter((c) => c.active !== 0), label: (c) => c.name, sub: (c) => c.code + (c.area ? ' · ' + c.area : '') + (c.phone ? ' · ' + c.phone : ''), placeholder: 'Gõ tên, mã hoặc số điện thoại đại lý...', value: S.customer ? S.customer.name : '',
      onPick: (c) => { S.customer = c; if (!inputs.address.value.trim()) inputs.address.value = c.address || ''; drawInfo(); loadPrices(); },
    });
    drawInfo();

    const tbody = h('tbody');
    const sumEl = h('div');
    const amountCells = [];
    const lineAmount = (it) => Math.round(num(it.qty) * num(it.price));
    function drawTotals() {
      if (!sees) { mount(sumEl, h('p', { class: 'muted' }, `${S.items.filter((i) => i.product_id).length} mặt hàng. Giá do bộ phận tài chính áp theo bảng giá.`)); return; }
      const sub = S.items.reduce((s, it) => s + lineAmount(it), 0);
      const disc = Math.min(Math.max(0, num(inputs.discount.value)), sub);
      S.items.forEach((it, i) => { if (amountCells[i]) amountCells[i].textContent = fmtMoney(lineAmount(it)); });
      mount(sumEl, h('div', { class: 'totals' }, h('div', null, h('span', null, 'Tạm tính'), h('b', null, E.money(sub))), h('div', null, h('span', null, 'Chiết khấu (đ)'), inputs.discount), h('div', { class: 'grand' }, h('span', null, 'Thành tiền'), h('span', null, E.money(sub - disc)))));
    }
    inputs.discount.addEventListener('input', drawTotals);

    function drawLines(focusLast) {
      amountCells.length = 0;
      const active = products.filter((p) => p.active !== 0);
      mount(tbody, S.items.map((it, i) => {
        const prod = it.product_id ? byId.get(it.product_id) : null;
        const hint = h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '3px' } }, prod ? `${prod.spec || ''}${prod.spec ? ' · ' : ''}${packText(prod, num(it.qty))}` : '');
        const nameBox = E.combo({ items: active, label: (p) => p.name, sub: (p) => `${p.code} · ${p.spec || ''} · ${p.unit}${sees ? ' · ' + E.money(S.prices[p.id] !== undefined ? S.prices[p.id] : p.price) : ''}`, placeholder: 'Chọn sản phẩm...', value: it.name,
          onPick: (p) => {
            if (S.items.some((x, j) => j !== i && x.product_id === p.id)) { toast(`"${p.name}" đã có trong đơn, hãy sửa số lượng dòng đó`, 'err'); drawLines(); return; }
            it.product_id = p.id; it.name = p.name; it.manual = false;
            if (!it.qty) it.qty = p.qty_step < 1 ? 1 : p.qty_step;
            if (sees) it.price = S.prices[p.id] !== undefined ? S.prices[p.id] : p.price;
            if (i === S.items.length - 1) S.items.push(blank());
            drawLines();
          } });
        nameBox.input.addEventListener('input', () => { it.product_id = null; it.name = nameBox.input.value; hint.textContent = ''; });
        const qty = h('input', { class: 'in qty', type: 'number', min: 0, step: prod ? prod.qty_step : 'any', value: it.qty, 'aria-label': 'Số lượng',
          oninput: (e) => { it.qty = e.target.value; hint.textContent = prod ? `${prod.spec || ''}${prod.spec ? ' · ' : ''}${packText(prod, num(it.qty))}` : ''; drawTotals(); } });
        const cells = [h('td', { class: 'c nw' }, String(i + 1)), h('td', { style: { minWidth: '240px' } }, nameBox.el, hint), h('td', { class: 'nw' }, prod ? prod.unit : ''), h('td', null, qty)];
        if (sees) {
          const price = h('input', { class: 'in price', type: 'number', min: 0, step: '500', value: it.price, 'aria-label': 'Đơn giá', title: 'Sửa giá riêng cho đơn này (chỉ bộ phận tài chính)', oninput: (e) => { it.price = e.target.value; it.manual = true; drawTotals(); } });
          const amt = h('span', null, fmtMoney(lineAmount(it)));
          amountCells[i] = amt;
          cells.push(h('td', null, price), h('td', { class: 'r nw' }, amt));
        }
        cells.push(h('td', null, h('button', { class: 'btn sm ghost icon', type: 'button', 'aria-label': 'Xoá dòng', onclick: () => { S.items.splice(i, 1); if (!S.items.length) S.items.push(blank()); drawLines(); } }, E.ico('trash'))));
        return h('tr', null, cells);
      }));
      if (focusLast) { const ins = tbody.querySelectorAll('tr:last-child input'); if (ins[0]) ins[0].focus(); }
      drawTotals();
    }
    drawLines();
    loadPrices();

    const err = h('div', { class: 'callout err', hidden: true, role: 'alert' });
    function payload() {
      if (!S.customer) throw new Error('Vui lòng chọn khách hàng');
      const lines = S.items.filter((it) => it.product_id || it.name.trim());
      const bad = lines.find((it) => !it.product_id);
      if (bad) throw new Error(`"${bad.name}" chưa có trong danh mục. Hãy chọn sản phẩm từ danh sách gợi ý.`);
      if (!lines.length) throw new Error('Đơn hàng cần có ít nhất một sản phẩm');
      const items = lines.map((it) => ({ product_id: it.product_id, qty: num(it.qty), ...(sees && it.manual && it.price !== '' ? { price: num(it.price) } : {}) }));
      return { customer_id: S.customer.id, order_date: inputs.order_date.value, delivery_date: inputs.delivery_date.value, address: inputs.address.value.trim(), note: inputs.note.value.trim(), ...(sees ? { discount: num(inputs.discount.value) } : {}), items };
    }
    async function save(btn, thenPrint) {
      await E.busy(btn, async () => {
        err.hidden = true;
        try {
          const p = payload();
          const r = isEdit ? await PUT('/api/orders/' + order.id, p) : await POST('/api/orders', p);
          E.refs.clear();
          toast(isEdit ? 'Đã cập nhật đơn ' + r.code : 'Đã tạo đơn ' + r.code, 'ok');
          if (thenPrint) E.printOpen('prod', { ids: r.id });
          E.go('order/' + r.code);
        } catch (e) { err.textContent = e.message; err.hidden = false; err.scrollIntoView({ block: 'center' }); }
      });
    }
    const b1 = h('button', { class: 'btn primary', type: 'button', onclick: () => save(b1, false) }, E.ico('check'), isEdit ? 'Lưu thay đổi' : 'Lưu đơn');
    const b2 = h('button', { class: 'btn', type: 'button', onclick: () => save(b2, true) }, E.ico('print'), 'Lưu & in phiếu làm hàng');
    const heads = ['#', 'Sản phẩm', 'ĐVT', 'Số lượng', ...(sees ? ['Đơn giá', 'Thành tiền'] : []), ''];

    mount(el,
      E.head(isEdit ? `Sửa đơn ${order.code}` : 'Nhập đơn mới', isEdit ? 'Sửa đơn sẽ bỏ trạng thái check in để kiểm lại hàng' : 'Chọn đại lý, chọn sản phẩm và số lượng rồi lưu', h('a', { class: 'btn', href: isEdit ? '#/order/' + order.code : '#/orders' }, 'Quay lại')),
      err,
      h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Thông tin đơn hàng')), h('div', { class: 'pb', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        field('Khách hàng đại lý', cus.el), info,
        h('div', { class: 'grid3' }, field('Ngày đặt', inputs.order_date), field('Ngày giao', inputs.delivery_date), field('Địa chỉ giao hàng', inputs.address)),
        field('Ghi chú', inputs.note))),
      h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Hàng hoá'), h('button', { class: 'btn sm', type: 'button', onclick: () => { S.items.push(blank()); drawLines(true); } }, E.ico('plus'), 'Thêm dòng')),
        h('div', { class: 'tablewrap lines', style: { overflow: 'visible' } }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, heads.map((x, i) => h('th', { class: i >= 3 && i < heads.length - 1 ? 'r' : '' }, x)))), tbody)),
        h('div', { class: 'pb' }, sumEl)),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' } }, h('a', { class: 'btn', href: isEdit ? '#/order/' + order.code : '#/orders' }, 'Huỷ bỏ'), b2, b1));
  }

  E.page('order-new', { title: 'Nhập đơn mới', nav: 'order-new', allow: () => E.can('orders'), render: (el, arg) => orderForm(el, null, arg) });
  E.page('order-edit', {
    title: 'Sửa đơn hàng', nav: 'orders', allow: () => E.can('orders'),
    async render(el, arg) { await orderForm(el, await GET('/api/orders/' + arg)); },
  });

  /* ---------- Chi tiết đơn ---------- */
  E.page('order', {
    title: (a) => 'Đơn ' + a, nav: 'orders', allow: () => E.can('orders', 'delivery', 'finance', 'warehouse'),
    async render(el, arg) {
      const o = await GET('/api/orders/' + encodeURIComponent(arg));
      const canWrite = E.can('orders');
      const refresh = () => E.route();
      const steps = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, STEPS.map((s) => {
        const on = o.status === s;
        return h('button', { class: 'btn sm' + (on ? ' primary' : ''), type: 'button', disabled: !canWrite || on || o.status === 'cancelled' || (!!o.invoice && o.status === 'delivered'), onclick: async () => {
          try { await POST(`/api/orders/${o.id}/status`, { status: s }); toast('Đã chuyển sang: ' + E.ST_LONG[s], 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); }
        } }, E.ST_LONG[s]);
      }));
      const editable = canWrite && o.status !== 'cancelled' && !o.invoice && canEditRow(o);
      const acts = [
        E.can('warehouse', 'orders') && o.status !== 'cancelled' ? h('button', { class: 'btn', type: 'button', onclick: () => { E.printOpen('prod', { ids: o.id }); setTimeout(refresh, 1500); } }, E.ico('print'), 'Phiếu làm hàng') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => E.printOpen('order', { ids: o.id }) }, E.ico('print'), o.print_count ? `In lại phiếu giao (đã in ${o.print_count})` : 'Phiếu giao hàng'),
        E.can('warehouse', 'orders') && !o.checked && ['new', 'producing'].includes(o.status) ? h('a', { class: 'btn primary', href: '#/checkin/' + o.code }, E.ico('check'), 'Check in hàng') : null,
        editable ? h('a', { class: 'btn', href: '#/order-edit/' + o.id }, E.ico('edit'), 'Sửa đơn') : null,
        canWrite && o.status !== 'cancelled' && !o.invoice ? h('button', { class: 'btn danger', type: 'button', onclick: () => cancelFlow(o, refresh) }, 'Huỷ đơn') : null,
        canWrite && o.status === 'cancelled' ? h('button', { class: 'btn', type: 'button', onclick: async () => { try { await POST(`/api/orders/${o.id}/restore`); toast('Đã khôi phục đơn', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); } } }, E.ico('undo'), 'Khôi phục đơn') : null,
        E.isAdmin() && o.status === 'cancelled' ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox(`Xoá hẳn đơn ${o.code}? Không thể khôi phục.`, { danger: true, okText: 'Xoá hẳn' })) { try { await DEL('/api/orders/' + o.id); toast('Đã xoá đơn', 'ok'); E.go('orders'); } catch (e) { toast(e.message, 'err'); } } } }, E.ico('trash'), 'Xoá hẳn') : null,
      ];
      const sees = E.sees();
      const items = E.table({ rows: o.items, cols: [
        { label: '#', cls: 'c', render: (_, i) => String(i + 1) }, { label: 'Sản phẩm', render: (i) => h('div', null, i.name, i.spec ? h('span', { class: 'sub2' }, i.spec) : null) }, { label: 'ĐVT', render: (i) => i.unit },
        { label: 'Số lượng', cls: 'r', render: (i) => fmtQ(i.qty) }, { label: 'Quy đổi', render: (i) => i.pack_text },
        ...(sees ? [{ label: 'Đơn giá', cls: 'r nw', render: (i) => E.money(i.price) }, { label: 'Thành tiền', cls: 'r nw', render: (i) => E.money(i.amount) }] : []),
      ] });
      mount(el,
        E.head(o.code, `Tạo lúc ${CC.fmtDateTime(o.created_at)} · nguồn: ${E.SRC[o.source] || o.source}${o.checked_at ? ' · đã check in ' + CC.fmtDateTime(o.checked_at) : ''}`, E.statusChip(o.status), E.checkChip(o), ...acts, h('a', { class: 'btn', href: '#/orders' }, 'Danh sách')),
        o.status === 'cancelled' ? h('div', { class: 'callout err' }, `Đơn đã huỷ${o.cancel_reason ? ': ' + o.cancel_reason : ''}`) : null,
        o.invoice ? h('div', { class: 'callout ok' }, E.ico('invoice'), `Đơn đã chốt vào hoá đơn ${o.invoice.code}. Muốn sửa hoặc huỷ đơn, hãy huỷ hoá đơn trước.`) : null,
        canWrite && o.status !== 'cancelled' ? h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Trạng thái đơn hàng'), h('span', { class: 'muted' }, 'Quy trình: Mới → In phiếu làm hàng (Đang làm hàng) → Check in → Gán chuyến, xuất phát (Đang giao) → Đã giao')), h('div', { class: 'pb' }, steps)) : null,
        h('div', { class: 'cols2' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 } },
            h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Hàng hoá')), items,
              sees ? h('div', { class: 'pb' }, h('div', { class: 'totals' }, h('div', null, h('span', null, 'Tạm tính'), h('span', null, E.money(o.subtotal))), o.discount ? h('div', null, h('span', null, 'Chiết khấu'), h('span', null, '-' + E.money(o.discount))) : null, h('div', { class: 'grand' }, h('span', null, 'Thành tiền'), h('span', null, E.money(o.total))))) : null)),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 } },
            h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Thông tin')), h('dl', { class: 'kv pb' },
              h('dt', null, 'Khách hàng'), h('dd', null, h('a', { href: '#/customers/' + o.customer_id }, o.customer_name), h('div', { class: 'muted' }, o.customer_code + (o.customer_phone ? ' · ' + o.customer_phone : ''))),
              h('dt', null, 'Địa chỉ giao'), h('dd', null, o.address || '—'),
              h('dt', null, 'Ngày đặt'), h('dd', null, E.dmy(o.order_date)), h('dt', null, 'Ngày giao'), h('dd', null, E.dmy(o.delivery_date)),
              o.trip_code ? [h('dt', null, 'Chuyến giao'), h('dd', null, `${o.trip_code}${o.driver_name ? ' · ' + o.driver_name : ''}${o.route_name ? ' · ' + o.route_name : ''}`)] : null,
              o.note ? [h('dt', null, 'Ghi chú'), h('dd', null, o.note)] : null)),
            h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Lịch sử đơn hàng')), h('div', { class: 'pb timeline' }, o.events.map((ev) => h('div', null, h('i'), h('div', null, ev.detail, h('small', null, `${CC.fmtDateTime(ev.ts)} · ${ev.actor_name}`)))))))));
    },
  });

  /* ---------- Nhập từ Excel ---------- */
  E.page('order-import', {
    title: 'Nhập đơn từ Excel', nav: 'order-import', allow: () => E.can('orders'),
    render(el) {
      const S = { file: null, b64: '', result: null };
      const out = h('div');
      const createCus = h('input', { type: 'checkbox' });
      const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true });
      const drop = h('div', { class: 'dropzone', tabindex: '0', role: 'button', 'aria-label': 'Chọn file Excel' }, E.ico('upload'), h('p', null, h('b', null, 'Chọn file Excel (.xlsx) hoặc CSV'), ' hoặc kéo thả vào đây'), h('p', { class: 'muted' }, 'Mỗi dòng là một dòng hàng. Hệ thống sẽ cho bạn xem trước trước khi tạo đơn.'));

      async function readFile(f) {
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) return toast('File quá lớn (tối đa 5 MB)', 'err');
        S.file = f;
        S.b64 = E.toBase64(await f.arrayBuffer());
        preview();
      }
      async function preview() {
        mount(out, E.loading());
        try { S.result = await POST('/api/orders/import', { filename: S.file.name, data: S.b64, create_customers: createCus.checked }); drawPreview(); } catch (e) { mount(out, h('div', { class: 'callout err' }, e.message)); }
      }
      function drawPreview() {
        const r = S.result;
        const ok = r.orders.filter((o) => !o.errors.length);
        const bad = r.orders.length - ok.length;
        const commit = h('button', { class: 'btn primary', type: 'button', disabled: !ok.length }, E.ico('check'), `Tạo ${ok.length} đơn hàng`);
        commit.onclick = () => E.busy(commit, async () => {
          const c = await POST('/api/orders/import', { filename: S.file.name, data: S.b64, create_customers: createCus.checked, commit: true });
          E.refs.clear();
          mount(out, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Kết quả nhập đơn')), h('div', { class: 'pb', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
            h('div', { class: 'callout ok' }, E.ico('check'), `Đã tạo ${c.created.length} đơn hàng`),
            c.skipped.length ? h('div', { class: 'callout err' }, h('div', null, h('b', null, `${c.skipped.length} đơn bị bỏ qua:`), c.skipped.map((s) => h('div', null, `Dòng ${s.row} (${s.customer}): ${s.errors.join('; ')}`)))) : null,
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, c.created.map((o) => h('a', { class: 'btn sm', href: '#/order/' + o.code }, o.code)),
              h('a', { class: 'btn primary', href: '#/orders' }, 'Xem danh sách đơn')))));
        });
        mount(out, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, `Xem trước: ${r.orders.length} đơn từ file "${S.file.name}"`), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, bad ? E.chip(`${bad} đơn có lỗi sẽ bị bỏ qua`, 'seal') : E.chip('Tất cả hợp lệ', 'ok'), commit)),
          r.errors.length ? h('div', { class: 'pb' }, h('div', { class: 'callout err' }, h('div', null, r.errors.slice(0, 8).map((x) => h('div', null, `Dòng ${x.row}: ${x.msg}`)), r.errors.length > 8 ? h('div', null, `... và ${r.errors.length - 8} lỗi khác`) : null))) : null,
          E.table({ rows: r.orders, empty: 'File không có đơn nào', cols: [
            { label: 'Dòng', cls: 'c', render: (o) => String(o.row) },
            { label: 'Khách hàng', render: (o) => h('div', null, o.customer_name, o.new_customer ? h('span', { class: 'sub2' }, 'Khách mới, sẽ tự tạo') : null) },
            { label: 'Ngày giao', cls: 'nw', render: (o) => E.dmy(o.delivery_date) },
            { label: 'Hàng hoá', render: (o) => o.items.map((i) => `${i.name} ×${fmtQ(i.qty)}`).join(', ') },
            ...(E.sees() ? [{ label: 'Thành tiền', cls: 'r nw', render: (o) => E.money(o.total) }] : []),
            { label: 'Kiểm tra', render: (o) => (o.errors.length ? h('div', { class: 'neg' }, o.errors.map((x) => h('div', null, x))) : E.chip('Hợp lệ', 'ok')) },
          ] })));
      }

      createCus.addEventListener('change', () => { if (S.file) preview(); });
      drop.addEventListener('click', () => fileIn.click());
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); readFile(e.dataTransfer.files[0]); });
      fileIn.addEventListener('change', () => readFile(fileIn.files[0]));
      const tpl = h('button', { class: 'btn', type: 'button', onclick: () => E.busy(tpl, () => CC.download('/api/orders/template', 'mau-nhap-don.xlsx')) }, E.ico('download'), 'Tải file mẫu');

      mount(el, E.head('Nhập đơn từ Excel', 'Nhập nhiều đơn cùng lúc từ bảng tính', tpl, h('a', { class: 'btn', href: '#/orders' }, 'Danh sách đơn')),
        h('div', { class: 'panel' }, h('div', { class: 'pb', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
          h('ol', { style: { margin: 0, paddingLeft: '20px', color: 'var(--ink-2)', fontSize: '14px', lineHeight: 1.7 } },
            h('li', null, 'Tải file mẫu, điền: Khách hàng (mã hoặc tên), Sản phẩm (mã SP01... hoặc tên), Số lượng, Ngày giao.'),
            h('li', null, 'Số lượng theo đơn vị tính: hàng gói tính KG (bội 0,5), nui tươi tính HỘP, hủ tiếu dai bội 5 kg. Không cần nhập giá: hệ thống tự áp theo bảng giá.'),
            h('li', null, 'Các dòng cùng "Mã đơn (nhóm)" được gộp thành một đơn.'),
            h('li', null, 'Chọn file, kiểm tra kết quả xem trước, rồi bấm tạo đơn.')),
          drop, fileIn, h('label', { class: 'check' }, createCus, 'Tự tạo khách hàng mới nếu chưa có trong danh mục')), out));
    },
  });
})();
