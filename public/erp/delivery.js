'use strict';
/* Điều hành giao hàng: bảng điều đơn, phân bổ hàng hoá, tài xế, tuyến, lịch sử chuyến, màn hình của tài xế. */
(function () {
  const { h, mount, GET, POST, PUT, DEL, toast, dialog, confirmBox, field, fmtMoney } = CC;
  const E = ERP;
  const TRIP_ST = { planned: ['Chờ xuất phát', 'warn'], running: ['Đang chạy', 'stamp'], done: ['Hoàn thành', 'ok'] };
  const tripChip = (s) => E.chip(TRIP_ST[s][0], TRIP_ST[s][1]);

  /* ---------- Hộp thoại chuyến ---------- */
  async function tripDialog(trip, day, done) {
    const [drivers, routes] = await Promise.all([E.refs.drivers(), E.refs.routes()]);
    const driver = E.select(drivers.map((d) => ({ v: d.id, l: `${d.name}${d.plate ? ' · ' + d.plate : ''}` })), trip ? trip.driver_id : '', { placeholder: '— Chưa chọn tài xế —' });
    const route = E.select(routes.map((r) => ({ v: r.id, l: r.name })), trip ? trip.route_id : '', { placeholder: '— Chưa chọn tuyến —' });
    const note = h('input', { class: 'in', value: trip ? trip.note : '', placeholder: 'Ghi chú cho tài xế' });
    const dateIn = h('input', { class: 'in', type: 'date', value: trip ? trip.trip_date : day });
    const err = h('div', { class: 'callout err', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Lưu');
    const d = dialog({ title: trip ? 'Sửa chuyến ' + trip.code : 'Tạo chuyến giao hàng', actions: [h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save],
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err, field('Ngày giao', dateIn), field('Tài xế', driver), field('Tuyến giao hàng', route), field('Ghi chú', note),
        !drivers.length ? h('p', { class: 'muted' }, 'Chưa có tài xế nào. Hãy thêm ở mục Tài xế.') : null) });
    save.onclick = () => E.busy(save, async () => {
      const p = { trip_date: dateIn.value, driver_id: driver.value || null, route_id: route.value || null, note: note.value };
      try { const r = trip ? await PUT('/api/trips/' + trip.id, p) : await POST('/api/trips', p); d.close(); done(r); } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  }

  async function allocationDialog(tripId) {
    const t = await GET('/api/trips/' + tripId);
    const a = t.allocation;
    const per = new Map();
    for (const r of a.perOrder) { if (!per.has(r.id)) per.set(r.id, { code: r.code, customer: r.customer_name, items: [] }); per.get(r.id).items.push(r); }
    dialog({ title: `Phân bổ hàng hoá · ${t.code}`, wide: true, actions: [h('button', { class: 'btn', type: 'button', onclick: () => E.printOpen('trip', { id: tripId }) }, E.ico('print'), 'In bảng kê chuyến')],
      body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        h('div', null, h('h3', { style: { marginBottom: '8px' } }, 'Tổng hàng cần chuẩn bị'),
          E.table({ rows: a.lines, empty: 'Chuyến chưa có đơn nào', cols: [{ label: 'Sản phẩm', render: (r) => r.name }, { label: 'ĐVT', render: (r) => r.unit }, { label: 'Tổng số lượng', cls: 'r', render: (r) => h('b', null, fmtMoney(r.qty)) }, { label: 'Số đơn', cls: 'r', render: (r) => String(r.orders) }] })),
        per.size ? h('div', null, h('h3', { style: { marginBottom: '8px' } }, 'Chi tiết theo điểm giao'), E.table({ rows: [...per.values()], cols: [
          { label: 'Đơn', cls: 'nw', render: (o) => o.code }, { label: 'Khách hàng', render: (o) => o.customer }, { label: 'Hàng hoá', render: (o) => o.items.map((i) => `${i.name} ×${fmtMoney(i.qty)} ${i.unit}`).join(', ') }] })) : null) });
  }

  /* ---------- Bảng điều đơn ---------- */
  E.page('delivery', {
    title: 'Bảng điều đơn', nav: 'delivery', allow: () => E.can('delivery'),
    async render(el, arg) {
      let day = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : CC.todayStr();
      const sel = new Set();
      const body = h('div');
      const dateIn = h('input', { class: 'in', type: 'date', value: day, 'aria-label': 'Ngày giao', onchange: (e) => { if (e.target.value) { day = e.target.value; sel.clear(); load(); } } });
      const shift = (n) => { day = CC.addDays(day, n); dateIn.value = day; sel.clear(); load(); };

      async function load() {
        mount(body, E.loading());
        try { draw(await GET('/api/delivery/board?date=' + day)); } catch (e) { mount(body, E.errorBox(e, load)); }
      }

      function draw(b) {
        const openTrips = b.trips.filter((t) => t.status !== 'done');
        const target = E.select(openTrips.map((t) => ({ v: t.id, l: `${t.code} · ${t.driver_name || 'chưa có tài xế'}` })), openTrips[0] ? openTrips[0].id : '', { placeholder: openTrips.length ? undefined : 'Chưa có chuyến', cls: 'sm' });
        const assign = h('button', { class: 'btn sm primary', type: 'button', disabled: !openTrips.length }, 'Gán vào chuyến');
        assign.onclick = () => E.busy(assign, async () => {
          if (!sel.size) return toast('Hãy chọn đơn cần điều', 'err');
          await POST(`/api/trips/${target.value}/assign`, { order_ids: [...sel] });
          sel.clear(); toast('Đã gán đơn vào chuyến', 'ok'); load();
        });
        const newTrip = h('button', { class: 'btn sm', type: 'button', onclick: () => tripDialog(null, day, async (t) => { if (sel.size) await POST(`/api/trips/${t.id}/assign`, { order_ids: [...sel] }); sel.clear(); load(); }) }, E.ico('plus'), sel.size ? 'Tạo chuyến & gán' : 'Tạo chuyến');

        const left = h('div', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', null, `Đơn chờ điều (${b.unassigned.length})`),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: b.unassigned.length && sel.size === b.unassigned.length, onchange: (e) => { b.unassigned.forEach((o) => (e.target.checked ? sel.add(o.id) : sel.delete(o.id))); draw(b); } }), 'Chọn tất cả')),
          sel.size ? h('div', { class: 'callout', style: { margin: '10px 12px 0', flexWrap: 'wrap' } }, h('b', null, `${sel.size} đơn`), target, assign) : null,
          b.unassigned.length ? b.unassigned.map((o) => h('div', { class: 'ocard' },
            h('input', { type: 'checkbox', checked: sel.has(o.id), 'aria-label': 'Chọn ' + o.code, style: { marginTop: '4px' }, onchange: (e) => { if (e.target.checked) sel.add(o.id); else sel.delete(o.id); draw(b); } }),
            h('div', { class: 'body2' }, h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('a', { class: 'lnk', href: '#/order/' + o.code }, o.code), E.statusChip(o.status)),
              h('b', null, o.customer_name), h('span', null, o.address || 'Chưa có địa chỉ'), h('span', null, `${o.item_count} mặt hàng${o.total !== undefined ? ' · ' + E.money(o.total) : ''}${o.delivery_date < day ? ' · TRỄ HẸN ' + E.dmy(o.delivery_date) : ''}`), h('div', { style: { display: 'flex', gap: '4px', marginTop: '3px' } }, o.checked_at ? E.chip('Đã check in', 'ok') : E.chip('Chưa check in', 'warn'), E.srcChip(o.source))))) : h('div', { class: 'empty' }, h('strong', null, 'Không còn đơn nào chờ điều'), 'Các đơn cần giao đã được gán chuyến.'));

        const trips = b.trips.length ? b.trips.map((t) => tripCard(t, b)) : [h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('strong', null, 'Chưa có chuyến giao nào trong ngày'), 'Bấm "Tạo chuyến", chọn tài xế và tuyến, rồi gán đơn vào chuyến.'))];
        const un = b.trips.reduce((s, t) => s + t.order_count, 0);
        mount(body, h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('span', null, 'Số chuyến'), h('b', null, String(b.trips.length))),
          h('div', { class: 'stat' }, h('span', null, 'Đơn đã gán chuyến'), h('b', null, String(un))),
          h('div', { class: 'stat' }, h('span', null, 'Chờ điều đã check in'), h('b', null, String(b.unassigned.filter((o) => o.checked_at).length))),
          h('div', { class: 'stat' + (b.unassigned.length ? ' warn' : '') }, h('span', null, 'Đơn chờ điều'), h('b', null, String(b.unassigned.length)))),
        h('div', { class: 'board', style: { marginTop: '14px' } }, left, h('div', null, h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' } }, newTrip), trips)));
      }

      function tripCard(t, b) {
        const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); load(); } catch (e) { toast(e.message, 'err'); } };
        const finish = async () => {
          try { await POST(`/api/trips/${t.id}/finish`, {}); toast('Chuyến đã hoàn thành', 'ok'); load(); } catch (e) {
            if (e.code === 'OPEN_ORDERS' && await confirmBox(e.message + '\n\nĐánh dấu tất cả đơn còn lại là đã giao và hoàn thành chuyến?', { okText: 'Đã giao hết' })) await act(() => POST(`/api/trips/${t.id}/finish`, { mark_delivered: true }), 'Chuyến đã hoàn thành');
            else if (e.code !== 'OPEN_ORDERS') toast(e.message, 'err');
          }
        };
        const move = (i, dir) => {
          const ids = t.orders.map((o) => o.id);
          [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
          act(() => POST(`/api/trips/${t.id}/reorder`, { order_ids: ids }));
        };
        const editable = t.status !== 'done';
        return h('div', { class: 'panel trip' },
          h('div', { class: 'th' }, E.ico('truck'),
            h('div', { class: 't' }, h('b', null, `${t.code} · ${t.driver_name || 'Chưa chọn tài xế'}`), h('span', null, `${t.route_name || 'Chưa chọn tuyến'}${t.driver_plate ? ' · ' + t.driver_plate : ''}${t.note ? ' · ' + t.note : ''}`)),
            tripChip(t.status),
            h('div', { class: 'acts' },
              h('button', { class: 'btn sm', type: 'button', onclick: () => allocationDialog(t.id) }, E.ico('box'), 'Phân bổ hàng'),
              h('button', { class: 'btn sm', type: 'button', onclick: () => E.printOpen('trip', { id: t.id }) }, E.ico('print'), 'In bảng kê'),
              editable ? h('button', { class: 'btn sm', type: 'button', onclick: () => tripDialog(t, day, load) }, E.ico('edit'), 'Sửa') : null,
              t.status === 'planned' ? h('button', { class: 'btn sm primary', type: 'button', disabled: !t.order_count, onclick: async () => {
                try { await POST(`/api/trips/${t.id}/start`, {}); toast('Chuyến đã xuất phát, hàng đã đẩy sang tài xế', 'ok'); load(); } catch (e) {
                  if (e.code === 'NOT_CHECKED' && E.isMgr() && await confirmBox(e.message + '\n\nVẫn cho xuất phát (bỏ qua bước check in)?', { okText: 'Vẫn xuất phát', danger: true })) await act(() => POST(`/api/trips/${t.id}/start`, { force: true }), 'Chuyến đã xuất phát');
                  else if (e.code !== 'NOT_CHECKED' || !E.isMgr()) toast(e.message, 'err');
                }
              } }, 'Xuất phát') : null,
              t.status === 'running' ? h('button', { class: 'btn sm primary', type: 'button', onclick: finish }, 'Hoàn thành') : null,
              t.status === 'planned' ? h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmBox(`Xoá chuyến ${t.code}? Các đơn trong chuyến sẽ quay lại danh sách chờ điều.`, { danger: true, okText: 'Xoá' })) act(() => DEL('/api/trips/' + t.id)); } }, E.ico('trash')) : null)),
          t.orders.length ? t.orders.map((o, i) => h('div', { class: 'ocard' },
            h('span', { class: 'chip', style: { minWidth: '28px', justifyContent: 'center' } }, String(i + 1)),
            h('div', { class: 'body2' }, h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('a', { class: 'lnk', href: '#/order/' + o.code }, o.code), E.statusChip(o.status)), h('b', null, o.customer_name), h('span', null, o.address || ''), h('span', null, `${o.item_count} mặt hàng${o.total !== undefined ? ' · ' + E.money(o.total) : ''}`), o.status !== 'delivered' && o.status !== 'delivering' ? h('div', { style: { marginTop: '3px' } }, o.checked_at ? E.chip('Đã check in', 'ok') : E.chip('Chưa check in', 'warn')) : null),
            editable ? h('div', { style: { display: 'flex', flexDirection: 'column' } },
              h('button', { class: 'btn sm ghost icon', type: 'button', disabled: i === 0, 'aria-label': 'Lên', onclick: () => move(i, -1) }, E.ico('up')),
              h('button', { class: 'btn sm ghost icon', type: 'button', disabled: i === t.orders.length - 1, 'aria-label': 'Xuống', onclick: () => move(i, 1) }, E.ico('down'))) : null,
            editable && o.status !== 'delivered' ? h('button', { class: 'btn sm ghost icon', type: 'button', title: 'Gỡ khỏi chuyến', 'aria-label': 'Gỡ khỏi chuyến', onclick: () => act(() => POST(`/api/trips/${t.id}/unassign`, { order_id: o.id })) }, E.ico('x')) : null))
            : h('div', { class: 'empty', style: { padding: '18px' } }, 'Chưa có đơn nào. Chọn đơn ở cột bên trái rồi bấm "Gán vào chuyến".'),
          h('div', { class: 'pager' }, h('span', null, `${t.order_count} đơn · đã giao ${t.delivered_count}/${t.order_count}`), t.total !== undefined ? h('b', null, E.money(t.total)) : null));
      }

      mount(el, E.head('Bảng điều đơn', 'Gán đơn vào chuyến, chọn tài xế và tuyến, xem phân bổ hàng hoá',
        h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Ngày trước', onclick: () => shift(-1) }, E.ico('left')), dateIn,
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Ngày sau', onclick: () => shift(1) }, E.ico('right')),
          h('button', { class: 'btn', type: 'button', onclick: () => { day = CC.todayStr(); dateIn.value = day; sel.clear(); load(); } }, 'Hôm nay'))), body);
      await load();
    },
  });

  /* ---------- Lịch sử chuyến ---------- */
  E.page('trips', {
    title: 'Lịch sử chuyến giao', allow: () => E.can('delivery'),
    async render(el) {
      const from = CC.addDays(CC.todayStr(), -30);
      const rows = await GET(`/api/trips?from=${from}&to=${CC.addDays(CC.todayStr(), 14)}`);
      mount(el, E.head('Lịch sử chuyến giao', '30 ngày gần đây và các chuyến sắp tới'),
        h('div', { class: 'panel' }, E.table({ rows, empty: 'Chưa có chuyến giao nào', cols: [
          { label: 'Ngày', cls: 'nw', render: (t) => h('a', { class: 'lnk', href: '#/delivery/' + t.trip_date }, E.dmy(t.trip_date)) },
          { label: 'Chuyến', cls: 'nw', render: (t) => t.code }, { label: 'Tài xế', render: (t) => t.driver_name || '—' }, { label: 'Tuyến', render: (t) => t.route_name || '—' },
          { label: 'Đơn', cls: 'r', render: (t) => `${t.delivered_count}/${t.order_count}` }, ...(E.sees() ? [{ label: 'Giá trị', cls: 'r nw', render: (t) => E.money(t.total) }] : []), { label: 'Trạng thái', render: (t) => tripChip(t.status) },
          { label: '', render: (t) => h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => allocationDialog(t.id) }, 'Phân bổ'), h('button', { class: 'btn sm', type: 'button', onclick: () => E.printOpen('trip', { id: t.id }) }, E.ico('print'))) },
        ] })));
    },
  });

  /* ---------- Tài xế ---------- */
  function driverDialog(d0, employees, done) {
    const f = {
      name: h('input', { class: 'in', value: d0.name || '' }), phone: h('input', { class: 'in', value: d0.phone || '', inputmode: 'tel' }), plate: h('input', { class: 'in', value: d0.plate || '', placeholder: '51A-123.45' }),
      emp: E.select(employees.map((e) => ({ v: e.id, l: `${e.code} - ${e.full_name}` })), d0.employee_id || '', { placeholder: '— Không liên kết —' }),
      active: h('input', { type: 'checkbox', checked: d0.active !== 0 }),
    };
    const err = h('div', { class: 'callout err', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Lưu');
    const acts = [];
    if (d0.id) acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox(`Xoá tài xế "${d0.name}"? Nếu đã có chuyến, tài xế sẽ chuyển sang ngừng hoạt động.`, { danger: true, okText: 'Xoá' })) { try { await DEL('/api/drivers/' + d0.id); E.refs.clear(); d.close(); done(); } catch (e) { toast(e.message, 'err'); } } } }, E.ico('trash'), 'Xoá'));
    acts.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save);
    const d = dialog({ title: d0.id ? d0.name : 'Thêm tài xế', actions: acts, body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err,
      field('Họ tên', f.name), h('div', { class: 'grid2' }, field('Điện thoại', f.phone), field('Biển số xe', f.plate)),
      employees.length ? field('Tài khoản nhân viên', f.emp, 'Liên kết để tài xế đăng nhập và xem chuyến giao của mình trong mục "Giao hàng của tôi"') : null,
      d0.id ? h('label', { class: 'check' }, f.active, 'Đang hoạt động') : null) });
    save.onclick = () => E.busy(save, async () => {
      const p = { name: f.name.value, phone: f.phone.value, plate: f.plate.value, employee_id: f.emp.value || null, active: f.active.checked };
      try { if (d0.id) await PUT('/api/drivers/' + d0.id, p); else await POST('/api/drivers', p); E.refs.clear(); d.close(); toast('Đã lưu tài xế', 'ok'); done(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  }
  E.page('drivers', {
    title: 'Tài xế', allow: () => E.can('delivery'),
    async render(el) {
      let employees = [];
      try { employees = (await GET('/api/employees')).filter((e) => e.active !== 0); } catch { /* không đủ quyền: bỏ chọn liên kết */ }
      const holder = h('div');
      async function load() {
        const rows = await GET('/api/drivers?all=1');
        mount(holder, E.table({ rows, empty: 'Chưa có tài xế nào', rowClass: (r) => (r.active ? '' : 'off'), cols: [
          { label: 'Tài xế', render: (r) => h('div', null, h('b', null, r.name), r.employee_name ? h('span', { class: 'sub2' }, 'TK: ' + r.employee_code) : null) },
          { label: 'Điện thoại', render: (r) => r.phone, cls: 'nw' }, { label: 'Biển số', render: (r) => r.plate, cls: 'nw' }, { label: 'Trạng thái', render: (r) => (r.active ? E.chip('Hoạt động', 'ok') : E.chip('Ngừng')) },
          { label: '', render: (r) => h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => driverDialog(r, employees, load) }, 'Sửa')) }] }));
      }
      mount(el, E.head('Tài xế', 'Danh sách tài xế và xe giao hàng', h('button', { class: 'btn primary', type: 'button', onclick: () => driverDialog({}, employees, load) }, E.ico('plus'), 'Thêm tài xế')), h('div', { class: 'panel' }, holder));
      await load();
    },
  });

  /* ---------- Tuyến giao hàng ---------- */
  function routeDialog(r0, done) {
    const name = h('input', { class: 'in', value: r0.name || '', placeholder: 'Ví dụ: Tuyến Quận 1 - Quận 3' });
    const note = h('textarea', { class: 'in' }, r0.note || '');
    const active = h('input', { type: 'checkbox', checked: r0.active !== 0 });
    const err = h('div', { class: 'callout err', hidden: true });
    const save = h('button', { class: 'btn primary', type: 'button' }, 'Lưu');
    const acts = [];
    if (r0.id) acts.push(h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmBox(`Xoá tuyến "${r0.name}"?`, { danger: true, okText: 'Xoá' })) { try { await DEL('/api/delivery-routes/' + r0.id); E.refs.clear(); d.close(); done(); } catch (e) { toast(e.message, 'err'); } } } }, E.ico('trash'), 'Xoá'));
    acts.push(h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Huỷ'), save);
    const d = dialog({ title: r0.id ? r0.name : 'Thêm tuyến giao hàng', actions: acts, body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, err, field('Tên tuyến', name), field('Mô tả (khu vực, thứ tự điểm giao...)', note), r0.id ? h('label', { class: 'check' }, active, 'Đang sử dụng') : null) });
    save.onclick = () => E.busy(save, async () => {
      const p = { name: name.value, note: note.value, active: active.checked };
      try { if (r0.id) await PUT('/api/delivery-routes/' + r0.id, p); else await POST('/api/delivery-routes', p); E.refs.clear(); d.close(); toast('Đã lưu tuyến', 'ok'); done(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  }
  E.page('routes', {
    title: 'Tuyến giao hàng', allow: () => E.can('delivery'),
    async render(el) {
      const holder = h('div');
      async function load() {
        const rows = await GET('/api/delivery-routes?all=1');
        mount(holder, E.table({ rows, empty: 'Chưa có tuyến nào', rowClass: (r) => (r.active ? '' : 'off'), cols: [
          { label: 'Tuyến', render: (r) => h('b', null, r.name) }, { label: 'Mô tả', render: (r) => r.note }, { label: 'Trạng thái', render: (r) => (r.active ? E.chip('Sử dụng', 'ok') : E.chip('Ngừng')) },
          { label: '', render: (r) => h('div', { class: 'acts' }, h('button', { class: 'btn sm', type: 'button', onclick: () => routeDialog(r, load) }, 'Sửa')) }] }));
      }
      mount(el, E.head('Tuyến giao hàng', 'Gán tuyến cho chuyến để tài xế biết khu vực phụ trách', h('button', { class: 'btn primary', type: 'button', onclick: () => routeDialog({}, load) }, E.ico('plus'), 'Thêm tuyến')), h('div', { class: 'panel' }, holder));
      await load();
    },
  });

  /* ---------- Giao hàng của tôi (tài xế) ---------- */
  E.page('my-trips', {
    title: 'Giao hàng của tôi', allow: () => E.isDriver(),
    async render(el, arg) {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : CC.todayStr();
      const r = await GET('/api/my/trips?date=' + day);
      const refresh = () => E.route();
      const cards = [];
      for (const t of r.trips) {
        cards.push(h('div', { class: 'panel', style: { gridColumn: '1 / -1' } }, h('div', { class: 'ph' }, h('h2', null, `${t.code}${t.route_name ? ' · ' + t.route_name : ''}`), tripChip(t.status))));
        if (t.status === 'planned') cards.push(h('div', { class: 'callout', style: { gridColumn: '1 / -1' } }, 'Chuyến chưa xuất phát. Hãy chờ điều phối viên xác nhận.'));
        for (const o of t.orders) {
          const due = o.total !== undefined ? Math.max(0, o.total - (o.paid || 0)) : 0;
          const money = h('input', { class: 'in sm', type: 'number', min: 0, step: '1000', placeholder: 'Tiền thu (nếu có)', style: { width: '160px' }, 'aria-label': 'Tiền thu khi giao' });
          const done = h('button', { class: 'btn primary', type: 'button', disabled: o.status !== 'delivering' }, E.ico('check'), 'Đã giao');
          done.onclick = () => E.busy(done, async () => {
            if (!(await confirmBox(`Xác nhận đã giao đơn ${o.code} cho ${o.customer_name}?`, { okText: 'Đã giao' }))) return;
            await POST(`/api/my/orders/${o.id}/delivered`, { collected: money.value ? Number(money.value) : 0 }); toast('Đã xác nhận giao hàng', 'ok'); refresh();
          });
          cards.push(h('div', { class: 'dcard' },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('h3', null, `${o.stop_seq || ''}${o.stop_seq ? '. ' : ''}${o.customer_name}`), E.statusChip(o.status)),
            h('div', null, h('b', null, o.code), o.total !== undefined ? ' · ' + E.money(o.total) + (o.paid ? ` (đã thu ${E.money(o.paid)})` : '') : ''),
            h('div', { class: 'it' }, o.address || 'Chưa có địa chỉ'),
            h('div', { class: 'it' }, o.items.map((i) => `${i.name} ×${fmtMoney(i.qty)}${i.unit ? ' ' + i.unit : ''}`).join(', ')),
            o.note ? h('div', { class: 'it' }, 'Ghi chú: ' + o.note) : null,
            h('div', { class: 'row2' },
              o.customer_phone ? h('a', { class: 'btn', href: 'tel:' + o.customer_phone }, E.ico('phone'), 'Gọi') : null,
              o.address ? h('a', { class: 'btn', href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(o.address), target: '_blank', rel: 'noopener' }, E.ico('pin'), 'Bản đồ') : null),
            o.status === 'delivering' ? h('div', { class: 'row2', style: { alignItems: 'center' } }, money, done, o.total !== undefined && due ? h('span', { class: 'muted' }, 'Còn phải thu ' + E.money(due)) : null) : null));
        }
      }
      mount(el, E.head('Giao hàng của tôi', `${r.driver.name} · ${E.dmy(r.date)}`),
        r.trips.length ? h('div', { class: 'dgrid' }, cards) : h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('strong', null, 'Hôm nay bạn chưa có chuyến giao nào'), 'Khi điều phối viên gán chuyến cho bạn, đơn hàng sẽ hiện ở đây.')));
    },
  });
})();
