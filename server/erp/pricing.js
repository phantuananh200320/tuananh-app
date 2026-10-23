'use strict';
// Giá bán do bộ phận tài chính đặt: giá chung trong danh mục sản phẩm, có thể có các bảng giá riêng theo khu vực/nhóm đại lý.
const { q } = require('../db');

function priceOf(customerId, productId) {
  const c = customerId ? q.get('SELECT price_list_id FROM customers WHERE id=?', customerId) : null;
  if (c && c.price_list_id) {
    const r = q.get('SELECT price FROM price_list_items WHERE list_id=? AND product_id=?', c.price_list_id, productId);
    if (r) return r.price;
  }
  const p = q.get('SELECT price FROM products WHERE id=?', productId);
  return p ? p.price : 0;
}

// Toàn bộ giá của một khách: { [productId]: price }
function priceMap(customerId) {
  const c = customerId ? q.get('SELECT price_list_id FROM customers WHERE id=?', customerId) : null;
  const map = {};
  for (const p of q.all('SELECT id, price FROM products')) map[p.id] = p.price;
  if (c && c.price_list_id) for (const r of q.all('SELECT product_id, price FROM price_list_items WHERE list_id=?', c.price_list_id)) map[r.product_id] = r.price;
  return map;
}

module.exports = { priceOf, priceMap };
