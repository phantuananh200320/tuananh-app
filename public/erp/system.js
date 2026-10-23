'use strict';
/* Hệ thống: phân quyền sử dụng các phân hệ ERP và nhật ký thao tác. Cài đặt, sao lưu, cập nhật dùng lại trang quản lý có sẵn. */
(function () {
  const { h, mount, GET, PUT, toast } = CC;
  const E = ERP;

  E.page('perms', {
    title: 'Phân quyền người dùng', allow: () => E.isAdmin(),
    async render(el) {
      const r = await GET('/api/erp/perms');
      const mods = Object.keys(r.labels);
      const holder = h('div');
      let q = '';
      function draw() {
        const k = E.norm(q);
        const rows = r.rows.filter((x) => !k || E.norm(x.full_name + ' ' + x.code).includes(k));
        mount(holder, E.table({ rows, empty: 'Không có nhân viên nào', cols: [
          { label: 'Nhân viên', render: (x) => h('div', null, h('b', null, x.full_name), h('span', { class: 'sub2' }, x.code + (x.position ? ' · ' + x.position : ''))) },
          { label: 'Vai trò', render: (x) => CC.ROLE[x.role] },
          ...mods.map((m) => ({ label: r.labels[m], cls: 'c', render: (x) => h('input', { type: 'checkbox', checked: x.modules.includes(m), disabled: x.role === 'admin', 'aria-label': `${r.labels[m]} - ${x.full_name}`,
            onchange: async (e) => {
              const next = mods.filter((mm) => (mm === m ? e.target.checked : x.modules.includes(mm)));
              try { const res = await PUT('/api/erp/perms/' + x.id, { modules: next }); x.modules = res.modules; x.custom = true; toast('Đã cập nhật quyền ' + x.full_name, 'ok'); draw(); } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message, 'err'); }
            } }) })),
          { label: 'Tài xế', cls: 'c', render: (x) => (x.driver ? E.chip('Có', 'ok') : '') },
          { label: '', render: (x) => (x.custom && x.role !== 'admin' ? h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { const res = await PUT('/api/erp/perms/' + x.id, { reset: true }); x.modules = res.modules; x.custom = false; draw(); } catch (ex) { toast(ex.message, 'err'); } } }, 'Về mặc định') : x.role === 'admin' ? E.chip('Toàn quyền', 'stamp') : E.chip('Mặc định')) },
        ] }));
      }
      const s = h('input', { class: 'in', type: 'search', placeholder: 'Tìm nhân viên...', 'aria-label': 'Tìm nhân viên' });
      s.addEventListener('input', CC.debounce(() => { q = s.value.trim(); draw(); }, 150));
      mount(el, E.head('Phân quyền người dùng', 'Chọn nhân viên được dùng từng phân hệ. Chấm công luôn dùng được với mọi tài khoản.'),
        h('div', { class: 'callout' }, E.ico('shield'), 'Mặc định: Quản trị viên toàn quyền; Quản lý dùng Quản lý, Nhập đơn, Điều hành giao hàng; Nhân viên chỉ dùng Chấm công. Tài xế xem chuyến giao của mình ở mục "Giao hàng của tôi" khi được gán ở Điều hành giao hàng → Tài xế.'),
        h('div', { class: 'panel' }, h('div', { class: 'filters' }, h('div', { class: 'field grow' }, s)), holder));
      draw();
    },
  });

  E.page('audit', {
    title: 'Nhật ký thao tác', allow: () => E.isAdmin(),
    async render(el) {
      const rows = await GET('/api/audit');
      mount(el, E.head('Nhật ký thao tác', '200 thao tác gần nhất của người dùng trong hệ thống'),
        h('div', { class: 'panel' }, E.table({ rows, empty: 'Chưa có thao tác nào', cols: [
          { label: 'Thời gian', cls: 'nw', render: (r) => CC.fmtDateTime(r.ts) }, { label: 'Người thực hiện', render: (r) => r.actor_name }, { label: 'Thao tác', render: (r) => r.action }, { label: 'Chi tiết', render: (r) => r.detail }] })));
    },
  });
})();
