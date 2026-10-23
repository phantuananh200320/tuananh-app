'use strict';
/* Khung của web quản lý: đăng nhập, điều hướng, các thành phần giao diện dùng lại. */
window.ADM = (function () {
  const { h, icon, mount, clear, GET, POST, toast, dialog, field, initials, STATUS } = CC;
  const root = document.getElementById('root');
  const st = { user: null, info: { company_name: 'Chấm công' }, refs: null, pending: 0, photoTok: null, photoAt: 0 };
  const pages = [];
  let timers = [];
  let current = null;

  const isAdmin = () => st.user && st.user.role === 'admin';
  const register = (def) => pages.push(def);
  const every = (fn, ms) => { timers.push(setInterval(fn, ms)); };

  /* ---------- Dữ liệu tham chiếu (phòng ban, chi nhánh, ca, nhân viên) ---------- */
  async function refs(force) {
    if (!st.refs || force) {
      const [departments, branches, shifts, employees] = await Promise.all([GET('/api/departments'), GET('/api/branches'), GET('/api/shifts'), GET('/api/employees?all=1')]);
      st.refs = { departments, branches, shifts, employees };
    }
    return st.refs;
  }

  /* ---------- Thành phần giao diện ---------- */
  const loading = () => h('div', { class: 'empty' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Đang tải' }));
  const errorBox = (e, retry) => h('div', { class: 'empty' }, h('strong', null, 'Không tải được dữ liệu'), h('p', null, e.message), retry ? h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: retry }, icon('refresh'), 'Thử lại') : null);

  function pageHead(title, sub, ...actions) {
    return h('div', { class: 'pagehead' }, h('div', null, h('h1', null, title), sub ? h('p', null, sub) : null), h('div', { class: 'acts' }, actions));
  }

  function select(options, value, { placeholder, onchange, cls = '' } = {}) {
    const s = h('select', { class: 'in ' + cls, onchange }, placeholder !== undefined ? h('option', { value: '' }, placeholder) : null,
      options.map((o) => h('option', { value: o.v }, o.l)));
    if (value !== undefined && value !== null) s.value = String(value);
    return s;
  }

  function table({ cols, rows, empty = 'Chưa có dữ liệu', foot, cls = '', rowClass }) {
    if (!rows.length) return h('div', { class: 'empty' }, h('strong', null, empty));
    return h('div', { class: 'tablewrap' }, h('table', { class: 'tbl ' + cls },
      h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.cls || '', style: c.w ? { width: c.w } : null }, c.label)))),
      h('tbody', null, rows.map((r, i) => h('tr', { class: rowClass ? rowClass(r) : '' }, cols.map((c) => h('td', { class: c.cls || '' }, c.render(r, i)))))),
      foot ? h('tfoot', null, foot) : null));
  }

  const person = (e) => h('div', { class: 'who' }, h('span', { class: 'av', 'aria-hidden': 'true' }, initials(e.full_name)), h('div', null, h('b', null, e.full_name), h('span', null, e.code + (e.dept_name ? ' · ' + e.dept_name : ''))));
  const statusChip = (s) => { const x = STATUS[s] || {}; return h('span', { class: 'chip ' + (x.tone === 'mute' || x.tone === 'none' ? '' : x.tone || '') }, x.label || ''); };

  function monthNav(month, onChange) {
    const isNow = month === CC.monthNow();
    return h('div', { class: 'monthnav' },
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tháng trước', onclick: () => onChange(CC.addMonths(month, -1)) }, icon('left')),
      h('b', null, CC.fmtMonth(month)),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tháng sau', onclick: () => onChange(CC.addMonths(month, 1)) }, icon('right')),
      isNow ? null : h('button', { class: 'btn sm ghost', type: 'button', onclick: () => onChange(CC.monthNow()) }, 'Tháng này'));
  }

  const deptSelect = (r, value, onchange) => { const s = select(r.departments.map((d) => ({ v: d.id, l: d.name })), value, { placeholder: 'Tất cả phòng ban', onchange }); s.setAttribute('aria-label', 'Phòng ban'); return s; };

  async function photoUrl(photo) {
    if (!st.photoTok || Date.now() - st.photoAt > 20 * 60 * 1000) {
      st.photoTok = (await GET('/api/photo-token')).token;
      st.photoAt = Date.now();
    }
    return `/api/photos/${photo}?t=${encodeURIComponent(st.photoTok)}`;
  }
  function thumb(photo) {
    if (!photo) return h('span', { class: 'muted' }, '');
    const img = h('img', { class: 'thumb', alt: 'Ảnh chấm công', loading: 'lazy', tabindex: '0', role: 'button' });
    photoUrl(photo).then((u) => { img.src = u; img.onclick = () => dialog({ title: 'Ảnh chấm công', body: h('img', { class: 'bigphoto', src: u, alt: 'Ảnh chấm công' }) }); img.onkeydown = (e) => { if (e.key === 'Enter') img.click(); }; }).catch(() => {});
    return img;
  }

  async function withBusy(btn, fn) {
    btn.disabled = true;
    try { return await fn(); } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; }
  }

  /* ---------- Điều hướng ---------- */
  function visiblePages() { return pages.filter((p) => p.roles.includes(st.user.role)); }

  async function refreshBadge() {
    try { st.pending = (await GET('/api/requests/pending-count')).count; } catch { st.pending = 0; }
    const b = document.getElementById('nav-badge');
    if (b) { b.textContent = String(st.pending); b.hidden = !st.pending; }
  }

  async function route() {
    if (!st.user) return;
    timers.forEach(clearInterval);
    timers = [];
    const id = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0];
    const vis = visiblePages();
    const page = vis.find((p) => p.id === id) || vis[0];
    current = page;
    document.querySelectorAll('.nav a').forEach((a) => a.setAttribute('aria-current', a.dataset.id === page.id ? 'page' : 'false'));
    document.getElementById('side').classList.remove('open');
    document.title = `${page.label} - ${st.info.company_name}`;
    const content = document.getElementById('content');
    mount(content, loading());
    try {
      const el = h('div', { style: { display: 'contents' } });
      await page.render(el);
      if (current === page) { mount(content, el); window.scrollTo(0, 0); }
    } catch (e) {
      if (e.status !== 401) mount(content, errorBox(e, route));
    }
    refreshBadge();
  }
  window.addEventListener('hashchange', route);

  const homeLink = (ic, label, href = '../') => h('a', { class: 'btn', href, style: { justifyContent: 'flex-start', background: 'transparent', color: 'var(--side-ink)', borderColor: 'color-mix(in srgb, #fff 24%, transparent)', minHeight: '34px', fontSize: '13px' } }, icon(ic), label);

  function layout() {
    const vis = visiblePages();
    mount(root, h('div', { class: 'shell' },
      h('aside', { class: 'side', id: 'side', 'aria-label': 'Menu chính' },
        h('div', { class: 'brand' }, CC.logoImg(st.info, '../icons/icon-192.png'), h('div', null, h('b', null, st.info.company_name), h('span', null, 'Quản lý chấm công'))),
        h('nav', { class: 'nav' }, vis.map((p) => h('a', { href: '#/' + p.id, 'data-id': p.id, 'aria-current': 'false' }, icon(p.icon), p.label, p.id === 'requests' ? h('span', { class: 'badge', id: 'nav-badge', hidden: true }, '0') : null))),
        h('div', { class: 'me' },
          h('div', { class: 'who' }, h('div', null, h('b', null, st.user.full_name), h('span', null, CC.ROLE[st.user.role] + ' · ' + st.user.code))),
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: changePasswordDialog }, icon('key'), 'Mật khẩu'),
            h('button', { class: 'btn', type: 'button', onclick: logout }, icon('logout'), 'Thoát')),
          homeLink('home', 'Trang chủ hệ thống'), homeLink('phone', 'Ứng dụng nhân viên', '../cc/'))),
      h('div', { class: 'main' },
        h('div', { class: 'topbar' }, h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Mở menu', onclick: () => document.getElementById('side').classList.toggle('open') }, icon('menu')), h('b', null, st.info.company_name)),
        h('main', { class: 'content', id: 'content' }))));
  }

  /* ---------- Đăng nhập, đổi mật khẩu ---------- */
  function showLogin(message) {
    const err = h('div', { class: 'err', role: 'alert', hidden: !message }, message || '');
    const user = h('input', { class: 'in', type: 'text', autocomplete: 'username', required: true, value: CC.store.get('cc_user') || '' });
    const pass = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit', style: { minHeight: '46px' } }, 'Đăng nhập');
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (!user.value.trim() || !pass.value) { err.textContent = 'Vui lòng nhập tài khoản và mật khẩu.'; err.hidden = false; return; }
        btn.disabled = true;
        try {
          const r = await POST('/api/auth/login', { username: user.value.trim(), password: pass.value });
          if (r.user.role === 'employee') { err.innerHTML = ''; err.append('Tài khoản này không có quyền quản lý. Hãy dùng ', h('a', { href: '../cc/' }, 'ứng dụng nhân viên'), '.'); err.hidden = false; btn.disabled = false; return; }
          CC.setToken(r.token);
          CC.store.set('cc_user', user.value.trim());
          st.user = r.user;
          st.lastPw = pass.value;
          start();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
      },
    }, h('h2', null, 'Đăng nhập quản lý'), err, field('Tài khoản', user, 'Mã nhân viên hoặc số điện thoại'), field('Mật khẩu', pass), btn);
    mount(root, h('div', { class: 'login' },
      h('div', { class: 'art' }, CC.logoImg(st.info, '../icons/icon-192.png'), h('div', null, h('h1', null, st.info.company_name), h('p', null, 'Theo dõi chấm công, xếp ca, duyệt đơn và chốt bảng công mỗi tháng trong một nơi.')), h('span', { style: { color: 'var(--side-mute)', fontSize: '13px' } }, 'Dành cho quản trị viên và quản lý')),
      h('div', { class: 'form' }, form)));
    setTimeout(() => (user.value ? pass : user).focus(), 50);
  }

  function passwordForm(forced, done) {
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const old = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', value: forced ? st.lastPw || '' : '' });
    const n1 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    const n2 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn primary', type: 'submit', style: { minHeight: '44px' } }, 'Lưu mật khẩu mới');
    return h('form', {
      novalidate: true, style: { display: 'flex', flexDirection: 'column', gap: '14px' },
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        if (n1.value.length < 6) return fail('Mật khẩu mới phải có ít nhất 6 ký tự.');
        if (n1.value !== n2.value) return fail('Mật khẩu nhập lại chưa khớp.');
        btn.disabled = true;
        try {
          const r = await POST('/api/auth/change-password', { old_password: old.value, new_password: n1.value });
          CC.setToken(r.token); st.user = r.user; st.lastPw = '';
          toast('Đã đổi mật khẩu', 'ok');
          done();
        } catch (ex) { fail(ex.message); btn.disabled = false; }
      },
    }, forced ? h('p', { class: 'muted' }, 'Bạn đang dùng mật khẩu mặc định hoặc mật khẩu vừa được đặt lại. Hãy tạo mật khẩu riêng trước khi tiếp tục.') : null,
    err, field('Mật khẩu hiện tại', old), field('Mật khẩu mới', n1, 'Ít nhất 6 ký tự'), field('Nhập lại mật khẩu mới', n2), btn);
  }
  function changePasswordDialog() { const d = dialog({ title: 'Đổi mật khẩu', body: passwordForm(false, () => d.close()) }); }

  function logout() {
    CC.setToken('');
    st.user = null; st.refs = null;
    timers.forEach(clearInterval);
    showLogin();
  }

  function start() {
    if (st.user.role === 'employee') { CC.setToken(''); st.user = null; showLogin('Tài khoản này không có quyền quản lý.'); return; }
    if (st.user.must_change_password) {
      mount(root, h('div', { class: 'login' },
        h('div', { class: 'art' }, CC.logoImg(st.info, '../icons/icon-192.png'), h('div', null, h('h1', null, 'Tạo mật khẩu riêng'), h('p', null, 'Mật khẩu mặc định chỉ dùng cho lần đăng nhập đầu tiên.')), h('span')),
        h('div', { class: 'form' }, h('div', { style: { width: 'min(380px,100%)', display: 'flex', flexDirection: 'column', gap: '14px' } }, h('h2', null, 'Đổi mật khẩu'), passwordForm(true, start)))));
      return;
    }
    layout();
    route();
  }

  CC.session.onExpire = () => { st.user = null; showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); };

  async function boot() {
    mount(root, loading());
    st.info = await CC.loadPublicInfo();
    CC.watchVersion(CC.updateBanner);
    document.title = 'Quản lý chấm công - ' + st.info.company_name;
    if (CC.getToken()) {
      try { st.user = (await GET('/api/auth/me')).user; } catch (e) { if (e.code === 'NETWORK') { mount(root, errorBox(e, () => location.reload())); return; } st.user = null; }
    }
    if (st.user) start(); else showLogin();
  }

  return { st, register, every, refs, isAdmin, loading, errorBox, pageHead, select, table, person, statusChip, monthNav, deptSelect, photoUrl, thumb, withBusy, boot, route, refreshBadge };
})();
