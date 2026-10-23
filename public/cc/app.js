'use strict';
(function () {
  const {
    h, icon, mount, GET, POST, toast, dialog, confirmBox, field, initials,
    fmtDate, fmtDay, hhmm, STATUS, METHOD, REQ_TYPE, REQ_STATUS, ROLE,
  } = CC;

  const root = document.getElementById('root');
  const S = { user: null, info: { company_name: 'Chấm công' }, today: null, pos: null, posErr: null, watchId: null, locUpdater: null, lastPw: '', installEvt: null, busy: false };
  let timers = [];

  const TABS = [['/', 'Chấm công', 'clock'], ['/month', 'Bảng công', 'calendar'], ['/requests', 'Đơn từ', 'doc'], ['/me', 'Cá nhân', 'user']];

  function cleanup() {
    timers.forEach(clearInterval);
    timers = [];
    if (S.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(S.watchId);
    S.watchId = null;
    S.locUpdater = null;
  }

  /* ---------- Khung chung ---------- */
  const loadingView = () => h('div', { class: 'empty' }, h('span', { class: 'spinner', role: 'status', 'aria-label': 'Đang tải' }));
  function errorView(e, retry) {
    return h('div', { class: 'empty' }, h('strong', null, 'Không tải được dữ liệu'), h('p', null, e.message), h('p', null, h('button', { class: 'btn', type: 'button', style: { marginTop: '12px' }, onclick: retry }, icon('refresh'), 'Thử lại')));
  }
  function shell(active, ...content) {
    const main = h('main', { class: 'screen' }, content);
    mount(root, h('div', { class: 'app' }, main,
      h('nav', { class: 'tabs', 'aria-label': 'Điều hướng' },
        TABS.map(([p, l, i]) => h('a', { class: 'tab', href: '#' + p, 'aria-current': p === active ? 'page' : null }, icon(i), l)))));
    window.scrollTo(0, 0);
    return main;
  }
  const goHome = () => { location.hash = '#/'; };

  /* ---------- Điều hướng ---------- */
  async function route() {
    cleanup();
    const path = location.hash.replace(/^#/, '') || '/';
    const scan = path.match(/^\/scan\/(\d+)\/(\d{6})/);
    if (!S.user) {
      if (scan) CC.store.set('cc_scan', `${scan[1]}|${scan[2]}`);
      return showLogin();
    }
    if (S.user.must_change_password) return showForcedPassword();
    if (scan) CC.store.set('cc_scan', `${scan[1]}|${scan[2]}`);
    if (path.startsWith('/scan/')) { history.replaceState(null, '', location.pathname + '#/'); }
    if (path === '/month') return renderMonth();
    if (path === '/requests') return renderRequests();
    if (path === '/me') return renderMe();
    await renderHome();
    const pending = CC.store.get('cc_scan');
    if (pending) {
      CC.store.del('cc_scan');
      const [b, c] = pending.split('|');
      confirmScan(Number(b), c);
    }
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.user && (location.hash === '' || location.hash === '#/') && !document.querySelector('dialog[open]') && !S.busy) route();
  });
  CC.session.onExpire = () => { S.user = null; cleanup(); showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'); };

  /* ---------- Đăng nhập ---------- */
  function authShell(...kids) {
    mount(root, h('div', { class: 'auth' },
      h('div', { class: 'brand' }, CC.logoImg(S.info, '../icons/icon-192.png'), h('div', null, h('h1', null, S.info.company_name), h('p', null, 'Chấm công và quản lý ca làm việc'))),
      kids));
  }

  function showLogin(message) {
    const err = h('div', { class: 'err', role: 'alert', hidden: !message }, message || '');
    const user = h('input', { class: 'in', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text', required: true, value: CC.store.get('cc_user') || '' });
    const pass = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit', style: { minHeight: '48px', fontSize: '16px' } }, 'Đăng nhập');
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        if (!user.value.trim() || !pass.value) { err.textContent = 'Vui lòng nhập tài khoản và mật khẩu.'; err.hidden = false; return; }
        btn.disabled = true;
        btn.textContent = 'Đang đăng nhập...';
        try {
          const r = await POST('/api/auth/login', { username: user.value.trim(), password: pass.value });
          CC.setToken(r.token);
          CC.store.set('cc_user', user.value.trim());
          S.user = r.user;
          S.lastPw = pass.value;
          route();
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
          btn.disabled = false;
          btn.textContent = 'Đăng nhập';
        }
      },
    }, err, field('Mã nhân viên hoặc số điện thoại', user), field('Mật khẩu', pass), btn);
    authShell(form, h('p', { class: 'foot' }, 'Quên mật khẩu? Hãy nhờ quản trị viên đặt lại cho bạn.'), h('nav', { class: 'picker', 'aria-label': 'Chọn tính năng' },
      h('a', { class: 'tile on', href: './', 'aria-current': 'page' }, icon('clock'), h('b', null, 'Chấm công'), h('span', null, 'Dành cho nhân viên')),
      h('a', { class: 'tile', href: '../admin/' }, icon('settings'), h('b', null, 'Trang quản lý'), h('span', null, 'Quản trị, quản lý')),
      h('a', { class: 'tile', href: '../kiosk/' }, icon('qr'), h('b', null, 'Màn hình QR'), h('span', null, 'Máy chấm công tại chỗ'))));
    setTimeout(() => (user.value ? pass : user).focus(), 50);
  }

  function passwordForm({ forced, onDone }) {
    const err = h('div', { class: 'err', role: 'alert', hidden: true });
    const old = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', value: S.lastPw || '' });
    const n1 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    const n2 = h('input', { class: 'in', type: 'password', autocomplete: 'new-password' });
    const btn = h('button', { class: 'btn primary block', type: 'submit', style: { minHeight: '46px' } }, 'Lưu mật khẩu mới');
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        err.hidden = true;
        const fail = (m) => { err.textContent = m; err.hidden = false; };
        if (n1.value.length < 6) return fail('Mật khẩu mới phải có ít nhất 6 ký tự.');
        if (n1.value !== n2.value) return fail('Mật khẩu nhập lại chưa khớp.');
        btn.disabled = true;
        try {
          const r = await POST('/api/auth/change-password', { old_password: old.value, new_password: n1.value });
          CC.setToken(r.token);
          S.user = r.user;
          S.lastPw = '';
          toast('Đã đổi mật khẩu', 'ok');
          onDone();
        } catch (ex) { fail(ex.message); btn.disabled = false; }
      },
    }, forced ? h('p', { class: 'muted' }, 'Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được đặt lại. Hãy tạo mật khẩu riêng cho bạn.') : null,
    err, field('Mật khẩu hiện tại', old), field('Mật khẩu mới', n1, 'Ít nhất 6 ký tự'), field('Nhập lại mật khẩu mới', n2), btn);
    return form;
  }

  function showForcedPassword() {
    authShell(h('div', { class: 'stack' }, h('h2', null, 'Tạo mật khẩu mới'), passwordForm({ forced: true, onDone: route })),
      h('button', { class: 'btn ghost', type: 'button', onclick: logout }, 'Đăng xuất'));
  }

  function logout() {
    CC.setToken('');
    S.user = null;
    S.today = null;
    cleanup();
    showLogin();
  }

  /* ---------- Vị trí ---------- */
  function distM(a, b, c, d) {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180;
    const dl = rad(c - a), dn = rad(d - b);
    const x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dn / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function startWatch() {
    if (!navigator.geolocation || S.watchId !== null) return;
    S.watchId = navigator.geolocation.watchPosition(
      (p) => { S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, ts: Date.now() }; S.posErr = null; if (S.locUpdater) S.locUpdater(); },
      (e) => { S.posErr = e.code; if (S.locUpdater) S.locUpdater(); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
    );
  }
  function getPosition() {
    if (S.pos && Date.now() - S.pos.ts < 30000) return Promise.resolve(S.pos);
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => { S.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, ts: Date.now() }; resolve(S.pos); },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  /* ---------- Chấm công ---------- */
  async function renderHome() {
    const main = shell('/', loadingView());
    let t;
    try { t = await GET('/api/me/today'); } catch (e) { mount(main, errorView(e, renderHome)); return; }
    CC.clock.skew = t.now - Date.now();
    S.today = t;
    drawHome(main, t);
  }

  function drawHome(main, t) {
    const u = S.user;
    const d = t.day;
    const next = t.next_type;
    const secEl = h('span', { class: 'sec' });
    const hmEl = h('span');
    const dateEl = h('div', { class: 'date' });
    const tick = () => {
      const n = CC.now();
      const [hh, mm, ss] = CC.hhmmss(n).split(':');
      hmEl.textContent = `${hh}:${mm}`;
      secEl.textContent = ':' + ss;
      const today = CC.todayStr();
      dateEl.textContent = `${CC.DOW_LONG[CC.dowOf(today)]}, ${fmtDate(today)}`;
    };
    tick();
    timers.push(setInterval(tick, 1000));

    // Dòng ca làm việc
    const shiftLine = h('div', { class: 'shift' });
    if (d.holiday) shiftLine.append(h('span', { class: 'chip stamp' }, 'Ngày lễ'), d.holiday);
    else if (d.shift) shiftLine.append(icon('clock'), `${d.shift.name}: ${d.shift.start} - ${d.shift.end}`);
    else shiftLine.append('Hôm nay bạn không có ca làm việc');
    if (d.late_min > 0) shiftLine.append(h('span', { class: 'chip warn' }, `Đi muộn ${d.late_min} phút`));

    // Vị trí
    const loc = h('div', { class: 'loc', 'aria-live': 'polite' });
    const geoBranches = t.branches.filter((b) => b.lat !== null && b.lng !== null);
    const needGeo = !t.remote && t.settings.allow_gps && geoBranches.length > 0;
    const updateLoc = () => {
      if (!needGeo) { mount(loc, t.remote ? [icon('home'), 'Làm việc từ xa: không giới hạn vị trí'] : []); loc.className = 'loc'; return; }
      if (S.posErr === 1) { loc.className = 'loc bad'; mount(loc, icon('pin'), 'Chưa có quyền truy cập vị trí. Bạn vẫn có thể quét mã QR.'); return; }
      if (!S.pos) { loc.className = 'loc'; mount(loc, h('span', { class: 'spinner' }), 'Đang xác định vị trí...'); return; }
      let best = null;
      for (const b of geoBranches) { const dist = distM(S.pos.lat, S.pos.lng, b.lat, b.lng); if (!best || dist < best.dist) best = { b, dist }; }
      const m = Math.round(best.dist);
      if (m <= best.b.radius) { loc.className = 'loc ok'; mount(loc, icon('pin'), `Đúng vị trí: ${best.b.name} (cách ${m} m)`); }
      else { loc.className = 'loc bad'; mount(loc, icon('pin'), `Cách ${best.b.name} ${m} m. Cần trong ${best.b.radius} m`); }
    };
    S.locUpdater = updateLoc;
    updateLoc();
    if (needGeo) startWatch();

    const sealBtn = h('button', { class: 'punch' + (next === 'out' ? ' out' : ''), type: 'button', id: 'seal', onclick: () => doCheckin() },
      icon(next === 'out' ? 'logout' : 'check'), h('span', { class: 't' }, next === 'out' ? 'Chấm ra' : 'Chấm vào'),
      t.open_in ? h('span', { class: 's' }, 'Đã vào lúc ' + hhmm(t.open_in.ts)) : null);

    const stage = h('section', { class: 'stage', 'aria-label': 'Chấm công' },
      h('div', { class: 'clock num' }, hmEl, secEl), dateEl, shiftLine, sealBtn, loc,
      t.settings.allow_qr ? h('button', { class: 'btn', type: 'button', onclick: openScanner }, icon('qr'), 'Quét mã QR tại điểm chấm công') : null);

    // Các lượt trong ngày
    const logsCard = h('section', { class: 'card' }, h('h2', null, 'Hôm nay'),
      t.logs.length
        ? h('ul', { class: 'timeline' }, t.logs.map((l) => h('li', null,
          h('span', { class: 'dot ' + (l.type === 'out' ? 'is-out' : 'is-in') }),
          h('span', null, h('span', { class: 'tm' }, hhmm(l.ts)), ' ', h('span', { class: 'what' }, l.type === 'in' ? 'Vào' : 'Ra')),
          h('span', { class: 'chip' }, METHOD[l.method] || l.method))))
        : h('p', { class: 'muted' }, 'Chưa có lượt chấm công nào hôm nay.'));

    const cards = [logsCard];
    if (t.balance && t.balance.total > 0) {
      cards.push(h('section', { class: 'card balance' }, h('div', null, h('div', { class: 'muted' }, 'Phép năm còn lại'), h('b', null, `${CC.fmtNum(t.balance.remaining)} ngày`)),
        h('a', { class: 'btn', href: '#/requests' }, 'Xin nghỉ phép')));
    }
    if (t.announcements.length) {
      cards.push(h('section', { class: 'card' }, h('h2', null, 'Thông báo'), t.announcements.slice(0, 3).map((a) =>
        h('article', { class: 'ann' }, h('div', { class: 'hd' }, a.pinned ? h('span', { class: 'chip stamp' }, 'Ghim') : null, h('b', null, a.title)), a.body ? h('p', null, a.body) : null))));
    }

    mount(main,
      h('header', { class: 'top' }, h('div', null, h('div', { class: 'co', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, t.settings.logo ? CC.logoImg({ logo: t.settings.logo }, '', { width: '26', height: '26', style: { borderRadius: '6px' } }) : null, t.settings.company_name), h('h1', null, 'Chào ' + u.full_name.trim().split(/\s+/).slice(-1)[0])), h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(u.full_name))),
      stage, cards);
  }

  const HINTS = {
    OUTSIDE: 'Hãy đến đúng nơi làm việc, hoặc quét mã QR tại điểm chấm công.',
    NO_GPS: 'Hãy bật định vị (GPS) và cho phép trình duyệt truy cập vị trí, hoặc quét mã QR.',
    GPS_WEAK: 'Hãy ra nơi thoáng hơn rồi thử lại, hoặc quét mã QR.',
    LOCATION_FAILED: 'Hãy kết nối WiFi công ty hoặc quét mã QR.',
    QR_INVALID: 'Mã QR trên màn hình đổi sau mỗi 30 giây. Hãy quét lại mã đang hiển thị.',
  };

  async function doCheckin({ qr } = {}) {
    if (S.busy) return;
    const t = S.today;
    if (!t) return;
    S.busy = true;
    const btn = document.getElementById('seal');
    if (btn) btn.disabled = true;
    try {
      const body = { type: t.next_type, device_id: CC.deviceId() };
      if (t.settings.require_photo) {
        const photo = await capturePhoto();
        if (!photo) return;
        body.photo = photo;
      }
      if (qr) { body.method = 'qr'; body.qr = qr; }
      else if (!t.remote) {
        const p = await getPosition();
        if (p) { body.lat = p.lat; body.lng = p.lng; body.accuracy = p.accuracy; }
      }
      const r = await POST('/api/me/checkin', body);
      S.busy = false;
      showStamp(r);
      renderHome();
    } catch (e) {
      showCheckinError(e, qr);
    } finally {
      S.busy = false;
      const b2 = document.getElementById('seal');
      if (b2) b2.disabled = false;
    }
  }

  function showStamp(r) {
    const late = r.type === 'in' && r.day && r.day.late_min > 0;
    const d = dialog({
      title: r.type === 'in' ? 'Chấm công vào' : 'Chấm công ra',
      body: h('div', { class: 'done' },
        h('div', { class: 'stampmark ' + (late ? 'late' : r.type === 'out' ? 'out' : '') }, h('span', { class: 'w' }, r.type === 'in' ? 'Đã chấm vào' : 'Đã chấm ra'), h('span', { class: 'tm' }, r.time)),
        h('p', null, r.message), h('span', { class: 'chip' }, METHOD[r.method] || r.method)),
      actions: h('button', { class: 'btn primary', type: 'button', onclick: () => d.close() }, 'Xong'),
    });
    if (navigator.vibrate) navigator.vibrate(40);
  }

  function showCheckinError(e, usedQr) {
    const t = S.today;
    const acts = [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Đóng')];
    if (!usedQr && t && t.settings.allow_qr && ['OUTSIDE', 'NO_GPS', 'GPS_WEAK', 'LOCATION_FAILED'].includes(e.code)) {
      acts.push(h('button', { class: 'btn primary', type: 'button', onclick: () => { d.close(); setTimeout(openScanner, 120); } }, icon('qr'), 'Quét mã QR'));
    }
    if (e.code === 'ALREADY_IN' || e.code === 'NO_OPEN_IN') acts.push(h('button', { class: 'btn primary', type: 'button', onclick: () => { d.close(); renderHome(); } }, 'Tải lại'));
    const d = dialog({
      title: 'Chưa chấm công được',
      body: [h('div', { class: 'err', role: 'alert' }, e.message), HINTS[e.code] && !e.message.includes(HINTS[e.code]) ? h('p', { class: 'muted' }, HINTS[e.code]) : null],
      actions: acts,
    });
  }

  /* ---------- Camera: chụp ảnh khuôn mặt, quét QR ---------- */
  async function openStream(facing) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Trình duyệt này không hỗ trợ camera, hoặc trang chưa chạy qua HTTPS.');
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false });
    } catch {
      throw new Error('Không mở được camera. Hãy cho phép trình duyệt dùng camera trong phần cài đặt.');
    }
  }
  const stopStream = (s) => { if (s) s.getTracks().forEach((t) => t.stop()); };

  function capturePhoto() {
    return new Promise((resolve) => {
      let stream = null, result = null;
      const video = h('video', { autoplay: true, playsinline: true, muted: true });
      video.muted = true;
      const shot = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => {
        const w = video.videoWidth, hgt = video.videoHeight;
        if (!w) return;
        const scale = Math.min(1, 480 / Math.max(w, hgt));
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(hgt * scale);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        result = c.toDataURL('image/jpeg', 0.72);
        d.close();
      } }, icon('camera'), 'Chụp ảnh');
      const d = dialog({
        title: 'Chụp ảnh khuôn mặt',
        body: [h('div', { class: 'cam mirror' }, video, h('div', { class: 'frame' })), h('p', { class: 'muted' }, 'Đặt khuôn mặt vào khung rồi bấm chụp. Ảnh chỉ dùng để xác nhận chấm công.')],
        actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), shot],
        onClose: () => { stopStream(stream); resolve(result); },
      });
      openStream('user').then((s) => {
        stream = s;
        if (!d.el.open) { stopStream(s); return; }
        video.srcObject = s;
        video.onloadedmetadata = () => { shot.disabled = false; };
      }).catch((e) => { toast(e.message, 'err'); d.close(); });
    });
  }

  function openScanner() {
    let stream = null, raf = 0, stopped = false;
    const supportsDetector = 'BarcodeDetector' in window;
    const video = h('video', { autoplay: true, playsinline: true, muted: true });
    video.muted = true;
    const code = h('input', { class: 'in code-in', inputmode: 'numeric', maxlength: '6', placeholder: '000000', autocomplete: 'one-time-code', 'aria-label': 'Mã 6 số' });
    const submitCode = () => {
      if (!/^\d{6}$/.test(code.value.trim())) { toast('Nhập đủ 6 số hiển thị trên màn hình QR', 'err'); return; }
      const v = code.value.trim();
      d.close();
      doCheckin({ qr: v });
    };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitCode(); } });
    const camBox = h('div', { class: 'cam scan', hidden: !supportsDetector }, video, h('div', { class: 'frame' }));
    const d = dialog({
      title: 'Quét mã QR chấm công',
      body: [
        camBox,
        supportsDetector ? null : h('p', { class: 'muted' }, 'Hãy mở camera điện thoại và quét mã QR trên màn hình chấm công. Trang này sẽ tự mở. Hoặc nhập mã 6 số bên dưới.'),
        h('div', { class: 'field' }, h('label', { for: 'qr-code' }, 'Hoặc nhập mã 6 số trên màn hình'), code),
      ],
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), h('button', { class: 'btn primary', type: 'button', onclick: submitCode }, 'Chấm công bằng mã')],
      onClose: () => { stopped = true; cancelAnimationFrame(raf); stopStream(stream); },
    });
    code.id = 'qr-code';
    if (!supportsDetector) { setTimeout(() => code.focus(), 60); return; }
    let detector;
    try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { camBox.hidden = true; return; }
    openStream({ ideal: 'environment' }).then((s) => {
      stream = s;
      if (stopped) { stopStream(s); return; }
      video.srcObject = s;
      let last = 0;
      const loop = async (ts) => {
        if (stopped) return;
        if (ts - last > 200 && video.readyState >= 2) {
          last = ts;
          try {
            const found = await detector.detect(video);
            if (found.length && found[0].rawValue) { const v = found[0].rawValue; d.close(); doCheckin({ qr: v }); return; }
          } catch { /* thử lại khung hình sau */ }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }).catch((e) => { camBox.hidden = true; toast(e.message, 'err'); });
  }

  // Mở từ liên kết trong mã QR (quét bằng camera điện thoại)
  function confirmScan(branchId, codeStr) {
    const t = S.today;
    const br = t && t.branches.find((b) => b.id === branchId);
    const next = t ? t.next_type : 'in';
    const d = dialog({
      title: 'Chấm công bằng mã QR',
      body: h('div', { class: 'done' }, h('p', null, br ? `Điểm chấm công: ${br.name}` : 'Đã quét mã QR chấm công'), h('p', { class: 'muted' }, `Bạn sẽ chấm ${next === 'out' ? 'RA' : 'VÀO'} ngay bây giờ.`)),
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { d.close(); doCheckin({ qr: `ACK|${branchId}|${codeStr}` }); } }, next === 'out' ? 'Chấm ra' : 'Chấm vào')],
    });
  }

  /* ---------- Bảng công tháng ---------- */
  let viewMonth = null;
  async function renderMonth() {
    viewMonth = viewMonth || CC.monthNow();
    const main = shell('/month', loadingView());
    let data;
    try { data = await GET('/api/me/month?month=' + viewMonth); } catch (e) { mount(main, errorView(e, renderMonth)); return; }
    const m = viewMonth;
    const sm = data.summary;
    const isNow = m === CC.monthNow();
    const bar = h('div', { class: 'monthbar' },
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tháng trước', onclick: () => { viewMonth = CC.addMonths(m, -1); renderMonth(); } }, icon('left')),
      h('h1', null, CC.fmtMonth(m)),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tháng sau', disabled: isNow, onclick: () => { viewMonth = CC.addMonths(m, 1); renderMonth(); } }, icon('right')));

    const stat = (v, l, cls) => h('div', { class: 'stat ' + (cls || '') }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
    const stats = h('div', { class: 'stats' },
      stat([CC.fmtNum(sm.paid_days), h('small', null, ` / ${data.standard_days} công`)], 'Công hưởng lương'),
      stat([String(sm.late_count), h('small', null, ` lần (${sm.late_minutes} phút)`)], 'Đi muộn', sm.late_count ? 'warn' : ''),
      stat([CC.fmtNum(sm.leave_days + sm.unpaid_leave_days), h('small', null, ' ngày')], 'Nghỉ phép'),
      stat([CC.fmtNum(sm.ot_hours), h('small', null, ' giờ')], 'Làm thêm'),
      sm.absent_days || sm.incomplete_days ? stat(String(sm.absent_days + sm.incomplete_days), 'Ngày vắng hoặc thiếu giờ', 'seal') : null);

    const first = data.days[0].date;
    const lead = (CC.dowOf(first) + 6) % 7;
    const today = CC.todayStr();
    const cal = h('div', { class: 'cal', role: 'grid', 'aria-label': CC.fmtMonth(m) },
      ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((x) => h('div', { class: 'dh' }, x)),
      Array.from({ length: lead }, () => h('div', { class: 'gap' })),
      data.days.map((day) => {
        const st = STATUS[day.status] || STATUS.off;
        const label = `${fmtDate(day.date)}: ${st.label || 'Chưa đến'}`;
        return h('button', { class: `d ${st.tone}${day.date === today ? ' today' : ''}`, type: 'button', 'aria-label': label, title: label, onclick: () => openDay(day) },
          h('span', { class: 'n' }, String(Number(day.date.slice(8)))), h('span', { class: 's' }, st.sym));
      }));

    const legend = h('div', { class: 'legend' }, [['X', 'Đủ công', 'ok'], ['M', 'Đi muộn', 'warn'], ['V', 'Vắng', 'seal'], ['P', 'Nghỉ phép', 'stamp'], ['L', 'Ngày lễ', ''], ['?', 'Thiếu giờ ra', 'seal']]
      .map(([s, l, tone]) => h('span', { class: 'chip ' + tone }, `${s} ${l}`)));
    mount(main, bar, stats, h('section', { class: 'card' }, cal), legend);
  }

  async function openDay(day) {
    if (['future', 'n/a'].includes(day.status)) return;
    const st = STATUS[day.status] || STATUS.off;
    const body = h('div', { class: 'stack' }, loadingView());
    const canExplain = day.date <= CC.todayStr() && !['holiday', 'leave', 'unpaid_leave', 'trip'].includes(day.status);
    const d = dialog({
      title: `${CC.DOW_LONG[day.dow]}, ${fmtDate(day.date)}`, body,
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Đóng'),
        canExplain ? h('button', { class: 'btn primary', type: 'button', onclick: () => { d.close(); openRequestForm('explain', { date: day.date }); } }, 'Giải trình chấm công') : null],
    });
    try {
      const r = await GET('/api/me/day?date=' + day.date);
      const x = r.day;
      mount(body,
        h('div', null, h('span', { class: 'chip ' + (st.tone === 'mute' || st.tone === 'none' ? '' : st.tone) }, st.label || 'Chưa đến'), x.holiday ? h('span', { class: 'muted' }, ' ' + x.holiday) : null),
        h('div', { class: 'kv' },
          row('Ca làm việc', x.shift ? `${x.shift.name} (${x.shift.start} - ${x.shift.end})` : 'Không có ca'),
          row('Giờ vào', x.first_in ? hhmm(x.first_in) : '--:--'), row('Giờ ra', x.last_out ? hhmm(x.last_out) : '--:--'),
          x.worked_min ? row('Thời gian làm', CC.fmtHours(x.worked_min)) : null,
          x.late_min ? row('Đi muộn', CC.fmtMin(x.late_min)) : null, x.early_min ? row('Về sớm', CC.fmtMin(x.early_min)) : null,
          x.ot_hours ? row('Làm thêm', x.ot_hours + ' giờ') : null, row('Công được tính', CC.fmtNum(x.total))),
        r.logs.length ? h('div', null, h('h3', { style: { marginBottom: '6px' } }, 'Các lượt chấm công'),
          h('ul', { class: 'timeline' }, r.logs.map((l) => h('li', null, h('span', { class: 'dot ' + (l.type === 'out' ? 'is-out' : 'is-in') }), h('span', null, h('span', { class: 'tm' }, hhmm(l.ts)), ' ', h('span', { class: 'what' }, l.type === 'in' ? 'Vào' : 'Ra'), l.note ? h('span', { class: 'muted' }, ' ' + l.note) : null), h('span', { class: 'chip' }, METHOD[l.method] || l.method))))) : h('p', { class: 'muted' }, 'Không có lượt chấm công nào trong ngày này.'));
    } catch (e) { mount(body, h('div', { class: 'err' }, e.message)); }
  }
  const row = (k, v) => h('div', null, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));

  /* ---------- Đơn từ ---------- */
  const TYPE_INFO = [
    ['leave', 'doc', 'Nghỉ phép', 'Nghỉ phép năm, nghỉ ốm, việc riêng'],
    ['explain', 'edit', 'Giải trình chấm công', 'Bổ sung giờ vào/ra khi quên chấm công'],
    ['ot', 'clock', 'Làm thêm giờ', 'Đăng ký giờ làm thêm (OT) cho một ngày'],
    ['trip', 'pin', 'Công tác', 'Đi công tác, làm việc ngoài văn phòng'],
    ['wfh', 'home', 'Làm việc từ xa', 'Được chấm công không giới hạn vị trí trong các ngày này'],
  ];

  async function renderRequests() {
    const main = shell('/requests', loadingView());
    let list, bal;
    try { [list, bal] = await Promise.all([GET('/api/requests/mine'), GET('/api/me/balance')]); } catch (e) { mount(main, errorView(e, renderRequests)); return; }
    const cards = list.map((r) => {
      const [stLabel, stTone] = REQ_STATUS[r.status];
      const when = r.type === 'ot' ? `${fmtDate(r.start_date)}, ${r.hours} giờ`
        : r.type === 'explain' ? `${fmtDate(r.start_date)}: vào ${r.in_time || '--'}, ra ${r.out_time || '--'}`
          : r.start_date === r.end_date ? `${fmtDate(r.start_date)}${r.session === 'am' ? ' (buổi sáng)' : r.session === 'pm' ? ' (buổi chiều)' : ''}` : `${fmtDate(r.start_date)} đến ${fmtDate(r.end_date)}`;
      return h('article', { class: 'card req' },
        h('div', { class: 'hd' }, h('div', null, h('b', null, REQ_TYPE[r.type] + (r.leave_name ? `: ${r.leave_name}` : '')), h('div', { class: 'when' }, when + (r.type === 'leave' || r.type === 'trip' || r.type === 'wfh' ? ` (${CC.fmtNum(r.days)} ngày)` : ''))), h('span', { class: 'chip ' + stTone }, stLabel)),
        r.reason ? h('p', { class: 'why' }, r.reason) : null,
        r.approver_note ? h('p', { class: 'reply' }, `${r.approver_name || 'Người duyệt'}: ${r.approver_note}`) : null,
        r.status === 'pending' ? h('div', null, h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
          if (!(await confirmBox('Huỷ đơn này?', { okText: 'Huỷ đơn', danger: true }))) return;
          try { await POST(`/api/requests/${r.id}/cancel`); toast('Đã huỷ đơn'); renderRequests(); } catch (e) { toast(e.message, 'err'); }
        } }, 'Huỷ đơn')) : null);
    });
    mount(main,
      h('div', { class: 'monthbar' }, h('h1', null, 'Đơn từ'), h('button', { class: 'btn primary', type: 'button', onclick: openTypePicker }, icon('plus'), 'Tạo đơn')),
      bal.total > 0 ? h('section', { class: 'card balance' }, h('div', null, h('div', { class: 'muted' }, `Phép năm ${bal.year}`), h('b', null, `Còn ${CC.fmtNum(bal.remaining)} ngày`)), h('div', { class: 'muted', style: { textAlign: 'right', fontSize: '13px' } }, `Tổng ${CC.fmtNum(bal.total)} ngày`, h('br'), `Đã nghỉ ${CC.fmtNum(bal.used)}, chờ duyệt ${CC.fmtNum(bal.pending)}`)) : null,
      cards.length ? cards : h('div', { class: 'empty' }, h('strong', null, 'Bạn chưa có đơn nào'), 'Bấm "Tạo đơn" để xin nghỉ phép, đăng ký làm thêm giờ hoặc giải trình chấm công.'));
  }

  function openTypePicker() {
    const d = dialog({
      title: 'Bạn muốn tạo đơn gì?',
      body: h('div', { class: 'pick' }, TYPE_INFO.map(([type, ic, name, sub]) => h('button', { type: 'button', onclick: () => { d.close(); openRequestForm(type); } }, icon(ic), h('div', null, h('b', null, name), h('span', null, sub))))),
    });
  }

  async function openRequestForm(type, pre = {}) {
    const today = CC.todayStr();
    const date1 = h('input', { class: 'in', type: 'date', value: pre.date || today });
    const date2 = h('input', { class: 'in', type: 'date', value: pre.date || today });
    const reason = h('textarea', { class: 'in', maxlength: '500', placeholder: type === 'explain' ? 'Ví dụ: Quên chấm công ra do họp muộn' : 'Lý do' });
    const fields = [];
    let leaveSel, sessionSel, hours, tIn, tOut;
    if (type === 'leave') {
      let types = [];
      try { types = await GET('/api/leave-types'); } catch (e) { toast(e.message, 'err'); return; }
      leaveSel = h('select', { class: 'in' }, types.map((t) => h('option', { value: t.id }, t.name + (t.paid ? '' : ' (không lương)'))));
      sessionSel = h('select', { class: 'in' }, h('option', { value: 'full' }, 'Cả ngày'), h('option', { value: 'am' }, 'Buổi sáng'), h('option', { value: 'pm' }, 'Buổi chiều'));
      const sw = field('Buổi nghỉ', sessionSel);
      const sync = () => { sw.hidden = date1.value !== date2.value; if (date2.value < date1.value) date2.value = date1.value; };
      date1.addEventListener('change', () => { if (date2.value < date1.value) date2.value = date1.value; sync(); });
      date2.addEventListener('change', sync);
      fields.push(field('Loại nghỉ', leaveSel), h('div', { class: 'grid2' }, field('Từ ngày', date1), field('Đến ngày', date2)), sw);
      sync();
    } else if (type === 'trip' || type === 'wfh') {
      date1.addEventListener('change', () => { if (date2.value < date1.value) date2.value = date1.value; });
      fields.push(h('div', { class: 'grid2' }, field('Từ ngày', date1), field('Đến ngày', date2)));
    } else if (type === 'ot') {
      hours = h('input', { class: 'in', type: 'number', min: '0.5', max: '12', step: '0.5', value: '2', inputmode: 'decimal' });
      fields.push(h('div', { class: 'grid2' }, field('Ngày làm thêm', date1), field('Số giờ', hours)));
    } else if (type === 'explain') {
      tIn = h('input', { class: 'in', type: 'time', value: pre.in || '' });
      tOut = h('input', { class: 'in', type: 'time', value: pre.out || '' });
      fields.push(field('Ngày cần giải trình', date1), h('div', { class: 'grid2' }, field('Giờ vào', tIn), field('Giờ ra', tOut)), h('p', { class: 'muted' }, 'Chỉ nhập giờ còn thiếu hoặc giờ đúng. Đơn được duyệt thì giờ này sẽ thêm vào bảng công.'));
    }
    fields.push(field(type === 'trip' ? 'Địa điểm, nội dung công tác' : 'Lý do', reason));
    const submit = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const body = { type, start_date: date1.value, end_date: type === 'trip' || type === 'wfh' || type === 'leave' ? date2.value : date1.value, reason: reason.value.trim() };
      if (type === 'leave') { body.leave_type_id = Number(leaveSel.value); body.session = date1.value === date2.value ? sessionSel.value : 'full'; }
      if (type === 'ot') body.hours = Number(hours.value);
      if (type === 'explain') { body.in_time = tIn.value || null; body.out_time = tOut.value || null; }
      submit.disabled = true;
      try { await POST('/api/requests', body); d.close(); toast('Đã gửi đơn, chờ duyệt', 'ok'); if (location.hash === '#/requests') renderRequests(); else location.hash = '#/requests'; }
      catch (e) { toast(e.message, 'err'); submit.disabled = false; }
    } }, 'Gửi đơn');
    const info = TYPE_INFO.find((x) => x[0] === type);
    const d = dialog({ title: info[2], body: fields, actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), submit] });
  }

  /* ---------- Cá nhân ---------- */
  async function renderMe() {
    const u = S.user;
    const main = shell('/me', loadingView());
    let ann = [];
    try { ann = await GET('/api/announcements'); } catch { /* không bắt buộc */ }
    const info = [['Mã nhân viên', u.code], ['Vai trò', ROLE[u.role]], u.position ? ['Chức vụ', u.position] : null, u.phone ? ['Số điện thoại', u.phone] : null, u.hired_date ? ['Ngày vào làm', fmtDate(u.hired_date)] : null].filter(Boolean);
    const installable = !!S.installEvt;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    mount(main,
      h('section', { class: 'card stack' },
        h('div', { class: 'profile' }, h('div', { class: 'avatar' }, initials(u.full_name)), h('div', null, h('h1', null, u.full_name), h('div', { class: 'muted' }, S.info.company_name))),
        h('div', { class: 'kv' }, info.map(([k, v]) => row(k, v)))),
      h('a', { class: 'btn', href: '../' }, icon('home'), 'Về trang chủ hệ thống'),
      u.role !== 'employee' ? h('a', { class: 'btn', href: '../admin/' }, icon('chart'), 'Mở trang quản lý') : null,
      ann.length ? h('section', { class: 'card' }, h('h2', null, 'Thông báo từ công ty'), ann.map((a) => h('article', { class: 'ann' }, h('div', { class: 'hd' }, a.pinned ? h('span', { class: 'chip stamp' }, 'Ghim') : null, h('b', null, a.title)), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, CC.fmtDateTime(a.created_at)), a.body ? h('p', null, a.body) : null))) : null,
      h('section', { class: 'stack' },
        installable ? h('button', { class: 'btn', type: 'button', onclick: async () => { S.installEvt.prompt(); S.installEvt = null; renderMe(); } }, icon('download'), 'Cài ứng dụng lên màn hình chính') : null,
        isIos ? h('p', { class: 'muted' }, 'Để cài ứng dụng trên iPhone: bấm nút Chia sẻ của Safari, chọn "Thêm vào MH chính".') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => { const d = dialog({ title: 'Đổi mật khẩu', body: passwordForm({ forced: false, onDone: () => d.close() }) }); } }, icon('key'), 'Đổi mật khẩu'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox('Đăng xuất khỏi ứng dụng?', { okText: 'Đăng xuất' })) logout(); } }, icon('logout'), 'Đăng xuất')));
  }

  /* ---------- Khởi động ---------- */
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  (async function boot() {
    mount(root, h('div', { class: 'auth' }, loadingView()));
    S.info = await CC.loadPublicInfo();
    CC.watchVersion(CC.updateBanner);
    document.title = S.info.company_name + ' - Chấm công';
    if (CC.getToken()) {
      try { S.user = (await GET('/api/auth/me')).user; } catch (e) { if (e.code === 'NETWORK') { mount(root, h('div', { class: 'auth' }, errorView(e, () => location.reload()))); return; } S.user = null; }
    }
    route();
  })();
})();
