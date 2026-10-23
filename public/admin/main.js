'use strict';
/* Khi được nhúng trong khung ERP (?embed=1) thì ẩn cột menu và thanh đầu của trang quản lý. */
if (new URLSearchParams(location.search).get('embed') === '1') document.documentElement.classList.add('embed');
ADM.boot();
