#!/usr/bin/env node
'use strict';
// Tải face-api.js và các file mô hình nhận diện khuôn mặt về public/vendor và public/models.
// Chạy MỘT LẦN trên máy có Internet:   node scripts/get-face-models.js
// Muốn dùng nguồn riêng (mirror nội bộ):  node scripts/get-face-models.js --base=https://mirror.local/face-api
//   (mirror cần có face-api.min.js và các file mô hình cùng một thư mục)
// Giấy phép: face-api.js và mô hình đi kèm theo giấy phép MIT.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'public');
const VERSION = '0.22.2';
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const base = arg('base');

const LIB_URLS = base ? [`${base}/face-api.min.js`] : [
  `https://cdn.jsdelivr.net/npm/face-api.js@${VERSION}/dist/face-api.min.js`,
  'https://raw.githubusercontent.com/justadudewhocodes/face-api.js/master/dist/face-api.min.js',
];
const modelUrls = (f) => (base ? [`${base}/${f}`] : [
  `https://cdn.jsdelivr.net/gh/justadudewhocodes/face-api.js@master/weights/${f}`,
  `https://raw.githubusercontent.com/justadudewhocodes/face-api.js/master/weights/${f}`,
]);
// Chỉ lấy 3 mô hình nhẹ cần dùng: dò khuôn mặt, 68 điểm (bản nhỏ, để phát hiện chớp mắt), vector nhận diện
const MANIFESTS = ['tiny_face_detector_model-weights_manifest.json', 'face_landmark_68_tiny_model-weights_manifest.json', 'face_recognition_model-weights_manifest.json'];

async function get(urls, minBytes) {
  let lastErr;
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < minBytes) throw new Error(`file quá nhỏ (${buf.length} byte)`);
      return { buf, url: u };
    } catch (e) { lastErr = `${u}: ${e.message}`; }
  }
  throw new Error(lastErr);
}

(async () => {
  fs.mkdirSync(path.join(ROOT, 'vendor'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'models'), { recursive: true });
  const lib = await get(LIB_URLS, 100 * 1024);
  if (!lib.buf.toString('utf8', 0, 400000).includes('faceapi')) throw new Error('file thư viện tải về không đúng');
  fs.writeFileSync(path.join(ROOT, 'vendor', 'face-api.min.js'), lib.buf);
  console.log(`✓ face-api.min.js (${Math.round(lib.buf.length / 1024)} KB) từ ${lib.url}`);
  for (const m of MANIFESTS) {
    const man = await get(modelUrls(m), 50);
    const groups = JSON.parse(man.buf.toString('utf8'));
    fs.writeFileSync(path.join(ROOT, 'models', m), man.buf);
    for (const g of groups) for (const f of g.paths) {
      const shard = await get(modelUrls(f), 1024);
      fs.writeFileSync(path.join(ROOT, 'models', f), shard.buf);
      console.log(`✓ ${f} (${Math.round(shard.buf.length / 1024)} KB)`);
    }
  }
  console.log('\nXong. Vào Cài đặt, bật "Chấm công bằng khuôn mặt tại màn hình QR". Nếu dùng Docker, chạy lại docker compose up -d --build.');
})().catch((e) => {
  console.error('\nKhông tải được: ' + e.message);
  console.error('Kiểm tra kết nối Internet, hoặc tải thủ công face-api.min.js vào public/vendor/ và các file mô hình vào public/models/.');
  process.exit(1);
});
