'use strict';
/* Trang: Danh mục (phòng ban, chi nhánh, ca, loại nghỉ, ngày lễ), Thông báo, Cài đặt */
(function () {
  const { h, icon, mount, GET, POST, PUT, DEL, toast, dialog, confirmBox, field, fmtDate } = CC;
  const A = ADM;

  const cancelBtn = (d) => h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ');
  const editBtn = (fn) => h('button', { class: 'btn sm', type: 'button', onclick: fn }, icon('edit'), 'Sửa');
  const delBtn = (fn) => h('button', { class: 'btn sm ghost icon', type: 'button', 'aria-label': 'Xoá', onclick: fn }, icon('trash'));
  const yes = (v, label = 'Có') => (v ? h('span', { class: 'chip ok' }, label) : h('span', { class: 'muted' }, 'Không'));

  async function remove(url, what, after) {
    if (!(await confirmBox(`Xoá ${what}? Thao tác này không thể hoàn tác.`, { okText: 'Xoá', danger: true }))) return;
    try {
      const r = await DEL(url);
      toast(r && r.deactivated ? 'Đã ẩn vì đang được sử dụng' : 'Đã xoá', 'ok');
      await A.refs(true);
      after();
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- Phòng ban ---------- */
  function deptDialog(row, after) {
    const name = h('input', { class: 'in', value: row ? row.name : '' });
    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
      if (row) await PUT('/api/departments/' + row.id, { name: name.value }); else await POST('/api/departments', { name: name.value });
      await A.refs(true); d.close(); toast('Đã lưu', 'ok'); after();
    }) }, 'Lưu');
    const d = dialog({ title: row ? 'Sửa phòng ban' : 'Thêm phòng ban', body: field('Tên phòng ban', name), actions: [save] });
    d.el.querySelector('.dlg-foot').prepend(cancelBtn(d));
    setTimeout(() => name.focus(), 40);
  }

  function tabDepartments(box, r) {
    const reload = async () => { const rr = await A.refs(true); tabDepartments(box, rr); };
    mount(box, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('span', { class: 'muted' }, `${r.departments.length} phòng ban`), h('button', { class: 'btn primary sm', type: 'button', onclick: () => deptDialog(null, reload) }, icon('plus'), 'Thêm phòng ban')),
      A.table({ rows: r.departments, empty: 'Chưa có phòng ban nào', cols: [
        { label: 'Tên phòng ban', render: (x) => h('b', null, x.name) },
        { label: 'Số nhân viên', cls: 'r', render: (x) => String(r.employees.filter((e) => e.active && e.department_id === x.id).length) },
        { label: '', cls: 'r', render: (x) => h('div', { class: 'acts' }, editBtn(() => deptDialog(x, reload)), delBtn(() => remove('/api/departments/' + x.id, `phòng ban "${x.name}"`, reload))) }] })));
  }

  /* ---------- Chi nhánh ---------- */
  const kioskUrl = (b) => `${location.origin}/kiosk/?key=${b.kiosk_key}`;

  function linkDialog(b, after) {
    const url = kioskUrl(b);
    const input = h('input', { class: 'in', value: url, readonly: true, 'aria-label': 'Liên kết màn hình QR' });
    const copy = h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Đã sao chép liên kết', 'ok'); } catch { input.select(); toast('Hãy nhấn Ctrl+C để sao chép'); } } }, 'Sao chép');
    const d = dialog({ title: `Màn hình QR: ${b.name}`, body: [
      h('p', null, 'Mở liên kết này trên máy tính bảng hoặc TV đặt tại cổng. Màn hình hiển thị mã QR tự đổi mỗi 30 giây, nhân viên quét bằng ứng dụng để chấm công. Ai có liên kết đều xem được màn hình, nên đừng chia sẻ công khai.'),
      h('div', { class: 'linkbox' }, input, copy)],
    actions: [h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox('Tạo liên kết mới? Liên kết cũ sẽ ngừng hoạt động và màn hình QR đang mở sẽ phải đổi sang liên kết mới.', { okText: 'Tạo liên kết mới' })) { try { const nb = await POST(`/api/branches/${b.id}/regen-key`, {}); await A.refs(true); d.close(); after(); linkDialog(nb, after); } catch (e) { toast(e.message, 'err'); } } } }, 'Tạo lại liên kết'),
      h('span', { class: 'spacer' }), h('a', { class: 'btn primary', href: url, target: '_blank', rel: 'noopener' }, icon('qr'), 'Mở màn hình QR')] });
  }

  function branchDialog(row, after) {
    const b = row || { radius: 100, active: 1 };
    const name = h('input', { class: 'in', value: b.name || '' });
    const addr = h('input', { class: 'in', value: b.address || '' });
    const lat = h('input', { class: 'in', type: 'number', step: 'any', value: b.lat ?? '', inputmode: 'decimal' });
    const lng = h('input', { class: 'in', type: 'number', step: 'any', value: b.lng ?? '', inputmode: 'decimal' });
    const radius = h('input', { class: 'in', type: 'number', min: '10', max: '5000', value: b.radius });
    const ips = h('input', { class: 'in', value: b.allowed_ips || '', placeholder: 'Ví dụ: 113.161.10.25' });
    const active = h('input', { type: 'checkbox', checked: b.active !== 0 });
    const here = h('button', { class: 'btn sm', type: 'button', onclick: () => {
      if (!navigator.geolocation) { toast('Trình duyệt không hỗ trợ định vị', 'err'); return; }
      here.disabled = true;
      navigator.geolocation.getCurrentPosition((p) => { lat.value = p.coords.latitude.toFixed(6); lng.value = p.coords.longitude.toFixed(6); here.disabled = false; toast(`Đã lấy vị trí (sai số ±${Math.round(p.coords.accuracy)} m)`, 'ok'); },
        () => { here.disabled = false; toast('Không lấy được vị trí. Hãy cho phép định vị (cần mở trang bằng HTTPS) hoặc nhập tay.', 'err'); }, { enableHighAccuracy: true, timeout: 15000 });
    } }, icon('pin'), 'Lấy vị trí của tôi');
    const myip = h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { const r = await GET('/api/my-ip'); const cur = ips.value.split(/[\s,;]+/).filter(Boolean); if (!cur.includes(r.ip)) cur.push(r.ip); ips.value = cur.join(', '); toast(`Đã thêm IP ${r.ip}`, 'ok'); } catch (e) { toast(e.message, 'err'); } } }, icon('wifi'), 'Thêm IP đang dùng');
    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
      const body = { name: name.value, address: addr.value, lat: lat.value === '' ? null : Number(lat.value), lng: lng.value === '' ? null : Number(lng.value), radius: Number(radius.value), allowed_ips: ips.value.trim(), active: active.checked };
      if ((body.lat === null) !== (body.lng === null)) throw new Error('Hãy nhập đủ cả vĩ độ và kinh độ, hoặc để trống cả hai');
      if (row) await PUT('/api/branches/' + row.id, body); else await POST('/api/branches', body);
      await A.refs(true); d.close(); toast('Đã lưu chi nhánh', 'ok'); after();
    }) }, 'Lưu');
    const d = dialog({ title: row ? 'Sửa chi nhánh' : 'Thêm chi nhánh', wide: true, body: [
      h('div', { class: 'formgrid' }, field('Tên chi nhánh', name), field('Địa chỉ', addr)),
      h('div', { class: 'note' }, 'Có 3 cách xác nhận nhân viên đang ở chi nhánh: toạ độ GPS (trong bán kính cho phép), WiFi công ty (theo địa chỉ IP công khai) và mã QR tại cổng. Bạn có thể dùng một, hai hoặc cả ba. Nếu để trống cả toạ độ và IP, nhân viên chấm công ở đâu cũng được.'),
      h('div', { class: 'formgrid' }, field('Vĩ độ', lat), field('Kinh độ', lng), field('Bán kính cho phép (mét)', radius, 'Nên từ 100 đến 200 m để bù sai số GPS')),
      here,
      field('IP WiFi công ty', ips, 'Nhiều IP cách nhau bằng dấu phẩy. Hỗ trợ dải 10.0.0.0/24 hoặc 203.0.113.*. Dùng nút bên dưới khi bạn đang kết nối WiFi công ty.'), myip,
      h('label', { class: 'check' }, active, 'Chi nhánh đang hoạt động')], actions: [save] });
    d.el.querySelector('.dlg-foot').prepend(cancelBtn(d));
  }

  function tabBranches(box, r) {
    const reload = async () => { const rr = await A.refs(true); tabBranches(box, rr); };
    mount(box, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('span', { class: 'muted' }, `${r.branches.length} chi nhánh`), h('button', { class: 'btn primary sm', type: 'button', onclick: () => branchDialog(null, reload) }, icon('plus'), 'Thêm chi nhánh')),
      A.table({ rows: r.branches, empty: 'Chưa có chi nhánh nào. Thêm chi nhánh để giới hạn nơi chấm công.', rowClass: (x) => (x.active ? '' : 'off'), cols: [
        { label: 'Chi nhánh', render: (x) => [h('b', null, x.name), h('span', { class: 'sub' }, x.address || '')] },
        { label: 'GPS', render: (x) => (x.lat !== null ? [`${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}`, h('span', { class: 'sub' }, `Bán kính ${x.radius} m`)] : h('span', { class: 'muted' }, 'Chưa đặt')) },
        { label: 'IP WiFi', render: (x) => x.allowed_ips || h('span', { class: 'muted' }, 'Chưa đặt') },
        { label: 'Trạng thái', render: (x) => (x.active ? h('span', { class: 'chip ok' }, 'Hoạt động') : h('span', { class: 'chip' }, 'Tạm dừng')) },
        { label: '', cls: 'r', render: (x) => h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => linkDialog(x, reload) }, icon('qr'), 'Màn hình QR'), editBtn(() => branchDialog(x, reload)), delBtn(() => remove('/api/branches/' + x.id, `chi nhánh "${x.name}"`, reload))) }] })));
  }

  /* ---------- Ca làm việc ---------- */
  const WD = [[1, 'T2'], [2, 'T3'], [3, 'T4'], [4, 'T5'], [5, 'T6'], [6, 'T7'], [0, 'CN']];

  function shiftDialog(row, after) {
    const s = row || { start_time: '08:00', end_time: '17:00', break_minutes: 60, late_grace: 5, early_grace: 0, work_days: '1,2,3,4,5,6', active: 1 };
    const name = h('input', { class: 'in', value: s.name || '' });
    const st = h('input', { class: 'in', type: 'time', value: s.start_time });
    const en = h('input', { class: 'in', type: 'time', value: s.end_time });
    const brk = h('input', { class: 'in', type: 'number', min: '0', max: '480', value: s.break_minutes });
    const lg = h('input', { class: 'in', type: 'number', min: '0', max: '120', value: s.late_grace });
    const eg = h('input', { class: 'in', type: 'number', min: '0', max: '120', value: s.early_grace });
    const have = new Set(s.work_days.split(','));
    const dows = WD.map(([v, l]) => h('label', null, h('input', { type: 'checkbox', value: v, checked: have.has(String(v)) }), l));
    const active = h('input', { type: 'checkbox', checked: s.active !== 0 });
    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
      const wd = dows.map((x) => x.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      if (!wd.length) throw new Error('Hãy chọn ít nhất một ngày làm việc');
      const body = { name: name.value, start_time: st.value, end_time: en.value, break_minutes: Number(brk.value), late_grace: Number(lg.value), early_grace: Number(eg.value), work_days: wd.join(','), active: active.checked };
      if (row) await PUT('/api/shifts/' + row.id, body); else await POST('/api/shifts', body);
      await A.refs(true); d.close(); toast('Đã lưu ca làm việc', 'ok'); after();
    }) }, 'Lưu');
    const d = dialog({ title: row ? 'Sửa ca làm việc' : 'Thêm ca làm việc', body: [
      field('Tên ca', name), h('div', { class: 'grid2' }, field('Giờ bắt đầu', st), field('Giờ kết thúc', en, 'Giờ kết thúc nhỏ hơn giờ bắt đầu nghĩa là ca qua đêm')),
      h('div', { class: 'grid3' }, field('Nghỉ giữa ca (phút)', brk), field('Cho phép đi muộn (phút)', lg), field('Cho phép về sớm (phút)', eg)),
      h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Ngày làm việc trong tuần'), h('div', { class: 'dows' }, dows)),
      h('label', { class: 'check' }, active, 'Đang sử dụng')], actions: [save] });
    d.el.querySelector('.dlg-foot').prepend(cancelBtn(d));
  }

  function tabShifts(box, r) {
    const reload = async () => { const rr = await A.refs(true); tabShifts(box, rr); };
    mount(box, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('span', { class: 'muted' }, 'Ca mặc định được chọn trong Cài đặt'), h('button', { class: 'btn primary sm', type: 'button', onclick: () => shiftDialog(null, reload) }, icon('plus'), 'Thêm ca')),
      A.table({ rows: r.shifts, empty: 'Chưa có ca nào', rowClass: (x) => (x.active ? '' : 'off'), cols: [
        { label: 'Tên ca', render: (x) => h('b', null, x.name) },
        { label: 'Giờ làm', render: (x) => `${x.start_time} - ${x.end_time}${x.end_time <= x.start_time ? ' (qua đêm)' : ''}` },
        { label: 'Nghỉ giữa ca', render: (x) => `${x.break_minutes} phút` },
        { label: 'Cho phép muộn / sớm', render: (x) => `${x.late_grace} / ${x.early_grace} phút` },
        { label: 'Ngày làm', render: (x) => WD.filter(([v]) => x.work_days.split(',').includes(String(v))).map(([, l]) => l).join(' ') },
        { label: '', cls: 'r', render: (x) => h('div', { class: 'acts' }, editBtn(() => shiftDialog(x, reload)), delBtn(() => remove('/api/shifts/' + x.id, `ca "${x.name}"`, reload))) }] })));
  }

  /* ---------- Loại nghỉ ---------- */
  function leaveDialog(row, after) {
    const l = row || { paid: 1, deduct_balance: 0, active: 1 };
    const name = h('input', { class: 'in', value: l.name || '' });
    const paid = h('input', { type: 'checkbox', checked: !!l.paid });
    const ded = h('input', { type: 'checkbox', checked: !!l.deduct_balance });
    const active = h('input', { type: 'checkbox', checked: l.active !== 0 });
    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
      const body = { name: name.value, paid: paid.checked, deduct_balance: ded.checked, active: active.checked };
      if (row) await PUT('/api/leave-types/' + row.id, body); else await POST('/api/leave-types', body);
      d.close(); toast('Đã lưu', 'ok'); after();
    }) }, 'Lưu');
    const d = dialog({ title: row ? 'Sửa loại nghỉ' : 'Thêm loại nghỉ', body: [field('Tên loại nghỉ', name),
      h('label', { class: 'check' }, paid, 'Được hưởng lương'), h('label', { class: 'check' }, ded, 'Trừ vào số ngày phép năm'), h('label', { class: 'check' }, active, 'Đang sử dụng')], actions: [save] });
    d.el.querySelector('.dlg-foot').prepend(cancelBtn(d));
  }
  async function tabLeave(box) {
    const list = await GET('/api/leave-types?all=1');
    const reload = () => tabLeave(box);
    mount(box, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('span', { class: 'muted' }, 'Các loại nghỉ nhân viên có thể chọn khi tạo đơn'), h('button', { class: 'btn primary sm', type: 'button', onclick: () => leaveDialog(null, reload) }, icon('plus'), 'Thêm loại nghỉ')),
      A.table({ rows: list, cols: [
        { label: 'Loại nghỉ', render: (x) => h('b', null, x.name) }, { label: 'Hưởng lương', render: (x) => yes(x.paid) }, { label: 'Trừ phép năm', render: (x) => yes(x.deduct_balance) },
        { label: '', cls: 'r', render: (x) => h('div', { class: 'acts' }, editBtn(() => leaveDialog(x, reload)), delBtn(() => remove('/api/leave-types/' + x.id, `loại nghỉ "${x.name}"`, reload))) }] })));
  }

  /* ---------- Ngày lễ ---------- */
  async function tabHolidays(box, year) {
    year = year || new Date().getFullYear();
    const rows = await GET('/api/holidays?year=' + year);
    const reload = () => tabHolidays(box, year);
    const date = h('input', { class: 'in', type: 'date', value: `${year}-01-01` });
    const name = h('input', { class: 'in', placeholder: 'Tên ngày lễ' });
    const nameField = field('Tên ngày lễ', name);
    nameField.classList.add('grow');
    const add = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(add, async () => { await PUT('/api/holidays', { date: date.value, name: name.value }); name.value = ''; toast('Đã lưu ngày lễ', 'ok'); reload(); }) }, icon('plus'), 'Thêm');
    mount(box, h('div', { class: 'panel' },
      h('div', { class: 'ph' }, h('div', { class: 'monthnav' }, h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Năm trước', onclick: () => tabHolidays(box, year - 1) }, icon('left')), h('b', null, `Năm ${year}`), h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Năm sau', onclick: () => tabHolidays(box, year + 1) }, icon('right'))),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { const r = await POST('/api/holidays/seed-vn', { year }); toast(r.added ? `Đã thêm ${r.added} ngày lễ` : 'Các ngày lễ dương lịch đã có sẵn', 'ok'); reload(); } catch (e) { toast(e.message, 'err'); } } }, 'Thêm ngày lễ dương lịch cố định')),
      h('div', { class: 'pb' }, h('div', { class: 'note', style: { marginBottom: '14px' } }, 'Tết Nguyên đán, Giỗ Tổ Hùng Vương (âm lịch) và các ngày nghỉ bù thay đổi theo từng năm, hãy thêm tay theo thông báo của Chính phủ. Nhân viên có ca trong ngày lễ vẫn được tính một công.'),
        h('div', { class: 'filters', style: { alignItems: 'flex-end' } }, field('Ngày', date), nameField, add)),
      A.table({ rows, empty: `Chưa có ngày lễ nào trong năm ${year}`, cols: [{ label: 'Ngày', cls: 'nowrap', render: (x) => `${CC.DOW_LONG[CC.dowOf(x.date)]}, ${fmtDate(x.date)}` }, { label: 'Tên ngày lễ', render: (x) => h('b', null, x.name) },
        { label: '', cls: 'r', render: (x) => delBtn(async () => { try { await DEL('/api/holidays/' + x.date); toast('Đã xoá'); reload(); } catch (e) { toast(e.message, 'err'); } }) }] })));
  }

  A.register({
    id: 'catalog', label: 'Danh mục', icon: 'building', roles: ['admin'],
    async render(el) {
      const r = await A.refs(true);
      const tabs = [['departments', 'Phòng ban'], ['branches', 'Chi nhánh'], ['shifts', 'Ca làm việc'], ['leave', 'Loại nghỉ'], ['holidays', 'Ngày lễ']];
      let cur = CC.store.get('cc_catalog_tab') || 'departments';
      if (!tabs.some((t) => t[0] === cur)) cur = 'departments';
      const bar = h('div', { class: 'tabs-h', role: 'tablist' });
      const box = h('div');
      async function show() {
        mount(bar, tabs.map(([id, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(cur === id), onclick: () => { cur = id; CC.store.set('cc_catalog_tab', id); show(); } }, l)));
        mount(box, A.loading());
        try {
          const rr = await A.refs();
          if (cur === 'departments') tabDepartments(box, rr);
          else if (cur === 'branches') tabBranches(box, rr);
          else if (cur === 'shifts') tabShifts(box, rr);
          else if (cur === 'leave') await tabLeave(box);
          else await tabHolidays(box);
        } catch (e) { mount(box, A.errorBox(e, show)); }
      }
      mount(el, A.pageHead('Danh mục', 'Phòng ban, chi nhánh, ca làm việc, loại nghỉ và ngày lễ'), bar, box);
      await show();
    },
  });

  /* ================= Thông báo ================= */
  function annDialog(row, after) {
    const a = row || { pinned: 0, active: 1 };
    const title = h('input', { class: 'in', value: a.title || '' });
    const body = h('textarea', { class: 'in', rows: '5' }, a.body || '');
    const pinned = h('input', { type: 'checkbox', checked: !!a.pinned });
    const active = h('input', { type: 'checkbox', checked: a.active !== 0 });
    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
      const b = { title: title.value, body: body.value, pinned: pinned.checked, active: active.checked };
      if (row) await PUT('/api/announcement-admin/' + row.id, b); else await POST('/api/announcement-admin', b);
      d.close(); toast('Đã lưu thông báo', 'ok'); after();
    }) }, row ? 'Lưu' : 'Đăng thông báo');
    const d = dialog({ title: row ? 'Sửa thông báo' : 'Thông báo mới', body: [field('Tiêu đề', title), field('Nội dung', body), h('label', { class: 'check' }, pinned, 'Ghim lên đầu'), h('label', { class: 'check' }, active, 'Đang hiển thị cho nhân viên')], actions: [save] });
    d.el.querySelector('.dlg-foot').prepend(cancelBtn(d));
  }

  A.register({
    id: 'announce', label: 'Thông báo', icon: 'megaphone', roles: ['admin'],
    async render(el) {
      const out = h('div');
      async function load() {
        const rows = await GET('/api/announcement-admin');
        mount(out, h('div', { class: 'panel' }, A.table({ rows, empty: 'Chưa có thông báo nào. Thông báo hiện trên màn hình chấm công của nhân viên.', rowClass: (x) => (x.active ? '' : 'off'), cols: [
          { label: 'Thông báo', render: (x) => [h('b', null, x.title), h('span', { class: 'sub', style: { maxWidth: '520px', whiteSpace: 'pre-wrap' } }, x.body.length > 140 ? x.body.slice(0, 140) + '...' : x.body)] },
          { label: 'Đăng lúc', cls: 'nowrap', render: (x) => CC.fmtDateTime(x.created_at) },
          { label: 'Trạng thái', render: (x) => [x.pinned ? h('span', { class: 'chip stamp' }, 'Ghim') : null, x.active ? h('span', { class: 'chip ok' }, 'Đang hiển thị') : h('span', { class: 'chip' }, 'Đã ẩn')] },
          { label: '', cls: 'r', render: (x) => h('div', { class: 'acts' }, editBtn(() => annDialog(x, load)), delBtn(() => remove('/api/announcement-admin/' + x.id, `thông báo "${x.title}"`, load))) }] })));
      }
      mount(el, A.pageHead('Thông báo', 'Gửi thông báo đến toàn bộ nhân viên', h('button', { class: 'btn primary', type: 'button', onclick: () => annDialog(null, load) }, icon('plus'), 'Thông báo mới')), out);
      await load();
    },
  });

  /* ================= Cài đặt ================= */
  function switchRow(title, desc, input) {
    return h('label', { class: 'switchrow' }, h('div', null, h('b', null, title), h('p', null, desc)), input);
  }

  /* ---------- Logo công ty ---------- */
  // Thu nhỏ ảnh về tối đa 512px rồi gửi lên máy chủ (giữ nền trong suốt nếu là PNG)
  async function imageToDataUrl(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Không đọc được file ảnh. Hãy chọn file PNG, JPG hoặc WebP.')); i.src = url; });
      const k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL('image/png');
      if (out.length > 1.3e6) { // PNG quá nặng (ảnh chụp): chuyển sang JPEG nền trắng
        ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', 0.9);
      }
      return out;
    } finally { URL.revokeObjectURL(url); }
  }

  function applyLogo(logo) {
    A.st.info.logo = logo;
    CC.setFavicon(logo || '../icons/icon.svg');
    document.querySelectorAll('.side .brand img').forEach((im) => { im.src = logo || '../icons/icon-192.png'; im.className = logo ? 'logo' : ''; });
  }

  function logoPanel() {
    const box = h('div', { class: 'logobox' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    const pick = h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('plus'), 'Tải logo lên');
    const remove = h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!(await confirmBox('Xoá logo công ty? Hệ thống sẽ dùng lại biểu tượng mặc định.', { title: 'Xoá logo', okText: 'Xoá logo', danger: true }))) return;
      try { await DEL('/api/logo'); applyLogo(''); toast('Đã xoá logo', 'ok'); draw(); } catch (e) { toast(e.message, 'err'); }
    } }, icon('trash'), 'Xoá logo');
    function draw() {
      const cur = A.st.info.logo;
      mount(box,
        cur ? h('img', { class: 'logo logoprev', src: cur, alt: 'Logo công ty' }) : h('div', { class: 'logoprev empty' }, 'Chưa có logo'),
        h('div', { class: 'logoact' }, h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, pick, cur ? remove : null),
          h('p', { class: 'muted' }, 'Ảnh PNG, JPG hoặc WebP, nên là hình vuông hoặc nền trong suốt. Logo hiện ở màn hình đăng nhập, app nhân viên, trang quản lý và màn hình QR. Được lưu ngay khi chọn, không cần bấm "Lưu cài đặt".')),
        file);
    }
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      pick.disabled = true;
      try {
        const data = await imageToDataUrl(f);
        const r = await PUT('/api/logo', { data });
        applyLogo(r.logo);
        toast('Đã cập nhật logo', 'ok');
        draw();
      } catch (e) { toast(e.message, 'err'); } finally { pick.disabled = false; }
    });
    draw();
    return h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Logo công ty')), h('div', { class: 'pb' }, box));
  }

  /* ---------- Hình ảnh màn hình chờ ---------- */
  const MAX_SCREEN_IMAGES = 20;
  // Thu nhỏ về tối đa 1920px, lưu JPEG nền trắng cho nhẹ (ảnh chụp từ điện thoại thường vài MB)
  async function photoToDataUrl(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`Không đọc được "${file.name}". Hãy chọn file PNG, JPG hoặc WebP.`)); i.src = url; });
      const k = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.88);
    } finally { URL.revokeObjectURL(url); }
  }

  function screenImagesBox() {
    let rows = [];
    const grid = h('div', { class: 'svgrid' });
    const count = h('span', { class: 'muted' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true });
    const add = h('button', { class: 'btn', type: 'button', style: { width: 'auto', flex: 'none' }, onclick: () => file.click() }, icon('plus'), 'Thêm hình');
    function draw() {
      count.textContent = `${rows.length}/${MAX_SCREEN_IMAGES} hình`;
      add.disabled = rows.length >= MAX_SCREEN_IMAGES;
      mount(grid, rows.length ? rows.map((x) => h('div', { class: 'svthumb' },
        h('img', { src: x.url, alt: 'Hình màn hình chờ', loading: 'lazy' }),
        h('button', { class: 'btn sm danger icon', type: 'button', 'aria-label': 'Xoá hình này', onclick: async () => {
          if (!(await confirmBox('Xoá hình này khỏi màn hình chờ?', { title: 'Xoá hình', okText: 'Xoá', danger: true }))) return;
          try { await DEL('/api/screensaver-images/' + x.id); rows = rows.filter((y) => y.id !== x.id); draw(); toast('Đã xoá hình', 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, icon('trash')))) : h('p', { class: 'muted' }, 'Chưa có hình nào. Khi chưa có hình, màn hình chờ chỉ hiện thông báo và đồng hồ.'));
    }
    file.addEventListener('change', async () => {
      const list = Array.from(file.files);
      file.value = '';
      if (!list.length) return;
      add.disabled = true;
      let ok = 0;
      try {
        for (const f of list) {
          if (rows.length >= MAX_SCREEN_IMAGES) throw new Error(`Tối đa ${MAX_SCREEN_IMAGES} hình. Hãy xoá bớt hình cũ.`);
          rows.push(await POST('/api/screensaver-images', { data: await photoToDataUrl(f) }));
          ok++;
        }
      } catch (e) { toast(e.message, 'err'); }
      if (ok) toast(ok === 1 ? 'Đã thêm hình' : `Đã thêm ${ok} hình`, 'ok');
      draw();
    });
    GET('/api/screensaver-images').then((x) => { rows = x; draw(); }, (e) => mount(grid, h('p', { class: 'muted' }, e.message)));
    mount(grid, h('p', { class: 'muted' }, 'Đang tải...'));
    return h('div', null, h('div', { class: 'row', style: { gap: '12px', alignItems: 'center', marginBottom: '12px' } }, add, count), grid, file);
  }

  /* ---------- Sao lưu tự động và nạp dữ liệu cũ ---------- */
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  function backupPanel() {
    const box = h('div', { class: 'pb', style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    const file = h('input', { type: 'file', accept: '.db,application/octet-stream', hidden: true });

    async function reload() { draw(await GET('/api/backups')); }

    async function restoreFrom(name, label, info) {
      const lines = info ? `Dữ liệu trong file: ${info.employees} nhân viên, ${info.logs} lượt chấm công${info.from ? ` (từ ${fmtDate(info.from)} đến ${fmtDate(info.to)})` : ''}. ` : '';
      const ok = await confirmBox(
        `${lines}Toàn bộ dữ liệu hiện tại sẽ được thay bằng dữ liệu của "${label}". Hệ thống tự lưu một bản dữ liệu hiện tại trước khi thay, nên vẫn quay lại được. Sau khi xong bạn cần đăng nhập lại. Ảnh chấm công không bị ảnh hưởng.`,
        { title: 'Khôi phục dữ liệu', okText: 'Khôi phục', danger: true });
      if (!ok) return false;
      try {
        await POST(`/api/backups/${encodeURIComponent(name)}/restore`, {});
        toast('Đã khôi phục dữ liệu. Đang tải lại...', 'ok');
        CC.setToken('');
        setTimeout(() => location.reload(), 1200);
      } catch (e) { toast(e.message, 'err'); return false; }
      return true;
    }

    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      try {
        toast('Đang kiểm tra file...', 'ok');
        const res = await fetch('/api/backups/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + CC.getToken() }, body: f });
        const info = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(info.error || `Lỗi ${res.status}`);
        await restoreFrom(info.name, f.name, info);
        reload();
      } catch (e) { toast(e.message, 'err'); }
    });

    function draw(st) {
      const auto = h('input', { type: 'checkbox', checked: st.auto });
      const keep = h('input', { class: 'in', type: 'number', min: '1', max: '365', value: st.keep, style: { width: '90px' } });
      const saveCfg = () => PUT('/api/backups/settings', { auto: auto.checked, keep: Number(keep.value) }).then((r) => { toast('Đã lưu cài đặt sao lưu', 'ok'); draw(r); }, (e) => toast(e.message, 'err'));
      auto.addEventListener('change', saveCfg);
      keep.addEventListener('change', saveCfg);
      const last = st.last ? (st.last.ok ? `Lần gần nhất: ${CC.fmtDateTime(st.last.ts)}, thành công.` : `Lần gần nhất: ${CC.fmtDateTime(st.last.ts)}, LỖI: ${st.last.error}`) : 'Chưa có lần sao lưu tự động nào.';
      const now = h('button', { class: 'btn', type: 'button', onclick: () => A.withBusy(now, async () => { await POST('/api/backups', {}); toast('Đã sao lưu', 'ok'); reload(); }) }, icon('download'), 'Sao lưu ngay');
      const old = h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, icon('plus'), 'Nạp dữ liệu cũ từ file...');
      mount(box,
        switchRow(`Tự động sao lưu lúc ${String(st.hour).padStart(2, '0')}:00 sáng mỗi đêm`, 'Hệ thống tự lưu một bản dữ liệu vào thư mục backups trên máy chủ. Nếu máy chủ tắt đúng giờ đó thì sẽ bù khi bật lại.', auto),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, 'Giữ lại', keep, 'bản tự động gần nhất (các bản cũ hơn tự xoá).'),
        h('p', { class: 'muted' }, last, st.next ? ` Lần tự động tiếp theo: ${CC.fmtDateTime(st.next)}.` : ' Đang tắt tự động.'),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, now, old),
        h('p', { class: 'muted' }, 'Nạp dữ liệu cũ: chọn file .db đã sao lưu trước đó (từ nút Tải bản sao lưu, từ danh sách dưới đây, hoặc từ máy chủ cũ). Hệ thống kiểm tra file rồi hỏi xác nhận trước khi thay dữ liệu hiện tại. Ảnh chấm công lưu riêng nên cần chép thư mục photos nếu muốn mang theo.'),
        A.table({
          rows: st.items, empty: 'Chưa có bản sao lưu nào',
          cols: [
            { label: 'Thời gian', cls: 'nowrap', render: (x) => CC.fmtDateTime(x.ts) },
            { label: 'Loại', render: (x) => x.kind_label },
            { label: 'Dung lượng', cls: 'nowrap', render: (x) => fmtSize(x.size) },
            { label: '', cls: 'r', render: (x) => h('div', { class: 'acts' },
              h('button', { class: 'btn sm', type: 'button', onclick: (e) => A.withBusy(e.currentTarget, () => CC.download(`/api/backups/${encodeURIComponent(x.name)}/download`, x.name)) }, icon('download'), 'Tải'),
              h('button', { class: 'btn sm', type: 'button', onclick: () => restoreFrom(x.name, `${x.kind_label} ${CC.fmtDateTime(x.ts)}`) }, 'Khôi phục'),
              h('button', { class: 'btn sm danger', type: 'button', 'aria-label': 'Xoá bản sao lưu', onclick: async () => {
                if (!(await confirmBox('Xoá bản sao lưu này? Không thể khôi phục lại file đã xoá.', { title: 'Xoá bản sao lưu', okText: 'Xoá', danger: true }))) return;
                try { await DEL(`/api/backups/${encodeURIComponent(x.name)}`); reload(); } catch (e) { toast(e.message, 'err'); }
              } }, icon('trash'))) },
          ] }),
        file);
    }

    box.append(h('p', { class: 'muted' }, 'Đang tải...'));
    reload().catch((e) => mount(box, h('p', { class: 'muted' }, e.message)));
    return h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Sao lưu và khôi phục dữ liệu')), box);
  }

  /* ---------- Cập nhật phần mềm: chọn file là cập nhật, không cần cài đặt gì thêm ---------- */
  function updatePanel() {
    const box = h('div', { class: 'pb', style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
    const file = h('input', { type: 'file', accept: '.tgz,.gz,.zip,application/gzip,application/zip', hidden: true });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let st = null;

    function progress(title, sub) {
      mount(box, h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', padding: '18px', borderRadius: '12px', background: 'var(--canvas)' } },
        h('span', { class: 'spinner', role: 'status', 'aria-label': 'Đang xử lý' }), h('div', null, h('b', null, title), sub ? h('p', { class: 'muted', style: { margin: '4px 0 0' } }, sub) : null)));
    }

    // Sau khi cập nhật: chờ máy chủ chạy bản mới rồi tự tải lại trang
    async function afterUpdate(r) {
      if (r.hot_reloaded) { progress(`Đã cập nhật lên ${r.version}`, 'Đang tải lại trang...'); await sleep(1000); location.reload(); return; }
      if (r.restarted) {
        progress(`Đã cài bản ${r.version}, phần mềm đang khởi động lại`, 'Mất khoảng 5-15 giây, trang sẽ tự tải lại. Dữ liệu được giữ nguyên.');
        for (let i = 0; i < 90; i++) {
          await sleep(1500);
          try { const v = await GET('/api/version'); if (v.version === r.version && v.started_at !== st.started_at) { location.reload(); return; } } catch { /* đang khởi động */ }
        }
        mount(box, h('div', { class: 'callout err' }, 'Phần mềm chưa chạy lại sau 2 phút. Hãy kiểm tra máy chủ (log trong thư mục dữ liệu/logs) rồi tải lại trang.'));
        return;
      }
      await confirmBox(`Đã ghi bản ${r.version}. Bản này đổi phần lõi nên cần chạy lại phần mềm để có hiệu lực. Phần mềm chưa tự chạy lại được vì không được khởi động bằng start.bat / start.sh / dịch vụ. Hãy tắt rồi mở lại phần mềm bằng start.bat (Windows) hoặc start.sh (Linux).`, { title: 'Cần chạy lại phần mềm', okText: 'Đã hiểu' });
      load();
    }

    async function upload(f) {
      if (!f) return;
      if (!/\.(tgz|tar\.gz|zip)$/i.test(f.name)) { toast('Hãy chọn file cập nhật .tgz hoặc gói cài đặt .zip của phần mềm', 'err'); return; }
      progress(`Đang tải lên ${f.name}`, `${Math.round(f.size / 1024)} KB · kiểm tra tính toàn vẹn của gói...`);
      try {
        const res = await fetch('/api/update/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer ' + CC.getToken() }, body: f });
        const plan = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(plan.error || `Lỗi ${res.status}`);
        showPlan(plan);
      } catch (e) { draw(); toast(e.message, 'err'); }
    }

    function showPlan(plan) {
      const pw = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu của bạn' });
      const down = h('input', { type: 'checkbox' });
      const go = h('button', { class: 'btn primary', type: 'button', style: { minHeight: '46px', fontSize: '16px' } }, icon('check'), plan.downgrade ? 'Hạ phiên bản' : 'Cập nhật ngay');
      const list = (title, items) => (items.length ? h('details', null, h('summary', null, `${title}: ${items.length} tệp`), h('ul', { style: { margin: '6px 0 0 18px', fontSize: '13px', maxHeight: '160px', overflow: 'auto' } }, items.map((x) => h('li', null, x)))) : null);
      const note = (t, bad) => h('p', { class: 'muted', style: bad ? { color: 'var(--seal, #b42318)', margin: 0 } : { margin: 0 } }, t);
      const run = () => A.withBusy(go, async () => {
        if (!pw.value) { toast('Nhập mật khẩu để xác nhận', 'err'); pw.focus(); return; }
        if (plan.downgrade && !down.checked) { toast('Hãy đánh dấu xác nhận hạ phiên bản', 'err'); return; }
        try {
          progress(`Đang cập nhật ${plan.current} → ${plan.version}`, 'Đang sao lưu dữ liệu và ghi bản mới...');
          const r = await POST('/api/update/apply', { token: plan.token, password: pw.value, allow_downgrade: down.checked });
          await afterUpdate(r);
        } catch (e) { toast(e.message, 'err'); showPlan(plan); }
      });
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
      go.addEventListener('click', run);
      mount(box, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', border: '1px solid var(--line)', borderRadius: '12px' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } }, h('h3', { style: { margin: 0, fontSize: '20px' } }, `${plan.current}  →  ${plan.version}`), plan.full ? h('span', { class: 'chip' }, 'Từ gói cài đặt đầy đủ') : null, plan.signed ? h('span', { class: 'chip ok' }, 'Chữ ký hợp lệ') : null),
        plan.notes ? h('p', { style: { margin: 0 } }, plan.notes) : null,
        note(`${plan.added.length} tệp thêm mới, ${plan.changed.length} tệp thay đổi, ${plan.removed.length} tệp bỏ.`),
        list('Thêm mới', plan.added), list('Thay đổi', plan.changed), list('Bỏ', plan.removed),
        plan.restart_required
          ? note(st.auto_restart ? 'Bản này đổi phần lõi: phần mềm tự khởi động lại trong vài giây, người đang dùng chỉ cần chờ trang tự tải lại.' : 'Bản này đổi phần lõi: sau khi cập nhật cần tắt và mở lại phần mềm (start.bat / start.sh).', !st.auto_restart)
          : note('Áp dụng ngay, không cần khởi động lại, người đang dùng không bị ngắt.'),
        plan.infra_changed.length ? note(`Các tệp hạ tầng (${plan.infra_changed.join(', ')}) không áp dụng khi chạy Docker; cần build lại ảnh nếu muốn dùng.`, true) : null,
        plan.downgrade ? h('label', { class: 'check', style: { color: 'var(--seal, #b42318)' } }, down, 'Đây là phiên bản CŨ hơn bản đang chạy. Tôi xác nhận hạ phiên bản.') : null,
        note('Hệ thống tự sao lưu dữ liệu trước khi cập nhật và giữ bản cũ để quay lại được.'),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } }, h('div', { style: { flex: '1 1 220px' } }, pw), go, h('button', { class: 'btn', type: 'button', onclick: draw }, 'Huỷ'))));
      setTimeout(() => pw.focus(), 50);
    }

    function rollbackDialog() {
      const pw = h('input', { class: 'in', type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu của bạn để xác nhận' });
      const go = h('button', { class: 'btn danger', type: 'button' }, 'Quay lại bản trước');
      const d = dialog({ title: 'Quay lại phiên bản trước', body: [h('p', null, `Phiên bản ${st.version} sẽ được thay bằng bản ngay trước đó. Dữ liệu giữ nguyên (không bị lùi).`), pw], actions: [go] });
      go.addEventListener('click', () => A.withBusy(go, async () => {
        try { const r = await POST('/api/update/rollback', { password: pw.value }); d.close(); progress('Đang quay lại bản trước...'); await afterUpdate(r); } catch (e) { toast(e.message, 'err'); }
      }));
      setTimeout(() => pw.focus(), 50);
    }

    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; upload(f); });

    function draw() {
      const SUP = { launcher: 'start.bat / start.sh', docker: 'Docker', systemd: 'dịch vụ systemd', other: 'trình quản lý tiến trình' };
      const hist = st.history.length ? A.table({ rows: st.history, empty: '', cols: [
        { label: 'Phiên bản', render: (x) => x.version }, { label: 'Lúc', cls: 'nowrap', render: (x) => CC.fmtDateTime(x.at) }, { label: 'Bởi', render: (x) => x.by }] }) : null;
      const drop = h('div', { tabindex: '0', role: 'button', 'aria-label': 'Chọn file cập nhật',
        style: { border: '2px dashed var(--line-2, #cdd5e3)', borderRadius: '14px', padding: '30px 16px', textAlign: 'center', cursor: 'pointer', background: 'var(--canvas)' },
        onclick: () => file.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } },
        h('div', { style: { fontSize: '17px', fontWeight: 700 } }, 'Kéo thả file cập nhật vào đây, hoặc bấm để chọn file'),
        h('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'Nhận file chamcong-update-x.y.z.tgz hoặc gói cài đặt chamcong-x.y.z-cai-dat.zip. Kiểm tra xong sẽ hiện nội dung bản mới để bạn xác nhận.'));
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--stamp)'; });
      drop.addEventListener('dragleave', () => { drop.style.borderColor = ''; });
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.style.borderColor = ''; upload(e.dataTransfer.files[0]); });
      mount(box,
        h('p', { style: { margin: 0 } }, 'Phiên bản đang chạy: ', h('b', { style: { fontSize: '18px' } }, st.version), ` · khởi động lúc ${CC.fmtDateTime(st.started_at)}`,
          st.supervisor ? h('span', { class: 'muted' }, ` · tự chạy lại bằng ${SUP[st.supervisor]}`) : null),
        !st.enabled
          ? h('div', { class: 'callout err', style: { padding: '12px', borderRadius: '10px', background: '#fdeeee' } }, 'Cập nhật trên web đang bị tắt bằng dòng ALLOW_ONLINE_UPDATE=0 trong file .env. Xoá dòng đó rồi chạy lại phần mềm để bật.')
          : [drop,
              !st.auto_restart ? h('p', { class: 'muted', style: { margin: 0, color: 'var(--seal, #b42318)' } }, 'Phần mềm không được chạy bằng start.bat / start.sh / dịch vụ, nên bản đổi phần lõi sẽ cần tắt mở lại thủ công. Nên chạy phần mềm bằng start.bat (Windows) hoặc cài dịch vụ bằng install-linux.sh.') : null,
              st.can_rollback ? h('div', null, h('button', { class: 'btn', type: 'button', onclick: rollbackDialog }, icon('refresh'), 'Quay lại bản trước')) : null,
              hist],
        file);
    }
    async function load() {
      try { st = await GET('/api/update/status'); draw(); } catch (e) { mount(box, h('p', { class: 'muted' }, e.message)); }
    }
    box.append(h('p', { class: 'muted' }, 'Đang tải...'));
    load();
    return h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Cập nhật phần mềm')), box);
  }

  A.register({
    id: 'update', label: 'Cập nhật phần mềm', icon: 'refresh', roles: ['admin'],
    async render(el) {
      mount(el, A.pageHead('Cập nhật phần mềm', 'Chọn file bản mới là cập nhật, không cần cài đặt gì trên máy chủ.'), updatePanel());
    },
  });

  A.register({
    id: 'settings', label: 'Cài đặt', icon: 'settings', roles: ['admin'],
    async render(el) {
      const [S, r] = await Promise.all([GET('/api/settings'), A.refs()]);
      const chk = (k) => h('input', { type: 'checkbox', checked: S[k] === '1' });
      const num = (k, o = {}) => h('input', Object.assign({ class: 'in', type: 'number', value: S[k], step: 'any' }, o));
      const company = h('input', { class: 'in', value: S.company_name });
      const url = h('input', { class: 'in', value: S.public_url, placeholder: 'https://chamcong.congty.vn' });
      const gps = chk('allow_gps'), wifi = chk('allow_wifi'), qr = chk('allow_qr'), photo = chk('require_photo'), bind = chk('bind_device');
      const faceOn = chk('allow_face'), faceLive = chk('face_liveness');
      const faceThr = num('face_threshold', { min: '0.3', max: '0.7', step: '0.05' });
      const faceStatus = h('p', { class: 'muted' }, 'Đang kiểm tra thư viện nhận diện...');
      GET('/api/face/assets').then((a) => {
        faceStatus.textContent = a.ready ? 'Thư viện nhận diện khuôn mặt: đã cài.' : 'Thư viện nhận diện khuôn mặt: CHƯA cài, màn hình QR sẽ chưa hiện khung camera. Chạy lệnh "node scripts/get-face-models.js" trên máy chủ (cần Internet), rồi tải lại trang này.';
        if (!a.ready) faceStatus.style.color = 'var(--seal, #b42318)';
      }, () => { faceStatus.textContent = ''; });
      const svOn = chk('screensaver_on'), svAnn = chk('screensaver_announce');
      const svIdle = num('screensaver_idle_min', { min: '1', max: '240', step: '1' });
      const svSlide = num('screensaver_slide_sec', { min: '3', max: '300', step: '1' });
      const svBranch = r.branches.find((b) => b.active !== 0 && b.kiosk_key);
      const svPreview = h('button', { class: 'btn', type: 'button', disabled: !svBranch, onclick: () => window.open('/kiosk/?key=' + encodeURIComponent(svBranch.kiosk_key) + '&idle=2', '_blank', 'noopener') }, 'Xem thử màn hình chờ');
      const acc = num('max_accuracy', { min: '20', max: '1000' });
      const gap = num('min_gap_seconds', { min: '0', max: '3600' });
      const defShift = A.select(r.shifts.filter((s) => s.active).map((s) => ({ v: s.id, l: `${s.name}, ${s.start_time}-${s.end_time}` })), S.default_shift_id);
      const full = num('full_day_ratio', { value: Math.round(Number(S.full_day_ratio) * 100), min: '50', max: '100' });
      const half = num('half_day_ratio', { value: Math.round(Number(S.half_day_ratio) * 100), min: '10', max: '80' });
      const std = num('std_days', { min: '0', max: '31' });
      const otm = num('ot_multiplier', { min: '1', max: '5', step: '0.1' });
      const oth = num('ot_base_hours', { min: '1', max: '24' });
      const pen = num('late_penalty_per_minute', { min: '0', step: '100' });
      const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
        await PUT('/api/settings', {
          company_name: company.value, public_url: url.value, allow_gps: gps.checked, allow_wifi: wifi.checked, allow_qr: qr.checked, require_photo: photo.checked, bind_device: bind.checked,
          allow_face: faceOn.checked, face_liveness: faceLive.checked, face_threshold: faceThr.value,
          screensaver_on: svOn.checked, screensaver_announce: svAnn.checked, screensaver_idle_min: svIdle.value, screensaver_slide_sec: svSlide.value,
          max_accuracy: acc.value, min_gap_seconds: gap.value, default_shift_id: defShift.value, full_day_ratio: Number(full.value) / 100, half_day_ratio: Number(half.value) / 100,
          std_days: std.value, ot_multiplier: otm.value, ot_base_hours: oth.value, late_penalty_per_minute: pen.value,
        });
        A.st.info.company_name = company.value.trim() || A.st.info.company_name;
        toast('Đã lưu cài đặt', 'ok');
      }) }, 'Lưu cài đặt');
      const backup = h('button', { class: 'btn', type: 'button', onclick: () => A.withBusy(backup, () => CC.download('/api/backup', 'chamcong.db')) }, icon('download'), 'Tải bản sao lưu dữ liệu');
      const auditBtn = h('button', { class: 'btn', type: 'button', onclick: () => A.withBusy(auditBtn, async () => {
        const rows = await GET('/api/audit');
        dialog({ title: 'Nhật ký thao tác (200 gần nhất)', wide: true, body: A.table({ rows, empty: 'Chưa có thao tác nào', cols: [{ label: 'Thời gian', cls: 'nowrap', render: (x) => CC.fmtDateTime(x.ts) }, { label: 'Người thực hiện', render: (x) => x.actor_name }, { label: 'Thao tác', render: (x) => h('b', null, x.action) }, { label: 'Chi tiết', render: (x) => x.detail }] }) });
      }) }, icon('list'), 'Xem nhật ký thao tác');
      mount(el, A.pageHead('Cài đặt', 'Quy tắc chấm công và cách tính công'),
        h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Thông tin chung')), h('div', { class: 'pb' }, h('div', { class: 'formgrid' }, field('Tên công ty', company), field('Địa chỉ website của hệ thống', url, 'Dùng để tạo mã QR. Để trống để tự nhận theo địa chỉ đang truy cập.')))),
        logoPanel(),
        h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Hình thức chấm công')), h('div', { class: 'pb' },
          switchRow('Chấm công bằng GPS', 'Nhân viên phải ở trong bán kính của chi nhánh đã đặt toạ độ.', gps),
          switchRow('Chấm công bằng WiFi công ty', 'Chấp nhận khi địa chỉ IP công khai khớp với IP đã khai báo cho chi nhánh.', wifi),
          switchRow('Chấm công bằng mã QR', 'Quét mã QR tự đổi trên màn hình tại chi nhánh, hoặc nhập mã 6 số.', qr),
          switchRow('Bắt buộc chụp ảnh khuôn mặt', 'Mỗi lần chấm công phải chụp ảnh bằng camera trước. Ảnh lưu trên máy chủ để đối chiếu khi cần.', photo),
          switchRow('Mỗi nhân viên chỉ dùng một điện thoại', 'Lần chấm công đầu tiên sẽ gắn tài khoản với điện thoại đó. Muốn đổi máy, quản trị viên gỡ liên kết ở mục Nhân viên.', bind),
          h('div', { class: 'formgrid', style: { marginTop: '14px' } }, field('Sai số GPS tối đa (mét)', acc, 'Từ chối khi tín hiệu GPS kém hơn mức này'), field('Giãn cách giữa hai lần chấm (giây)', gap, 'Tránh bấm nhầm hai lần liên tiếp')))),
        h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Chấm công bằng khuôn mặt tại màn hình QR')), h('div', { class: 'pb' },
          switchRow('Bật nhận diện khuôn mặt', 'Màn hình QR (/kiosk/) hiện thêm khung camera, nhân viên đã đăng ký khuôn mặt chỉ cần nhìn vào camera. Vẫn dùng được mã QR song song. Đăng ký khuôn mặt ở mục Nhân viên, nút camera.', faceOn),
          switchRow('Yêu cầu chớp mắt trước khi nhận diện', 'Giảm khả năng dùng ảnh in hoặc ảnh trên điện thoại để chấm công hộ. Không thể ngăn hoàn toàn video hay mặt nạ, nên cần đặt màn hình ở nơi có người giám sát.', faceLive),
          h('div', { class: 'formgrid', style: { marginTop: '14px' } }, field('Ngưỡng nhận diện (0,3 đến 0,7)', faceThr, 'Số nhỏ = chặt hơn: ít chấm nhầm người nhưng dễ báo "không nhận ra". Mặc định 0,5.')),
          h('p', { class: 'muted' }, 'Khuôn mặt là dữ liệu sinh trắc học nhạy cảm: chỉ đăng ký khi nhân viên đồng ý, và xoá được bất cứ lúc nào. Dữ liệu nằm trong file sao lưu. Lưu ý quy định về bảo vệ dữ liệu cá nhân tại nơi bạn kinh doanh.'),
          faceStatus)),
        h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Màn hình chờ tại màn hình QR')), h('div', { class: 'pb' },
          switchRow('Bật màn hình chờ', 'Khi quá thời gian chờ mà không có ai chấm công, màn hình QR (/kiosk/) chuyển sang hiện hình ảnh và thông báo của công ty. Chạm vào màn hình để quay lại chấm công.', svOn),
          switchRow('Hiện thông báo của công ty', 'Lấy các thông báo đang hiển thị ở mục Thông báo. Lưu ý: màn hình đặt nơi công cộng thì ai đi ngang cũng đọc được.', svAnn),
          h('div', { class: 'formgrid', style: { marginTop: '14px' } }, field('Chờ bao nhiêu phút thì vào màn hình chờ', svIdle, 'Tính từ lần chấm công hoặc lần chạm màn hình gần nhất. Mặc định 5 phút.'), field('Mỗi hình / thông báo hiện (giây)', svSlide, 'Từ 3 đến 300 giây. Mặc định 8 giây.')),
          h('h3', { style: { margin: '18px 0 10px', fontSize: '15px' } }, 'Hình ảnh'),
          screenImagesBox(),
          h('p', { class: 'muted' }, 'Ảnh PNG, JPG hoặc WebP, tối đa 20 hình, tự thu nhỏ về 1920 px. Hình được thêm hoặc xoá ngay khi chọn; các mục còn lại cần bấm \"Lưu cài đặt\". Màn hình QR đang mở tự cập nhật sau tối đa 30 giây.'),
          h('div', { style: { marginTop: '10px' } }, svPreview))),
        h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Cách tính công và lương')), h('div', { class: 'pb' }, h('div', { class: 'formgrid' },
          field('Ca mặc định', defShift, 'Áp dụng cho nhân viên chưa được gán ca riêng'),
          field('Đủ một công khi làm được (%) ca', full, 'Ví dụ 90: làm đủ 90% giờ của ca thì tính 1 công'),
          field('Tính nửa công khi làm được (%) ca', half, 'Dưới mức này tính là thiếu giờ, không có công'),
          field('Công chuẩn của tháng (ngày)', std, 'Nhập 0 để tự đếm theo ngày làm việc của ca mặc định'),
          field('Hệ số lương làm thêm giờ', otm, 'Ví dụ 1.5 là 150%'), field('Số giờ chuẩn mỗi ngày để tính lương giờ', oth), field('Phạt đi muộn (đồng/phút)', pen, 'Nhập 0 nếu không phạt')))),
        h('div', { class: 'savebar' }, save),
        backupPanel(),
        updatePanel(),
        h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, 'Dữ liệu và an toàn')), h('div', { class: 'pb', style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, h('p', { class: 'muted' }, 'Bản sao lưu nằm trên chính máy chủ này. Hãy thỉnh thoảng tải về một bản và cất ở nơi khác để phòng khi hỏng ổ đĩa.'), h('div', { class: 'row', style: { gap: '10px' } }, backup, auditBtn))));
    },
  });
})();
