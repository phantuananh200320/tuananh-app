'use strict';
/* Nhận diện khuôn mặt trên trình duyệt bằng face-api.js (dùng cho màn hình QR /kiosk/ và đăng ký khuôn mặt ở trang quản lý).
   Thư viện và mô hình nằm ở public/vendor và public/models, tải bằng: node scripts/get-face-models.js
   Tại đây chỉ tính "vector khuôn mặt" (128 số). Việc so khớp và quyết định chấm công do máy chủ làm. */
(function () {
  const LIB = '/vendor/face-api.min.js';
  const MODELS = '/models';
  let ready = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = res;
      s.onerror = () => rej(new Error('Chưa cài thư viện nhận diện khuôn mặt. Hãy chạy: node scripts/get-face-models.js'));
      document.head.appendChild(s);
    });
  }

  // Nạp thư viện và 3 mô hình (một lần)
  function load() {
    if (!ready) {
      ready = (async () => {
        if (!window.faceapi) await loadScript(LIB);
        const f = window.faceapi;
        if (!f) throw new Error('Thư viện nhận diện khuôn mặt không chạy được. Xem README, mục "Nhận diện khuôn mặt".');
        await Promise.all([
          f.nets.tinyFaceDetector.loadFromUri(MODELS),
          f.nets.faceLandmark68TinyNet.loadFromUri(MODELS),
          f.nets.faceRecognitionNet.loadFromUri(MODELS),
        ]);
        return f;
      })();
      ready.catch(() => { ready = null; }); // cho phép thử lại
    }
    return ready;
  }

  async function startCamera(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Trình duyệt không cho dùng camera. Hãy mở trang bằng HTTPS (hoặc localhost).');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch (e) {
      throw new Error(e && e.name === 'NotAllowedError' ? 'Chưa cho phép dùng camera. Hãy cấp quyền camera cho trang này.' : 'Không mở được camera: ' + ((e && e.message) || e));
    }
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', '');
    await video.play();
    return () => stream.getTracks().forEach((t) => t.stop());
  }

  // Dò một khuôn mặt trong khung hình. withDescriptor=true thì tính thêm vector 128 số (chậm hơn).
  // Trả về null nếu không có mặt. box tính theo tỉ lệ 0..1 của khung hình.
  async function detect(video, withDescriptor) {
    const f = await load();
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const opts = new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    let task = f.detectSingleFace(video, opts).withFaceLandmarks(true);
    if (withDescriptor) task = task.withFaceDescriptor();
    const r = await task;
    if (!r) return null;
    const b = r.detection.box;
    return {
      box: { x: b.x / vw, y: b.y / vh, w: b.width / vw, h: b.height / vh },
      score: r.detection.score,
      points: r.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
      descriptor: withDescriptor && r.descriptor ? Array.from(r.descriptor) : null,
    };
  }

  // Tỉ lệ mở mắt (EAR) từ 68 điểm: mắt trái 36-41, mắt phải 42-47
  function ear(points) {
    const d = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
    const eye = (i) => (d(i + 1, i + 5) + d(i + 2, i + 4)) / (2 * d(i, i + 3) || 1);
    return (eye(36) + eye(42)) / 2;
  }

  // Phát hiện chớp mắt theo thay đổi TƯƠNG ĐỐI so với mức mắt mở của chính người đó, nên không phụ thuộc cỡ mắt.
  // Sau khi chớp, được xem là "còn sống" trong 6 giây.
  function blinkDetector() {
    let base = 0, closedAt = 0, passedAt = 0;
    return {
      update(value, now) {
        now = now || performance.now();
        base = Math.max(value, base * 0.995);
        const closed = value < base * 0.75;
        if (closed && !closedAt) closedAt = now;
        if (!closed && closedAt) { if (now - closedAt < 1500) passedAt = now; closedAt = 0; }
        return this.ok(now);
      },
      ok(now) { return !!passedAt && (now || performance.now()) - passedAt < 6000; },
      reset() { base = 0; closedAt = 0; passedAt = 0; },
    };
  }

  // Chụp một ảnh nhỏ từ video để lưu đối chiếu cùng lượt chấm công
  function snapshot(video, maxW) {
    maxW = maxW || 320;
    const k = Math.min(1, maxW / (video.videoWidth || maxW));
    const c = document.createElement('canvas');
    c.width = Math.round((video.videoWidth || maxW) * k);
    c.height = Math.round((video.videoHeight || maxW) * k);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  }

  window.CCFace = { load, startCamera, detect, ear, blinkDetector, snapshot };
})();
