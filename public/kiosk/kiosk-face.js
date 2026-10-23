'use strict';
/* Khung camera nhận diện khuôn mặt trên màn hình QR. Chạy song song với mã QR.
   Quy trình: thấy mặt -> (chớp mắt nếu bật) -> tính vector -> gửi máy chủ so khớp -> hiện kết quả -> đợi người đó rời đi. */
(function () {
  const { h } = CC;

  function start({ key, liveness, onResult, onClose, idleMs }) {
    const video = h('video', { class: 'fvideo', playsinline: true, muted: true, autoplay: true });
    const box = h('div', { class: 'fbox', hidden: true });
    const nameEl = h('div', { class: 'fname' });
    const msgEl = h('div', { class: 'fmsg' }, 'Đang khởi động camera...');
    const banner = h('div', { class: 'fstatus', 'aria-live': 'polite' }, nameEl, msgEl);
    const closeBtn = h('button', { class: 'fclose', type: 'button', onclick: () => { if (onClose) onClose(); } }, '✕ Về mã QR');
    const card = h('div', { class: 'facecard' }, video, box, banner, closeBtn);
    let lastActive = performance.now(); // lần cuối có người dùng (thấy mặt hoặc vừa chấm công)

    let stopped = false, stopCam = null, timer = null;
    let busy = false, needLeave = false, cooldownUntil = 0, noFaceSince = 0;
    const blink = CCFace.blinkDetector();

    function say(kind, msg, name) {
      banner.className = 'fstatus ' + kind;
      nameEl.textContent = name || '';
      msgEl.textContent = msg;
    }
    const later = (ms) => { if (!stopped) timer = setTimeout(loop, ms); };

    async function send(descriptor, photo) {
      const r = await fetch('/api/kiosk/face', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, descriptor, photo }) });
      const data = await r.json().catch(() => ({}));
      return { status: r.status, data };
    }

    async function loop() {
      if (stopped) return;
      const now = performance.now();
      if (onClose && idleMs && !busy && now - lastActive > idleMs) { onClose(); return; } // lâu không ai dùng: về mã QR, tắt camera
      if (busy || now < cooldownUntil) return later(150);
      try {
        const d = await CCFace.detect(video, false);
        if (stopped) return;
        if (!d) {
          box.hidden = true;
          if (!noFaceSince) noFaceSince = performance.now();
          if (performance.now() - noFaceSince > 1500) { needLeave = false; blink.reset(); say('idle', 'Nhìn vào camera để chấm công'); }
          return later(60);
        }
        noFaceSince = 0; lastActive = performance.now();
        // khung bao quanh mặt (video được lật gương nên cũng lật toạ độ)
        Object.assign(box.style, { left: (1 - d.box.x - d.box.w) * 100 + '%', top: d.box.y * 100 + '%', width: d.box.w * 100 + '%', height: d.box.h * 100 + '%' });
        box.hidden = false;
        if (needLeave) return later(150); // vừa chấm xong: đợi người rời khung hình
        if (d.box.w < 0.22) { say('warn', 'Lại gần camera hơn một chút'); return later(60); }
        if (liveness && !blink.update(CCFace.ear(d.points), performance.now())) { say('prompt', 'Nhìn thẳng và chớp mắt để chấm công'); return later(0); }

        busy = true;
        say('busy', 'Đang nhận diện...');
        const full = await CCFace.detect(video, true);
        if (!full || !full.descriptor) { busy = false; return later(60); }
        const { status, data } = await send(full.descriptor, CCFace.snapshot(video));
        busy = false;
        if (stopped) return;
        if (status === 200 && data.ok) {
          say('ok', data.message, data.name);
          needLeave = true; cooldownUntil = performance.now() + 4500; lastActive = performance.now();
          if (onResult) onResult(data);
        } else if (status === 200 && data.code === 'TOO_FAST') {
          say('warn', data.message, data.name);
          needLeave = true; cooldownUntil = performance.now() + 3500;
        } else {
          say('err', data.error || 'Không chấm công được');
          cooldownUntil = performance.now() + 2500;
          if (status === 403 && data.code === 'FACE_DISABLED') return; // quản trị vừa tắt: màn hình sẽ tự gỡ khung này
        }
        blink.reset();
      } catch (e) {
        busy = false;
        say('err', e.message || 'Lỗi nhận diện');
        cooldownUntil = performance.now() + 3000;
      }
      later(60);
    }

    (async () => {
      try {
        say('busy', 'Đang tải mô hình nhận diện...');
        await CCFace.load();
        if (stopped) return;
        stopCam = await CCFace.startCamera(video);
        if (stopped) { stopCam(); return; }
        say('idle', 'Nhìn vào camera để chấm công');
        loop();
      } catch (e) { say('err', e.message || 'Không khởi động được nhận diện khuôn mặt'); }
    })();

    return {
      el: card,
      stop() { stopped = true; clearTimeout(timer); if (stopCam) stopCam(); },
    };
  }

  window.KioskFace = { start };
})();
