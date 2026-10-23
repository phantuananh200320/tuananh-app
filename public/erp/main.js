'use strict';
/* Khởi động: đăng nhập, đổi mật khẩu lần đầu, vào khung ERP. */
(function () {
  const { h, mount, GET, POST, field } = CC;
  const root = document.getElementById('root');
  ERP.setRoot(root);
  const S = { user: null, info: { company_name: 'Hệ thống quản lý' }, lastPw: '' };

  function logout() {
    ERP.stop();
    CC.setToken('');
    S.user = null;
    location.hash = '';
    showLogin();
  }
  CC.session.onExpire = () => { ERP.stop(); S.user = null; showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); };

  function card(...kids) {
    document.title = S.info.company_name;
    const logo = S.info.logo ? h('img', { src: S.info.logo, alt: '' }) : h('img', { src: 'erp/logo-mark.png', alt: '' });
    mount(root, h('div', { class: 'login' }, h('div', { class: 'lcard' },
      h('div', { class: 'top2' }, logo, h('div', null, h('h1', null, 'Hệ thống quản lý'), h('p', { class: 's' }, S.info.company_name))), kids)));
  }

  function showLogin(message) {
    const err = h('div', { class: 'err', role: 'alert', hidden: !message }, message || '');
    const user = h('input', { class: 'in', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', value: CC.store.get('cc_user') || '' });
    const pass = h('input', { class: 'in', type: 'password', autocomplete: 'current-password' });
    const btn = h('button', { class: 'btn primary block', type: 'submit', style: { minHeight: '46px', fontSize: '16px' } }, 'Đăng nhập');
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault(); err.hidden = true;
        if (!user.value.trim() || !pass.value) { err.textContent = 'Vui lòng nhập tài khoản và mật khẩu.'; err.hidden = false; return; }
        btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
        try {
          const r = await POST('/api/auth/login', { username: user.value.trim(), password: pass.value });
          CC.setToken(r.token); CC.store.set('cc_user', user.value.trim());
          S.user = r.user; S.lastPw = pass.value;
          enter();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Đăng nhập'; }
      },
    }, err, field('Tài khoản (mã nhân viên hoặc số điện thoại)', user), field('Mật khẩu', pass), btn);
    card(form, h('p', { class: 'foot' }, 'Quên mật khẩu? Hãy nhờ quản trị viên cấp lại cho bạn.'));
    setTimeout(() => (user.value ? pass : user).focus(), 50);
  }

  function enter() {
    if (!S.user) return showLogin();
    if (S.user.must_change_password) {
      card(h('div', { style: { padding: '22px 28px 10px' } }, ERP.passwordForm({ forced: true, lastPw: S.lastPw, onDone: () => { S.user = ERP.st.user; enter(); } })),
        h('p', { class: 'foot' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); logout(); } }, 'Đăng xuất')));
      return;
    }
    ERP.start(S.user, logout);
  }

  (async function boot() {
    mount(root, h('div', { class: 'login' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Đang tải' })));
    S.info = await CC.loadPublicInfo();
    ERP.st.info = S.info;
    CC.watchVersion(CC.updateBanner);
    if (CC.getToken()) {
      try { S.user = (await GET('/api/auth/me')).user; } catch (e) {
        if (e.code === 'NETWORK') { mount(root, h('div', { class: 'login' }, h('div', { class: 'lcard', style: { padding: '24px' } }, ERP.errorBox(e, () => location.reload())))); return; }
        S.user = null;
      }
    }
    enter();
  })();
})();
