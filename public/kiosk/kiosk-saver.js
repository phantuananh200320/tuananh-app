'use strict';
/* Màn hình chờ của màn hình QR: hình ảnh + thông báo của công ty + đồng hồ.
   Chạm vào bất kỳ đâu (hoặc bấm phím) để quay lại màn hình chấm công.
   Mọi chữ hiển thị đều đi qua textContent (hàm h), không chèn HTML từ dữ liệu. */
(function (g) {
  const { h } = CC;

  function create({ onWake }) {
    let on = false, cfg = null, cfgKey = '', step = 0, curUrl = '', curAnn = '';
    let slideTimer = 0, clockTimer = 0, removeTimer = 0, front = 0;

    const mkSlide = () => {
      const bg = h('div', { class: 'sv-bg' });
      const fg = h('img', { class: 'sv-fg', alt: '' });
      return { el: h('div', { class: 'sv-slide' }, bg, fg), set(u) { bg.style.backgroundImage = `url("${u}")`; fg.src = u; } };
    };
    const slides = [mkSlide(), mkSlide()];
    const logo = h('img', { class: 'sv-logo', alt: '', hidden: true });
    const co = h('div', { class: 'sv-co' });
    const timeEl = h('div', { class: 'sv-time' });
    const dateEl = h('div', { class: 'sv-date' });
    const annT = h('div', { class: 'sv-at' });
    const annB = h('div', { class: 'sv-ab' });
    const ann = h('div', { class: 'sv-ann', hidden: true }, h('div', { class: 'sv-tag' }, 'Thông báo'), annT, annB);
    const root = h('div', { class: 'sv', tabindex: '-1', role: 'button', 'aria-label': 'Màn hình chờ. Chạm vào màn hình để chấm công.' },
      slides[0].el, slides[1].el,
      h('div', { class: 'sv-shade' }),
      h('div', { class: 'sv-top' }, logo, co),
      h('div', { class: 'sv-clock' }, timeEl, dateEl),
      ann,
      h('div', { class: 'sv-hint' }, 'Chạm vào màn hình để chấm công'));

    function tickClock() {
      timeEl.textContent = CC.hhmm(CC.now());
      const t = CC.todayStr();
      dateEl.textContent = `${CC.DOW_LONG[CC.dowOf(t)]}, ${CC.fmtDate(t)}`;
    }

    function showImg(url) {
      if (url === curUrl) return;
      const pre = new Image();
      pre.onload = () => {
        if (!on || url === curUrl) return;
        curUrl = url;
        const old = slides[front], nx = slides[1 - front];
        nx.set(url);
        old.el.classList.add('prev'); old.el.classList.remove('on'); // hình cũ nằm dưới cho đến khi hình mới hiện rõ
        nx.el.classList.add('on');
        front = 1 - front;
        setTimeout(() => old.el.classList.remove('prev'), 1400);
      };
      pre.src = url; // ảnh lỗi thì bỏ qua, giữ hình hiện tại
    }

    function showAnn(i) {
      const list = cfg.announcements;
      if (!list.length) { ann.hidden = true; curAnn = ''; return; }
      const a = list[i % list.length];
      const k = a.title + '\n' + (a.body || '');
      if (k === curAnn) return;
      curAnn = k;
      annT.textContent = a.title;
      annB.textContent = a.body || '';
      annB.hidden = !a.body;
      ann.hidden = false;
      ann.classList.remove('swap'); void ann.offsetWidth; ann.classList.add('swap'); // chạy lại hiệu ứng xuất hiện
    }

    function advance() {
      if (cfg.images.length) showImg(cfg.images[step % cfg.images.length]);
      showAnn(step);
      step++;
    }

    function layout(st) {
      co.textContent = st.company || '';
      if (st.logo) { if (logo.getAttribute('src') !== st.logo) logo.src = st.logo; logo.hidden = false; } else logo.hidden = true;
      root.classList.toggle('noimg', !cfg.images.length);
      root.classList.toggle('empty', !cfg.images.length && !cfg.announcements.length);
    }

    function onKey(e) { if (!e.repeat) wake(); }
    function wake() {
      if (!on) return;
      hide(true);
      if (onWake) onWake();
    }

    function hide(animate) {
      if (!on) return;
      on = false;
      clearInterval(slideTimer); clearInterval(clockTimer);
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('in');
      clearTimeout(removeTimer);
      // Giữ lớp phủ thêm một chút để cú chạm đánh thức không "xuyên" xuống nút bên dưới
      removeTimer = setTimeout(() => root.remove(), animate ? 450 : 0);
    }

    // Vào màn hình chờ, hoặc cập nhật nội dung nếu đang hiện (quản trị vừa đổi hình, thông báo)
    function show(st) {
      const next = st && st.screensaver;
      if (!next) { hide(false); return; }
      const key = JSON.stringify([next.images, next.announcements, next.slide_ms, st.company, st.logo]);
      if (on) {
        if (key === cfgKey) return;
        const slideChanged = next.slide_ms !== cfg.slide_ms;
        cfg = next; cfgKey = key;
        layout(st);
        if (slideChanged) { clearInterval(slideTimer); slideTimer = setInterval(advance, cfg.slide_ms); }
        curAnn = ''; advance();
        return;
      }
      on = true; cfg = next; cfgKey = key; step = 0; curUrl = ''; curAnn = '';
      clearTimeout(removeTimer);
      slides.forEach((s) => s.el.classList.remove('on', 'prev'));
      layout(st);
      tickClock();
      if (!root.isConnected) document.body.append(root);
      void root.offsetWidth;
      root.classList.add('in');
      advance();
      slideTimer = setInterval(advance, cfg.slide_ms);
      clockTimer = setInterval(tickClock, 1000);
      document.addEventListener('keydown', onKey, true);
    }

    root.addEventListener('pointerdown', (e) => { e.preventDefault(); wake(); });

    return { show, hide: () => hide(false), isOn: () => on };
  }

  g.KioskSaver = { create };
})(window);
