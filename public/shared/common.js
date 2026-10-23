'use strict';
/* Thư viện dùng chung cho app nhân viên, web quản lý và màn hình QR.
   Mọi nội dung hiển thị đều đi qua textContent (hàm h) nên không có nguy cơ chèn mã độc từ dữ liệu. */
(function (g) {
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } },
  };

  /* ---------- Gọi API ---------- */
  let token = store.get('cc_token') || '';
  const session = { onExpire: null };
  function setToken(t) {
    token = t || '';
    if (token) store.set('cc_token', token); else store.del('cc_token');
  }
  const getToken = () => token;

  async function api(method, url, body) {
    const opt = { method, headers: {} };
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    let res;
    try { res = await fetch(url, opt); } catch {
      const e = new Error('Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.');
      e.code = 'NETWORK';
      throw e;
    }
    const isJson = (res.headers.get('content-type') || '').includes('json');
    const data = isJson ? await res.json().catch(() => ({})) : null;
    if (!res.ok) {
      const e = new Error((data && data.error) || `Lỗi ${res.status}`);
      e.status = res.status;
      e.code = data && data.code;
      if (res.status === 401 && token && url !== '/api/auth/login') {
        setToken('');
        if (session.onExpire) session.onExpire();
      }
      throw e;
    }
    return data;
  }
  const GET = (u) => api('GET', u);
  const POST = (u, b) => api('POST', u, b || {});
  const PUT = (u, b) => api('PUT', u, b || {});
  const DEL = (u) => api('DELETE', u);

  async function download(url, fallbackName) {
    const res = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    if (!res.ok) {
      let msg = `Lỗi ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* không phải JSON */ }
      throw new Error(msg);
    }
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^";]+)"?/.exec(cd);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : fallbackName || 'tai-xuong';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------- Dựng DOM ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'value') value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    append(el, kids);
    if (value !== undefined) el.value = value;
    return el;
  }
  function append(el, kids) {
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      if (Array.isArray(k)) append(el, k);
      else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const mount = (el, ...kids) => { clear(el); append(el, kids); return el; };

  const ICONS = {
    clock: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2',
    calendar: 'M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z M3 10h18 M8 3v4 M16 3v4',
    doc: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h6 M9 17h6',
    user: 'M12 4a4 4 0 100 8 4 4 0 000-8z M4 21c0-4 4-6 8-6s8 2 8 6',
    users: 'M9 5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5 M17 6a2.7 2.7 0 010 5.4 M18.5 14.6c2.2.5 3.5 2.2 3.5 4.4',
    check: 'M5 12.5l4.5 4.5L19 7',
    x: 'M6 6l12 12 M18 6L6 18',
    plus: 'M12 5v14 M5 12h14',
    download: 'M12 4v11 M7 11l5 5 5-5 M5 20h14',
    search: 'M11 5a6 6 0 100 12 6 6 0 000-12z M20 20l-4-4',
    camera: 'M4 8h3l2-3h6l2 3h3v12H4z M12 10a3.5 3.5 0 100 7 3.5 3.5 0 000-7z',
    qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h3v3 M20 14v6 M14 20h3',
    pin: 'M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z M12 7.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
    wifi: 'M2 9a15 15 0 0120 0 M5.5 12.5a10 10 0 0113 0 M9 16a5 5 0 016 0 M12 19.5v.01',
    logout: 'M10 4H5v16h5 M16 8l4 4-4 4 M20 12H9',
    bell: 'M6 17v-6a6 6 0 1112 0v6l2 2H4z M10 21h4',
    chart: 'M4 20V10 M10 20V4 M16 20v-8 M22 20H2',
    settings: 'M12 9a3 3 0 100 6 3 3 0 000-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2',
    building: 'M5 3h14v18H5z M9 7h2 M13 7h2 M9 11h2 M13 11h2 M10 21v-4h4v4',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
    edit: 'M4 20l1-5L16 4l4 4L9 19z M14 6l4 4',
    key: 'M8 11a4 4 0 100 8 4 4 0 000-8z M11 12l9-9 M16 7l3 3',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    money: 'M5 6h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
    megaphone: 'M3 11v3l12 5V6z M15 9a3 3 0 010 6 M6 15l1 5h3l-1-4',
    refresh: 'M4 12a8 8 0 0114-5l2 2 M20 4v5h-5 M20 12a8 8 0 01-14 5l-2-2 M4 20v-5h5',
    left: 'M15 5l-7 7 7 7',
    right: 'M9 5l7 7-7 7',
    list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
    phone: 'M8 2h8a1 1 0 011 1v18a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1z M11 18h2',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
    image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M9 9.5a1 1 0 100-2 1 1 0 000 2z',
    swap: 'M7 4L3 8l4 4 M3 8h14 M17 20l4-4-4-4 M21 16H7',
    home: 'M4 11l8-7 8 7v9H4z M10 20v-6h4v6',
    calcheck: 'M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z M3 10h18 M8 3v4 M16 3v4 M9 15.5l2 2 4-4',
    box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9',
    truck: 'M2 6h11v10H2z M13 10h4l3 3v3h-7 M6.5 18.5a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z M16.5 18.5a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z',
    briefcase: 'M4 8h16v11H4z M9 8V5h6v3 M4 13h16 M11 13h2',
    grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
    invoice: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h3',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    down: 'M6 9l6 6 6-6',
  };
  function icon(name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    for (const d of (ICONS[name] || '').split(' M').map((x, i) => (i ? 'M' + x : x))) {
      if (!d) continue;
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    }
    return s;
  }
  function svgEl(tag, attrs, ...kids) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const k of kids) if (k) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }

  /* ---------- Thời gian (theo múi giờ của công ty, không phụ thuộc máy người dùng) ---------- */
  const clock = { tz: 'Asia/Ho_Chi_Minh', skew: 0 };
  const now = () => Date.now() + clock.skew;
  const pad = (n) => String(n).padStart(2, '0');
  const fmtCache = {};
  function parts(ts) {
    const key = clock.tz;
    if (!fmtCache[key]) {
      fmtCache[key] = new Intl.DateTimeFormat('en-GB', { timeZone: key, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    const o = {};
    for (const p of fmtCache[key].formatToParts(new Date(ts))) o[p.type] = p.value;
    return o;
  }
  const hhmm = (ts) => (ts ? (({ hour, minute }) => `${hour}:${minute}`)(parts(ts)) : '--:--');
  const hhmmss = (ts) => (({ hour, minute, second }) => `${hour}:${minute}:${second}`)(parts(ts));
  const ymdOf = (ts) => (({ year, month, day }) => `${year}-${month}-${day}`)(parts(ts));
  const todayStr = () => ymdOf(now());
  const monthNow = () => todayStr().slice(0, 7);
  const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const DOW_LONG = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const dowOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + n, 1)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; };
  const daysInMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
  const fmtDate = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
  const fmtDay = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  const fmtMonth = (m) => `Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;
  const fmtDateTime = (ts) => `${hhmm(ts)} ${fmtDate(ymdOf(ts))}`;
  const fmtMoney = (n) => (Number(n) || 0).toLocaleString('vi-VN');
  const fmtNum = (n, d = 2) => (Math.round((Number(n) || 0) * 10 ** d) / 10 ** d).toLocaleString('vi-VN');
  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}g${pad(m % 60)}p` : `${m} phút`);
  const fmtHours = (min) => `${Math.floor(min / 60)}:${pad(Math.round(min % 60))}`;
  const monday = (s) => addDays(s, -((dowOf(s) + 6) % 7));

  /* ---------- Nhãn tiếng Việt ---------- */
  const STATUS = {
    present: { label: 'Đủ công', tone: 'ok', sym: 'X' },
    late: { label: 'Đi muộn', tone: 'warn', sym: 'M' },
    early: { label: 'Về sớm', tone: 'warn', sym: 'S' },
    late_early: { label: 'Muộn và sớm', tone: 'warn', sym: 'MS' },
    half: { label: 'Nửa công', tone: 'warn', sym: '½' },
    short: { label: 'Thiếu giờ', tone: 'seal', sym: '<' },
    missing_out: { label: 'Thiếu giờ ra', tone: 'seal', sym: '?' },
    missing_in: { label: 'Thiếu giờ vào', tone: 'seal', sym: '?' },
    absent: { label: 'Vắng', tone: 'seal', sym: 'V' },
    leave: { label: 'Nghỉ phép', tone: 'stamp', sym: 'P' },
    unpaid_leave: { label: 'Nghỉ không lương', tone: 'stamp', sym: 'KL' },
    half_leave: { label: 'Nghỉ nửa ngày', tone: 'stamp', sym: 'P½' },
    half_unpaid: { label: 'Nghỉ nửa ngày không lương', tone: 'stamp', sym: 'KL½' },
    holiday: { label: 'Ngày lễ', tone: 'mute', sym: 'L' },
    trip: { label: 'Công tác', tone: 'stamp', sym: 'CT' },
    off: { label: 'Ngày nghỉ', tone: 'mute', sym: '' },
    pending: { label: 'Chưa chấm công', tone: 'mute', sym: '·' },
    working: { label: 'Đang làm việc', tone: 'ok', sym: '…' },
    future: { label: '', tone: 'none', sym: '' },
    'n/a': { label: 'Chưa vào làm', tone: 'none', sym: '' },
  };
  const METHOD = { gps: 'GPS', wifi: 'WiFi công ty', qr: 'Mã QR', remote: 'Từ xa', manual: 'Thủ công', open: 'Không giới hạn' };
  const REQ_TYPE = { leave: 'Nghỉ phép', ot: 'Làm thêm giờ', trip: 'Công tác', wfh: 'Làm việc từ xa', explain: 'Giải trình chấm công' };
  const REQ_STATUS = { pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'ok'], rejected: ['Từ chối', 'seal'], cancelled: ['Đã huỷ', ''] };
  const ROLE = { admin: 'Quản trị viên', manager: 'Quản lý', employee: 'Nhân viên' };

  /* ---------- Thông báo nổi ---------- */
  function toast(msg, kind) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const t = h('div', { class: 'toast' + (kind ? ' ' + kind : ''), role: kind === 'err' ? 'alert' : 'status' }, msg);
    box.append(t);
    setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3200);
  }

  /* ---------- Hộp thoại (dùng thẻ <dialog> có sẵn: tự khoá focus, đóng bằng Esc) ---------- */
  function dialog({ title, body, actions, wide, onClose }) {
    const dlg = h('dialog', { class: 'dlg' + (wide ? ' wide' : '') });
    const close = () => { if (dlg.open) dlg.close(); };
    dlg.append(
      h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'btn ghost icon sm', type: 'button', 'aria-label': 'Đóng', onclick: close }, icon('x'))),
      h('div', { class: 'dlg-body' }, body)
    );
    // Hộp thoại không có nút: không chèn gì (append(null) sẽ hiện chữ "null")
    if (actions) dlg.append(h('div', { class: 'dlg-foot' }, actions));
    dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
    dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) close(); });
    document.body.append(dlg);
    dlg.showModal();
    return { el: dlg, close, body: dlg.querySelector('.dlg-body') };
  }

  function confirmBox(message, { okText = 'Đồng ý', danger = false, title = 'Xác nhận' } = {}) {
    return new Promise((resolve) => {
      let result = false;
      const d = dialog({
        title,
        body: h('p', null, message),
        actions: [
          h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'),
          h('button', { class: 'btn ' + (danger ? 'danger solid' : 'primary'), type: 'button', onclick: () => { result = true; d.close(); } }, okText),
        ],
        onClose: () => resolve(result),
      });
    });
  }

  function promptBox(title, label, { value = '', okText = 'Lưu', multiline = false, required = false, hint = '' } = {}) {
    return new Promise((resolve) => {
      let result = null;
      const input = multiline ? h('textarea', { class: 'in', id: 'pb-in' }, value) : h('input', { class: 'in', id: 'pb-in', value });
      const submit = () => {
        const v = input.value.trim();
        if (required && !v) { input.focus(); return; }
        result = v;
        d.close();
      };
      if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      const d = dialog({
        title,
        body: h('div', { class: 'field' }, h('label', { for: 'pb-in' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null),
        actions: [
          h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'),
          h('button', { class: 'btn primary', type: 'button', onclick: submit }, okText),
        ],
        onClose: () => resolve(result),
      });
      setTimeout(() => input.focus(), 30);
    });
  }

  /* ---------- Tiện ích nhỏ ---------- */
  const field = (label, input, hint) => {
    const id = 'f' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  };
  const initials = (name) => {
    const w = String(name || '?').trim().split(/\s+/);
    return ((w.length > 1 ? w[w.length - 2][0] : '') + w[w.length - 1][0]).toUpperCase();
  };
  function debounce(fn, ms = 250) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }
  function deviceId() {
    let id = store.get('cc_device');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      store.set('cc_device', id);
    }
    return id;
  }
  // Logo công ty (nếu có) dùng làm biểu tượng tab trình duyệt
  function setFavicon(url) {
    if (!url) return;
    let l = document.querySelector('link[rel="icon"]');
    if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
    l.type = ''; l.href = url;
  }
  // Ảnh logo: dùng logo công ty đã tải lên, chưa có thì dùng biểu tượng mặc định
  function logoImg(info, fallback, attrs) {
    return h('img', Object.assign({ src: (info && info.logo) || fallback, alt: '', class: info && info.logo ? 'logo' : '' }, attrs || {}));
  }
  // Theo dõi số phiên bản của máy chủ: khi quản trị cập nhật ứng dụng, trang đang mở biết để tải lại
  let knownVersion = null;
  function watchVersion(onNew, every) {
    const check = async () => {
      try {
        const v = (await GET('/api/version')).version;
        if (knownVersion === null) knownVersion = v;
        else if (v !== knownVersion) { knownVersion = v; onNew(v); }
      } catch { /* mất mạng: lần sau thử lại */ }
    };
    check();
    setInterval(check, every || 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }
  function updateBanner(v) {
    if (document.querySelector('.updbar')) return;
    document.body.appendChild(h('div', { class: 'updbar', role: 'status' }, `Có phiên bản mới của ứng dụng (${v}). `, h('button', { type: 'button', onclick: () => location.reload() }, 'Tải lại ngay')));
  }
  async function loadPublicInfo() {
    try {
      const info = await GET('/api/public-info');
      if (info.tz) clock.tz = info.tz;
      setFavicon(info.logo);
      return info;
    } catch { return { company_name: 'Chấm công' }; }
  }

  g.CC = {
    store, api, GET, POST, PUT, DEL, download, setToken, getToken, session,
    h, mount, clear, icon, svgEl, field, initials, debounce, parseCsv, deviceId, loadPublicInfo, setFavicon, logoImg, watchVersion, updateBanner,
    clock, now, pad, hhmm, hhmmss, ymdOf, todayStr, monthNow, DOW, DOW_LONG, dowOf, addDays, addMonths, daysInMonth, monday,
    fmtDate, fmtDay, fmtMonth, fmtDateTime, fmtMoney, fmtNum, fmtMin, fmtHours,
    STATUS, METHOD, REQ_TYPE, REQ_STATUS, ROLE,
    toast, dialog, confirmBox, promptBox,
  };
})(window);
