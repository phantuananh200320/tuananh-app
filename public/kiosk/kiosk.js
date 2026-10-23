'use strict';
(function () {
  const { h, icon, mount } = CC;
  const root = document.getElementById('root');
  const key = new URLSearchParams(location.search).get('key') || '';
  let state = null, fetchedAt = 0, failed = 0;

  const timeEl = h('div', { class: 'time' });
  const dateEl = h('div', { class: 'date' });
  const codeEl = h('div', { class: 'code', 'aria-live': 'off' });
  const barFill = h('i');
  const qrImg = h('img', { alt: 'Mã QR chấm công', width: '400', height: '400' });
  const qrCard = h('div', { class: 'qrcard' }, qrImg);
  const codeBox = h('div', { class: 'codebox' }, h('div', { class: 'lbl' }, 'Mã chấm công (đổi mỗi 30 giây)'), codeEl, h('div', { class: 'bar' }, barFill));
  const howEl = h('p', { class: 'how' });
  let faceCtl = null, faceOn = false; // faceOn: đang mở khung camera
  let faceAvail = false;               // quản trị đã bật và thư viện đã cài
  const idleSec = Number(new URLSearchParams(location.search).get('faceidle')) || 25; // tự đóng khung camera khi không dùng
  const faceBtn = h('button', { class: 'facebtn', type: 'button', onclick: () => { faceOn = true; build(true); } }, icon('camera'), 'Chấm công bằng khuôn mặt');
  // ---- Màn hình chờ: sau N phút không ai chấm công (và không chạm màn hình) thì hiện hình ảnh + thông báo; chạm để quay lại ----
  const idleOverride = Number(new URLSearchParams(location.search).get('idle')) || 0; // giây; chỉ dùng để xem thử (?idle=5)
  let lastActivity = Date.now(), lastLogTs = null;
  const saver = KioskSaver.create({ onWake: () => { lastActivity = Date.now(); load(); } });
  const poke = () => { if (!saver.isOn()) lastActivity = Date.now(); };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, poke, true));
  const recent = h('ul', { class: 'recent' });
  const coEl = h('div', { class: 'co' });
  const logoEl = h('img', { class: 'logo', alt: '', hidden: true, style: { height: 'clamp(48px, 7vw, 96px)', maxWidth: '60%', borderRadius: '12px', marginBottom: '8px' } });
  const brEl = h('h1');
  const offline = h('div', { class: 'offline', hidden: true }, 'Mất kết nối, đang thử lại');

  function fail(msg) { mount(root, h('div', { class: 'center' }, h('div', null, h('h1', null, 'Không mở được màn hình chấm công'), h('p', null, msg)))); }

  // Mở màn hình QR không kèm mã liên kết: quản trị viên đăng nhập rồi chọn chi nhánh
  async function chooseBranch(msg) {
    const open = (list, token) => {
      const pick = (b) => { location.search = '?key=' + encodeURIComponent(b.kiosk_key); };
      if (list.length === 1) { pick(list[0]); return; }
      mount(root, h('div', { class: 'center' }, h('div', null,
        h('h1', null, 'Chọn chi nhánh'), h('p', null, 'Màn hình QR này sẽ hiện mã chấm công của chi nhánh bạn chọn.'),
        h('div', { style: { display: 'grid', gap: '10px', marginTop: '16px', justifyItems: 'center' } },
          list.map((b) => h('button', { class: 'btn', type: 'button', style: { minWidth: '260px', minHeight: '48px', fontSize: '18px' }, onclick: () => pick(b) }, b.name))))));
    };
    const fromList = (rows) => (rows || []).filter((b) => b.kiosk_key && b.active !== 0);
    try { // đã đăng nhập quản trị trên trình duyệt này
      const rows = fromList(await CC.GET('/api/branches'));
      if (rows.length) { open(rows); return; }
    } catch { /* chưa đăng nhập: hiện form bên dưới */ }
    const err = h('p', { role: 'alert', style: { color: '#ff8a8a', minHeight: '1.4em' } }, msg || '');
    const user = h('input', { class: 'in', type: 'text', autocomplete: 'username', placeholder: 'Tài khoản quản trị', style: { width: '100%', minHeight: '48px', fontSize: '18px' } });
    const pass = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu', style: { width: '100%', minHeight: '48px', fontSize: '18px' } });
    const go = h('button', { class: 'btn primary', type: 'submit', style: { minHeight: '48px', fontSize: '18px' } }, 'Mở màn hình QR');
    mount(root, h('div', { class: 'center' }, h('form', { style: { display: 'grid', gap: '12px', width: 'min(360px, 90vw)', textAlign: 'left' }, novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true; err.textContent = '';
        try {
          const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.value.trim(), password: pass.value }) }).then((x) => x.json());
          if (!r.token) throw new Error(r.error || 'Đăng nhập không thành công');
          if (r.user.role !== 'admin') throw new Error('Chỉ quản trị viên mới mở được màn hình QR.');
          const rows = fromList(await fetch('/api/branches', { headers: { Authorization: 'Bearer ' + r.token } }).then((x) => x.json()));
          if (!rows.length) throw new Error('Chưa có chi nhánh nào. Hãy tạo chi nhánh ở trang quản lý, mục Danh mục.');
          open(rows);
        } catch (ex) { err.textContent = ex.message; go.disabled = false; }
      } },
      h('h1', { style: { textAlign: 'center' } }, 'Màn hình QR chấm công'), h('p', { style: { textAlign: 'center' } }, 'Đăng nhập quản trị để chọn chi nhánh.'),
      user, pass, err, go)));
    setTimeout(() => user.focus(), 50);
  }

  // face = true: có khung camera nhận diện khuôn mặt ở bên trái, mã QR thu nhỏ sang bên phải
  function build(face) {
    howEl.textContent = face
      ? 'Nhìn vào camera và chớp mắt để chấm công. Hoặc mở ứng dụng Chấm công trên điện thoại, bấm "Quét mã QR" rồi hướng vào mã bên cạnh.'
      : 'Mở ứng dụng Chấm công trên điện thoại, bấm "Quét mã QR" rồi hướng camera vào mã bên trái. Hoặc nhập mã 6 số.';
    if (faceCtl) { faceCtl.stop(); faceCtl = null; }
    if (face) {
      faceCtl = KioskFace.start({
        key, liveness: !!(state && state.face_liveness), idleMs: idleSec * 1000,
        onResult: () => load(),
        onClose: () => { faceOn = false; build(false); },
      });
      mount(root, h('div', { class: 'k face' },
        faceCtl.el,
        h('div', { class: 'info' }, logoEl, coEl, brEl, timeEl, dateEl,
          h('div', { class: 'qrrow' }, qrCard, codeBox),
          howEl, recent),
        offline));
    } else {
      mount(root, h('div', { class: 'k' },
        qrCard,
        h('div', { class: 'info' }, logoEl, coEl, brEl, timeEl, dateEl, codeBox, faceAvail ? faceBtn : null, howEl, recent),
        offline));
    }
  }

  async function load() {
    try {
      const r = await fetch('/api/kiosk/state?key=' + encodeURIComponent(key), { cache: 'no-store' });
      if (r.status === 404) { fail('Liên kết không hợp lệ hoặc đã bị thay. Hãy lấy liên kết mới trong trang quản lý, mục Danh mục, Chi nhánh.'); return false; }
      if (!r.ok) throw new Error('http ' + r.status);
      state = await r.json();
      fetchedAt = Date.now();
      failed = 0;
      offline.hidden = true;
      CC.clock.skew = state.now - Date.now();
      coEl.textContent = state.company;
      if (state.logo) { logoEl.src = state.logo; logoEl.hidden = false; CC.setFavicon(state.logo); } else logoEl.hidden = true;
      brEl.textContent = state.branch;
      document.title = `${state.branch} - Chấm công QR`;
      qrImg.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(state.svg);
      codeEl.textContent = state.code.slice(0, 3) + ' ' + state.code.slice(3);
      if (!!state.face !== faceAvail) { // quản trị vừa bật/tắt hoặc thư viện vừa cài
        faceAvail = !!state.face;
        if (!faceAvail) faceOn = false;
        build(faceOn);
      }
      // Có lượt chấm công mới tại chi nhánh này: tính là có người dùng, bắt đầu đếm lại thời gian chờ
      const lastTs = state.recent.length ? state.recent[0].ts : 0;
      if (lastLogTs !== null && lastTs !== lastLogTs) lastActivity = Date.now();
      lastLogTs = lastTs;
      if (saver.isOn()) saver.show(state); // cập nhật hình/thông báo mới, hoặc tự đóng nếu quản trị đã tắt tính năng
      mount(recent, state.recent.slice(0, 5).map((x) => h('li', null, h('span', null, x.full_name), h('span', { class: 't' }, `${x.type === 'in' ? 'Vào' : 'Ra'} ${CC.hhmm(x.ts)}`))));
      return true;
    } catch {
      failed++;
      if (failed > 2) offline.hidden = false;
      return true;
    }
  }

  function tick() {
    const n = CC.now();
    timeEl.textContent = CC.hhmm(n);
    const t = CC.todayStr();
    dateEl.textContent = `${CC.DOW_LONG[CC.dowOf(t)]}, ${CC.fmtDate(t)}`;
    if (faceOn) lastActivity = Date.now(); // đang dùng camera nhận diện: chưa phải lúc nghỉ
    else if (state && state.screensaver && !saver.isOn() && Date.now() - lastActivity >= (idleOverride ? idleOverride * 1000 : state.screensaver.idle_ms)) saver.show(state);
    if (state) {
      const left = Math.max(0, state.expires_in - (Date.now() - fetchedAt));
      barFill.style.transform = `scaleX(${Math.min(1, left / 30000)})`;
      if (left <= 0 && Date.now() - fetchedAt > 800) load();
    }
  }

  (async function init() {
    await CC.loadPublicInfo();
    if (!key) { chooseBranch(); return; }
    build(false);
    // Màn hình đặt ở quầy không có người bấm: khi có phiên bản mới thì tự tải lại lúc không dùng camera (lệch giờ ngẫu nhiên để nhiều máy không tải cùng lúc)
    CC.watchVersion(() => { const go = () => (faceOn ? setTimeout(go, 15000) : location.reload()); setTimeout(go, 3000 + Math.random() * 7000); }, 60000);
    if (!(await load())) return;
    tick();
    setInterval(tick, 1000);
    setInterval(() => { if (Date.now() - fetchedAt > 10000) load(); }, 5000);
  })();
})();
