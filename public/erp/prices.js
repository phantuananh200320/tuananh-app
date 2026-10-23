'use strict';
/* Bảng giá: chỉ bộ phận tài chính kế toán (và quản trị viên) xem và đặt giá.
   Giá chung cho mọi khách; bảng giá riêng (theo quận/huyện, nhóm đại lý) ghi đè giá chung cho các khách được gán. */
(function () {
  const { h, mount, GET, POST, PUT, DEL, toast, dialog, confirmBox, field } = CC;
  const E = ERP;

  E.page('prices', {
    title: 'Bảng giá', allow: () => E.can('finance'),
    async render(el) {
      let D = await GET('/api/prices');
      const holder = h('div');
      let q = '';

      // Ô nhập giá: lưu khi rời ô hoặc bấm Enter
      function priceInput(value, placeholder, onSave) {
        const inp = h('input', { class: 'in sm', type: 'number', min: 0, step: '500', value: value === null || value === undefined ? '' : value, placeholder, style: { width: '120px', textAlign: 'right' }, inputmode: 'numeric' });
        let last = inp.value;
        const save = async () => {
          if (inp.value === last) return;
          inp.style.borderColor = '';
          try { await onSave(inp.value === '' ? null : Number(inp.value)); last = inp.value; inp.style.borderColor = 'var(--green, #1ea35a)'; } catch (e) { toast(e.message, 'err'); inp.style.borderColor = 'var(--red, #d6232a)'; }
        };
        inp.addEventListener('change', save);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
        return inp;
      }
      const itemPrice = (lid, pid) => { const r = D.items.find((x) => x.list_id === lid && x.product_id === pid); return r ? r.price : null; };

      function draw() {
        const k = E.norm(q);
        const rows = D.products.filter((p) => !k || E.norm(p.name + ' ' + p.code + ' ' + p.group_name).includes(k));
        const noPrice = D.products.filter((p) => p.active && !p.price).length;
        const cols = [
          { label: 'Mã', cls: 'nw', render: (p) => p.code },
          { label: 'Sản phẩm', render: (p) => h('div', null, h('b', null, p.name), h('span', { class: 'sub2' }, `${p.group_name}${p.spec ? ' · ' + p.spec : ''}`)) },
          { label: 'ĐVT', render: (p) => p.unit },
          { label: 'Giá chung (đ)', cls: 'r', render: (p) => priceInput(p.price, '0', async (v) => { await PUT(`/api/prices/product/${p.id}`, { price: v || 0 }); p.price = v || 0; }) },
          ...D.lists.map((l) => ({
            label: h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center', justifyContent: 'flex-end' } }, l.name, h('button', { class: 'btn sm ghost icon', type: 'button', 'aria-label': 'Sửa bảng giá ' + l.name, onclick: () => listDialog(l) }, E.ico('edit'))),
            cls: 'r',
            render: (p) => priceInput(itemPrice(l.id, p.id), 'giá chung', async (v) => {
              await PUT('/api/prices/item', { list_id: l.id, product_id: p.id, price: v });
              D.items = D.items.filter((x) => !(x.list_id === l.id && x.product_id === p.id));
              if (v !== null) D.items.push({ list_id: l.id, product_id: p.id, price: v });
            }),
          })),
        ];
        mount(holder, noPrice ? h('div', { class: 'callout', style: { margin: '10px 14px' } }, E.ico('tag'), `${noPrice} sản phẩm đang bán chưa có giá chung. Đơn đặt các sản phẩm này sẽ có giá 0 cho tới khi bạn đặt giá rồi bấm "Áp giá cho đơn".`) : null,
          E.table({ rows, cols, rowClass: (p) => (p.active ? '' : 'off') }));
      }

      function listDialog(l) {
        const name = h('input', { class: 'in', value: l ? l.name : '', placeholder: 'Ví dụ: Quận 7 - Nhà Bè, Đại lý cấp 1' });
        const note = h('input', { class: 'in', value: l ? l.note : '' });
        const copy = h('input', { type: 'checkbox', checked: true });
        const save = h('button', { class: 'btn primary', type: 'button' }, 'Lưu');
        const acts = [];
        if (l) acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!(await confirmBox(`Xoá bảng giá "${l.name}"? ${l.customers} khách đang dùng bảng giá này sẽ quay về giá chung.`, { danger: true, okText: 'Xoá' }))) return;
          try { await DEL('/api/price-lists/' + l.id); d.close(); reload(); } catch (e) { toast(e.message, 'err'); }
        } }, E.ico('trash'), 'Xoá'));
        acts.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save);
        const d = dialog({ title: l ? 'Sửa bảng giá' : 'Thêm bảng giá riêng', actions: acts, body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
          field('Tên bảng giá', name), field('Ghi chú', note),
          l ? h('p', { class: 'muted' }, `${l.customers} khách hàng đang dùng. Gán bảng giá cho khách ở Quản lý → Khách hàng đại lý.`) : h('label', { class: 'check' }, copy, 'Chép sẵn giá chung hiện tại vào bảng giá mới')) });
        save.onclick = () => E.busy(save, async () => {
          if (l) await PUT('/api/price-lists/' + l.id, { name: name.value, note: note.value });
          else await POST('/api/price-lists', { name: name.value, note: note.value, copy_base: copy.checked });
          d.close(); reload();
        });
        setTimeout(() => name.focus(), 30);
      }
      async function reload() { D = await GET('/api/prices'); E.refs.clear(); drawTop(); draw(); }

      const showSw = h('input', { type: 'checkbox', checked: D.app_show_price, onchange: async (e) => {
        try { await PUT('/api/erp/app-config', { app_show_price: e.target.checked }); toast(e.target.checked ? 'Khách đại lý đã thấy giá trên app' : 'Đã ẩn giá trên app của khách', 'ok'); } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message, 'err'); }
      } });
      const top = h('div');
      function drawTop() {
        showSw.checked = D.app_show_price;
        mount(top, h('div', { class: 'panel' }, h('div', { class: 'pb', style: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' } },
          h('label', { class: 'check' }, showSw, 'Hiển thị giá cho khách đại lý trên app đặt hàng'),
          h('span', { class: 'muted' }, `${D.lists.length} bảng giá riêng · nhân viên không có quyền tài chính không thấy giá ở bất kỳ màn hình nào`))));
      }
      const applyZero = h('button', { class: 'btn', type: 'button', onclick: () => E.busy(applyZero, async () => { const r = await POST('/api/prices/apply', { only_zero: true }); toast(`Đã áp giá cho ${r.updated} đơn`, 'ok'); }) }, E.ico('refresh'), 'Áp giá cho đơn chưa có giá');
      const applyAll = h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmBox('Áp giá hiện hành cho TẤT CẢ đơn chưa chốt hoá đơn (kể cả đơn đã giao)? Giá đã sửa riêng trên từng đơn cũng bị thay bằng giá bảng giá.', { okText: 'Áp giá' }))) return;
        E.busy(applyAll, async () => { const r = await POST('/api/prices/apply', { only_zero: false }); toast(`Đã cập nhật giá ${r.updated} đơn`, 'ok'); });
      } }, 'Áp lại giá mới cho đơn chưa chốt');
      const s = h('input', { class: 'in', type: 'search', placeholder: 'Tìm sản phẩm...', 'aria-label': 'Tìm sản phẩm' });
      s.addEventListener('input', CC.debounce(() => { q = s.value.trim(); draw(); }, 150));
      mount(el, E.head('Bảng giá', 'Giá bán cho đại lý theo đơn vị tính. Bỏ trống ô bảng giá riêng = dùng giá chung.', applyZero, applyAll, h('button', { class: 'btn primary', type: 'button', onclick: () => listDialog(null) }, E.ico('plus'), 'Thêm bảng giá riêng')),
        top, h('div', { class: 'panel' }, h('div', { class: 'filters' }, h('div', { class: 'field grow' }, s)), holder));
      drawTop(); draw();
    },
  });
})();
