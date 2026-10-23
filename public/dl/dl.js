'use strict';
/* App đặt hàng của khách đại lý: đăng nhập, chọn hàng theo quy cách, gửi đơn, theo dõi và huỷ đơn.
   Phiên đăng nhập lưu riêng (dl_token), không đụng phiên của nhân viên trên cùng máy. */
(function () {
  const { h, mount, toast, dialog, confirmBox, field, fmtMoney, fmtDate } = CC;
  const root = document.getElementById('root');
  const KEY = 'dl_token';
  const S = { token: localStorage.getItem(KEY) || '', info: {}, me: null, catalog: [], showPrice: false, cart: new Map(), tab: 'order', group: '', q: '', orders: [] };

  /* ---------- Gọi API ---------- */
  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw new Error('Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && url !== '/api/dl/login') { logout('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'); throw new Error(data.error || 'Hết phiên đăng nhập'); }
    if (!res.ok) { const e = new Error(data.error || 'Có lỗi xảy ra'); e.code = data.code; throw e; }
    return data;
  }

  /* ---------- Giỏ hàng (lưu trên máy để không mất khi tắt app) ---------- */
  const saveCart = () => localStorage.setItem('dl_cart', JSON.stringify([...S.cart]));
  function loadCart() { try { S.cart = new Map(JSON.parse(localStorage.getItem('dl_cart') || '[]')); } catch { S.cart = new Map(); } }
  const prodOf = (id) => S.catalog.find((p) => p.id === Number(id));
  const fmtQ = (n) => String(Math.round(n * 1000) / 1000).replace('.', ',');
  const kgText = (kg) => (kg < 1 ? `${Math.round(kg * 1000)}gr` : `${fmtQ(kg)}kg`);
  function packText(p, qty) {
    if (!p.pack_kg) return `${fmtQ(qty)} kg rời`;
    if (p.unit === 'KG') return `${fmtQ(qty / p.pack_kg)} ${p.pack_noun} ${kgText(p.pack_kg)}`;
    return `${fmtQ(qty)} ${p.pack_noun} ${kgText(p.pack_kg)}`;
  }
  const snap = (p, v) => { const st = p.qty_step || 1; return Math.max(0, Math.round(Math.round(v / st) * st * 1000) / 1000); };
  function setQty(p, v) {
    const q = snap(p, v);
    if (q > 0) S.cart.set(p.id, q); else S.cart.delete(p.id);
    saveCart(); drawBar();
  }
  const cartCount = () => [...S.cart.keys()].filter((id) => prodOf(id)).length;
  const cartTotal = () => [...S.cart].reduce((s, [id, q]) => s + (prodOf(id) ? (prodOf(id).price || 0) * q : 0), 0);
  const money = (n) => fmtMoney(Math.round(n)) + 'đ';

  /* ---------- Đăng nhập ---------- */
  function logout(msg) {
    S.token = ''; localStorage.removeItem(KEY); S.me = null;
    showLogin(msg);
  }
  function showLogin(message) {
    const err = h('div', { class: 'err', role: 'alert', hidden: !message }, message || '');
    const user = h('input', { class: 'in', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', value: localStorage.getItem('dl_login') || '' });
    const pass = h('input', { class: 'in', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary block big', type: 'submit' }, 'Đăng nhập');
    const logo = S.info.logo ? h('img', { src: S.info.logo, alt: '' }) : h('img', { src: '../erp/logo-mark.png', alt: '' });
    mount(root, h('div', { class: 'login' }, h('div', { class: 'lcard' },
      h('div', { class: 'top2' }, logo, h('div', null, h('h1', null, 'Đặt hàng đại lý'), h('p', { class: 's' }, S.info.company_name || ''))),
      h('form', { novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        if (!user.value.trim() || !pass.value) { err.textContent = 'Vui lòng nhập tên đăng nhập và mật khẩu.'; err.hidden = false; return; }
        btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
        try {
          const r = await api('POST', '/api/dl/login', { login: user.value.trim(), password: pass.value });
          S.token = r.token; localStorage.setItem(KEY, r.token); localStorage.setItem('dl_login', user.value.trim());
          await enter();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Đăng nhập'; }
      } }, err, field('Tên đăng nhập', user, 'Số điện thoại hoặc mã do công ty cấp'), field('Mật khẩu', pass), btn),
      h('p', { class: 'foot' }, 'Chưa có tài khoản hoặc quên mật khẩu? Vui lòng liên hệ nhân viên kinh doanh.'))));
    setTimeout(() => (user.value ? pass : user).focus(), 50);
  }

  /* ---------- Khung chính ---------- */
  let mainEl, barEl, tabEl;
  async function enter() {
    const [me, cat] = await Promise.all([api('GET', '/api/dl/me'), api('GET', '/api/dl/catalog')]);
    S.me = me; S.catalog = cat.products; S.showPrice = cat.show_price;
    loadCart();
    for (const id of [...S.cart.keys()]) if (!prodOf(id)) S.cart.delete(id); // sản phẩm đã ngừng bán
    const logo = S.info.logo ? h('img', { src: S.info.logo, alt: '' }) : h('img', { src: '../erp/logo-mark.png', alt: '' });
    mainEl = h('main', { class: 'main' });
    barEl = h('div', { class: 'cartbar' });
    tabEl = h('div', { class: 'tabbar' });
    mount(root, h('div', { class: 'wrap' }, h('header', { class: 'hdr' }, logo, h('div', { class: 't' }, h('b', null, S.me.customer.name), h('span', null, me.company_name || S.info.company_name))), mainEl, barEl, tabEl));
    go(S.tab);
  }
  function go(tab) {
    S.tab = tab;
    mount(tabEl, h('nav', null, [['order', 'box', 'Đặt hàng'], ['orders', 'list', 'Đơn của tôi'], ['account', 'user', 'Tài khoản']].map(([id, ic, label]) =>
      h('button', { type: 'button', 'aria-current': S.tab === id ? 'page' : 'false', onclick: () => go(id) }, CC.icon(ic), label, id === 'order' ? h('span', { class: 'badge', hidden: !cartCount() }, String(cartCount())) : null))));
    window.scrollTo(0, 0);
    if (tab === 'order') drawOrder(); else if (tab === 'orders') drawOrders(); else drawAccount();
    drawBar();
  }
  function drawBar() {
    if (!barEl) return;
    const n = cartCount();
    mount(barEl, S.tab === 'order' && n ? h('button', { type: 'button', onclick: openCart }, h('span', null, `Giỏ hàng: ${n} mặt hàng`), h('span', null, S.showPrice ? money(cartTotal()) + ' ›' : 'Gửi đơn ›')) : null);
    const badge = tabEl && tabEl.querySelector('.badge');
    if (badge) { badge.textContent = String(n); badge.hidden = !n; }
  }

  /* ---------- Đặt hàng ---------- */
  function drawOrder() {
    const groups = [...new Set(S.catalog.map((p) => p.group_name || 'Khác'))];
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
    function drawList() {
      const k = norm(S.q);
      const rows = S.catalog.filter((p) => (!S.group || (p.group_name || 'Khác') === S.group) && (!k || norm(p.name + ' ' + p.code).includes(k)));
      // Gom theo nhóm hàng, giữ thứ tự nhóm như trong danh mục
      const out = [];
      for (const g of groups) {
        const inG = rows.filter((p) => (p.group_name || 'Khác') === g);
        if (!inG.length) continue;
        if (!S.group) out.push(h('div', { class: 'grp-title' }, g));
        for (const p of inG) out.push(prodRow(p));
      }
      mount(list, out.length ? out : h('div', { class: 'empty2' }, 'Không tìm thấy sản phẩm'));
    }
    function prodRow(p) {
      const qty = S.cart.get(p.id) || 0;
      const st = p.qty_step || 1;
      const hint = h('em', null, qty ? packText(p, qty) : '');
      const inp = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: st, value: qty ? String(qty) : '', placeholder: '0', 'aria-label': 'Số lượng ' + p.name });
      const row = h('div', { class: 'prod' + (qty ? ' on' : '') });
      const upd = (v) => { setQty(p, v); const q = S.cart.get(p.id) || 0; inp.value = q ? String(q) : ''; hint.textContent = q ? packText(p, q) : ''; row.classList.toggle('on', !!q); };
      inp.addEventListener('change', () => upd(Number(String(inp.value).replace(',', '.')) || 0));
      mount(row, h('div', { class: 'info' }, h('b', null, p.name), h('span', null, `${p.spec || ''}${p.spec ? ' · ' : ''}ĐVT: ${p.unit}${p.qty_step !== 1 ? ` · đặt theo bội ${fmtQ(p.qty_step)}` : ''}`),
        S.showPrice ? h('span', { class: 'pr' }, `${money(p.price)}/${p.unit.toLowerCase()}`) : null, hint),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'Bớt', onclick: () => upd((S.cart.get(p.id) || 0) - st) }, '−'), inp,
        h('button', { type: 'button', 'aria-label': 'Thêm', onclick: () => upd((S.cart.get(p.id) || 0) + st) }, '+')));
      return row;
    }
    const search = h('input', { type: 'search', placeholder: 'Tìm sản phẩm...', value: S.q, 'aria-label': 'Tìm sản phẩm' });
    search.addEventListener('input', () => { S.q = search.value; drawList(); });
    const chips = h('div', { class: 'chips' });
    const drawChips = () => mount(chips, ['', ...groups].map((g) => h('button', { type: 'button', 'aria-pressed': String(S.group === g), onclick: () => { S.group = g; drawChips(); drawList(); } }, g || 'Tất cả')));
    drawChips();
    mount(mainEl, S.me.notice ? h('div', { class: 'notice' }, S.me.notice) : null, h('div', { class: 'search' }, CC.icon('search'), search), chips, list);
    drawList();
  }

  function openCart() {
    const lines = h('div', { class: 'lines' });
    const totalEl = h('b');
    function drawLines() {
      const rows = [...S.cart].map(([id, q]) => [prodOf(id), q]).filter(([p]) => p);
      mount(lines, rows.map(([p, q]) => h('div', null, h('div', null, h('b', null, p.name), h('small', null, `${fmtQ(q)} ${p.unit} · ${packText(p, q)}`)),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, S.showPrice ? h('span', null, money(p.price * q)) : null,
          h('button', { class: 'btn sm ghost icon', type: 'button', 'aria-label': 'Bỏ ' + p.name, onclick: () => { S.cart.delete(p.id); saveCart(); drawBar(); if (!cartCount()) { d.close(); go('order'); } else drawLines(); } }, CC.icon('x'))))));
      totalEl.textContent = S.showPrice ? money(cartTotal()) : '';
    }
    let day = S.me.min_date;
    const dateIn = h('input', { class: 'in', type: 'date', min: S.me.min_date, max: S.me.max_date, value: day, onchange: (e) => { day = e.target.value; drawDates(); } });
    const datesBox = h('div', { class: 'dates' });
    const quick = [0, 1, 2].map((n) => CC.addDays(S.me.min_date, n)).filter((x) => x <= S.me.max_date);
    const label = (x) => (x === CC.todayStr() ? 'Hôm nay' : x === CC.addDays(CC.todayStr(), 1) ? 'Ngày mai' : fmtDate(x).slice(0, 5));
    const drawDates = () => mount(datesBox, quick.map((x) => h('button', { type: 'button', 'aria-pressed': String(day === x), onclick: () => { day = x; dateIn.value = x; drawDates(); } }, label(x))));
    drawDates();
    const addr = h('input', { class: 'in', value: S.me.customer.address || '', placeholder: 'Địa chỉ nhận hàng' });
    const note = h('textarea', { class: 'in', placeholder: 'Ví dụ: giao trước 6h sáng, gọi trước khi tới...' });
    const send = h('button', { class: 'btn primary block big', type: 'button' }, 'Gửi đơn hàng');
    const d = dialog({ title: 'Giỏ hàng của bạn', body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      lines, S.showPrice ? h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '16px' } }, h('span', null, 'Tạm tính'), totalEl) : null,
      S.showPrice ? h('small', { class: 'muted' }, 'Số tiền chính xác theo hoá đơn của công ty.') : null,
      field('Ngày nhận hàng', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, datesBox, dateIn)),
      field('Địa chỉ giao', addr), field('Ghi chú cho công ty', note), send) });
    drawLines();
    send.onclick = async () => {
      if (!day) return toast('Hãy chọn ngày nhận hàng', 'err');
      send.disabled = true; send.textContent = 'Đang gửi...';
      try {
        const r = await api('POST', '/api/dl/orders', { delivery_date: day, address: addr.value.trim(), note: note.value.trim(), items: [...S.cart].map(([product_id, qty]) => ({ product_id, qty })) });
        S.cart.clear(); saveCart(); d.close();
        dialog({ title: 'Đã gửi đơn hàng', body: h('div', { class: 'okbig' }, h('div', { class: 'tick' }, CC.icon('check')), h('h3', null, `Mã đơn: ${r.code}`),
          h('p', null, `Ngày nhận hàng: ${fmtDate(r.delivery_date)}. Công ty sẽ chuẩn bị hàng và giao cho bạn. Theo dõi ở mục "Đơn của tôi".`)) });
        go('orders');
      } catch (e) { toast(e.message, 'err'); send.disabled = false; send.textContent = 'Gửi đơn hàng'; }
    };
  }

  /* ---------- Đơn của tôi ---------- */
  const stChip = (o) => h('span', { class: 'st ' + o.status }, o.status_text);
  async function drawOrders() {
    mount(mainEl, h('div', { class: 'empty2' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Đang tải' })));
    try { S.orders = await api('GET', '/api/dl/orders'); } catch (e) { mount(mainEl, h('div', { class: 'empty2' }, e.message)); return; }
    mount(mainEl, S.orders.length ? S.orders.map((o) => h('button', { class: 'card ocard', type: 'button', onclick: () => openOrder(o.code) },
      h('div', { class: 'r1' }, h('b', null, o.code), stChip(o)),
      h('small', null, `Nhận hàng: ${fmtDate(o.delivery_date)} · ${o.item_count} mặt hàng${S.showPrice && o.total !== undefined ? ' · ' + money(o.total) : ''}`),
      h('small', null, o.items.slice(0, 3).map((i) => `${i.name} ${fmtQ(i.qty)} ${i.unit}`).join(', ') + (o.items.length > 3 ? '...' : ''))))
      : h('div', { class: 'empty2' }, h('p', null, 'Bạn chưa có đơn hàng nào.'), h('button', { class: 'btn primary', type: 'button', onclick: () => go('order') }, 'Đặt hàng ngay')));
  }
  async function openOrder(code) {
    let o;
    try { o = await api('GET', '/api/dl/orders/' + encodeURIComponent(code)); } catch (e) { return toast(e.message, 'err'); }
    const acts = [];
    if (o.can_cancel) acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!(await confirmBox(`Huỷ đơn ${o.code}?`, { danger: true, okText: 'Huỷ đơn' }))) return;
      try { await api('POST', `/api/dl/orders/${o.code}/cancel`); toast('Đã huỷ đơn', 'ok'); d.close(); drawOrders(); } catch (e) { toast(e.message, 'err'); }
    } }, 'Huỷ đơn'));
    acts.push(h('span', { class: 'spacer' }), h('button', { class: 'btn primary', type: 'button', onclick: () => {
      let n = 0;
      for (const i of o.items) { const p = prodOf(i.product_id); if (p) { S.cart.set(p.id, snap(p, i.qty)); n++; } }
      saveCart(); d.close(); toast(`Đã thêm ${n} mặt hàng vào giỏ`, 'ok'); go('order');
    } }, 'Đặt lại đơn này'));
    const d = dialog({ title: 'Đơn ' + o.code, actions: acts, body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, stChip(o), h('span', { class: 'muted' }, `Nhận hàng ${fmtDate(o.delivery_date)}`)),
      h('div', { class: 'lines' }, o.items.map((i) => h('div', null, h('div', null, h('b', null, i.name), h('small', null, `${fmtQ(i.qty)} ${i.unit} · ${i.pack_text}`)), S.showPrice && i.amount !== undefined ? h('span', null, money(i.amount)) : null))),
      S.showPrice && o.total !== undefined ? h('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 700 } }, h('span', null, 'Tổng'), h('span', null, money(o.total))) : null,
      o.address ? h('div', null, h('small', { class: 'muted' }, 'Địa chỉ giao: '), o.address) : null,
      o.note ? h('div', null, h('small', { class: 'muted' }, 'Ghi chú: '), o.note) : null,
      h('div', { class: 'tl' }, o.events.map((e) => h('div', null, h('i'), h('div', null, e.text, h('small', null, CC.fmtDateTime(e.ts)))))),
      !o.can_cancel && o.status !== 'cancelled' && o.status !== 'delivered' ? h('small', { class: 'muted' }, 'Đơn đã vào làm hàng. Muốn thay đổi, vui lòng gọi nhân viên kinh doanh.') : null) });
  }

  /* ---------- Tài khoản ---------- */
  function drawAccount() {
    const c = S.me.customer;
    const old = h('input', { class: 'in', type: 'password', autocomplete: 'current-password' });
    const n1 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    const n2 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Đổi mật khẩu');
    save.onclick = async () => {
      if (n1.value.length < 6) return toast('Mật khẩu mới phải có ít nhất 6 ký tự', 'err');
      if (n1.value !== n2.value) return toast('Mật khẩu nhập lại chưa khớp', 'err');
      save.disabled = true;
      try { const r = await api('POST', '/api/dl/password', { old_password: old.value, new_password: n1.value }); S.token = r.token; localStorage.setItem(KEY, r.token); toast('Đã đổi mật khẩu', 'ok'); old.value = n1.value = n2.value = ''; } catch (e) { toast(e.message, 'err'); }
      save.disabled = false;
    };
    mount(mainEl,
      h('div', { class: 'card' }, h('h3', null, c.name), h('dl', { style: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px', marginTop: '8px', fontSize: '14.5px' } },
        h('dt', { class: 'muted' }, 'Mã khách'), h('dd', null, c.code), h('dt', { class: 'muted' }, 'Điện thoại'), h('dd', null, c.phone || '—'), h('dt', { class: 'muted' }, 'Địa chỉ'), h('dd', null, c.address || '—'), c.area ? [h('dt', { class: 'muted' }, 'Khu vực'), h('dd', null, c.area)] : null)),
      h('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, h('h3', null, 'Đổi mật khẩu'), field('Mật khẩu hiện tại', old), field('Mật khẩu mới', n1, 'Ít nhất 6 ký tự'), field('Nhập lại mật khẩu mới', n2), save),
      h('button', { class: 'btn block big', type: 'button', onclick: async () => { if (await confirmBox('Đăng xuất khỏi app?', { okText: 'Đăng xuất' })) logout(); } }, CC.icon('logout'), 'Đăng xuất'),
      h('p', { class: 'muted', style: { textAlign: 'center', fontSize: '13px' } }, 'Mẹo: trên điện thoại, chọn "Thêm vào màn hình chính" để mở nhanh như ứng dụng.'));
  }

  (async function boot() {
    mount(root, h('div', { class: 'login' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Đang tải' })));
    try { S.info = await CC.loadPublicInfo(); } catch { S.info = {}; }
    document.title = 'Đặt hàng · ' + (S.info.company_name || '');
    if (!S.token) return showLogin();
    try { await enter(); } catch (e) { if (S.token) mount(root, h('div', { class: 'login' }, h('div', { class: 'lcard', style: { padding: '24px', textAlign: 'center' } }, h('p', null, e.message), h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, 'Thử lại')))); }
  })();
})();
