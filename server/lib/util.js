'use strict';
// Tiện ích ngày giờ (theo múi giờ của server), địa lý, IP.

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const currentMonth = () => today().slice(0, 7);
const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(parseYmd(s).getTime()) && ymd(parseYmd(s)) === s;
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const isHm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const dow = (s) => parseYmd(s).getDay(); // 0 = Chủ nhật
const hmToMin = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
};
const monthRange = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return { from: `${y}-${pad(mo)}-01`, to: ymd(new Date(y, mo, 0)) };
};
function dateList(from, to) {
  const out = [];
  let c = from;
  while (c <= to && out.length < 400) {
    out.push(c);
    c = addDays(c, 1);
  }
  return out;
}
const tsAt = (date, hm) => {
  const d = parseYmd(date);
  const [h, m] = hm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const hhmm = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normIp(ip) {
  ip = String(ip || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return normIp(xff[xff.length - 1]);
    if (req.headers['x-real-ip']) return normIp(req.headers['x-real-ip']);
  }
  return normIp(req.socket.remoteAddress);
}
function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
// list: "1.2.3.4, 10.0.0.0/24, 203.0.113.*"
function ipAllowed(ip, list) {
  ip = normIp(ip);
  const entries = String(list || '').split(/[\s,;]+/).filter(Boolean);
  for (const e of entries) {
    if (e === ip) return true;
    if (e.endsWith('*') && ip.startsWith(e.slice(0, -1))) return true;
    if (e.includes('/')) {
      const [base, bitsStr] = e.split('/');
      const bits = Number(bitsStr);
      const a = ipv4ToInt(ip);
      const b = ipv4ToInt(base);
      if (a !== null && b !== null && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        if ((a & mask) >>> 0 === (b & mask) >>> 0) return true;
      }
    }
  }
  return false;
}

module.exports = {
  pad, ymd, today, currentMonth, parseYmd, isYmd, isMonth, isHm, addDays, dow, hmToMin,
  monthRange, dateList, tsAt, hhmm, distM, clientIp, ipAllowed, normIp,
};
