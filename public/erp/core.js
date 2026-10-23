'use strict';
/* Khung ERP: menu, điều hướng, tìm kiếm nhanh, thông báo và các thành phần giao diện dùng chung.
   Mọi nội dung hiển thị đi qua hàm h() (textContent) nên dữ liệu không thể chèn mã độc. */
window.ERP = (function () {
  const { h, mount, GET, POST, toast, dialog, confirmBox, fmtMoney, fmtDate, initials, debounce, svgEl } = CC;

  /* ---------- Biểu tượng bổ sung ---------- */
  const EXTRA = {
    print: 'M7 8V3h10v5 M7 17H5a2 2 0 01-2-2v-5a2 2 0 012-2h14a2 2 0 012 2v5a2 2 0 01-2 2h-2 M7 14h10v7H7z',
    upload: 'M12 16V4 M7 9l5-5 5 5 M5 20h14',
    ext: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
    gear: 'M12 9a3 3 0 100 6 3 3 0 000-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2',
    undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-3',
    tag: 'M3 12V3h9l9 9-9 9z M7.5 7.5h.01',
    coin: 'M12 3a9 9 0 100 18 9 9 0 000-18z M9.5 9.5C9.5 8.4 10.6 8 12 8s2.5.5 2.5 1.6c0 2.3-5 1.2-5 3.7 0 1 1.1 1.7 2.5 1.7s2.5-.6 2.5-1.7 M12 6.5V8 M12 16v1.5',
  };
  function ico(name, cls) {
    if (!EXTRA[name]) return CC.icon(name, cls);
    const s = svgEl('svg', { viewBox: '0 0 24 24', class: 'ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    for (const d of EXTRA[name].split(' M').map((x, i) => (i ? 'M' + x : x))) s.appendChild(svgEl('path', { d }));
    return s;
  }

  const st = { user: null, me: { modules: [], is_admin: false, driver: null }, info: { company_name: 'Hệ thống quản lý' }, timers: [], notes: [] };
  const pages = new Map();
  const page = (id, def) => pages.set(id, def);
  let root = null;

  /* ---------- Phân quyền hiển thị ---------- */
  const isAdmin = () => !!st.user && st.user.role === 'admin';
  const isMgr = () => !!st.user && st.user.role !== 'employee';
  const can = (...mods) => isAdmin() || mods.some((m) => st.me.modules.includes(m));
  const isDriver = () => !!st.me.driver;
  // Chỉ bộ phận tài chính kế toán (và quản trị viên) thấy giá; máy chủ cũng tự bỏ các trường tiền với người khác
  const sees = () => can('finance');

  /* ---------- Định dạng ---------- */
  const money = (n) => (n === undefined || n === null ? '' : fmtMoney(n) + 'đ');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const ST = { new: 'Mới', producing: 'Đang làm', delivering: 'Đang giao', delivered: 'Đã giao', cancelled: 'Đã huỷ' };
  const ST_LONG = { new: 'Mới', producing: 'Đang làm hàng', delivering: 'Đang giao', delivered: 'Đã giao', cancelled: 'Đã huỷ' };
  const SRC = { manual: 'Nhân viên', excel: 'Excel', app: 'App khách' };
  const srcChip = (s) => (s === 'app' ? h('span', { class: 'chip seal' }, 'App khách') : s === 'excel' ? h('span', { class: 'chip' }, 'Excel') : null);
  const checkChip = (o) => (o.checked_at && (o.status === 'new' || o.status === 'producing') ? h('span', { class: 'chip ok' }, 'Đã check in') : null);
  const statusChip = (s) => h('span', { class: 'chip s-' + s }, ST[s] || s);
  const chip = (text, tone) => h('span', { class: 'chip' + (tone ? ' ' + tone : '') }, text);
  function ago(ts) {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return 'vừa xong';
    if (m < 60) return `${m} phút trước`;
    if (m < 1440) return `${Math.floor(m / 60)} giờ trước`;
    return `${Math.floor(m / 1440)} ngày trước`;
  }
  const ymdLocal = (d) => `${d.getFullYear()}-${CC.pad(d.getMonth() + 1)}-${CC.pad(d.getDate())}`;
  const dmy = (s) => (s ? fmtDate(s) : '');

  /* ---------- Thành phần giao diện ---------- */
  const loading = () => h('div', { class: 'empty' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Đang tải' }));
  const errorBox = (e, retry) => h('div', { class: 'empty' }, h('strong', null, 'Không tải được dữ liệu'), h('p', null, e.message), retry ? h('button', { class: 'btn', type: 'button', style: { marginTop: '12px' }, onclick: retry }, ico('refresh'), 'Thử lại') : null);
  const head = (title, sub, ...acts) => h('div', { class: 'pagehead' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'acts' }, acts));
  const select = (options, value, { placeholder, onchange, cls = '' } = {}) => {
    const s = h('select', { class: 'in ' + cls, onchange }, placeholder !== undefined ? h('option', { value: '' }, placeholder) : null, options.map((o) => h('option', { value: o.v }, o.l)));
    if (value !== undefined && value !== null) s.value = String(value);
    return s;
  };
  function table({ cols, rows, empty = 'Chưa có dữ liệu', foot, rowClass }) {
    if (!rows.length) return h('div', { class: 'empty' }, h('strong', null, empty));
    return h('div', { class: 'tablewrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.cls || '', style: c.w ? { width: c.w } : null }, c.label)))),
      h('tbody', null, rows.map((r, i) => h('tr', { class: rowClass ? rowClass(r) : '' }, cols.map((c) => h('td', { class: c.cls || '' }, c.render(r, i)))))),
      foot ? h('tfoot', null, foot) : null));
  }
  function pager({ total, page: p, per, onPage }) {
    const pages2 = Math.max(1, Math.ceil(total / per));
    return h('div', { class: 'pager' }, h('span', null, `${fmtMoney(total)} bản ghi · trang ${p}/${pages2}`),
      h('div', { class: 'btns' },
        h('button', { class: 'btn sm', type: 'button', disabled: p <= 1, onclick: () => onPage(p - 1) }, ico('left'), 'Trước'),
        h('button', { class: 'btn sm', type: 'button', disabled: p >= pages2, onclick: () => onPage(p + 1) }, 'Sau', ico('right'))));
  }
  async function busy(btn, fn) {
    btn.disabled = true;
    try { return await fn(); } catch (e) { toast(e.message, 'err'); return undefined; } finally { btn.disabled = false; }
  }
  const tabs = (items, current, onPick) => h('div', { class: 'tabs', role: 'tablist' }, items.map((t) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': String(t.id === current), onclick: () => onPick(t.id) }, t.label, t.n !== undefined ? h('span', { class: 'n' }, String(t.n)) : null)));

  // Ô chọn có tìm kiếm (không dấu): dùng cho khách hàng, sản phẩm
  function combo({ items, label, sub, onPick, placeholder = 'Tìm...', value = '' }) {
    const input = h('input', { class: 'in', type: 'text', autocomplete: 'off', placeholder, value, role: 'combobox', 'aria-autocomplete': 'list' });
    const list = h('div', { class: 'list', role: 'listbox', hidden: true });
    const wrap = h('div', { class: 'combo' }, input, list);
    let cur = [];
    let act = -1;
    const close = () => { list.hidden = true; act = -1; };
    function draw() {
      const k = norm(input.value);
      const all = typeof items === 'function' ? items() : items;
      cur = all.filter((x) => !k || norm(label(x) + ' ' + (sub ? sub(x) : '')).includes(k)).slice(0, 40);
      mount(list, cur.length ? cur.map((x, i) => h('button', { type: 'button', class: i === act ? 'act' : '', role: 'option', onmousedown: (e) => { e.preventDefault(); pick(x); } }, h('span', null, label(x)), sub ? h('small', null, sub(x)) : null)) : h('div', { class: 'none' }, 'Không tìm thấy'));
      list.hidden = false;
    }
    function pick(x) { input.value = label(x); close(); onPick(x); }
    input.addEventListener('focus', () => { input.select(); draw(); });
    input.addEventListener('input', () => { act = -1; draw(); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) draw(); act = Math.min(cur.length - 1, act + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); draw(); } else if (e.key === 'Enter' && !list.hidden && cur.length) { e.preventDefault(); pick(cur[Math.max(0, act)]); } else if (e.key === 'Escape') close();
    });
    return { el: wrap, input, set: (t) => { input.value = t; } };
  }

  // Dữ liệu danh mục dùng chung (nhớ tạm 20 giây để không gọi API liên tục)
  const memo = new Map();
  function cached(key, fn, ttl = 20000) {
    const m = memo.get(key);
    if (m && Date.now() - m.at < ttl) return m.p;
    const p = fn();
    memo.set(key, { at: Date.now(), p });
    p.catch(() => memo.delete(key));
    return p;
  }
  const refs = {
    customers: () => cached('customers', () => GET('/api/customers')),
    products: () => cached('products', () => GET('/api/products')),
    drivers: () => cached('drivers', () => GET('/api/drivers')),
    routes: () => cached('routes', () => GET('/api/delivery-routes')),
    clear: () => memo.clear(),
  };

  function toBase64(buf) {
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const printOpen = (type, params = {}) => window.open('/print/?' + new URLSearchParams({ type, ...params }).toString(), '_blank');
  const go = (route) => { location.hash = '#/' + route; };

  /* ---------- Menu ---------- */
  const EMBED_ROLES = { dashboard: ['admin', 'manager'], logs: ['admin', 'manager'], timesheet: ['admin', 'manager'], requests: ['admin', 'manager'], employees: ['admin', 'manager'], schedule: ['admin'], payroll: ['admin'], catalog: ['admin'], announce: ['admin'], settings: ['admin'], update: ['admin'] };
  const MENU = () => [
    { id: 'home', label: 'Trang chủ', icon: 'home', route: 'home' },
    { id: 'manage', label: 'Quản lý', icon: 'users', kids: [
      { label: 'Khách hàng đại lý', route: 'customers', show: () => can('manage', 'orders', 'delivery', 'finance') },
      { label: 'Sản phẩm & quy cách', route: 'products', show: () => can('manage', 'orders', 'delivery', 'finance', 'warehouse') },
      { label: 'Nhân viên & hồ sơ', route: 'e/employees', show: isMgr },
      { label: 'Đơn từ nhân sự', route: 'e/requests', show: isMgr },
    ] },
    { id: 'orders', label: 'Nhập đơn', icon: 'doc', kids: [
      { label: 'Quản lý đơn hàng', route: 'orders', show: () => can('orders', 'delivery', 'finance', 'warehouse') },
      { label: 'Nhập đơn mới', route: 'order-new', show: () => can('orders') },
      { label: 'Nhập từ file Excel', route: 'order-import', show: () => can('orders') },
      { label: 'Làm hàng & soạn hàng', route: 'production', show: () => can('warehouse', 'orders') },
      { label: 'Check in hàng', route: 'checkin', show: () => can('warehouse', 'orders') },
    ] },
    { id: 'delivery', label: 'Điều hành giao hàng', icon: 'truck', kids: [
      { label: 'Bảng điều đơn', route: 'delivery', show: () => can('delivery') },
      { label: 'Lịch sử chuyến giao', route: 'trips', show: () => can('delivery') },
      { label: 'Tài xế', route: 'drivers', show: () => can('delivery') },
      { label: 'Tuyến giao hàng', route: 'routes', show: () => can('delivery') },
      { label: 'Giao hàng của tôi', route: 'my-trips', show: isDriver },
    ] },
    { id: 'attendance', label: 'Chấm công', icon: 'calcheck', kids: [
      { label: 'Chấm công của tôi', href: '/cc/', ext: true },
      { label: 'Tổng quan hôm nay', route: 'e/dashboard', show: isMgr },
      { label: 'Nhật ký chấm công', route: 'e/logs', show: isMgr },
      { label: 'Bảng công', route: 'e/timesheet', show: isMgr },
      { label: 'Xếp ca', route: 'e/schedule', show: isAdmin },
      { label: 'Màn hình QR / khuôn mặt', route: 'kiosk', show: isMgr },
    ] },
    { id: 'system', label: 'Hệ thống', icon: 'settings', kids: [
      { label: 'Cập nhật phần mềm', route: 'e/update', show: isAdmin },
      { label: 'Cài đặt, sao lưu', route: 'e/settings', show: isAdmin },
      { label: 'Phân quyền người dùng', route: 'perms', show: isAdmin },
      { label: 'Danh mục chấm công', route: 'e/catalog', show: isAdmin },
      { label: 'Thông báo nội bộ', route: 'e/announce', show: isAdmin },
      { label: 'Nhật ký thao tác', route: 'audit', show: isAdmin },
    ] },
    { id: 'finance', label: 'Tài chính kế toán', icon: 'invoice', kids: [
      { label: 'Bảng giá', route: 'prices', show: () => can('finance') },
      { label: 'Công nợ phải thu', route: 'debts', show: () => can('finance') },
      { label: 'Thu tiền', route: 'payments', show: () => can('finance') },
      { label: 'Chốt công nợ & hoá đơn', route: 'invoices', show: () => can('finance') },
      { label: 'Bảng lương', route: 'e/payroll', show: isAdmin },
    ] },
  ];
  const visibleKids = (g) => (g.kids || []).filter((k) => !k.show || k.show());

  let navRoute = 'home';
  function buildNav() {
    const nav = h('nav', { 'aria-label': 'Menu chính' });
    for (const g of MENU()) {
      if (!g.kids) { nav.append(h('a', { class: 'ni', href: '#/' + g.route, 'data-route': g.route, 'aria-current': 'false' }, CC.icon(g.icon), g.label)); continue; }
      const kids = visibleKids(g);
      if (!kids.length) continue;
      const grp = h('div', { class: 'grp', 'data-g': g.id },
        h('button', { class: 'ni', type: 'button', 'aria-expanded': 'false', onclick: () => toggleGroup(g.id) }, CC.icon(g.icon), g.label, CC.icon('right', 'chev')),
        h('div', { class: 'sub' }, kids.map((k) => (k.href
          ? h('a', { href: k.href, target: '_blank', rel: 'noopener' }, ico('ext'), k.label)
          : h('a', { href: '#/' + k.route, 'data-route': k.route, 'data-g': g.id }, k.label)))));
      nav.append(grp);
    }
    return nav;
  }
  function toggleGroup(id) {
    document.querySelectorAll('.grp').forEach((g) => { const open = g.dataset.g === id && !g.classList.contains('open'); g.classList.toggle('open', open); g.firstChild.setAttribute('aria-expanded', String(open)); });
  }
  function markNav() {
    document.querySelectorAll('.side [data-route]').forEach((a) => {
      const on = a.dataset.route === navRoute;
      if (a.classList.contains('ni')) a.setAttribute('aria-current', String(on)); else a.setAttribute('aria-current', on ? 'page' : 'false');
    });
    const act = document.querySelector(`.sub a[data-route="${CSS.escape(navRoute)}"]`);
    document.querySelectorAll('.grp > .ni').forEach((b) => b.setAttribute('aria-current', 'false'));
    if (act) {
      const g = act.closest('.grp');
      document.querySelectorAll('.grp').forEach((x) => { x.classList.toggle('open', x === g); });
      g.firstChild.setAttribute('aria-current', 'true');
      g.firstChild.setAttribute('aria-expanded', 'true');
    }
  }

  /* ---------- Điều hướng ---------- */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const i = raw.indexOf('/');
    return i < 0 ? { id: raw || 'home', arg: '' } : { id: raw.slice(0, i), arg: decodeURIComponent(raw.slice(i + 1)) };
  }
  let token = 0;
  async function route() {
    if (!st.user) return;
    st.timers.forEach(clearInterval);
    st.timers = [];
    const { id, arg } = parseHash();
    const def = pages.get(id === 'e' ? 'embed' : id) || pages.get('home');
    const my = ++token;
    const view = document.getElementById('view');
    closeSide();
    let nav = def.nav ? (typeof def.nav === 'function' ? def.nav(arg) : def.nav) : id;
    if (id === 'e') nav = 'e/' + arg;
    navRoute = nav;
    markNav();
    document.title = `${def.title ? (typeof def.title === 'function' ? def.title(arg) : def.title) : 'Trang chủ'} - ${st.info.company_name}`;
    mount(view, loading());
    try {
      if (def.allow && !def.allow(arg)) { mount(view, h('div', { class: 'empty' }, h('strong', null, 'Bạn chưa được cấp quyền dùng chức năng này'), h('p', null, 'Hãy liên hệ quản trị viên để được phân quyền.'))); return; }
      const el = h('div', { style: { display: 'contents' } });
      await def.render(el, arg);
      if (my === token) { mount(view, el); window.scrollTo(0, 0); }
    } catch (e) { if (my === token && e.status !== 401) mount(view, errorBox(e, route)); }
  }
  window.addEventListener('hashchange', route);

  // Nhúng trang của web quản lý (chấm công, nhân sự, cài đặt) vào khung ERP
  page('embed', {
    title: (a) => ({ dashboard: 'Tổng quan chấm công', logs: 'Nhật ký chấm công', timesheet: 'Bảng công', requests: 'Đơn từ nhân sự', employees: 'Nhân viên', schedule: 'Xếp ca', payroll: 'Bảng lương', catalog: 'Danh mục', announce: 'Thông báo nội bộ', settings: 'Cài đặt hệ thống', update: 'Cập nhật phần mềm' }[a] || 'Quản lý'),
    allow: (a) => !!EMBED_ROLES[a] && EMBED_ROLES[a].includes(st.user.role),
    render(el, a) {
      el.append(h('iframe', { class: 'embed', src: `/admin/?embed=1#/${encodeURIComponent(a)}`, title: 'Quản lý', style: { height: 'calc(100dvh - var(--head-h) - 56px)' } }));
    },
  });

  /* ---------- Thanh đầu: tìm kiếm, thông báo, tài khoản ---------- */
  const closeSide = () => { const s = document.getElementById('side'); if (s) s.classList.remove('open'); const c = document.getElementById('scrim'); if (c) c.classList.remove('open'); };
  const toggleSide = () => { const o = document.getElementById('side').classList.toggle('open'); document.getElementById('scrim').classList.toggle('open', o); };

  function searchBox() {
    const input = h('input', { type: 'search', placeholder: 'Tìm kiếm đơn hàng, khách hàng, nhân viên...', 'aria-label': 'Tìm kiếm', autocomplete: 'off' });
    const res = h('div', { class: 'res', hidden: true });
    const box = h('div', { class: 'search', id: 'search' }, h('div', { class: 'box' }, CC.icon('search'), input, h('kbd', null, 'Ctrl K')), res);
    const run = debounce(async () => {
      const k = input.value.trim();
      if (k.length < 2) { res.hidden = true; return; }
      try {
        const r = await GET('/api/erp/search?q=' + encodeURIComponent(k));
        const secs = [];
        const sec = (t, arr, mk) => { if (arr.length) secs.push(h('h4', null, t), arr.map(mk)); };
        sec('Đơn hàng', r.orders, (o) => h('a', { href: '#/order/' + o.code }, h('span', null, `${o.code} · ${o.customer_name}`), h('small', null, money(o.total))));
        sec('Khách hàng', r.customers, (c) => h('a', { href: '#/customers/' + c.id }, h('span', null, c.name), h('small', null, c.phone || c.code)));
        sec('Nhân viên', r.employees, (e) => h('a', { href: '#/e/employees' }, h('span', null, e.full_name), h('small', null, e.code)));
        mount(res, secs.length ? secs : h('div', { class: 'empty', style: { padding: '14px' } }, 'Không có kết quả'));
        res.hidden = false;
      } catch { res.hidden = true; }
    }, 250);
    input.addEventListener('input', run);
    res.addEventListener('click', () => { res.hidden = true; input.value = ''; box.classList.remove('open'); });
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) { res.hidden = true; } });
    document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); box.classList.add('open'); input.focus(); } if (e.key === 'Escape') { res.hidden = true; box.classList.remove('open'); } });
    return box;
  }

  async function loadNotes() {
    try {
      st.notes = await GET('/api/erp/notifications');
      const n = st.notes.filter((x) => x.kind === 'warn' || x.embed === 'requests').length;
      document.querySelectorAll('[data-bell]').forEach((b) => { b.textContent = n > 9 ? '9+' : String(n); b.hidden = !n; });
    } catch { /* bỏ qua */ }
  }
  const NOTE_ICON = { ok: 'check', warn: 'bell', info: 'doc', user: 'user' };
  const noteEl = (n) => {
    const kids = [h('span', { class: 'dot ' + n.kind }, CC.icon(NOTE_ICON[n.kind] || 'doc')), h('div', null, n.text, h('small', null, ago(n.ts)))];
    const href = n.route ? '#/' + n.route : n.embed ? '#/e/' + n.embed : null;
    return href ? h('a', { href }, kids) : h('div', { class: 'n' }, kids);
  };
  async function notesDialog() {
    await loadNotes();
    const body = st.notes.length ? h('div', { class: 'notes', onclick: () => d.close() }, st.notes.map(noteEl)) : h('div', { class: 'empty' }, h('strong', null, 'Chưa có thông báo nào'));
    const d = dialog({ title: 'Thông báo', body });
  }

  function passwordForm({ forced, onDone, lastPw }) {
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const f = (a) => h('input', { class: 'in', type: 'password', autocomplete: a });
    const old = f('current-password'); const n1 = f('new-password'); const n2 = f('new-password');
    if (lastPw) old.value = lastPw;
    const btn = h('button', { class: 'btn primary block', type: 'submit', style: { minHeight: '44px' } }, 'Lưu mật khẩu mới');
    return h('form', {
      novalidate: true, style: { display: 'flex', flexDirection: 'column', gap: '14px' },
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        if (n1.value.length < 6) return fail('Mật khẩu mới phải có ít nhất 6 ký tự.');
        if (n1.value !== n2.value) return fail('Mật khẩu nhập lại chưa khớp.');
        btn.disabled = true;
        try {
          const r = await POST('/api/auth/change-password', { old_password: old.value, new_password: n1.value });
          CC.setToken(r.token); st.user = r.user; toast('Đã đổi mật khẩu', 'ok'); onDone();
        } catch (ex) { fail(ex.message); btn.disabled = false; }
      },
    }, forced ? h('p', { class: 'muted' }, 'Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được đặt lại. Hãy tạo mật khẩu riêng cho bạn.') : null,
    err, CC.field('Mật khẩu hiện tại', old), CC.field('Mật khẩu mới', n1, 'Ít nhất 6 ký tự'), CC.field('Nhập lại mật khẩu mới', n2), btn);
  }
  function changePassword() { const d = dialog({ title: 'Đổi mật khẩu', body: passwordForm({ onDone: () => d.close() }) }); }

  function userMenu(onLogout) {
    const u = st.user;
    const menu = h('div', { class: 'menu', hidden: true, role: 'menu' },
      h('div', { class: 'who' }, h('b', null, u.full_name), h('br'), h('span', null, CC.ROLE[u.role] + ' · ' + u.code)),
      h('a', { href: '/cc/', target: '_blank', rel: 'noopener' }, CC.icon('phone'), 'Ứng dụng chấm công'),
      h('button', { type: 'button', onclick: () => { menu.hidden = true; changePassword(); } }, CC.icon('key'), 'Đổi mật khẩu'),
      h('button', { type: 'button', onclick: async () => { menu.hidden = true; if (await confirmBox('Đăng xuất khỏi hệ thống?', { okText: 'Đăng xuất' })) onLogout(); } }, CC.icon('logout'), 'Đăng xuất'));
    const btn = h('button', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Tài khoản', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } },
      h('span', { class: 'avatar' }, initials(u.full_name)), h('span', null, h('small', null, 'Xin chào,'), h('b', null, u.full_name)), CC.icon('down'));
    document.addEventListener('click', () => { menu.hidden = true; });
    return h('div', { class: 'me' }, btn, menu);
  }

  function clockBox() {
    const date = h('b', null); const time = h('span', null);
    const tick = () => {
      const t = CC.now(); const y = CC.ymdOf(t);
      date.textContent = `${CC.DOW_LONG[CC.dowOf(y)]}, ${fmtDate(y)}`; time.textContent = CC.hhmm(t);
    };
    tick(); setInterval(tick, 15000);
    return h('div', { class: 'clock', 'aria-label': 'Ngày giờ' }, CC.icon('calendar'), h('div', null, date, time));
  }

  /* ---------- Khung chính ---------- */
  function shell(onLogout) {
    const logo = st.info.logo ? h('img', { class: 'logo', src: st.info.logo, alt: '' }) : h('img', { src: 'erp/logo-mark.png', alt: '' });
    mount(root, h('div', { class: 'app' },
      h('header', { class: 'top' },
        h('button', { class: 'tbtn burger', type: 'button', 'aria-label': 'Mở menu', onclick: toggleSide }, CC.icon('menu')),
        h('div', { class: 'brand' }, logo, h('div', { style: { minWidth: 0 } }, h('b', { title: st.info.company_name }, st.info.company_name), h('span', null, 'Hệ thống quản lý'))),
        searchBox(),
        h('span', { class: 'sp' }),
        h('button', { class: 'tbtn', type: 'button', 'aria-label': 'Tìm kiếm', style: { display: matchMedia('(max-width: 960px)').matches ? '' : 'none' }, onclick: () => { const s = document.getElementById('search'); s.classList.toggle('open'); s.querySelector('input').focus(); } }, CC.icon('search')),
        h('button', { class: 'tbtn', type: 'button', 'aria-label': 'Thông báo', onclick: notesDialog }, CC.icon('bell'), h('span', { class: 'tbadge', 'data-bell': true, hidden: true }, '0')),
        userMenu(onLogout),
        clockBox(),
        isAdmin() ? h('a', { class: 'tbtn', href: '#/e/settings', 'aria-label': 'Cài đặt hệ thống', title: 'Cài đặt hệ thống' }, CC.icon('settings')) : null),
      h('div', { class: 'body' },
        h('aside', { class: 'side', id: 'side' }, buildNav(), h('div', { class: 'side-art' }, h('span', null, 'Công nghệ kiến tạo', h('br'), 'hiệu quả'))),
        h('div', { class: 'scrim', id: 'scrim', onclick: closeSide }),
        h('main', { class: 'main', id: 'view' }))));
    loadNotes();
    st.noteTimer = setInterval(loadNotes, 60000);
  }

  async function start(user, onLogout) {
    st.user = user;
    try { st.me = await GET('/api/erp/me'); } catch { st.me = { modules: [], is_admin: false, driver: null }; }
    shell(onLogout);
    if (!location.hash || location.hash === '#') location.hash = '#/home';
    route();
  }
  const stop = () => { clearInterval(st.noteTimer); st.timers.forEach(clearInterval); st.timers = []; memo.clear(); };

  return {
    st, page, start, stop, route, go, can, sees, isAdmin, isMgr, isDriver, passwordForm,
    ico, money, norm, ST, ST_LONG, SRC, srcChip, checkChip, statusChip, chip, ago, ymdLocal, dmy, loading, errorBox, head, select, table, pager, busy, tabs, combo, refs, toBase64, printOpen, loadNotes, noteEl,
    setRoot: (el) => { root = el; },
  };
})();
