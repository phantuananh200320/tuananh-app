'use strict';
/* Trang: Nhân viên, Xếp ca, Bảng lương */
(function () {
  const { h, icon, mount, GET, POST, PUT, DEL, toast, dialog, confirmBox, field, fmtDate, fmtDay, ROLE } = CC;
  const A = ADM;

  const opt = (list, v = 'id', l = 'name') => list.map((x) => ({ v: x[v], l: x[l] }));

  /* ================= Nhân viên ================= */
  function employeeDialog(r, emp, done) {
    const isNew = !emp;
    const e = emp || { role: 'employee', annual_leave: 12, track: 1, active: 1, allow_remote: 0, base_salary: 0, allowance: 0 };
    const code = h('input', { class: 'in', value: e.code || '', maxlength: '30', autocomplete: 'off' });
    const name = h('input', { class: 'in', value: e.full_name || '' });
    const phone = h('input', { class: 'in', type: 'tel', value: e.phone || '', inputmode: 'tel' });
    const email = h('input', { class: 'in', type: 'email', value: e.email || '' });
    const role = A.select(Object.entries(ROLE).map(([v, l]) => ({ v, l })), e.role);
    const dept = A.select(opt(r.departments), e.department_id, { placeholder: 'Chưa chọn' });
    const branch = A.select(opt(r.branches), e.branch_id, { placeholder: 'Mọi chi nhánh' });
    const shift = A.select(opt(r.shifts), e.shift_id, { placeholder: 'Theo ca mặc định' });
    const mgr = A.select(r.employees.filter((x) => x.active && x.id !== e.id && x.role !== 'employee').map((x) => ({ v: x.id, l: `${x.code} - ${x.full_name}` })), e.manager_id, { placeholder: 'Không có' });
    const pos = h('input', { class: 'in', value: e.position || '' });
    const hired = h('input', { class: 'in', type: 'date', value: e.hired_date || '' });
    const salary = h('input', { class: 'in', type: 'number', min: '0', step: '10000', value: e.base_salary || 0, inputmode: 'numeric' });
    const allow = h('input', { class: 'in', type: 'number', min: '0', step: '10000', value: e.allowance || 0, inputmode: 'numeric' });
    const leave = h('input', { class: 'in', type: 'number', min: '0', max: '60', step: '0.5', value: e.annual_leave ?? 12 });
    const note = h('input', { class: 'in', value: e.note || '' });
    const pw = h('input', { class: 'in', type: 'text', placeholder: '123456', autocomplete: 'off' });
    const remote = h('input', { type: 'checkbox', checked: !!e.allow_remote });
    const track = h('input', { type: 'checkbox', checked: e.track !== 0 });
    const active = h('input', { type: 'checkbox', checked: e.active !== 0 });

    const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
      const body = {
        code: code.value.trim(), full_name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim(), role: role.value,
        department_id: dept.value || null, branch_id: branch.value || null, shift_id: shift.value || null, manager_id: mgr.value || null,
        position: pos.value.trim(), hired_date: hired.value || null, base_salary: Number(salary.value) || 0, allowance: Number(allow.value) || 0,
        annual_leave: Number(leave.value) || 0, note: note.value.trim(), allow_remote: remote.checked, track: track.checked,
      };
      if (isNew) { if (pw.value) body.password = pw.value; await POST('/api/employees', body); toast('Đã thêm nhân viên', 'ok'); }
      else { body.active = active.checked; await PUT('/api/employees/' + e.id, body); toast('Đã lưu thay đổi', 'ok'); }
      d.close(); done();
    }) }, isNew ? 'Thêm nhân viên' : 'Lưu thay đổi');

    const extra = [];
    if (!isNew) {
      extra.push(
        h('button', { class: 'btn', type: 'button', onclick: async () => {
          if (!(await confirmBox(`Đặt lại mật khẩu của ${e.full_name}? Mật khẩu mới sẽ hiển thị một lần.`, { okText: 'Đặt lại' }))) return;
          try { const x = await POST(`/api/employees/${e.id}/reset-password`, {}); dialog({ title: 'Mật khẩu mới', body: [h('p', null, `Gửi mật khẩu này cho ${e.full_name}. Nhân viên sẽ phải đổi mật khẩu khi đăng nhập.`), h('div', { class: 'code-in', style: { fontSize: '32px', fontWeight: '800', letterSpacing: '.2em', textAlign: 'center', padding: '12px', background: 'var(--canvas)', borderRadius: '10px', fontVariantNumeric: 'tabular-nums' } }, x.password)] }); } catch (ex) { toast(ex.message, 'err'); }
        } }, icon('key'), 'Đặt lại mật khẩu'),
        e.device_bound ? h('button', { class: 'btn', type: 'button', onclick: async () => { try { await POST(`/api/employees/${e.id}/reset-device`, {}); toast('Đã gỡ liên kết điện thoại', 'ok'); d.close(); done(); } catch (ex) { toast(ex.message, 'err'); } } }, icon('phone'), 'Gỡ liên kết điện thoại') : null);
    }
    const d = dialog({
      title: isNew ? 'Thêm nhân viên' : `Nhân viên ${e.code}`, wide: true,
      body: [
        h('div', { class: 'formgrid' }, field('Mã nhân viên', code, 'Dùng để đăng nhập'), field('Họ và tên', name), field('Số điện thoại', phone, 'Cũng dùng để đăng nhập'), field('Email', email),
          field('Vai trò', role), field('Phòng ban', dept), field('Chi nhánh', branch, 'Giới hạn nơi được chấm công'), field('Ca làm việc', shift),
          field('Quản lý trực tiếp', mgr, 'Người duyệt đơn'), field('Chức vụ', pos), field('Ngày vào làm', hired), field('Số ngày phép năm', leave),
          field('Lương cơ bản (đồng/tháng)', salary), field('Phụ cấp (đồng/tháng)', allow), field('Ghi chú', note), isNew ? field('Mật khẩu ban đầu', pw, 'Để trống sẽ dùng 123456. Nhân viên phải đổi khi đăng nhập lần đầu.') : null),
        h('div', null,
          h('label', { class: 'check' }, remote, 'Được chấm công từ xa (không giới hạn vị trí)'), h('br'),
          h('label', { class: 'check' }, track, 'Tính công cho nhân viên này'), isNew ? null : h('br'),
          isNew ? null : h('label', { class: 'check' }, active, 'Tài khoản đang hoạt động')),
        extra.length ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, extra) : null,
      ],
      actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save],
    });
  }

  // Đăng ký khuôn mặt cho nhân viên: chụp vài mẫu từ camera, lưu vector (không lưu ảnh)
  const FACE_SAMPLES = 3;
  function faceDialog(emp, done) {
    const samples = [];
    let stopCam = null, busy = false;
    const video = h('video', { playsinline: true, muted: true, autoplay: true, style: { width: '100%', maxWidth: '440px', aspectRatio: '4 / 3', objectFit: 'cover', transform: 'scaleX(-1)', background: '#111', borderRadius: '12px' } });
    const info = h('p', { class: 'muted', role: 'status' }, 'Đang khởi động camera...');
    const count = h('b', null, `0/${FACE_SAMPLES}`);
    const consent = h('input', { type: 'checkbox' });
    const shot = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('camera'), 'Chụp mẫu');
    const redo = h('button', { class: 'btn', type: 'button', disabled: true }, 'Làm lại');
    const save = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Lưu khuôn mặt');
    const wipe = emp.face_count ? h('button', { class: 'btn danger', type: 'button' }, icon('trash'), 'Xoá dữ liệu khuôn mặt') : null;
    const refresh = () => { count.textContent = `${samples.length}/${FACE_SAMPLES}`; redo.disabled = !samples.length; save.disabled = !(samples.length >= FACE_SAMPLES && consent.checked); };
    consent.addEventListener('change', refresh);
    const GUIDE = ['Nhìn thẳng vào camera', 'Hơi nghiêng mặt sang trái', 'Hơi nghiêng mặt sang phải'];
    const guide = () => { info.textContent = samples.length >= FACE_SAMPLES ? 'Đã đủ mẫu. Tích xác nhận đồng ý rồi bấm Lưu khuôn mặt.' : `${GUIDE[samples.length] || 'Nhìn thẳng vào camera'}, rồi bấm Chụp mẫu.`; };

    shot.addEventListener('click', async () => {
      if (busy || samples.length >= FACE_SAMPLES) return;
      busy = true; shot.disabled = true;
      try {
        const r = await CCFace.detect(video, true);
        if (!r || !r.descriptor) throw new Error('Không thấy khuôn mặt. Hãy nhìn vào camera.');
        if (r.box.w < 0.25) throw new Error('Khuôn mặt hơi nhỏ, hãy lại gần camera hơn.');
        samples.push(r.descriptor);
        refresh(); guide();
      } catch (e) { toast(e.message, 'err'); }
      busy = false; shot.disabled = samples.length >= FACE_SAMPLES;
    });
    redo.addEventListener('click', () => { samples.length = 0; shot.disabled = false; refresh(); guide(); });
    save.addEventListener('click', () => A.withBusy(save, async () => {
      try {
        await POST(`/api/employees/${emp.id}/faces`, { descriptors: samples, consent: consent.checked });
        toast('Đã lưu khuôn mặt', 'ok'); d.close(); done();
      } catch (e) { toast(e.message, 'err'); }
    }));
    if (wipe) wipe.addEventListener('click', async () => {
      if (!(await confirmBox(`Xoá toàn bộ dữ liệu khuôn mặt của ${emp.full_name}? Nhân viên sẽ không chấm công bằng khuôn mặt được nữa.`, { title: 'Xoá dữ liệu khuôn mặt', okText: 'Xoá', danger: true }))) return;
      try { await DEL(`/api/employees/${emp.id}/faces`); toast('Đã xoá dữ liệu khuôn mặt', 'ok'); d.close(); done(); } catch (e) { toast(e.message, 'err'); }
    });

    const d = dialog({
      title: `Khuôn mặt: ${emp.full_name}`,
      body: [
        h('p', { class: 'muted' }, emp.face_count ? `Đã có ${emp.face_count} mẫu. Chụp lại sẽ thay toàn bộ mẫu cũ.` : 'Chưa đăng ký khuôn mặt.'),
        video, info,
        h('p', null, 'Số mẫu đã chụp: ', count),
        h('label', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start' } }, consent, h('span', null, 'Nhân viên đã được thông báo và đồng ý cho công ty thu thập, lưu trữ dữ liệu khuôn mặt (dữ liệu sinh trắc học) để chấm công. Hệ thống chỉ lưu dãy số đặc trưng, không lưu ảnh dùng để đăng ký.')),
      ],
      actions: [wipe, redo, shot, save],
      onClose: () => { if (stopCam) stopCam(); stopCam = null; },
    });
    (async () => {
      try {
        await CCFace.load();
        stopCam = await CCFace.startCamera(video);
        if (!d.el.open) { stopCam(); stopCam = null; return; }
        shot.disabled = false; guide();
      } catch (e) { info.textContent = e.message; info.style.color = 'var(--seal, #b42318)'; }
    })();
  }

  // Xoá vĩnh viễn một nhân viên (kèm toàn bộ chấm công, đơn từ, ca làm của người đó)
  async function deleteEmployee(x, done) {
    const ok = await confirmBox(
      `Xoá vĩnh viễn ${x.full_name} (${x.code})? Toàn bộ lịch sử chấm công, đơn từ và ca làm của người này cũng bị xoá và không thể khôi phục. Nếu chỉ muốn ngừng cho đăng nhập mà vẫn giữ lịch sử, hãy bấm Sửa rồi bỏ chọn "Tài khoản đang hoạt động".`,
      { title: 'Xoá nhân viên', okText: 'Xoá vĩnh viễn', danger: true }
    );
    if (!ok) return;
    try { await DEL('/api/employees/' + x.id + '?permanent=1'); toast('Đã xoá nhân viên', 'ok'); done(); } catch (ex) { toast(ex.message, 'err'); }
  }

  const CSV_COLS = [['code', 'Mã NV'], ['full_name', 'Họ tên'], ['phone', 'Số điện thoại'], ['department', 'Phòng ban'], ['position', 'Chức vụ'], ['base_salary', 'Lương cơ bản'], ['hired_date', 'Ngày vào làm (YYYY-MM-DD)']];
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '');
  const ALIASES = { code: ['manv', 'ma', 'code', 'manhanvien'], full_name: ['hoten', 'ten', 'hovaten', 'fullname', 'name'], phone: ['sodienthoai', 'sdt', 'dienthoai', 'phone'], department: ['phongban', 'bophan', 'department'], position: ['chucvu', 'position'], base_salary: ['luongcoban', 'luong', 'salary'], hired_date: ['ngayvaolam', 'ngayvaolamyyyymmdd', 'hireddate', 'ngayvao'] };

  function importDialog(done) {
    const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', class: 'in' });
    const area = h('textarea', { class: 'in', rows: '6', placeholder: 'Hoặc dán nội dung CSV vào đây' });
    const result = h('div');
    let parsed = [];
    const parse = (text) => {
      const rows = CC.parseCsv(text.replace(/^﻿/, ''));
      if (rows.length < 2) { parsed = []; mount(result, h('p', { class: 'muted' }, 'Chưa có dòng dữ liệu. Dòng đầu tiên phải là tiêu đề cột.')); go.disabled = true; return; }
      const head = rows[0].map(norm);
      const idx = {};
      for (const [k, al] of Object.entries(ALIASES)) idx[k] = head.findIndex((x) => al.includes(x) || al.some((a) => x.startsWith(a) && a.length > 3));
      if (idx.code < 0 || idx.full_name < 0) { parsed = []; mount(result, h('div', { class: 'err' }, 'Không tìm thấy cột "Mã NV" và "Họ tên" ở dòng tiêu đề.')); go.disabled = true; return; }
      parsed = rows.slice(1).map((r) => Object.fromEntries(Object.keys(ALIASES).map((k) => [k, idx[k] >= 0 ? (r[idx[k]] || '').trim() : ''])));
      mount(result, h('p', null, `Đọc được ${parsed.length} dòng. Ví dụ: ${parsed.slice(0, 2).map((p) => `${p.code} - ${p.full_name}`).join('; ')}`));
      go.disabled = false;
    };
    file.addEventListener('change', async () => { if (file.files[0]) { const t = await file.files[0].text(); area.value = t; parse(t); } });
    area.addEventListener('input', () => parse(area.value));
    const tpl = h('button', { class: 'btn', type: 'button', onclick: () => {
      const csv = '﻿' + CSV_COLS.map((c) => c[1]).join(',') + '\n' + 'NV100,Nguyễn Văn A,0901234567,Sản xuất,Công nhân,9500000,2024-03-01\n';
      const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'mau-nhan-vien.csv' });
      document.body.append(a); a.click(); a.remove();
    } }, icon('download'), 'Tải file mẫu');
    const go = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => A.withBusy(go, async () => {
      const r = await POST('/api/employees/import', { rows: parsed });
      mount(result, h('p', null, `Đã thêm ${r.created} nhân viên.`), r.skipped.length ? A.table({ rows: r.skipped, cols: [{ label: 'Dòng', render: (x) => x.line }, { label: 'Mã', render: (x) => x.code }, { label: 'Lý do bỏ qua', render: (x) => x.reason }] }) : null);
      go.disabled = true; done();
    }) }, 'Nhập vào hệ thống');
    const d = dialog({ title: 'Nhập nhân viên từ file CSV', wide: true, body: [h('div', { class: 'note' }, 'Mở file Excel, chọn Lưu thành, định dạng "CSV UTF-8". Mật khẩu ban đầu của mọi người là 123456 và sẽ được yêu cầu đổi khi đăng nhập. Phòng ban chưa có sẽ được tạo tự động.'), tpl, file, area, result], actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Đóng'), go] });
  }

  A.register({
    id: 'employees', label: 'Nhân viên', icon: 'users', roles: ['admin', 'manager'],
    async render(el) {
      const r = await A.refs(true);
      const search = h('input', { class: 'in', type: 'search', placeholder: 'Tìm theo tên, mã hoặc số điện thoại', 'aria-label': 'Tìm kiếm' });
      const dept = A.deptSelect(r, '');
      const inactive = h('input', { type: 'checkbox' });
      const out = h('div');
      async function load() {
        mount(out, A.loading());
        try {
          const qs = new URLSearchParams();
          if (inactive.checked) qs.set('all', '1');
          if (search.value.trim()) qs.set('search', search.value.trim());
          if (dept.value) qs.set('department_id', dept.value);
          const rows = await GET('/api/employees?' + qs);
          mount(out, h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('span', { class: 'muted' }, `${rows.length} nhân viên`)), A.table({ rows, empty: 'Không tìm thấy nhân viên nào', rowClass: (x) => (x.active ? '' : 'off'), cols: [
            { label: 'Nhân viên', render: (x) => A.person(x) },
            { label: 'Vai trò', render: (x) => h('span', { class: 'chip ' + (x.role === 'admin' ? 'stamp' : x.role === 'manager' ? 'ok' : '') }, ROLE[x.role]) },
            { label: 'Chức vụ', render: (x) => x.position || '' },
            { label: 'Ca làm việc', render: (x) => x.shift_name || h('span', { class: 'muted' }, 'Mặc định') },
            { label: 'Chi nhánh', render: (x) => x.branch_name || h('span', { class: 'muted' }, 'Mọi nơi') },
            { label: 'Điện thoại', render: (x) => x.phone || '' },
            { label: 'Trạng thái', render: (x) => (x.active ? [x.track ? null : h('span', { class: 'chip' }, 'Không tính công'), x.allow_remote ? h('span', { class: 'chip stamp' }, 'Từ xa') : null, x.device_bound ? h('span', { class: 'chip' }, 'Đã gắn máy') : null] : h('span', { class: 'chip seal' }, 'Đã khoá')) },
            ...(A.isAdmin() ? [{ label: '', cls: 'r act', render: (x) => h('div', { class: 'acts' },
              h('button', { class: 'btn sm', type: 'button', onclick: () => employeeDialog(r, x, async () => { await A.refs(true); load(); }) }, icon('edit'), 'Sửa'),
              h('button', { class: 'btn sm', type: 'button', title: x.face_count ? 'Khuôn mặt: đã đăng ký' : 'Đăng ký khuôn mặt', 'aria-label': `Khuôn mặt của ${x.full_name}`, onclick: () => faceDialog(x, reload) }, icon('camera'), x.face_count ? '✓' : null),
              x.id === A.st.user.id ? null : h('button', { class: 'btn sm danger', type: 'button', 'aria-label': `Xoá ${x.full_name}`, onclick: () => deleteEmployee(x, reload) }, icon('trash'), 'Xoá')) }] : [])] })));
        } catch (e) { mount(out, A.errorBox(e, load)); }
      }
      const reload = async () => { await A.refs(true); load(); };
      dept.addEventListener('change', load); inactive.addEventListener('change', load); search.addEventListener('input', CC.debounce(load, 300));
      mount(el,
        A.pageHead('Nhân viên', A.isAdmin() ? 'Thêm, sửa, khoá tài khoản và đặt lại mật khẩu' : 'Danh sách nhân viên thuộc quyền quản lý của bạn',
          A.isAdmin() ? h('button', { class: 'btn', type: 'button', onclick: () => importDialog(reload) }, icon('download'), 'Nhập từ file CSV') : null,
          A.isAdmin() ? h('button', { class: 'btn primary', type: 'button', onclick: () => employeeDialog(r, null, reload) }, icon('plus'), 'Thêm nhân viên') : null),
        h('div', { class: 'filters' }, h('div', { class: 'field grow' }, h('span', { class: 'lbl' }, 'Tìm kiếm'), search), h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Phòng ban'), dept), h('label', { class: 'check', style: { minHeight: '40px' } }, inactive, 'Hiện cả tài khoản đã khoá')),
        out);
      await load();
    },
  });

  /* ================= Xếp ca ================= */
  const SHIFT_COLORS = ['#4034a8', '#17794b', '#b86a00', '#0b6e99', '#a63d8a', '#5b6b2f'];

  A.register({
    id: 'schedule', label: 'Xếp ca', icon: 'swap', roles: ['admin'],
    async render(el) {
      const r = await A.refs(true);
      const S = await GET('/api/settings');
      const shiftById = new Map(r.shifts.map((s, i) => [s.id, { ...s, color: SHIFT_COLORS[i % SHIFT_COLORS.length] }]));
      const defShift = shiftById.get(Number(S.default_shift_id));
      let start = CC.monday(CC.todayStr());
      const days = 14;
      const dept = A.deptSelect(r, '');
      const out = h('div');
      const nav = h('div');
      const short = (s) => `${Number(s.start_time.slice(0, 2))}-${Number(s.end_time.slice(0, 2))}`;

      async function load() {
        const end = CC.addDays(start, days - 1);
        mount(nav, h('div', { class: 'monthnav' },
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tuần trước', onclick: () => { start = CC.addDays(start, -7); load(); } }, icon('left')),
          h('b', { style: { minWidth: '170px' } }, `${fmtDay(start)} - ${fmtDay(end)}/${end.slice(0, 4)}`),
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Tuần sau', onclick: () => { start = CC.addDays(start, 7); load(); } }, icon('right')),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { start = CC.monday(CC.todayStr()); load(); } }, 'Tuần này')));
        mount(out, A.loading());
        try {
          const emps = (await GET('/api/employees' + (dept.value ? '?department_id=' + dept.value : ''))).filter((e) => e.track);
          const sch = await GET(`/api/schedules?from=${start}&to=${end}`);
          const map = new Map(sch.map((s) => [`${s.employee_id}|${s.work_date}`, s]));
          const dates = Array.from({ length: days }, (_, i) => CC.addDays(start, i));
          const hol = new Map((await GET('/api/holidays?year=' + start.slice(0, 4))).map((x) => [x.date, x.name]));
          const effective = (e, date) => {
            const o = map.get(`${e.id}|${date}`);
            if (o) return { set: true, shift: o.shift_id ? shiftById.get(o.shift_id) : null };
            const s = (e.shift_id && shiftById.get(e.shift_id)) || defShift;
            const wd = s ? s.work_days.split(',').map(Number) : [];
            return { set: false, shift: s && wd.includes(CC.dowOf(date)) ? s : null };
          };
          if (!emps.length) { mount(out, h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('strong', null, 'Chưa có nhân viên nào để xếp ca')))); return; }
          mount(out, h('div', { class: 'panel' },
            h('div', { class: 'ph' }, h('div', { class: 'shiftkey' }, [...shiftById.values()].map((s) => h('span', null, h('i', { style: { background: s.color } }), `${s.name} (${s.start_time}-${s.end_time})`)), h('span', null, h('i', { style: { border: '1px dashed var(--line-2)' } }), 'Nghỉ'), h('span', { class: 'muted' }, 'Ô nhạt: theo ca mặc định'))),
            h('div', { class: 'tablewrap', style: { maxHeight: '70dvh' } }, h('table', { class: 'tbl ts sch' },
              h('thead', null, h('tr', null, h('th', { class: 'sticky', style: { minWidth: '200px' } }, 'Nhân viên'), dates.map((d) => h('th', { class: CC.dowOf(d) === 0 ? 'we' : '', title: hol.get(d) || '' }, fmtDay(d), h('small', null, hol.has(d) ? 'Lễ' : CC.DOW[CC.dowOf(d)]))))),
              h('tbody', null, emps.map((e) => h('tr', null, h('td', { class: 'sticky' }, h('div', { class: 'who' }, h('div', null, h('b', null, e.full_name), h('span', null, e.code)))),
                dates.map((d) => {
                  const ef = effective(e, d);
                  const b = ef.shift ? h('button', { type: 'button', class: ef.set ? 'set' : '', style: { background: ef.set ? ef.shift.color : `color-mix(in srgb, ${ef.shift.color} 16%, transparent)`, color: ef.set ? '#fff' : ef.shift.color }, 'aria-label': `${e.full_name} ${fmtDate(d)}: ${ef.shift.name}`, onclick: () => cellDialog(e, d, ef) }, short(ef.shift))
                    : h('button', { type: 'button', class: 'off', 'aria-label': `${e.full_name} ${fmtDate(d)}: nghỉ`, onclick: () => cellDialog(e, d, ef) }, ef.set ? 'Nghỉ' : '');
                  return h('td', { class: 'cell' }, b);
                }))))))));
        } catch (e) { mount(out, A.errorBox(e, load)); }
      }

      function cellDialog(e, date, ef) {
        const cur = ef.set ? (ef.shift ? String(ef.shift.id) : 'off') : 'default';
        const choices = [['default', `Theo ca mặc định${defShift ? ` (${defShift.name})` : ''}`], ...r.shifts.filter((s) => s.active).map((s) => [String(s.id), `${s.name}, ${s.start_time}-${s.end_time}`]), ['off', 'Nghỉ (không có ca)']];
        const name = 'shift-' + Math.random().toString(36).slice(2, 6);
        const radios = choices.map(([v, l]) => h('label', { class: 'check', style: { padding: '6px 0' } }, h('input', { type: 'radio', name, value: v, checked: v === cur }), l));
        const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
          const v = radios.map((x) => x.querySelector('input')).find((i) => i.checked).value;
          await PUT('/api/schedules', { employee_ids: [e.id], from: date, to: date, shift_id: v === 'default' || v === 'off' ? v : Number(v) });
          d.close(); load();
        }) }, 'Lưu');
        const d = dialog({ title: `${e.full_name}, ${CC.DOW_LONG[CC.dowOf(date)]} ${fmtDate(date)}`, body: h('div', null, radios), actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save] });
      }

      async function bulkDialog() {
        const emps = (await GET('/api/employees')).filter((e) => e.track);
        const boxes = emps.map((e) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: e.id }), `${e.code} - ${e.full_name}`));
        const all = h('input', { type: 'checkbox' });
        all.addEventListener('change', () => boxes.forEach((b) => (b.querySelector('input').checked = all.checked)));
        const from = h('input', { class: 'in', type: 'date', value: start });
        const to = h('input', { class: 'in', type: 'date', value: CC.addDays(start, 6) });
        const shiftSel = A.select([{ v: 'default', l: 'Theo ca mặc định' }, ...r.shifts.filter((s) => s.active).map((s) => ({ v: s.id, l: `${s.name}, ${s.start_time}-${s.end_time}` })), { v: 'off', l: 'Nghỉ (không có ca)' }], r.shifts[0] ? r.shifts[0].id : 'default');
        const dows = [1, 2, 3, 4, 5, 6, 0].map((w) => h('label', null, h('input', { type: 'checkbox', value: w, checked: w !== 0 }), CC.DOW[w]));
        const save = h('button', { class: 'btn primary', type: 'button', onclick: () => A.withBusy(save, async () => {
          const ids = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value));
          const res = await PUT('/api/schedules', { employee_ids: ids, from: from.value, to: to.value, shift_id: shiftSel.value === 'default' || shiftSel.value === 'off' ? shiftSel.value : Number(shiftSel.value), dows: dows.map((x) => x.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value)) });
          toast(`Đã cập nhật ${res.count} ô`, 'ok'); d.close(); load();
        }) }, 'Áp dụng');
        const d = dialog({ title: 'Xếp ca hàng loạt', wide: true, body: [
          h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Nhân viên'), h('label', { class: 'check' }, all, h('b', null, 'Chọn tất cả')), h('div', { class: 'checklist' }, boxes)),
          h('div', { class: 'grid2' }, field('Từ ngày', from), field('Đến ngày', to)),
          h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Áp dụng vào các thứ'), h('div', { class: 'dows' }, dows)),
          field('Ca làm việc', shiftSel)], actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save] });
      }

      dept.addEventListener('change', load);
      mount(el, A.pageHead('Xếp ca', 'Ca riêng của từng ngày sẽ thay cho ca mặc định của nhân viên', h('button', { class: 'btn primary', type: 'button', onclick: bulkDialog }, icon('plus'), 'Xếp ca hàng loạt')),
        h('div', { class: 'filters' }, nav, h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Phòng ban'), dept)), out);
      await load();
    },
  });

  /* ================= Bảng lương ================= */
  A.register({
    id: 'payroll', label: 'Bảng lương', icon: 'money', roles: ['admin'],
    async render(el) {
      const r = await A.refs();
      let month = CC.monthNow();
      const dept = A.deptSelect(r, '');
      const nav = h('div');
      const out = h('div');
      const qs = () => `month=${month}${dept.value ? '&department_id=' + dept.value : ''}`;
      const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => A.withBusy(exportBtn, () => CC.download('/api/payroll/export?' + qs(), `bang-luong-${month}.xlsx`)) }, icon('download'), 'Xuất Excel');
      async function load() {
        mount(nav, A.monthNav(month, (m) => { month = m; load(); }));
        mount(out, A.loading());
        try {
          const d = await GET('/api/payroll?' + qs());
          const total = d.rows.reduce((a, x) => a + x.pay.net, 0);
          const m = CC.fmtMoney;
          mount(out, h('div', { class: 'note' }, 'Bảng lương tạm tính từ công đã chốt: lương theo công, tiền làm thêm giờ, phụ cấp, trừ phạt đi muộn. Chưa gồm BHXH, BHYT, BHTN, thuế TNCN. Chỉnh hệ số OT và mức phạt trong Cài đặt.'),
            h('div', { class: 'panel' }, A.table({ rows: d.rows, empty: 'Chưa có nhân viên nào', cols: [
              { label: 'Nhân viên', render: (x) => A.person(x.employee) },
              { label: 'Lương cơ bản', cls: 'r', render: (x) => m(x.pay.base_salary) },
              { label: `Công / ${d.standard_days}`, cls: 'r', render: (x) => CC.fmtNum(x.pay.paid_days) },
              { label: 'Lương theo công', cls: 'r', render: (x) => m(x.pay.salary_by_days) },
              { label: 'OT (giờ)', cls: 'r', render: (x) => CC.fmtNum(x.pay.ot_hours) },
              { label: 'Tiền OT', cls: 'r', render: (x) => m(x.pay.ot_pay) },
              { label: 'Phụ cấp', cls: 'r', render: (x) => m(x.pay.allowance) },
              { label: 'Phạt đi muộn', cls: 'r', render: (x) => (x.pay.late_fine ? `-${m(x.pay.late_fine)}` : '0') },
              { label: 'Thực nhận (tạm tính)', cls: 'r', render: (x) => h('b', null, m(x.pay.net)) }],
            foot: h('tr', null, h('td', { colspan: '8' }, 'Tổng cộng'), h('td', { class: 'r' }, m(total))) })));
        } catch (e) { mount(out, A.errorBox(e, load)); }
      }
      dept.addEventListener('change', load);
      mount(el, A.pageHead('Bảng lương', 'Tính từ bảng công của tháng', exportBtn), h('div', { class: 'filters' }, nav, h('div', { class: 'field' }, h('span', { class: 'lbl' }, 'Phòng ban'), dept)), out);
      await load();
    },
  });
})();
