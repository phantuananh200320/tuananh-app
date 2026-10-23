'use strict';
/* Quản lý: khách hàng, sản phẩm và bảng giá, màn hình chấm công tại quầy (QR / khuôn mặt). */
(function () {
  const { h, mount, GET, POST, PUT, DEL, toast, dialog, confirmBox, field } = CC;
  const E = ERP;
  const num = (v) => (v === '' ? 0 : Number(v));

  /* ---------- Khách hàng đại lý ---------- */
  const appUrl = () => `${location.origin}/dl/`;

  // Cấp hoặc đặt lại mật khẩu app đặt hàng, hiện mật khẩu một lần để gửi cho khách
  async function appAccount(c, done, opts = {}) {
    const login = h('input', { class: 'in', value: c.app_login || String(c.phone || '').replace(/\D/g, '') || c.code.toLowerCase(), autocapitalize: 'off', spellcheck: 'false' });
    const pw = h('input', { class: 'in', type: 'text', placeholder: 'Để trống để hệ thống tự tạo 6 số', autocomplete: 'off' });
    const err = h('div', { class: 'callout err', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, c.app_login ? 'Đặt lại mật khẩu' : 'Cấp tài khoản');
    const d = dialog({ title: `Tài khoản app đặt hàng · ${c.name}`, actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save],
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err, field('Tên đăng nhập', login, 'Chữ không dấu, số; thường dùng số điện thoại'), field('Mật khẩu mới', pw, 'Ít nhất 6 ký tự'),
        h('p', { class: 'muted' }, 'Đặt lại mật khẩu sẽ đăng xuất khách trên mọi điện thoại đang dùng.')) });
    save.onclick = () => E.busy(save, async () => {
      err.hidden = true;
      try {
        const r = await PUT(`/api/customers/${c.id}/app-account`, { login: login.value.trim(), password: pw.value.trim(), reset: true, active: true });
        d.close(); E.refs.clear();
        const msg = `${c.name} ơi, mời anh/chị đặt hàng tại ${appUrl()}\nTên đăng nhập: ${r.login}\nMật khẩu: ${r.password}`;
        dialog({ title: 'Đã cấp tài khoản', body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          h('div', { class: 'callout ok' }, 'Mật khẩu chỉ hiện một lần. Hãy gửi cho khách ngay.'),
          h('dl', { class: 'kv' }, h('dt', null, 'Đường dẫn app'), h('dd', null, appUrl()), h('dt', null, 'Tên đăng nhập'), h('dd', null, h('b', null, r.login)), h('dt', null, 'Mật khẩu'), h('dd', null, h('b', { style: { fontSize: '18px', letterSpacing: '.08em' } }, r.password))),
          h('button', { class: 'btn primary', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(msg); toast('Đã chép tin nhắn, dán gửi Zalo/SMS cho khách', 'ok'); } catch { toast('Không chép được, hãy chép thủ công', 'err'); } } }, 'Chép tin nhắn gửi khách')) });
        if (done) done();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    if (opts.focus !== false) setTimeout(() => login.focus(), 30);
  }

  async function customerDialog(c, canEdit, done) {
    const isNew = !c.id;
    const sees = E.sees();
    let lists = [];
    if (sees) { try { lists = (await GET('/api/prices')).lists; } catch { lists = []; } }
    const f = {
      code: h('input', { class: 'in', value: c.code || '', disabled: !isNew || !canEdit, placeholder: 'Để trống để tự sinh mã' }),
      name: h('input', { class: 'in', value: c.name || '', disabled: !canEdit }),
      phone: h('input', { class: 'in', value: c.phone || '', inputmode: 'tel', disabled: !canEdit }),
      contact: h('input', { class: 'in', value: c.contact || '', disabled: !canEdit }),
      area: h('input', { class: 'in', value: c.area || '', disabled: !canEdit, placeholder: 'Quận/huyện, ví dụ: Quận 7' }),
      tax: h('input', { class: 'in', value: c.tax_code || '', disabled: !canEdit }),
      email: h('input', { class: 'in', value: c.email || '', type: 'email', disabled: !canEdit }),
      address: h('input', { class: 'in', value: c.address || '', disabled: !canEdit }),
      opening: h('input', { class: 'in', type: 'number', step: '1000', value: c.opening_debt || 0, disabled: !canEdit }),
      limit: h('input', { class: 'in', type: 'number', min: 0, step: '1000', value: c.credit_limit || 0, disabled: !canEdit }),
      list: E.select(lists.map((l) => ({ v: l.id, l: l.name })), c.price_list_id || '', { placeholder: 'Giá chung' }),
      note: h('textarea', { class: 'in', disabled: !canEdit }, c.note || ''),
      active: h('input', { type: 'checkbox', checked: c.active !== 0, disabled: !canEdit }),
    };
    const err = h('div', { class: 'callout err', hidden: true, role: 'alert' });
    const appBox = c.id && canEdit ? h('div', { class: 'callout' + (c.app_login ? (c.app_active ? ' ok' : ' err') : '') }, E.ico('phone'),
      h('span', { style: { flex: 1 } }, c.app_login ? `App đặt hàng: ${c.app_login}${c.app_active ? '' : ' (đang khoá)'}` : 'Chưa có tài khoản app đặt hàng'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { d.close(); appAccount(c, done); } }, c.app_login ? 'Đặt lại mật khẩu' : 'Cấp tài khoản'),
      c.app_login ? h('button', { class: 'btn sm ghost', type: 'button', onclick: async () => { try { await PUT(`/api/customers/${c.id}/app-account`, { login: c.app_login, active: !c.app_active }); toast(c.app_active ? 'Đã khoá tài khoản app' : 'Đã mở khoá tài khoản app', 'ok'); d.close(); done(); } catch (e) { toast(e.message, 'err'); } } }, c.app_active ? 'Khoá' : 'Mở khoá') : null) : null;
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err,
      h('div', { class: 'grid2' }, field('Mã khách hàng', f.code), field('Tên đại lý / cửa hàng', f.name)),
      h('div', { class: 'grid2' }, field('Điện thoại', f.phone), field('Người liên hệ', f.contact)),
      h('div', { class: 'grid2' }, field('Khu vực', f.area), field('Mã số thuế', f.tax)),
      field('Địa chỉ giao hàng mặc định', f.address),
      sees ? h('div', { class: 'grid3' }, field('Bảng giá áp dụng', f.list), field('Nợ đầu kỳ (đ)', f.opening), field('Hạn mức công nợ (đ)', f.limit, '0 = không giới hạn')) : null,
      field('Ghi chú', f.note),
      c.id ? h('label', { class: 'check' }, f.active, 'Đang giao dịch') : null,
      appBox,
      c.id && sees ? h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', null, 'Công nợ hiện tại'), h('b', { class: c.debt > 0 ? 'neg' : '' }, E.money(c.debt))),
        h('div', { class: 'stat' }, h('span', null, 'Số đơn hàng'), h('b', null, String(c.order_count)))) : null);
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Lưu');
    const acts = [];
    if (c.id && E.can('finance')) acts.push(h('button', { class: 'btn', type: 'button', onclick: () => { d.close(); E.go('ledger/' + c.id); } }, E.ico('list'), 'Sổ công nợ'));
    if (c.id && canEdit) acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!(await confirmBox(`Xoá khách hàng "${c.name}"? Nếu đã có đơn hàng, khách hàng sẽ chuyển sang ngừng giao dịch.`, { danger: true, okText: 'Xoá' }))) return;
      try { await DEL('/api/customers/' + c.id); E.refs.clear(); d.close(); done(); } catch (e) { toast(e.message, 'err'); }
    } }, E.ico('trash'), 'Xoá'));
    acts.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, canEdit ? 'Huỷ' : 'Đóng'));
    if (canEdit || sees) acts.push(save);
    const d = dialog({ title: isNew ? 'Thêm khách hàng đại lý' : c.name, body, actions: acts, wide: true });
    save.onclick = () => E.busy(save, async () => {
      err.hidden = true;
      const payload = { code: f.code.value, name: f.name.value, phone: f.phone.value, contact: f.contact.value, email: f.email.value, tax_code: f.tax.value, address: f.address.value, area: f.area.value,
        opening_debt: num(f.opening.value), credit_limit: num(f.limit.value), note: f.note.value, active: f.active.checked };
      try {
        let id = c.id;
        if (canEdit) { const r = isNew ? await POST('/api/customers', payload) : await PUT('/api/customers/' + c.id, payload); id = r.id; }
        if (sees && String(f.list.value || '') !== String(c.price_list_id || '')) await PUT(`/api/customers/${id}/price-list`, { price_list_id: f.list.value || null });
        E.refs.clear(); d.close(); toast('Đã lưu khách hàng', 'ok'); done();
        if (isNew && canEdit && await confirmBox('Cấp luôn tài khoản app đặt hàng cho khách này?', { okText: 'Cấp tài khoản' })) appAccount(await GET('/api/customers/' + id), done);
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    setTimeout(() => f.name.focus(), 30);
  }

  function appConfigDialog() {
    GET('/api/erp/app-config').then((c) => {
      const cut = h('input', { class: 'in', type: 'number', min: 0, max: 23, value: c.app_cutoff_hour });
      const max = h('input', { class: 'in', type: 'number', min: 1, max: 60, value: c.app_max_days });
      const notice = h('textarea', { class: 'in', placeholder: 'Ví dụ: Nghỉ Tết từ 28/1 đến 4/2, đơn sau ngày 27/1 giao từ 5/2' }, c.app_notice);
      const save = h('button', { class: 'btn primary', type: 'button' }, 'Lưu');
      const d = dialog({ title: 'Cài đặt app đặt hàng', actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save], body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div', { class: 'callout' }, E.ico('ext'), 'Đường dẫn cho khách: ', h('b', null, appUrl())),
        h('div', { class: 'grid2' }, field('Giờ chốt đơn trong ngày', cut, 'Đặt sau giờ này thì giao sớm nhất ngày mai. 0 = không chốt'), field('Đặt trước tối đa (ngày)', max)),
        field('Thông báo hiển thị trên app', notice),
        h('p', { class: 'muted' }, c.app_show_price ? 'Khách đang thấy giá trên app (tài chính bật ở Bảng giá).' : 'Khách không thấy giá trên app. Chỉ bộ phận tài chính bật được ở Tài chính → Bảng giá.')) });
      save.onclick = () => E.busy(save, async () => { await PUT('/api/erp/app-config', { app_cutoff_hour: Number(cut.value), app_max_days: Number(max.value), app_notice: notice.value }); d.close(); toast('Đã lưu cài đặt app', 'ok'); });
    }).catch((e) => toast(e.message, 'err'));
  }

  E.page('customers', {
    title: 'Khách hàng đại lý',
    allow: () => E.can('manage', 'orders', 'delivery', 'finance'),
    async render(el, arg) {
      const canEdit = E.can('manage');
      const sees = E.sees();
      let search = '';
      let showAll = false;
      const holder = h('div');
      const sInput = h('input', { class: 'in', type: 'search', placeholder: 'Tìm theo tên, mã, điện thoại...', 'aria-label': 'Tìm khách hàng' });
      async function load() {
        mount(holder, E.loading());
        try {
          const rows = await GET(`/api/customers?all=${showAll ? 1 : 0}&search=${encodeURIComponent(search)}`);
          mount(holder, E.table({
            rows, empty: 'Chưa có khách hàng nào',
            rowClass: (r) => (r.active ? '' : 'off'),
            cols: [
              { label: 'Mã', render: (r) => r.code, cls: 'nw' },
              { label: 'Đại lý', render: (r) => h('div', null, h('a', { class: 'lnk', href: '#', onclick: (ev) => { ev.preventDefault(); open(r.id); } }, r.name), r.contact ? h('span', { class: 'sub2' }, r.contact) : null) },
              { label: 'Khu vực', render: (r) => r.area || '' },
              { label: 'Điện thoại', render: (r) => r.phone, cls: 'nw' },
              { label: 'Địa chỉ', render: (r) => r.address },
              { label: 'App', render: (r) => (r.app_login ? (r.app_active ? E.chip('Có', 'ok') : E.chip('Khoá', 'seal')) : E.chip('Chưa')) },
              { label: 'Số đơn', render: (r) => String(r.order_count), cls: 'r' },
              ...(sees ? [{ label: 'Công nợ', render: (r) => h('span', { class: r.debt > 0 ? (r.credit_limit && r.debt > r.credit_limit ? 'neg' : '') : r.debt < 0 ? 'pos' : 'muted' }, E.money(r.debt)), cls: 'r nw' }] : []),
              { label: '', render: (r) => h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => open(r.id) }, canEdit ? 'Sửa' : 'Xem'), r.active && E.can('orders') ? h('a', { class: 'btn sm primary', href: '#/order-new/' + r.id }, 'Lên đơn') : null) },
            ],
            foot: h('tr', null, h('td', { colspan: sees ? 7 : 8 }, `${rows.length} khách hàng`), sees ? h('td', { class: 'r', colspan: 2 }, 'Tổng phải thu: ' + E.money(rows.reduce((s2, r) => s2 + Math.max(0, r.debt), 0))) : null),
          }));
        } catch (e) { mount(holder, E.errorBox(e, load)); }
      }
      async function open(id) {
        try { const c = await GET('/api/customers/' + id); customerDialog(c, canEdit, load); } catch (e) { toast(e.message, 'err'); }
      }
      sInput.addEventListener('input', CC.debounce(() => { search = sInput.value.trim(); load(); }, 250));
      mount(el,
        E.head('Khách hàng đại lý', 'Danh sách đại lý, khu vực, tài khoản app đặt hàng',
          h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(appUrl()); toast('Đã chép đường dẫn app đặt hàng: ' + appUrl(), 'ok'); } catch { toast(appUrl(), 'ok'); } } }, E.ico('ext'), 'Link app đặt hàng'),
          E.can('manage', 'finance') ? h('button', { class: 'btn', type: 'button', onclick: appConfigDialog }, E.ico('settings'), 'Cài đặt app') : null,
          canEdit ? h('button', { class: 'btn primary', type: 'button', onclick: () => customerDialog({ active: 1 }, true, load) }, E.ico('plus'), 'Thêm đại lý') : null),
        h('div', { class: 'panel' }, h('div', { class: 'filters' }, h('div', { class: 'field grow' }, sInput),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { showAll = e.target.checked; load(); } }), 'Hiện cả khách đã ngừng giao dịch')), holder));
      await load();
      if (arg && /^\d+$/.test(arg)) open(arg);
    },
  });

  /* ---------- Sản phẩm & quy cách ---------- */
  function productDialog(p, done) {
    const isNew = !p.id;
    const sees = E.sees();
    const f = {
      code: h('input', { class: 'in', value: p.code || '', disabled: !isNew, placeholder: 'Để trống để tự sinh mã' }),
      name: h('input', { class: 'in', value: p.name || '' }),
      group: h('input', { class: 'in', value: p.group_name || '', placeholder: 'Bún, Phở, Nui tươi...' }),
      spec: h('input', { class: 'in', value: p.spec || '', placeholder: '500gr, 500gr (1 hộp), Rời (xá)' }),
      unit: E.select([{ v: 'KG', l: 'KG' }, { v: 'HỘP', l: 'HỘP' }, { v: 'BỊCH', l: 'BỊCH' }, { v: 'GÓI', l: 'GÓI' }], p.unit || 'KG'),
      packKg: h('input', { class: 'in', type: 'number', min: 0, step: '0.1', value: p.pack_kg !== undefined ? p.pack_kg : 0.5 }),
      noun: h('input', { class: 'in', value: p.pack_noun || 'gói', placeholder: 'gói, hộp, bịch' }),
      step: h('input', { class: 'in', type: 'number', min: 0.1, step: '0.1', value: p.qty_step || 0.5 }),
      sort: h('input', { class: 'in', type: 'number', value: p.sort_no || 0 }),
      price: h('input', { class: 'in', type: 'number', min: 0, step: '500', value: p.price || 0 }),
      note: h('input', { class: 'in', value: p.note || '' }),
      active: h('input', { type: 'checkbox', checked: p.active !== 0 }),
    };
    const err = h('div', { class: 'callout err', hidden: true, role: 'alert' });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Lưu');
    const acts = [];
    if (!isNew) acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!(await confirmBox(`Xoá sản phẩm "${p.name}"? Nếu đã có trong đơn hàng, sản phẩm sẽ chuyển sang ngừng bán.`, { danger: true, okText: 'Xoá' }))) return;
      try { await DEL('/api/products/' + p.id); E.refs.clear(); d.close(); done(); } catch (e) { toast(e.message, 'err'); }
    } }, E.ico('trash'), 'Xoá'));
    acts.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save);
    const d = dialog({ title: isNew ? 'Thêm sản phẩm' : p.name, wide: true, actions: acts, body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err,
      h('div', { class: 'grid2' }, field('Mã sản phẩm', f.code), field('Nhóm hàng', f.group)), field('Tên sản phẩm', f.name),
      h('div', { class: 'grid3' }, field('Quy cách hiển thị', f.spec), field('Đơn vị tính', f.unit), field('Thứ tự hiển thị', f.sort)),
      h('div', { class: 'grid3' }, field('Khối lượng 1 gói/hộp (kg)', f.packKg, '0 = hàng rời'), field('Gọi đơn vị đóng gói là', f.noun), field('Đặt theo bội số', f.step, 'VD: 0,5 kg với gói 500gr; 5 với bịch 5kg; 1 với hộp')),
      sees ? field('Giá chung (đ / đơn vị tính)', f.price, 'Bảng giá riêng theo khu vực đặt ở Tài chính → Bảng giá') : h('p', { class: 'muted' }, 'Giá do bộ phận tài chính kế toán đặt.'),
      field('Ghi chú', f.note), isNew ? null : h('label', { class: 'check' }, f.active, 'Đang bán')) });
    save.onclick = () => E.busy(save, async () => {
      err.hidden = true;
      const payload = { code: f.code.value, name: f.name.value, group_name: f.group.value, spec: f.spec.value, unit: f.unit.value, pack_kg: num(f.packKg.value), pack_noun: f.noun.value, qty_step: num(f.step.value), sort_no: num(f.sort.value), note: f.note.value, active: f.active.checked, ...(sees ? { price: num(f.price.value) } : {}) };
      try {
        if (isNew) await POST('/api/products', payload); else await PUT('/api/products/' + p.id, payload);
        E.refs.clear(); d.close(); toast('Đã lưu sản phẩm', 'ok'); done();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    setTimeout(() => f.name.focus(), 30);
  }

  E.page('products', {
    title: 'Sản phẩm & quy cách',
    allow: () => E.can('manage', 'orders', 'delivery', 'finance', 'warehouse'),
    async render(el) {
      const canEdit = E.can('manage');
      const sees = E.sees();
      let search = '';
      const holder = h('div');
      const sInput = h('input', { class: 'in', type: 'search', placeholder: 'Tìm theo tên, mã, nhóm...', 'aria-label': 'Tìm sản phẩm' });
      let all = [];
      const fq = (n) => String(n).replace('.', ',');
      function draw() {
        const k = E.norm(search);
        const rows = all.filter((p) => !k || E.norm(p.name + ' ' + p.code + ' ' + p.group_name).includes(k));
        mount(holder, E.table({ rows, empty: 'Chưa có sản phẩm nào', rowClass: (r) => (r.active ? '' : 'off'), cols: [
          { label: 'Mã', render: (r) => r.code, cls: 'nw' },
          { label: 'Sản phẩm', render: (r) => h('div', null, h('b', null, r.name), r.note ? h('span', { class: 'sub2' }, r.note) : null) },
          { label: 'Nhóm', render: (r) => r.group_name },
          { label: 'Quy cách', render: (r) => r.spec },
          { label: 'ĐVT', render: (r) => r.unit },
          { label: 'Đặt theo', render: (r) => (r.pack_kg ? `bội ${fq(r.qty_step)} ${r.unit} (${r.pack_noun} ${r.pack_kg < 1 ? r.pack_kg * 1000 + 'gr' : fq(r.pack_kg) + 'kg'})` : `bội ${fq(r.qty_step)} ${r.unit}, hàng rời`) },
          ...(sees ? [{ label: 'Giá chung', render: (r) => (r.price ? E.money(r.price) : h('span', { class: 'neg' }, 'Chưa có giá')), cls: 'r nw' }] : []),
          { label: '', render: (r) => (canEdit ? h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => productDialog(r, load) }, 'Sửa')) : '') },
        ] }));
      }
      async function load() {
        mount(holder, E.loading());
        try { all = await GET('/api/products?all=1'); draw(); } catch (e) { mount(holder, E.errorBox(e, load)); }
      }
      sInput.addEventListener('input', CC.debounce(() => { search = sInput.value.trim(); draw(); }, 150));
      mount(el, E.head('Sản phẩm & quy cách', 'Danh mục hàng, quy cách đóng gói và bước đặt hàng', sees ? h('a', { class: 'btn', href: '#/prices' }, E.ico('tag'), 'Bảng giá') : null, canEdit ? h('button', { class: 'btn primary', type: 'button', onclick: () => productDialog({ active: 1, unit: 'KG', pack_kg: 0.5, qty_step: 0.5, pack_noun: 'gói' }, load) }, E.ico('plus'), 'Thêm sản phẩm') : null),
        h('div', { class: 'panel' }, h('div', { class: 'filters' }, h('div', { class: 'field grow' }, sInput)), holder));
      await load();
    },
  });

  /* ---------- Màn hình chấm công tại quầy ---------- */
  E.page('kiosk', {
    title: 'Màn hình QR / khuôn mặt',
    allow: () => E.isMgr(),
    async render(el) {
      const branches = (await GET('/api/branches')).filter((b) => b.active !== 0);
      const url = (b) => `${location.origin}/kiosk/?key=${b.kiosk_key}`;
      mount(el, E.head('Màn hình chấm công tại quầy', 'Mở trang này trên iPad, tablet hoặc TV đặt tại cổng. Nhân viên quét mã QR hoặc nhìn vào camera để chấm công.'),
        h('div', { class: 'panel' }, E.table({ rows: branches, empty: 'Chưa có chi nhánh nào', cols: [
          { label: 'Chi nhánh', render: (b) => h('div', null, h('b', null, b.name), b.address ? h('span', { class: 'sub2' }, b.address) : null) },
          { label: 'Đường dẫn', render: (b) => h('code', { style: { fontSize: '12.5px', wordBreak: 'break-all' } }, url(b)) },
          { label: '', render: (b) => h('div', { class: 'acts' },
            h('button', { class: 'btn sm', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url(b)); toast('Đã chép đường dẫn', 'ok'); } catch { toast('Không chép được, hãy chép thủ công', 'err'); } } }, 'Chép'),
            h('a', { class: 'btn sm primary', href: url(b), target: '_blank', rel: 'noopener' }, E.ico('ext'), 'Mở màn hình')) },
        ] })),
        h('p', { class: 'muted' }, 'Bật nhận diện khuôn mặt và màn hình chờ ở ', h('a', { href: '#/e/settings' }, 'Cài đặt'), '; đăng ký khuôn mặt từng nhân viên ở ', h('a', { href: '#/e/employees' }, 'Nhân viên'), '.'));
    },
  });
})();
