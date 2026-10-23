'use strict';
// Bộ tạo mã QR (chế độ byte, mức sửa lỗi M, phiên bản 1–10) không cần thư viện ngoài.
// Dùng cho màn hình QR chấm công tại chi nhánh. Luôn có mã 6 số hiển thị kèm để nhập tay.

// version -> [tổng codeword, ecc mỗi khối, số khối nhóm 1, data/khối nhóm 1, số khối nhóm 2, data/khối nhóm 2]
const EC_M = {
  1: [26, 10, 1, 16, 0, 0], 2: [44, 16, 1, 28, 0, 0], 3: [70, 26, 1, 44, 0, 0], 4: [100, 18, 2, 32, 0, 0],
  5: [134, 24, 2, 43, 0, 0], 6: [172, 16, 4, 27, 0, 0], 7: [196, 18, 4, 31, 0, 0], 8: [242, 22, 2, 38, 2, 39],
  9: [292, 22, 3, 36, 2, 37], 10: [346, 26, 4, 43, 1, 44],
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const FORMAT_BITS_M = 0; // M = 00

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

function chooseVersion(len) {
  for (let v = 1; v <= 10; v++) {
    const e = EC_M[v];
    const dataCw = e[2] * e[3] + e[4] * e[5];
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + 8 * len <= dataCw * 8) return v;
  }
  throw new Error('QR: dữ liệu quá dài');
}

function buildCodewords(bytes, ver) {
  const e = EC_M[ver];
  const dataCw = e[2] * e[3] + e[4] * e[5];
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const cap = dataCw * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  const numBlocks = e[2] + e[4];
  const eccLen = e[1];
  const raw = e[0];
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  const parts = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    parts.push({ dat: dat.slice(), ecc });
    if (i < numShort) dat.push(0); // phần đệm để các khối cùng độ dài, bị bỏ qua khi xen kẽ
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((blk, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(blk[i]);
    });
  }
  return { codewords: out, blocks, parts, div };
}

function penalty(m) {
  const n = m.length;
  let p = 0;
  for (let dir = 0; dir < 2; dir++) {
    for (let i = 0; i < n; i++) {
      const line = [];
      for (let j = 0; j < n; j++) line.push((dir ? m[j][i] : m[i][j]) ? 1 : 0);
      let run = 1;
      for (let j = 1; j < n; j++) {
        if (line[j] === line[j - 1]) {
          run++;
          if (run === 5) p += 3;
          else if (run > 5) p++;
        } else run = 1;
      }
      const s = line.join('');
      for (const pat of ['00001011101', '10111010000']) {
        let idx = -1;
        while ((idx = s.indexOf(pat, idx + 1)) >= 0) p += 40;
      }
    }
  }
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++)
      if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1;
  p += Math.max(0, k) * 10;
  return p;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0,
  (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0,
];

function formatBitsFor(mask) {
  const data = (FORMAT_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function encode(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const ver = chooseVersion(bytes.length);
  const size = 17 + 4 * ver;
  const { codewords } = buildCodewords(bytes, ver);

  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, v) => {
    mod[y][x] = !!v;
    fn[y][x] = true;
  };
  const bit = (n, i) => ((n >>> i) & 1) !== 0;

  // Timing
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  // Finder + separator
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Alignment
  const pos = ALIGN[ver];
  const n = pos.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) setFn(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

  const drawFormat = (mask) => {
    const bits = formatBitsFor(mask);
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6));
    setFn(8, 8, bit(bits, 7));
    setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit(bits, i));
      setFn(b, a, bit(bits, i));
    }
  }

  // Đặt dữ liệu theo đường zigzag
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < codewords.length * 8) {
          mod[y][x] = bit(codewords[bi >>> 3], 7 - (bi & 7));
          bi++;
        }
      }
    }
  }

  // Chọn mặt nạ tốt nhất
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) mod[y][x] = !mod[y][x];
  };
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const sc = penalty(mod);
    if (sc < bestScore) {
      bestScore = sc;
      best = mask;
    }
    applyMask(mask); // hoàn tác
  }
  applyMask(best);
  drawFormat(best);
  return mod;
}

function toSvg(matrix, { margin = 2, fg = '#000', bg = '#fff' } = {}) {
  const n = matrix.length;
  const s = n + margin * 2;
  let d = '';
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) if (matrix[y][x]) d += `M${x + margin},${y + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}

// Tự kiểm tra Reed–Solomon: phần dư của (data||ecc) chia cho đa thức sinh phải bằng 0.
function selfTest() {
  for (let v = 1; v <= 10; v++) {
    const e = EC_M[v];
    const dataCw = e[2] * e[3] + e[4] * e[5];
    const cap = Math.floor((dataCw * 8 - 4 - (v < 10 ? 8 : 16)) / 8);
    const text = 'x'.repeat(cap);
    if (chooseVersion(cap) !== v) throw new Error(`QR self-test: chọn version sai (${v})`);
    const { parts, div, codewords } = buildCodewords(Buffer.from(text), v);
    if (codewords.length !== e[0]) throw new Error(`QR self-test: sai số codeword ở version ${v}`);
    for (const { dat, ecc } of parts) {
      const check = rsRemainder(dat.concat(ecc), div);
      if (check.some((x) => x !== 0)) throw new Error(`QR self-test lỗi RS ở version ${v}`);
    }
    const m = encode(text);
    if (m.length !== 17 + 4 * v) throw new Error(`QR self-test: kích thước ma trận sai ở version ${v}`);
  }
  if (formatBitsFor(0) !== 0x5412) throw new Error('QR self-test: format bits sai');
  return true;
}

module.exports = { encode, toSvg, selfTest };
