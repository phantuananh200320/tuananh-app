'use strict';
/* Tài chính kế toán: công nợ phải thu, sổ chi tiết, thu tiền, chốt công nợ và hoá đơn. */
(function () {
  const { h, mount, GET, POST, PUT, toast, dialog, confirmBox, promptBox, field, fmtMoney } = CC;
  const E = ERP;
  const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));
  const METHODS = [{ v: 'cash', l: 'Tiền mặt' }, { v: 'transfer', l: 'Chuyển khoản' }, { v: 'other', l: 'Khác' }];
  const METHOD_L = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', other: 'Khác' };
  const INV_ST = { issued: ['Chưa thu', 'warn'], partial: ['Thu một phần', 'stamp'], paid: ['Đã thu đủ', 'ok'], void: ['Đã huỷ', ''] };
  const invChip = (s) => E.chip(INV_ST[s][0], INV_ST[s][1]);
  const monthStart = () => CC.todayStr().slice(0, 8) + '01';
  const debtCls = (n) => (n > 0 ? 'neg' : n < 0 ? 'pos' : 'muted');

  /* ---------- Thu tiền ---------- */
  async function paymentDialog({ customer, invoice }, done) {
    const customers = await E.refs.customers();
    let cus = customer || null;
    const amount = h('input', { class: 'in', type: 'number', min: 1, step: '1000', value: invoice ? invoice.balance : cus && cus.debt > 0 ? cus.debt : '' });
    const method = E.select(METHODS, 'cash');
    const date = h('input', { class: 'in', type: 'date', value: CC.todayStr() });
    const note = h('input', { class: 'in', placeholder: 'Ví dụ: CK ngân hàng, thu tiền mặt đợt 1' });
    const invSel = E.select([], '', { placeholder: '— Không gắn hoá đơn —' });
    const info = h('div');
    async function onCustomer() {
      mount(info, cus ? h('div', { class: 'callout' }, `Công nợ hiện tại của ${cus.name}: `, h('b', null, E.money(cus.debt || 0))) : null);
      mount(invSel, h('option', { value: '' }, '— Không gắn hoá đơn —'));
      if (!cus) return;
      try {
        const list = (await GET('/api/invoices?customer_id=' + cus.id)).filter((i) => i.state === 'issued' || i.state === 'partial');
        list.forEach((i) => invSel.append(h('option', { value: i.id }, `${i.code} · còn ${E.money(i.balance)}`)));
        if (invoice) invSel.value = String(invoice.id);
      } catch { /* bỏ qua */ }
    }
    const cbox = E.combo({ items: () => customers, label: (c) => c.name, sub: (c) => c.code, placeholder: 'Chọn khách hàng...', value: cus ? cus.name : '', onPick: (c) => { cus = c; if (!amount.value && c.debt > 0) amount.value = c.debt; onCustomer(); } });
    const err = h('div', { class: 'callout err', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, E.ico('check'), 'Ghi nhận thu tiền');
    const d = dialog({ title: 'Thu tiền khách hàng', actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save],
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err, field('Khách hàng', cbox.el), info,
        h('div', { class: 'grid2' }, field('Số tiền thu (đ)', amount), field('Ngày thu', date)), h('div', { class: 'grid2' }, field('Hình thức', method), field('Gắn với hoá đơn', invSel)), field('Ghi chú', note)) });
    onCustomer();
    save.onclick = () => E.busy(save, async () => {
      err.hidden = true;
      try {
        if (!cus) throw new Error('Vui lòng chọn khách hàng');
        await POST('/api/payments', { customer_id: cus.id, amount: num(amount.value), method: method.value, paid_date: date.value, note: note.value, invoice_id: invSel.value || null });
        E.refs.clear(); d.close(); toast('Đã ghi nhận thu tiền', 'ok'); done();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    setTimeout(() => amount.focus(), 40);
  }

  /* ---------- Lập hoá đơn / chốt công nợ một khách ---------- */
  async function invoiceDialog(customer, done) {
    const customers = await E.refs.customers();
    let cus = customer || null;
    const from = h('input', { class: 'in', type: 'date', value: monthStart() });
    const to = h('input', { class: 'in', type: 'date', value: CC.todayStr() });
    const ext = h('input', { class: 'in', placeholder: 'Nếu đã xuất hoá đơn VAT ở phần mềm khác' });
    const note = h('input', { class: 'in' });
    const list = h('div');
    const chosen = new Set();
    let orders = [];
    const err = h('div', { class: 'callout err', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button', disabled: true }, E.ico('invoice'), 'Chốt & lập hoá đơn');
    function drawList() {
      const total = orders.filter((o) => chosen.has(o.id)).reduce((s, o) => s + o.total, 0);
      save.disabled = !chosen.size;
      mount(list, orders.length ? [E.table({ rows: orders, cols: [
        { label: h('input', { type: 'checkbox', checked: chosen.size === orders.length, 'aria-label': 'Chọn tất cả', onchange: (e) => { orders.forEach((o) => (e.target.checked ? chosen.add(o.id) : chosen.delete(o.id))); drawList(); } }), cls: 'c', w: '36px', render: (o) => h('input', { type: 'checkbox', checked: chosen.has(o.id), onchange: (e) => { if (e.target.checked) chosen.add(o.id); else chosen.delete(o.id); drawList(); } }) },
        { label: 'Đơn hàng', render: (o) => o.code }, { label: 'Ngày giao', cls: 'nw', render: (o) => E.dmy(o.d) }, { label: 'Thành tiền', cls: 'r nw', render: (o) => E.money(o.total) }] }),
      h('div', { class: 'totals', style: { marginTop: '10px' } }, h('div', { class: 'grand' }, h('span', null, `Tổng ${chosen.size} đơn`), h('span', null, E.money(total))))]
        : h('div', { class: 'callout' }, cus ? 'Không có đơn đã giao nào chưa chốt trong khoảng thời gian này.' : 'Chọn khách hàng và khoảng thời gian rồi bấm "Xem đơn".'));
    }
    async function preview() {
      err.hidden = true;
      if (!cus) { err.textContent = 'Vui lòng chọn khách hàng'; err.hidden = false; return; }
      try { orders = (await POST('/api/invoices/preview', { customer_id: cus.id, from: from.value, to: to.value })).orders; chosen.clear(); orders.forEach((o) => chosen.add(o.id)); drawList(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    }
    const cbox = E.combo({ items: () => customers, label: (c) => c.name, sub: (c) => c.code, placeholder: 'Chọn khách hàng...', value: cus ? cus.name : '', onPick: (c) => { cus = c; preview(); } });
    const d = dialog({ title: 'Chốt công nợ & lập hoá đơn', wide: true, actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Đóng'), save],
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err, field('Khách hàng', cbox.el),
        h('div', { class: 'grid2' }, field('Từ ngày giao', from), field('Đến ngày giao', to)), h('button', { class: 'btn', type: 'button', onclick: preview, style: { alignSelf: 'flex-start' } }, E.ico('search'), 'Xem đơn đã giao chưa chốt'),
        list, h('div', { class: 'grid2' }, field('Số hoá đơn (nếu có)', ext), field('Ghi chú', note))) });
    drawList();
    if (cus) preview();
    save.onclick = () => E.busy(save, async () => {
      try {
        const r = await POST('/api/invoices', { customer_id: cus.id, from: from.value, to: to.value, order_ids: [...chosen], external_no: ext.value, note: note.value });
        E.refs.clear(); d.close(); toast(`Đã lập hoá đơn ${r.code} (${E.money(r.total)})`, 'ok'); done(r);
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  }

  /* ---------- Tổng quan công nợ ---------- */
  E.page('debts', {
    title: 'Công nợ phải thu', allow: () => E.can('finance'),
    async render(el) {
      const sum = await GET('/api/finance/summary');
      let search = ''; let only = true;
      const holder = h('div');
      async function load() {
        mount(holder, E.loading());
        try {
          const rows = await GET(`/api/finance/debts?only_debt=${only ? 1 : 0}&search=${encodeURIComponent(search)}`);
          mount(holder, E.table({ rows, empty: only ? 'Không có khách hàng nào còn công nợ' : 'Chưa có khách hàng', cols: [
            { label: 'Khách hàng', render: (r) => h('div', null, h('a', { class: 'lnk', href: '#/ledger/' + r.id }, r.name), h('span', { class: 'sub2' }, r.code + (r.phone ? ' · ' + r.phone : ''))) },
            { label: 'Nợ đầu kỳ', cls: 'r nw', render: (r) => E.money(r.opening_debt) }, { label: 'Đã giao', cls: 'r nw', render: (r) => E.money(r.billed) }, { label: 'Đã thu', cls: 'r nw', render: (r) => E.money(r.paid) },
            { label: 'Còn nợ', cls: 'r nw', render: (r) => h('span', { class: debtCls(r.debt) }, E.money(r.debt)) },
            { label: 'Chưa chốt HĐ', cls: 'r nw', render: (r) => (r.unbilled ? E.money(r.unbilled) : '—') },
            { label: 'Thu gần nhất', cls: 'nw', render: (r) => E.dmy(r.last_payment) || '—' },
            { label: '', render: (r) => h('div', { class: 'acts' },
              h('button', { class: 'btn sm primary', type: 'button', onclick: () => paymentDialog({ customer: r }, E.route) }, 'Thu tiền'),
              r.unbilled ? h('button', { class: 'btn sm', type: 'button', onclick: () => invoiceDialog(r, E.route) }, 'Chốt nợ') : null,
              h('a', { class: 'btn sm', href: '#/ledger/' + r.id }, 'Sổ')) }],
          foot: h('tr', null, h('td', null, `${rows.length} khách hàng`), h('td', { colspan: 3 }), h('td', { class: 'r' }, E.money(rows.reduce((s, r) => s + r.debt, 0))), h('td', { colspan: 3 })) }));
        } catch (e) { mount(holder, E.errorBox(e, load)); }
      }
      const sIn = h('input', { class: 'in', type: 'search', placeholder: 'Tìm khách hàng...', 'aria-label': 'Tìm khách hàng' });
      sIn.addEventListener('input', CC.debounce(() => { search = sIn.value.trim(); load(); }, 250));
      const exp = h('button', { class: 'btn', type: 'button', onclick: () => E.busy(exp, () => CC.download(`/api/finance/debts/export?only_debt=${only ? 1 : 0}&search=${encodeURIComponent(search)}`, 'cong-no.xlsx')) }, E.ico('download'), 'Xuất Excel');
      mount(el, E.head('Công nợ phải thu', 'Công nợ = nợ đầu kỳ + đơn đã giao − tiền đã thu', exp, h('button', { class: 'btn', type: 'button', onclick: () => invoiceDialog(null, E.route) }, E.ico('invoice'), 'Chốt công nợ'), h('button', { class: 'btn primary', type: 'button', onclick: () => paymentDialog({}, E.route) }, E.ico('plus'), 'Thu tiền')),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('span', null, 'Tổng phải thu'), h('b', null, E.money(sum.receivable)), h('small', null, `${sum.owing_customers} khách hàng còn nợ`)),
          h('div', { class: 'stat' + (sum.over_limit ? ' warn' : '') }, h('span', null, 'Vượt hạn mức'), h('b', null, String(sum.over_limit)), h('small', null, 'khách hàng')),
          h('div', { class: 'stat' }, h('span', null, `Doanh thu ${CC.fmtMonth(sum.month)}`), h('b', null, E.money(sum.revenue_month)), h('small', null, 'đơn đã giao')),
          h('div', { class: 'stat' }, h('span', null, `Đã thu ${CC.fmtMonth(sum.month)}`), h('b', null, E.money(sum.collected_month))),
          h('div', { class: 'stat' }, h('span', null, 'Chưa chốt hoá đơn'), h('b', null, E.money(sum.unbilled)), h('small', null, 'đơn đã giao chưa vào hoá đơn'))),
        h('div', { class: 'panel' }, h('div', { class: 'filters' }, h('div', { class: 'field grow' }, sIn), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { only = e.target.checked; load(); } }), 'Chỉ khách còn công nợ')), holder));
      await load();
    },
  });

  /* ---------- Sổ chi tiết công nợ ---------- */
  E.page('ledger', {
    title: 'Sổ chi tiết công nợ', nav: 'debts', allow: () => E.can('finance'),
    async render(el, arg) {
      const S = { from: monthStart(), to: CC.todayStr() };
      const holder = h('div'); const headBox = h('div');
      async function load() {
        mount(holder, E.loading());
        try {
          const r = await GET(`/api/finance/ledger/${arg}?from=${S.from}&to=${S.to}`);
          const cus = (await E.refs.customers()).find((c) => c.id === Number(arg)) || { id: r.customer.id, name: r.customer.name, debt: r.closing };
          mount(headBox, E.head(r.customer.name, `${r.customer.code}${r.customer.phone ? ' · ' + r.customer.phone : ''}${r.customer.address ? ' · ' + r.customer.address : ''}`,
            h('button', { class: 'btn', type: 'button', onclick: () => E.printOpen('ledger', { id: arg, from: S.from, to: S.to }) }, E.ico('print'), 'In sổ'),
            h('button', { class: 'btn', type: 'button', onclick: () => invoiceDialog(cus, load) }, E.ico('invoice'), 'Chốt công nợ'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => paymentDialog({ customer: cus }, load) }, E.ico('plus'), 'Thu tiền'), h('a', { class: 'btn', href: '#/debts' }, 'Công nợ')));
          mount(holder, E.table({ rows: r.entries, empty: 'Không có phát sinh trong kỳ', cols: [
            { label: 'Ngày', cls: 'nw', render: (e) => E.dmy(e.date) }, { label: 'Chứng từ', cls: 'nw', render: (e) => (e.kind === 'order' ? h('a', { class: 'lnk', href: '#/order/' + e.ref }, e.ref) : e.ref) }, { label: 'Diễn giải', render: (e) => e.text },
            { label: 'Ghi nợ', cls: 'r nw', render: (e) => (e.debit ? E.money(e.debit) : '') }, { label: 'Ghi có', cls: 'r nw', render: (e) => (e.credit ? E.money(e.credit) : '') }, { label: 'Số dư', cls: 'r nw', render: (e) => h('b', { class: debtCls(e.balance) }, E.money(e.balance)) }],
          foot: h('tr', null, h('td', { colspan: 3 }, `Số dư đầu kỳ: ${E.money(r.opening)}`), h('td', { class: 'r' }, E.money(r.debit)), h('td', { class: 'r' }, E.money(r.credit)), h('td', { class: 'r' }, E.money(r.closing))) }));
        } catch (e) { mount(holder, E.errorBox(e, load)); }
      }
      const from = h('input', { class: 'in', type: 'date', value: S.from, onchange: (e) => { S.from = e.target.value || '2000-01-01'; load(); } });
      const to = h('input', { class: 'in', type: 'date', value: S.to, onchange: (e) => { S.to = e.target.value || '2999-12-31'; load(); } });
      mount(el, headBox, h('div', { class: 'panel' }, h('div', { class: 'filters' }, field('Từ ngày', from), field('Đến ngày', to)), holder));
      await load();
    },
  });

  /* ---------- Phiếu thu ---------- */
  E.page('payments', {
    title: 'Thu tiền', allow: () => E.can('finance'),
    async render(el) {
      const S = { from: monthStart(), to: '', customer: null, page: 1 };
      const holder = h('div'); const customers = await E.refs.customers();
      async function load() {
        mount(holder, E.loading());
        try {
          const p = new URLSearchParams({ page: S.page, per: 40 });
          if (S.from) p.set('from', S.from); if (S.to) p.set('to', S.to); if (S.customer) p.set('customer_id', S.customer.id);
          const r = await GET('/api/payments?' + p);
          mount(holder, E.table({ rows: r.rows, empty: 'Chưa có phiếu thu nào', rowClass: (x) => (x.voided ? 'off' : ''), cols: [
            { label: 'Phiếu', cls: 'nw', render: (x) => h('span', { style: x.voided ? { textDecoration: 'line-through' } : null }, x.code) }, { label: 'Ngày thu', cls: 'nw', render: (x) => E.dmy(x.paid_date) },
            { label: 'Khách hàng', render: (x) => x.customer_name }, { label: 'Hình thức', render: (x) => METHOD_L[x.method] || x.method },
            { label: 'Gắn với', render: (x) => x.invoice_code || x.order_code || '' }, { label: 'Ghi chú', render: (x) => x.note }, { label: 'Số tiền', cls: 'r nw', render: (x) => h('b', null, E.money(x.amount)) },
            { label: '', render: (x) => (x.voided ? E.chip('Đã huỷ') : h('div', { class: 'acts' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { const reason = await promptBox('Huỷ phiếu thu ' + x.code, 'Lý do huỷ', { okText: 'Huỷ phiếu', required: true }); if (reason === null) return; try { await POST(`/api/payments/${x.id}/void`, { reason }); toast('Đã huỷ phiếu thu', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } } }, 'Huỷ'))) }] }),
          E.pager({ total: r.total, page: r.page, per: r.per, onPage: (n) => { S.page = n; load(); } }), h('div', { class: 'pager' }, h('b', null, 'Tổng thu (không tính phiếu huỷ): ' + E.money(r.sum))));
        } catch (e) { mount(holder, E.errorBox(e, load)); }
      }
      const cb = E.combo({ items: () => customers, label: (c) => c.name, sub: (c) => c.code, placeholder: 'Tất cả khách hàng', onPick: (c) => { S.customer = c; S.page = 1; load(); } });
      cb.input.addEventListener('input', () => { if (!cb.input.value) { S.customer = null; S.page = 1; load(); } });
      mount(el, E.head('Thu tiền', 'Phiếu thu tiền của khách hàng', h('button', { class: 'btn primary', type: 'button', onclick: () => paymentDialog({}, load) }, E.ico('plus'), 'Thu tiền')),
        h('div', { class: 'panel' }, h('div', { class: 'filters' }, h('div', { class: 'field grow' }, h('label', null, 'Khách hàng'), cb.el),
          field('Từ ngày', h('input', { class: 'in', type: 'date', value: S.from, onchange: (e) => { S.from = e.target.value; S.page = 1; load(); } })), field('Đến ngày', h('input', { class: 'in', type: 'date', onchange: (e) => { S.to = e.target.value; S.page = 1; load(); } }))), holder));
      await load();
    },
  });

  /* ---------- Hoá đơn ---------- */
  async function invoiceView(id, done) {
    const i = await GET('/api/invoices/' + id);
    const ext = h('input', { class: 'in sm', value: i.external_no, placeholder: 'Số hoá đơn VAT', disabled: i.status === 'void' });
    const note = h('input', { class: 'in sm', value: i.note, disabled: i.status === 'void' });
    const acts = [];
    if (i.status !== 'void') {
      acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        const reason = await promptBox('Huỷ hoá đơn ' + i.code, 'Lý do huỷ', { okText: 'Huỷ hoá đơn', required: true, hint: 'Các đơn hàng sẽ được giải phóng để chốt lại. Phiếu thu đã gắn vẫn được giữ.' });
        if (reason === null) return;
        try { await POST(`/api/invoices/${i.id}/void`, { reason }); toast('Đã huỷ hoá đơn', 'ok'); d.close(); done(); } catch (e) { toast(e.message, 'err'); }
      } }, 'Huỷ hoá đơn'));
      acts.push(h('span', { class: 'spacer' }));
      if (i.balance > 0) acts.push(h('button', { class: 'btn', type: 'button', onclick: () => { d.close(); paymentDialog({ customer: { id: i.customer_id, name: i.customer_name, debt: i.balance }, invoice: i }, done); } }, 'Thu tiền'));
      acts.push(h('button', { class: 'btn', type: 'button', onclick: async () => { try { await PUT('/api/invoices/' + i.id, { external_no: ext.value, note: note.value }); toast('Đã lưu', 'ok'); done(); } catch (e) { toast(e.message, 'err'); } } }, 'Lưu ghi chú'));
    }
    acts.push(h('button', { class: 'btn primary', type: 'button', onclick: () => E.printOpen('invoice', { id: i.id }) }, E.ico('print'), 'In'));
    const d = dialog({ title: `Hoá đơn ${i.code}`, wide: true, actions: acts, body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, invChip(i.state), h('span', { class: 'muted' }, `Lập ngày ${E.dmy(i.issue_date)} · kỳ ${E.dmy(i.period_from)} – ${E.dmy(i.period_to)}`)),
      h('dl', { class: 'kv' }, h('dt', null, 'Khách hàng'), h('dd', null, `${i.customer_name} (${i.customer_code})`), h('dt', null, 'Địa chỉ'), h('dd', null, i.customer_address || '—'), h('dt', null, 'Mã số thuế'), h('dd', null, i.customer_tax || '—'),
        h('dt', null, 'Số hoá đơn VAT'), h('dd', null, ext), h('dt', null, 'Ghi chú'), h('dd', null, note)),
      E.table({ rows: i.orders, empty: 'Hoá đơn không còn đơn nào', cols: [
        { label: 'Đơn hàng', render: (o) => h('a', { class: 'lnk', href: '#/order/' + o.code, onclick: () => d.close() }, o.code) }, { label: 'Ngày giao', cls: 'nw', render: (o) => E.dmy(o.delivered_date || o.delivery_date) },
        { label: 'Hàng hoá', render: (o) => o.items.map((x) => `${x.name} ×${fmtMoney(x.qty)}`).join(', ') }, { label: 'Thành tiền', cls: 'r nw', render: (o) => E.money(o.total) }] }),
      h('div', { class: 'totals' }, h('div', null, h('span', null, 'Tổng hoá đơn'), h('b', null, E.money(i.total))), h('div', null, h('span', null, 'Đã thu'), h('b', null, E.money(i.paid))), h('div', { class: 'grand' }, h('span', null, 'Còn lại'), h('span', null, E.money(i.balance)))),
      i.payments.length ? h('div', null, h('h3', { style: { marginBottom: '6px' } }, 'Các lần thu'), E.table({ rows: i.payments, cols: [{ label: 'Phiếu', render: (p) => p.code }, { label: 'Ngày', render: (p) => E.dmy(p.paid_date) }, { label: 'Hình thức', render: (p) => METHOD_L[p.method] }, { label: 'Số tiền', cls: 'r', render: (p) => h('span', { style: p.voided ? { textDecoration: 'line-through' } : null }, E.money(p.amount)) }] })) : null) });
  }

  E.page('invoices', {
    title: 'Chốt công nợ & hoá đơn', allow: () => E.can('finance'),
    async render(el) {
      const S = { q: '', state: '', from: '', to: '' };
      const holder = h('div');
      async function load() {
        mount(holder, E.loading());
        try {
          const p = new URLSearchParams(); for (const k of Object.keys(S)) if (S[k]) p.set(k, S[k]);
          const rows = await GET('/api/invoices?' + p);
          mount(holder, E.table({ rows, empty: 'Chưa có hoá đơn nào', rowClass: (r) => (r.state === 'void' ? 'off' : ''), cols: [
            { label: 'Hoá đơn', cls: 'nw', render: (r) => h('div', null, h('a', { class: 'lnk', href: '#', onclick: (ev) => { ev.preventDefault(); invoiceView(r.id, load); } }, r.code), r.external_no ? h('span', { class: 'sub2' }, 'VAT: ' + r.external_no) : null) },
            { label: 'Khách hàng', render: (r) => r.customer_name }, { label: 'Ngày lập', cls: 'nw', render: (r) => E.dmy(r.issue_date) }, { label: 'Kỳ chốt', cls: 'nw', render: (r) => `${CC.fmtDay(r.period_from)} – ${CC.fmtDay(r.period_to)}` },
            { label: 'Số đơn', cls: 'r', render: (r) => String(r.order_count) }, { label: 'Tổng tiền', cls: 'r nw', render: (r) => E.money(r.total) }, { label: 'Còn lại', cls: 'r nw', render: (r) => (r.state === 'void' ? '' : h('span', { class: r.balance ? 'neg' : 'pos' }, E.money(r.balance))) },
            { label: 'Trạng thái', render: (r) => invChip(r.state) },
            { label: '', render: (r) => h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => invoiceView(r.id, load) }, 'Xem'), h('button', { class: 'btn sm ghost icon', type: 'button', 'aria-label': 'In', onclick: () => E.printOpen('invoice', { id: r.id }) }, E.ico('print'))) }] }));
        } catch (e) { mount(holder, E.errorBox(e, load)); }
      }
      const closeAll = h('button', { class: 'btn', type: 'button' }, E.ico('refresh'), 'Chốt công nợ hàng loạt');
      closeAll.onclick = () => {
        const from = h('input', { class: 'in', type: 'date', value: monthStart() }); const to = h('input', { class: 'in', type: 'date', value: CC.todayStr() });
        const go = h('button', { class: 'btn primary', type: 'button' }, 'Chốt công nợ');
        const d = dialog({ title: 'Chốt công nợ hàng loạt', actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), go],
          body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, h('p', null, 'Mỗi khách hàng có đơn đã giao chưa chốt trong kỳ sẽ được lập một hoá đơn. Có thể huỷ từng hoá đơn nếu chốt nhầm.'), h('div', { class: 'grid2' }, field('Từ ngày giao', from), field('Đến ngày giao', to))) });
        go.onclick = () => E.busy(go, async () => { const r = await POST('/api/invoices/close-period', { from: from.value, to: to.value }); d.close(); E.refs.clear(); toast(r.created ? `Đã lập ${r.created} hoá đơn, tổng ${E.money(r.total)}` : 'Không có đơn nào cần chốt trong kỳ này', r.created ? 'ok' : undefined); load(); });
      };
      const q = h('input', { class: 'in', type: 'search', placeholder: 'Số hoá đơn, khách hàng...', 'aria-label': 'Tìm hoá đơn' });
      q.addEventListener('input', CC.debounce(() => { S.q = q.value.trim(); load(); }, 250));
      mount(el, E.head('Chốt công nợ & hoá đơn', 'Gom các đơn đã giao thành hoá đơn để đối chiếu và thu tiền', closeAll, h('button', { class: 'btn primary', type: 'button', onclick: () => invoiceDialog(null, load) }, E.ico('plus'), 'Lập hoá đơn')),
        h('div', { class: 'callout' }, E.ico('doc'), 'Đây là hoá đơn/bảng kê nội bộ để theo dõi công nợ. Hoá đơn điện tử theo quy định thuế cần xuất ở phần mềm hoá đơn điện tử; có thể ghi số hoá đơn đó vào ô "Số hoá đơn VAT".'),
        h('div', { class: 'panel' }, h('div', { class: 'filters' }, h('div', { class: 'field grow' }, h('label', null, 'Tìm kiếm'), q),
          field('Trạng thái', E.select([{ v: 'issued', l: 'Chưa thu' }, { v: 'partial', l: 'Thu một phần' }, { v: 'paid', l: 'Đã thu đủ' }, { v: 'void', l: 'Đã huỷ' }], '', { placeholder: 'Tất cả', onchange: (e) => { S.state = e.target.value; load(); } })),
          field('Từ ngày lập', h('input', { class: 'in', type: 'date', onchange: (e) => { S.from = e.target.value; load(); } })), field('Đến ngày', h('input', { class: 'in', type: 'date', onchange: (e) => { S.to = e.target.value; load(); } }))), holder));
      await load();
    },
  });
})();
