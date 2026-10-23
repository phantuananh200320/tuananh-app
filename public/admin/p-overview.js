'use strict';
/* Trang: Tổng quan, Nhật ký chấm công, Bảng công, Đơn từ */
(function () {
  const { h, icon, mount, GET, POST, DEL, toast, dialog, confirmBox, promptBox, field, svgEl, fmtDate, fmtDay, hhmm, STATUS, METHOD, REQ_TYPE, REQ_STATUS } = CC;
  const A = ADM;

  /* ================= Tổng quan ================= */
  function trendChart(trend) {
    const W = 560, H = 200, top = 26, bottom = 40, left = 12;
    const max = Math.max(1, ...trend.map((t) => Math.max(t.expected, t.attended)));
    const bw = 34, step = (W - left * 2) / trend.length;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Biểu đồ số người chấm công 7 ngày gần đây' });
    svg.style.maxHeight = '240px';
    const base = H - bottom;
    svg.append(svgEl('line', { x1: left, x2: W - left, y1: base, y2: base, style: 'stroke:var(--line-2);stroke-width:1' }));
    trend.forEach((t, i) => {
      const cx = left + step * i + step / 2;
      const hExp = ((base - top) * t.expected) / max;
      const hAtt = ((base - top) * t.attended) / max;
      svg.append(
        svgEl('rect', { x: cx - bw / 2, y: base - hExp, width: bw, height: Math.max(hExp, 0), rx: 5, style: 'fill:var(--sunk)' }),
        svgEl('rect', { x: cx - bw / 2, y: base - hAtt, width: bw, height: Math.max(hAtt, 0), rx: 5, style: 'fill:var(--stamp)' }),
        svgEl('text', { x: cx, y: base - Math.max(hExp, hAtt) - 7, 'text-anchor': 'middle', style: 'font-size:13px;font-weight:700;fill:var(--ink)' }, String(t.attended)),
        svgEl('text', { x: cx, y: base + 17, 'text-anchor': 'middle', style: 'font-size:12.5px;font-weight:600;fill:var(--ink-2)' }, CC.DOW[CC.dowOf(t.date)]),
        svgEl('text', { x: cx, y: base + 32, 'text-anchor': 'middle', style: 'font-size:11.5px;fill:var(--ink-3)' }, fmtDay(t.date)));
      svg.append(svgEl('title', null, `${fmtDate(t.date)}: ${t.attended} / ${t.expected} người chấm công, ${t.late} người đi muộn`));
    });
    return svg;
  }

  function nameList(items, render, empty) {
    if (!items.length) return h('p', { class: 'muted', style: { padding: '8px 0' } }, empty);
    const shown = items.slice(0, 10);
    return h('ul', { class: 'list' }, shown.map(render), items.length > shown.length ? h('li', null, h('span', { class: 'muted' }, `và ${items.length - shown.length} người khác`)) : null);
  }

  A.register({
    id: 'dashboard', label: 'Tổng quan', icon: 'chart', roles: ['admin', 'manager'],
    async render(el) {
      async function load() {
        const d = await GET('/api/dashboard');
        const t = d.today;
        const onTime = t.checked_in - t.late;
        const base = t.expected + t.on_leave;
        const seg = (cls, n) => (n > 0 ? h('i', { class: cls, style: { flex: String(n) } }) : null);
        mount(el,
          A.pageHead('Tổng quan', `${CC.DOW_LONG[CC.dowOf(d.date)]}, ${fmtDate(d.date)}`, h('button', { class: 'btn', type: 'button', onclick: () => load().then(() => toast('Đã cập nhật')).catch((e) => toast(e.message, 'err')) }, icon('refresh'), 'Làm mới')),
          d.pending_requests ? h('a', { class: 'callout', href: '#/requests' }, icon('doc'), `${d.pending_requests} đơn đang chờ bạn duyệt`, h('span', null, icon('right'))) : null,
          h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Điểm danh hôm nay'), h('span', { class: 'muted' }, `${t.expected} người có ca làm việc`)),
            h('div', { class: 'pb' },
              base ? [h('div', { class: 'roll', role: 'img', 'aria-label': `Đúng giờ ${onTime}, đi muộn ${t.late}, chưa chấm công ${t.not_yet}, nghỉ hoặc công tác ${t.on_leave}` }, seg('s-ok', onTime), seg('s-late', t.late), seg('s-wait', t.not_yet), seg('s-away', t.on_leave)),
                h('div', { class: 'rolllegend' },
                  h('div', { class: 's-ok' }, h('b', null, onTime), h('span', null, 'Đã chấm đúng giờ')),
                  h('div', { class: 's-late' }, h('b', null, t.late), h('span', null, 'Đi muộn')),
                  h('div', { class: 's-wait' }, h('b', null, t.not_yet), h('span', null, 'Chưa chấm công')),
                  h('div', { class: 's-away' }, h('b', null, t.on_leave), h('span', null, 'Nghỉ phép, công tác')))]
                : h('p', { class: 'muted' }, 'Hôm nay không có nhân viên nào có ca làm việc.'))),
          h('div', { class: 'cols2' },
            h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, '7 ngày gần đây'), h('span', { class: 'muted' }, 'Số người đã chấm công')), h('div', { class: 'pb' }, trendChart(d.trend))),
            h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Chưa chấm công'), h('span', { class: 'chip seal' }, String(t.not_yet))),
              h('div', { class: 'pb' }, nameList(d.lists.not_yet, (p) => h('li', null, h('span', null, p.name), h('span', { class: 'meta' }, p.dept || '')), 'Mọi người có ca đều đã chấm công.')))),
          h('div', { class: 'cols2' },
            h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Chấm công gần đây'), h('a', { href: '#/logs' }, 'Xem tất cả')),
              A.table({ rows: d.recent, empty: 'Chưa có lượt chấm công nào', cols: [
                { label: 'Giờ', render: (r) => h('b', { class: 'num' }, hhmm(r.ts)) },
                { label: 'Nhân viên', render: (r) => h('div', { class: 'who' }, h('div', null, h('b', null, r.full_name), h('span', null, r.code))) },
                { label: 'Loại', render: (r) => h('span', { class: 'chip ' + (r.type === 'in' ? 'ok' : '') }, r.type === 'in' ? 'Vào' : 'Ra') },
                { label: 'Hình thức', render: (r) => METHOD[r.method] || r.method },
                { label: 'Ảnh', render: (r) => A.thumb(r.photo) }] })),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px', minWidth: 0 } },
              h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Đi muộn hôm nay')),
                h('div', { class: 'pb' }, nameList(d.lists.late, (p) => h('li', null, h('span', null, p.name), h('span', { class: 'meta' }, `${hhmm(p.first_in)}, muộn ${p.late_min} phút`)), 'Không có ai đi muộn.'))),
              h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Nghỉ phép, công tác')),
                h('div', { class: 'pb' }, nameList(d.lists.on_leave, (p) => h('li', null, h('span', null, p.name), h('span', { class: 'chip stamp' }, (STATUS[p.status] || {}).label || '')), 'Không có ai vắng mặt có phép.'))))));
      }
      await load();
      A.every(() => load().catch(() => {}), 60000);
    },
  });

  /* ================= Nhật ký chấm công ================= */
  function manualDialog(r, preset, done) {
    const emp = A.select(r.employees.filter((e) => e.active).map((e) => ({ v: e.id, l: `${e.code} - ${e.full_name}` })), preset.employee_id, { placeholder: 'Chọn nhân viên' });
    const date = h('input', { class: 'in', type: 'date', value: preset.date || CC.todayStr() });
    const tin = h('input', { class: 'in', type: 'time' });
    const tout = h('input', { class: 'in', type: 'time' });
    const note = h('input', { class: 'in', placeholder: 'Ví dụ: Quên chấm công, đã xác nhận với quản lý', value: '' });
    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
      await POST('/api/logs/manual', { employee_id: Number(emp.value), date: date.value, in_time: tin.value || null, out_time: tout.value || null, note: note.value.trim() || undefined });
      toast('Đã bổ sung chấm công', 'ok'); d.close(); done();
    }) }, 'Lưu');
    const d = dialog({ title: 'Chấm công thủ công', body: [field('Nhân viên', emp), field('Ngày', date), h('div', { class: 'grid2' }, field('Giờ vào', tin), field('Giờ ra', tout)), field('Ghi chú', note), h('p', { class: 'muted' }, 'Bản ghi được đánh dấu "Thủ công" và lưu vào nhật ký thao tác.')], actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save] });
  }

  A.register({
    id: 'logs', label: 'Nhật ký chấm công', icon: 'clock', roles: ['admin', 'manager'],
    async render(el) {
      const r = await A.refs();
      const today = CC.todayStr();
      const f = { from: today, to: today, employee_id: '', department_id: '', method: '' };
      const from = h('input', { class: 'in', type: 'date', value: f.from });
      const to = h('input', { class: 'in', type: 'date', value: f.to });
      const emp = A.select(r.employees.map((e) => ({ v: e.id, l: `${e.code} - ${e.full_name}` })), '', { placeholder: 'Tất cả nhân viên' });
      const dept = A.deptSelect(r, '');
      const method = A.select(Object.entries(METHOD).map(([v, l]) => ({ v, l })), '', { placeholder: 'Mọi hình thức' });
      const out = h('div');
      async function load() {
        const qs = new URLSearchParams({ from: from.value, to: to.value });
        if (emp.value) qs.set('employee_id', emp.value);
        if (dept.value) qs.set('department_id', dept.value);
        if (method.value) qs.set('method', method.value);
        mount(out, A.loading());
        try {
          const rows = await GET('/api/logs?' + qs);
          mount(out, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('span', { class: 'muted' }, `${rows.length} lượt chấm công${rows.length >= 1500 ? ' (hiển thị tối đa 1.500)' : ''}`)),
            A.table({ rows, empty: 'Không có lượt chấm công nào trong khoảng này', cols: [
              { label: 'Thời gian', cls: 'nowrap', render: (x) => [h('b', { class: 'num' }, hhmm(x.ts)), h('span', { class: 'sub' }, fmtDate(CC.ymdOf(x.ts)))] },
              { label: 'Nhân viên', render: (x) => A.person(x) },
              { label: 'Loại', render: (x) => h('span', { class: 'chip ' + (x.type === 'in' ? 'ok' : '') }, x.type === 'in' ? 'Vào' : 'Ra') },
              { label: 'Hình thức', render: (x) => h('span', { class: 'chip' + (x.method === 'manual' ? ' warn' : '') }, METHOD[x.method] || x.method) },
              { label: 'Chi nhánh', render: (x) => x.branch_name || '' },
              { label: 'Vị trí / IP', render: (x) => (x.lat !== null ? [h('a', { href: `https://www.google.com/maps?q=${x.lat},${x.lng}`, target: '_blank', rel: 'noopener noreferrer' }, 'Xem bản đồ'), h('span', { class: 'sub' }, `${x.accuracy ? '±' + Math.round(x.accuracy) + ' m, ' : ''}${x.ip || ''}`)] : h('span', { class: 'muted' }, x.ip || '')) },
              { label: 'Ảnh', render: (x) => A.thumb(x.photo) },
              { label: 'Ghi chú', render: (x) => x.note || '' },
              ...(A.isAdmin() ? [{ label: '', cls: 'r', render: (x) => h('button', { class: 'btn sm ghost icon', type: 'button', 'aria-label': 'Xoá lượt chấm công', onclick: async () => { if (await confirmBox(`Xoá lượt chấm công ${x.type === 'in' ? 'vào' : 'ra'} lúc ${hhmm(x.ts)} của ${x.full_name}?`, { okText: 'Xoá', danger: true })) { try { await DEL('/api/logs/' + x.id); toast('Đã xoá'); load(); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash')) }] : [])] })));
        } catch (e) { mount(out, A.errorBox(e, load)); }
      }
      [from, to, emp, dept, method].forEach((c) => c.addEventListener('change', load));
      mount(el,
        A.pageHead('Nhật ký chấm công', 'Mọi lượt chấm công vào và ra, kèm vị trí và ảnh', A.isAdmin() ? h('button', { class: 'btn primary', type: 'button', onclick: () => manualDialog(r, {}, load) }, icon('plus'), 'Chấm công thủ công') : null),
        h('div', { class: 'filters' }, field('Từ ngày', from), field('Đến ngày', to), field('Nhân viên', emp), field('Phòng ban', dept), field('Hình thức', method)),
        out);
      await load();
    },
  });

  /* ================= Bảng công ================= */
  A.register({
    id: 'timesheet', label: 'Bảng công', icon: 'calendar', roles: ['admin', 'manager'],
    async render(el) {
      const r = await A.refs();
      let month = CC.monthNow();
      const dept = A.deptSelect(r, '');
      const search = h('input', { class: 'in', type: 'search', placeholder: 'Tìm theo tên hoặc mã', 'aria-label': 'Tìm kiếm' });
      const out = h('div');
      const nav = h('div');
      const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => A.withBusy(exportBtn, () => CC.download(`/api/timesheet/export?month=${month}${dept.value ? '&department_id=' + dept.value : ''}`, `bang-cong-${month}.xlsx`)) }, icon('download'), 'Xuất Excel');
      const q = () => `month=${month}${dept.value ? '&department_id=' + dept.value : ''}${search.value.trim() ? '&search=' + encodeURIComponent(search.value.trim()) : ''}`;

      async function load() {
        mount(nav, A.monthNav(month, (m) => { month = m; load(); }));
        mount(out, A.loading());
        try {
          const data = await GET('/api/timesheet?' + q());
          if (!data.employees.length) { mount(out, h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('strong', null, 'Chưa có nhân viên nào'), 'Thêm nhân viên ở mục Nhân viên để bắt đầu tính công.'))); return; }
          const dates = data.employees[0].days.map((d) => d.date);
          const head = h('tr', null,
            h('th', { class: 'sticky', style: { minWidth: '210px' } }, 'Nhân viên'),
            dates.map((d) => { const w = CC.dowOf(d); return h('th', { class: w === 0 ? 'we' : '' }, String(Number(d.slice(8))), h('small', null, CC.DOW[w])); }),
            ['Công hưởng lương', 'Nghỉ phép', 'Đi muộn (lần)', 'Phút muộn', 'Thiếu giờ', 'Vắng', 'OT (giờ)'].map((t) => h('th', { class: 'tot' }, t)));
          const body = data.employees.map((row) => {
            const sm = row.summary;
            return h('tr', null,
              h('td', { class: 'sticky' }, h('div', { class: 'who' }, h('div', null, h('b', null, row.employee.full_name), h('span', null, row.employee.code + (row.employee.dept_name ? ' · ' + row.employee.dept_name : ''))))),
              row.days.map((d) => {
                const s = STATUS[d.status] || STATUS.off;
                const btn = h('button', { type: 'button', class: s.tone && s.tone !== 'none' ? 't-' + s.tone : '', title: `${fmtDate(d.date)}: ${s.label || ''}`, 'aria-label': `${row.employee.full_name}, ${fmtDate(d.date)}: ${s.label || 'chưa đến'}`, onclick: () => dayDialog(row.employee, d) }, s.sym);
                return h('td', { class: 'cell' }, btn);
              }),
              h('td', { class: 'tot' }, `${CC.fmtNum(sm.paid_days)} / ${data.standard_days}`), h('td', { class: 'tot' }, CC.fmtNum(sm.leave_days + sm.unpaid_leave_days)),
              h('td', { class: 'tot' }, String(sm.late_count)), h('td', { class: 'tot' }, String(sm.late_minutes)), h('td', { class: 'tot' }, String(sm.incomplete_days)), h('td', { class: 'tot' }, String(sm.absent_days)), h('td', { class: 'tot' }, CC.fmtNum(sm.ot_hours)));
          });
          mount(out, h('div', { class: 'panel' },
            h('div', { class: 'ph' }, h('div', { class: 'legend', style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }, [['X', 'Đủ công', 'ok'], ['M', 'Muộn', 'warn'], ['S', 'Về sớm', 'warn'], ['½', 'Nửa công', 'warn'], ['V', 'Vắng', 'seal'], ['?', 'Thiếu giờ', 'seal'], ['P', 'Phép', 'stamp'], ['CT', 'Công tác', 'stamp'], ['L', 'Lễ', '']].map(([s, l, t]) => h('span', { class: 'chip ' + t }, `${s} ${l}`))), h('span', { class: 'muted' }, `Công chuẩn ${data.standard_days} ngày`)),
            h('div', { class: 'tablewrap', style: { maxHeight: '72dvh' } }, h('table', { class: 'tbl ts' }, h('thead', null, head), h('tbody', null, body)))));
        } catch (e) { mount(out, A.errorBox(e, load)); }
      }

      async function dayDialog(emp, day) {
        const s = STATUS[day.status] || STATUS.off;
        const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, A.loading());
        const d = dialog({ title: `${emp.full_name}, ${CC.DOW_LONG[day.dow]} ${fmtDate(day.date)}`, body: box, actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Đóng')], onClose: () => load() });
        async function fill() {
          const logs = await GET(`/api/logs?employee_id=${emp.id}&from=${day.date}&to=${day.date}`);
          logs.sort((a, b) => a.ts - b.ts);
          mount(box,
            h('div', null, h('span', { class: 'chip ' + (s.tone === 'mute' || s.tone === 'none' ? '' : s.tone) }, s.label || 'Chưa đến'), day.holiday ? h('span', { class: 'muted' }, ' ' + day.holiday) : null),
            h('div', { class: 'kvgrid' },
              h('div', null, h('b', null, day.shift ? `${day.shift.start}-${day.shift.end}` : 'Không có ca'), h('span', null, day.shift ? day.shift.name : 'Ca làm việc')),
              h('div', null, h('b', { class: 'num' }, `${day.first_in ? hhmm(day.first_in) : '--:--'} → ${day.last_out ? hhmm(day.last_out) : '--:--'}`), h('span', null, 'Giờ vào, giờ ra')),
              h('div', null, h('b', null, CC.fmtNum(day.total)), h('span', null, 'Công được tính')),
              day.late_min ? h('div', null, h('b', null, `${day.late_min} phút`), h('span', null, 'Đi muộn')) : null,
              day.ot_hours ? h('div', null, h('b', null, `${day.ot_hours} giờ`), h('span', null, 'Làm thêm (đã duyệt)')) : null),
            logs.length ? A.table({ rows: logs, cols: [
              { label: 'Giờ', render: (x) => h('b', { class: 'num' }, hhmm(x.ts)) }, { label: 'Loại', render: (x) => (x.type === 'in' ? 'Vào' : 'Ra') },
              { label: 'Hình thức', render: (x) => METHOD[x.method] || x.method }, { label: 'Ảnh', render: (x) => A.thumb(x.photo) }, { label: 'Ghi chú', render: (x) => x.note || '' },
              ...(A.isAdmin() ? [{ label: '', cls: 'r', render: (x) => h('button', { class: 'btn sm ghost icon', type: 'button', 'aria-label': 'Xoá', onclick: async () => { if (await confirmBox('Xoá lượt chấm công này?', { okText: 'Xoá', danger: true })) { try { await DEL('/api/logs/' + x.id); toast('Đã xoá'); fill(); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash')) }] : [])] }) : h('p', { class: 'muted' }, 'Không có lượt chấm công nào.'),
            A.isAdmin() ? h('div', null, h('button', { class: 'btn', type: 'button', onclick: () => manualDialog(r, { employee_id: emp.id, date: day.date }, fill) }, icon('plus'), 'Bổ sung giờ vào/ra')) : null);
        }
        try { await fill(); } catch (e) { mount(box, h('div', { class: 'err' }, e.message)); }
      }

      [dept].forEach((c) => c.addEventListener('change', load));
      search.addEventListener('input', CC.debounce(load, 300));
      mount(el, A.pageHead('Bảng công', 'Bấm vào một ô để xem hoặc chỉnh lượt chấm công trong ngày', exportBtn),
        h('div', { class: 'filters' }, nav, h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Phòng ban'), dept), h('div', { class: 'field grow' }, h('span', { class: 'lbl' }, 'Tìm nhân viên'), search)), out);
      await load();
    },
  });

  /* ================= Đơn từ ================= */
  const reqWhen = (r) => (r.type === 'ot' ? `${fmtDate(r.start_date)}, ${r.hours} giờ`
    : r.type === 'explain' ? `${fmtDate(r.start_date)}: vào ${r.in_time || '--'}, ra ${r.out_time || '--'}`
      : r.start_date === r.end_date ? `${fmtDate(r.start_date)}${r.session === 'am' ? ' (sáng)' : r.session === 'pm' ? ' (chiều)' : ''}` : `${fmtDate(r.start_date)} đến ${fmtDate(r.end_date)}`);

  A.register({
    id: 'requests', label: 'Đơn từ', icon: 'doc', roles: ['admin', 'manager'],
    async render(el) {
      let status = 'pending';
      const type = A.select(Object.entries(REQ_TYPE).map(([v, l]) => ({ v, l })), '', { placeholder: 'Mọi loại đơn' });
      const out = h('div');
      const tabs = h('div', { class: 'tabs-h', role: 'tablist' });
      async function load() {
        mount(tabs, [['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối'], ['', 'Tất cả']].map(([v, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(status === v), onclick: () => { status = v; load(); } }, l)));
        mount(out, A.loading());
        try {
          const rows = await GET(`/api/requests?status=${status}${type.value ? '&type=' + type.value : ''}`);
          const decide = (r, act) => async () => {
            const note = await promptBox(act === 'approve' ? 'Duyệt đơn' : 'Từ chối đơn', act === 'approve' ? 'Ghi chú cho nhân viên (không bắt buộc)' : 'Lý do từ chối', { okText: act === 'approve' ? 'Duyệt đơn' : 'Từ chối', required: act === 'reject', multiline: true });
            if (note === null) return;
            try { await POST(`/api/requests/${r.id}/${act}`, { note }); toast(act === 'approve' ? 'Đã duyệt đơn' : 'Đã từ chối đơn', 'ok'); load(); A.refreshBadge(); } catch (e) { toast(e.message, 'err'); }
          };
          mount(out, h('div', { class: 'panel' }, A.table({ rows, empty: status === 'pending' ? 'Không có đơn nào đang chờ duyệt' : 'Không có đơn nào', cols: [
            { label: 'Nhân viên', render: (r) => A.person({ full_name: r.emp_name, code: r.emp_code, dept_name: r.dept_name }) },
            { label: 'Loại đơn', render: (r) => [h('b', null, REQ_TYPE[r.type]), r.leave_name ? h('span', { class: 'sub' }, r.leave_name) : null] },
            { label: 'Thời gian', cls: 'nowrap', render: (r) => [reqWhen(r), r.days ? h('span', { class: 'sub' }, `${CC.fmtNum(r.days)} ngày`) : null] },
            { label: 'Lý do', render: (r) => h('div', { style: { maxWidth: '320px', whiteSpace: 'pre-wrap' } }, r.reason || '', r.approver_note ? h('span', { class: 'sub' }, `${r.approver_name || ''}: ${r.approver_note}`) : null) },
            { label: 'Gửi lúc', cls: 'nowrap', render: (r) => CC.fmtDateTime(r.created_at) },
            { label: 'Trạng thái', render: (r) => h('span', { class: 'chip ' + REQ_STATUS[r.status][1] }, REQ_STATUS[r.status][0]) },
            { label: '', cls: 'r', render: (r) => (r.status === 'pending' ? h('div', { class: 'acts' }, h('button', { class: 'btn sm danger', type: 'button', onclick: decide(r, 'reject') }, 'Từ chối'), h('button', { class: 'btn sm primary', type: 'button', onclick: decide(r, 'approve') }, icon('check'), 'Duyệt')) : '') }] })));
        } catch (e) { mount(out, A.errorBox(e, load)); }
      }
      type.addEventListener('change', load);
      mount(el, A.pageHead('Đơn từ', 'Duyệt đơn nghỉ phép, làm thêm giờ, công tác, làm việc từ xa và giải trình chấm công'), h('div', { class: 'filters' }, field('Loại đơn', type)), tabs, out);
      await load();
    },
  });
})();
