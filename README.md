# Chấm công — app nhân viên + web quản lý

Hệ thống chấm công tự lưu trữ (self-hosted), tham khảo mô hình của acheckin.io. Gồm:

| Thành phần | Đường dẫn | Dành cho |
|---|---|---|
| Trang chủ: đăng nhập rồi chọn chức năng | `/` | Tất cả người dùng |
| App chấm công (PWA, cài lên màn hình điện thoại) | `/cc/` | Nhân viên |
| Web quản lý | `/admin/` | Quản trị, quản lý trực tiếp |
| Màn hình QR tại cổng/quầy | `/kiosk/?key=…` | Tablet hoặc màn hình đặt tại chỗ làm |

Không có thư viện phụ thuộc: chỉ cần **Node.js 22 trở lên** (dùng SQLite có sẵn của Node). Không cần cài MySQL hay Redis.

## Phiên bản 1.5.0: cài đặt một bước, cập nhật trên web

- **Cập nhật trên web bật sẵn**: quản trị viên vào Hệ thống → Cập nhật phần mềm, kéo thả file là cập nhật (nhận cả `.tgz` cập nhật lẫn gói cài đặt `.zip`). Không cần đặt biến môi trường. Tắt hẳn bằng `ALLOW_ONLINE_UPDATE=0`.
- **Tệp khởi động** trong thư mục phần mềm: `start.bat` (Windows), `start.sh` (Linux/macOS), `stop.*`; `cai-dat-windows.bat` cho tự chạy khi bật máy; `install-linux.sh` cài dịch vụ systemd và tự cài Node.js. Tất cả gọi `start.js`: đọc `.env`, giữ phần mềm luôn chạy, tự bật lại sau khi cập nhật hoặc gặp sự cố, ghi log theo ngày.
- **Đóng gói phát hành**: `node scripts/make-release.js` tạo gói cài đặt `.zip`, `.tar.gz`, file cập nhật `.tgz` và `SHA256SUMS.txt`. Xem `INSTALL.md`.

## Phiên bản 1.4.0: app đặt hàng cho đại lý, quản lý đơn hàng, ẩn giá

- **Danh mục 28 sản phẩm** nạp sẵn theo bảng báo giá (bún, mì Quảng, phở, bánh, hủ tiếu dai, nui tươi, phở rời) với quy cách, ĐVT và bước đặt hàng: hàng gói 500gr đặt theo bội 0,5 kg; nui tươi theo hộp; hủ tiếu dai bịch 5 kg theo bội 5 kg; hàng rời (xá) theo kg. Màn hình làm hàng tự quy đổi ra số gói/hộp/bịch.
- **Giá chỉ bộ phận tài chính kế toán thấy và đặt** (Tài chính kế toán → Bảng giá): giá chung và các bảng giá riêng theo khu vực/nhóm đại lý. Máy chủ tự bỏ mọi trường tiền khỏi dữ liệu gửi cho người không có quyền tài chính, kể cả khi họ gọi thẳng API. Giá trên đơn do hệ thống áp; nút "Áp giá cho đơn" dùng khi đơn đến trước lúc có giá.
- **App đặt hàng cho khách đại lý** tại `/dl/`: nhân viên cấp tài khoản ở Quản lý → Khách hàng đại lý. Khách chọn hàng theo quy cách, chọn ngày nhận, gửi đơn, xem trạng thái, đặt lại đơn cũ, tự huỷ khi đơn chưa vào làm hàng. Giá ẩn với khách, tài chính có thể bật hiển thị.
- **Ba nguồn đơn**: app khách, nhân viên nhập tay, file Excel/CSV (chỉ nhận sản phẩm trong danh mục, không nhập giá).
- **Quy trình kho**: Làm hàng & soạn hàng (tổng hợp theo sản phẩm, in phiếu làm hàng → đơn sang "Đang làm hàng") → Check in hàng (quét/gõ mã đơn, kiểm từng dòng) → chuyến giao xuất phát thì hàng đẩy sang tài xế; đơn check in khi chuyến đã chạy được đẩy sang tài xế ngay. Chuyến không xuất phát được khi còn đơn chưa check in (quản lý có thể bỏ qua).
- **Quyền mới** "Làm hàng, soạn hàng, check in" cho nhân viên kho. Phiếu giao hàng không in giá.

## Hệ thống quản lý ERP (từ phiên bản 1.3.0)

Trang chủ `/` được thay bằng khung quản lý mới (menu bên trái, thanh tìm kiếm Ctrl+K, thông báo, 6 ô chức năng). Các phần chấm công/nhân sự cũ vẫn dùng nguyên, được gán vào menu:

| Ô chức năng | Nội dung |
|---|---|
| 1. Quản lý | Khách hàng, sản phẩm & bảng giá (mới); Nhân viên & hồ sơ, Đơn từ nhân sự (trang quản lý cũ nhúng vào) |
| 2. Nhập đơn | Danh sách đơn, nhập/sửa đơn, huỷ/khôi phục, in phiếu và in lại, nhập hàng loạt từ Excel/CSV, xuất Excel |
| 3. Điều hành giao hàng | Bảng điều đơn theo ngày, chuyến giao, gán tuyến và tài xế, phân bổ hàng hoá, in bảng kê, màn hình giao hàng của tài xế (xác nhận giao, thu tiền) |
| 4. Chấm công | Chấm công của tôi, tổng quan, nhật ký, bảng công, xếp ca, màn hình QR/khuôn mặt tại quầy |
| 5. Hệ thống | Cài đặt, sao lưu, cập nhật phiên bản (trang cũ nhúng vào), phân quyền người dùng, danh mục, thông báo, nhật ký thao tác |
| 6. Tài chính kế toán | Công nợ phải thu, sổ chi tiết, thu tiền, chốt công nợ và hoá đơn nội bộ, bảng lương |

**Phân quyền**: Quản trị viên toàn quyền. Quản lý mặc định dùng Quản lý, Nhập đơn, Điều hành giao hàng. Nhân viên mặc định chỉ chấm công. Quản trị viên chỉnh từng người ở Hệ thống, Phân quyền người dùng. Tài xế: thêm ở Điều hành giao hàng, Tài xế và liên kết với tài khoản nhân viên.

**Công nợ** = nợ đầu kỳ của khách + tổng đơn đã giao − tổng phiếu thu chưa huỷ. Đơn đã nằm trong hoá đơn thì khoá sửa/huỷ cho tới khi huỷ hoá đơn. Hoá đơn trong phần mềm là bảng kê nội bộ; hoá đơn điện tử theo quy định thuế cần xuất ở phần mềm riêng, có thể ghi số hoá đơn đó vào hoá đơn nội bộ.

Kiểm thử: `node scripts/smoke-erp.js` (tự chạy máy chủ tạm với dữ liệu riêng).
Dữ liệu chấm công hiện có không bị thay đổi; các bảng mới được tạo tự động khi chạy lần đầu.

## Tính năng

**Nhân viên (app điện thoại)**
- Chấm công vào/ra bằng một nút, đồng hồ theo giờ máy chủ.
- Xác thực bằng GPS (bán kính), WiFi công ty (theo IP công khai), quét mã QR tại chi nhánh, hoặc nhập mã 6 số.
- Chụp ảnh khi chấm công (tuỳ chọn), gắn một điện thoại cho một tài khoản (tuỳ chọn).
- Lịch tháng: đi muộn, về sớm, thiếu giờ, nghỉ phép, ngày lễ, làm thêm giờ.
- Gửi đơn: nghỉ phép, làm thêm giờ, công tác, làm việc từ xa, giải trình chấm công. Xem số ngày phép còn lại và thông báo của công ty.

**Quản trị (web)**
- Tổng quan hôm nay: ai đã chấm, đi muộn, chưa chấm, nghỉ phép. Biểu đồ 7 ngày.
- Nhật ký chấm công (kèm vị trí, ảnh), chấm công thủ công, xoá lượt sai.
- Bảng công theo tháng, xuất Excel (.xlsx).
- Duyệt hoặc từ chối đơn từ (quản lý trực tiếp hoặc quản trị). Đơn giải trình được duyệt sẽ tự bổ sung giờ chấm công.
- Quản lý nhân viên: thêm, sửa, xoá (xoá vĩnh viễn kèm toàn bộ chấm công của người đó, hoặc chỉ khoá tài khoản để giữ lịch sử), nhập hàng loạt từ CSV, đặt lại mật khẩu, gỡ liên kết điện thoại.
- Màn hình chờ cho màn hình QR: sau số phút không có ai chấm công (mặc định 5) tự chuyển sang trình chiếu hình ảnh của công ty kèm thông báo đang hiển thị và đồng hồ. Chạm vào màn hình để quay lại chấm công. Cấu hình ở Cài đặt, mục "Màn hình chờ tại màn hình QR" (thêm tới 20 hình, chỉnh thời gian, bật/tắt thông báo, nút xem thử). Có thể xem thử nhanh bằng cách thêm `&idle=5` (giây) vào liên kết `/kiosk/`.
- Logo công ty: tải ở Cài đặt, hiện ở màn hình đăng nhập, app nhân viên, trang quản lý, màn hình QR và biểu tượng tab trình duyệt.
- Xếp ca theo ngày (kể cả ca đêm), xếp hàng loạt. Danh mục phòng ban, chi nhánh, ca, loại nghỉ, ngày lễ (có nút thêm ngày lễ dương lịch cố định của Việt Nam).
- Bảng lương đơn giản (lương cơ bản theo công, làm thêm giờ, phụ cấp, phạt đi muộn), xuất Excel.
- Thông báo, nhật ký thao tác, tải bản sao lưu dữ liệu.

**Phân quyền:** `admin` (toàn quyền), `manager` (chỉ thấy và duyệt nhân viên thuộc phòng mình hoặc báo cáo trực tiếp), `employee`.

## Chạy thử nhanh (máy cá nhân)

```bash
node --version          # cần v22 trở lên
node server/index.js    # mở http://localhost:3000
```

- Web quản lý: <http://localhost:3000/admin/>, đăng nhập `admin` / `admin123`. Hệ thống **bắt đổi mật khẩu** ngay lần đầu.
- Muốn xem thử với dữ liệu mẫu (13 nhân viên, 35 ngày chấm công): `node scripts/seed-demo.js`. Nhân viên mẫu `NV001`…`NV012` mật khẩu `123456`, quản lý `QL01`. **Đừng chạy lệnh này trên hệ thống thật.**
- Kiểm tra nhanh toàn bộ luồng chính: `node scripts/smoke-test.js` (chạy trên dữ liệu tạm, không đụng dữ liệu thật).

> GPS, camera và cài app lên điện thoại **chỉ hoạt động qua HTTPS** (riêng `localhost` được miễn). Khi đưa lên máy chủ phải có HTTPS, xem bên dưới.

## Triển khai lên máy chủ

Yêu cầu: một VPS Linux (1 vCPU, 1 GB RAM là đủ cho vài trăm nhân viên), một tên miền trỏ về máy chủ.

### Cách 1: Docker Compose + Caddy (khuyên dùng, HTTPS tự động)

```bash
cp .env.example .env
nano .env                     # sửa DOMAIN, PUBLIC_URL, ADMIN_PASSWORD
docker compose up -d --build
```

Caddy tự xin và gia hạn chứng chỉ Let's Encrypt (mở cổng 80 và 443, DNS phải trỏ đúng trước). Dữ liệu nằm trong volume `chamcong-data`.

Cập nhật phiên bản mới: chép mã nguồn mới lên rồi `docker compose up -d --build`. Dữ liệu được giữ nguyên.

### Cách 2: chạy trực tiếp bằng systemd + Caddy hoặc Nginx

1. Cài Node.js 22+, chép dự án vào `/opt/chamcong`.
2. Tạo người dùng và thư mục dữ liệu:
   ```bash
   sudo useradd --system --home /opt/chamcong chamcong
   sudo mkdir -p /var/lib/chamcong && sudo chown chamcong: /var/lib/chamcong
   ```
3. Chép `deploy/chamcong.service` vào `/etc/systemd/system/`, sửa `ADMIN_PASSWORD`, `PUBLIC_URL` và đường dẫn `node` (xem bằng `which node`), rồi:
   ```bash
   sudo systemctl daemon-reload && sudo systemctl enable --now chamcong
   ```
4. Đặt reverse proxy phía trước để có HTTPS: dùng `deploy/Caddyfile` (đổi `chamcong:3000` thành `127.0.0.1:3000`) hoặc `deploy/nginx.conf` kèm `certbot`.

Dù dùng cách nào, **phải đặt `TRUST_PROXY=1`** khi chạy sau Caddy/Nginx, nếu không hệ thống sẽ thấy IP của proxy thay vì IP của nhân viên (làm hỏng chấm công theo WiFi và giới hạn đăng nhập sai). Ngược lại, **không đặt** biến này khi mở cổng 3000 trực tiếp ra Internet.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng lắng nghe |
| `HOST` | `0.0.0.0` | Địa chỉ lắng nghe (dùng `127.0.0.1` nếu có proxy trên cùng máy) |
| `DATA_DIR` | `./data` | Nơi lưu `chamcong.db`, `photos/`, `backups/`, `.jwt_secret` |
| `APP_TZ` | `Asia/Ho_Chi_Minh` | Múi giờ công ty. **Không đổi sau khi đã có dữ liệu** |
| `ADMIN_CODE` / `ADMIN_PASSWORD` | `admin` / `admin123` | Tài khoản quản trị tạo ở lần chạy đầu (cơ sở dữ liệu trống) |
| `PUBLIC_URL` | (trống) | Địa chỉ công khai, dùng để tạo mã QR. Có thể đặt trong Cài đặt của web quản lý |
| `TRUST_PROXY` | `0` | `1` khi chạy sau reverse proxy |
| `JWT_SECRET` | tự sinh | Khoá ký phiên đăng nhập (≥16 ký tự). Bỏ trống thì lưu trong `DATA_DIR/.jwt_secret` |

## Thiết lập lần đầu (khoảng 10 phút)

1. Vào `/admin/`, đăng nhập `admin`, đổi mật khẩu.
2. **Cài đặt**: nhập tên công ty, tải logo, địa chỉ website (`https://chamcong.congty.vn`), chọn hình thức chấm công muốn dùng, ca mặc định và quy tắc tính công.
3. **Danh mục → Chi nhánh**: sửa chi nhánh mặc định. Nhập toạ độ GPS và bán kính (mẹo: mở Google Maps tại cửa công ty, bấm giữ để lấy toạ độ). Muốn chấm công theo WiFi thì bấm **Thêm IP đang dùng** (khi bạn đang kết nối WiFi công ty) rồi lưu. Có thể thêm nhiều chi nhánh.
4. **Danh mục**: tạo phòng ban, ca làm việc, loại nghỉ; bấm "Thêm ngày lễ dương lịch cố định" ở tab Ngày lễ. Ngày lễ âm lịch (Tết, Giỗ Tổ) cần tự nhập hằng năm.
5. **Nhân viên**: thêm từng người hoặc nhập hàng loạt từ CSV (có file mẫu để tải). Mỗi người có mã nhân viên và mật khẩu khởi tạo; nhân viên bị bắt đổi mật khẩu lần đăng nhập đầu.
6. **Màn hình QR**: ở Danh mục → Chi nhánh bấm **Màn hình QR**, mở đường dẫn đó trên tablet/TV đặt tại cổng, để chế độ toàn màn hình. Mã đổi mỗi 30 giây nên không thể chụp ảnh gửi người khác chấm hộ.
7. Gửi nhân viên đường dẫn `https://chamcong.congty.vn/`: đăng nhập bằng tài khoản được cấp, bấm ô **Chấm Công** để vào app (hoặc gửi thẳng `https://chamcong.congty.vn/cc/`). Địa chỉ cũ `/app/` vẫn dùng được, tự chuyển sang `/cc/`. Trên điện thoại chọn "Thêm vào màn hình chính" (iPhone: Safari → Chia sẻ; Android: Chrome → Cài đặt ứng dụng).

### Các hình thức chấm công hoạt động như thế nào

- **GPS**: điện thoại gửi toạ độ, máy chủ tính khoảng cách tới chi nhánh. Từ chối nếu ngoài bán kính hoặc sai số GPS lớn hơn mức cho phép.
- **WiFi**: so IP công khai của nhân viên với danh sách IP của chi nhánh (hỗ trợ `1.2.3.4`, `203.0.113.*`, `10.0.0.0/24`). Chỉ hiệu quả nếu mạng công ty có IP tĩnh.
- **QR / mã 6 số**: mã sinh từ khoá riêng của chi nhánh, đổi mỗi 30 giây, chấp nhận trễ tối đa khoảng 90 giây. Nếu trình duyệt không hỗ trợ quét QR ngay trong app, nhân viên dùng camera mặc định của điện thoại (mã QR là một đường dẫn mở thẳng vào app) hoặc nhập mã 6 số.
- **Từ xa**: nhân viên có quyền "chấm công từ xa" hoặc có đơn làm việc từ xa đã duyệt trong ngày thì không bị kiểm tra vị trí.

Nếu chi nhánh chưa nhập GPS lẫn IP thì ai cũng chấm được (chế độ mở), thích hợp để chạy thử.

## Nhận diện khuôn mặt tại màn hình QR (tuỳ chọn)

Màn hình `/kiosk/` mặc định chỉ hiện mã QR. Khi tính năng được bật sẽ có nút **Chấm công bằng khuôn mặt**: bấm vào mới mở camera (bên trái là camera, bên phải mã QR thu nhỏ), nhìn vào camera để chấm công. Bấm **Về mã QR** hoặc để yên 25 giây thì camera tự tắt và màn hình quay về mã QR. Nhận diện chạy bằng [face-api.js](https://github.com/justadudewhocodes/face-api.js) (giấy phép MIT) ngay trên trình duyệt của kiosk.

**Cài đặt (một lần, trên máy có Internet):**

```bash
node scripts/get-face-models.js     # tải face-api.min.js vào public/vendor và 3 mô hình nhẹ vào public/models
```

Dùng Docker thì chạy lệnh trên ở thư mục dự án rồi `docker compose up -d --build` (thư viện được đóng vào ảnh). Sau đó vào **Cài đặt, Chấm công bằng khuôn mặt**, bật tính năng. Mục này báo "đã cài" khi đủ file.

**Đăng ký:** trang quản lý, mục Nhân viên, bấm nút camera ở dòng nhân viên, chụp 3 mẫu (nhìn thẳng, nghiêng trái, nghiêng phải), tích xác nhận nhân viên đã đồng ý, bấm Lưu. Hệ thống chỉ lưu dãy 128 số đặc trưng, không lưu ảnh đăng ký. Có thể xoá bất cứ lúc nào, và xoá nhân viên là xoá luôn dữ liệu khuôn mặt.

**Cách hoạt động và an toàn:**
- Trình duyệt kiosk chỉ tính dãy số đặc trưng rồi gửi lên máy chủ. **Máy chủ** so khớp với các mẫu đã đăng ký và quyết định chấm công, nên kiosk không thể tự khai "tôi là ai" và dãy số của nhân viên không bao giờ được gửi xuống kiosk.
- Từ chối khi không đủ giống (ngưỡng chỉnh được, mặc định 0,5), khi hai người quá giống nhau, hoặc khi nhân viên được giao chi nhánh khác. Có giới hạn số lần thử theo IP và khoảng cách tối thiểu giữa hai lần chấm (dùng chung cài đặt chấm công).
- Mỗi lượt nhận diện lưu kèm một ảnh nhỏ để đối chiếu (thư mục `photos/`).
- Tuỳ chọn bắt chớp mắt trước khi nhận diện để chặn ảnh in hoặc ảnh trên điện thoại. **Không thể chặn hoàn toàn** video hoặc mặt nạ, nên hãy đặt kiosk nơi có người giám sát, và xem ảnh đối chiếu khi nghi ngờ.
- Camera chỉ hoạt động khi mở trang bằng **HTTPS** (hoặc `localhost`), và cần cho phép camera cho trang `/kiosk/`.
- Khuôn mặt là dữ liệu sinh trắc học nhạy cảm. Hãy thông báo và xin đồng ý của nhân viên, và tuân thủ quy định bảo vệ dữ liệu cá nhân tại nơi bạn hoạt động. Dữ liệu này nằm trong file sao lưu.
- Nếu màn hình QR không hiện khung camera: xem Cài đặt (có báo thiếu file không) và mở bảng điều khiển của trình duyệt. Nếu thấy lỗi `unsafe-eval` thì đặt biến môi trường `FACE_UNSAFE_EVAL=1` rồi chạy lại ứng dụng (chỉ nới lỏng cho `/admin/` và `/kiosk/`).

## Cập nhật phiên bản không cần chạy lại cả hệ thống

Quản trị viên cập nhật ứng dụng ngay trong **Cài đặt, Cập nhật ứng dụng**: tải một gói `.tgz` lên, xem trước thay đổi, nhập mật khẩu để xác nhận. Không cần build lại ảnh Docker và thường không cần khởi động lại.

**Quy trình:**
1. Trên máy phát triển, tăng `version` trong `package.json` (ví dụ 1.1.0 lên 1.1.1), rồi chạy `node scripts/make-update.js --notes="Nội dung thay đổi"`. Ra file `dist/chamcong-update-1.1.1.tgz` (khoảng 250 KB).
2. Vào trang quản lý, Cài đặt, Cập nhật ứng dụng, chọn gói, kiểm tra danh sách thay đổi, nhập mật khẩu, bấm **Cập nhật ngay**.
3. Các trang đang mở (app nhân viên, trang quản lý) hiện thanh "Có phiên bản mới, Tải lại ngay". Màn hình QR ở quầy tự tải lại khi không dùng camera.

**Cách hoạt động:**
- Chỉ ghi các tệp thật sự thay đổi. Giao diện (`public/`) có hiệu lực ngay. Mã máy chủ được **nạp nóng** trong chính tiến trình đang chạy: kết nối CSDL giữ nguyên, người đang dùng không bị ngắt.
- Nếu gói đổi phần lõi (`db.js`, `config.js`, `lib/http.js`, `lib/security.js`, `index.js` và chính bộ cập nhật) thì cần khởi động lại **tiến trình** (vài giây, dữ liệu giữ nguyên). Chạy bằng `start.bat`, `start.sh`, dịch vụ Linux (`install-linux.sh`) hoặc Docker thì tự làm; chạy thẳng `node server/index.js` thì hệ thống báo để bạn tự chạy lại.
- Trước khi áp dụng: kiểm tra mã toàn vẹn từng tệp, kiểm tra cú pháp, từ chối gói có đường dẫn lạ, gói đổi thư viện phụ thuộc, hoặc gói cùng phiên bản. Hệ thống tự **sao lưu CSDL** (`truoc-cap-nhat-*.db`) và giữ bản cũ của từng tệp. Nếu nạp bản mới bị lỗi thì tự khôi phục bản cũ ngay.
- **Quay lại bản trước** bằng một nút (giữ được 5 bản gần nhất). Dữ liệu chấm công không bị lùi.
- Trong Docker, bản cập nhật gần nhất được giữ ở `/data/updates`. Nếu container được tạo lại từ ảnh cũ thì bản cập nhật tự được áp lại khi khởi động.
- Không đụng tới dữ liệu, thư viện nhận diện khuôn mặt (`public/vendor`, `public/models`), `.env`.

**Bật sẵn từ 1.5.0** (chỉ quản trị viên, phải nhập lại mật khẩu khi cập nhật). Tắt hẳn: thêm `ALLOW_ONLINE_UPDATE=0` vào `.env`.

**Tăng bảo mật bằng chữ ký số (khuyên dùng khi máy chủ mở ra Internet):**

```bash
node scripts/gen-update-key.js            # tạo khoá ký (giữ file update-private.pem ở máy của bạn, đừng đưa lên máy chủ)
# thêm vào .env của máy chủ:
UPDATE_PUBLIC_KEY=<dòng in ra ở lệnh trên>
# đóng gói có ký:
node scripts/make-update.js --sign=update-private.pem --notes="..."
```

Có `UPDATE_PUBLIC_KEY` thì chỉ nhận gói đã ký, nên dù tài khoản quản trị bị lộ cũng không đưa được mã lạ lên máy chủ. Không có khoá thì bất kỳ quản trị viên nào cũng chạy được mã tuỳ ý trên máy chủ: chỉ dùng khi bạn tin hoàn toàn các tài khoản quản trị.

**Giới hạn:** gói đổi `Dockerfile`, `docker-compose.yml`, `deploy/` hoặc thêm thư viện vào `package.json` thì phải build lại ảnh (hệ thống báo, và từ chối gói đổi thư viện).

## Sao lưu và khôi phục

Toàn bộ dữ liệu là file `DATA_DIR/chamcong.db` (ảnh chấm công nếu có ở `DATA_DIR/photos`).

```bash
node scripts/backup.js --keep=30                 # sao lưu khi đang chạy, giữ 30 bản
node scripts/backup.js --out=/mnt/nas            # ghi sang thư mục khác
```

**Tự động lúc 02:00 sáng (giờ máy chủ, mặc định giờ Việt Nam):** ứng dụng tự sao lưu vào `DATA_DIR/backups/` (tên `tu-dong-*.db`), không cần cài thêm gì. Nếu máy chủ tắt đúng 02:00 thì bù ngay khi bật lại. Mặc định giữ 30 bản tự động gần nhất. Bật, tắt và chỉnh số bản giữ lại ở **Cài đặt, Sao lưu và khôi phục dữ liệu**.

Cũng ở mục đó, quản trị viên có thể: sao lưu ngay, tải hoặc xoá từng bản, và **nạp dữ liệu cũ** bằng cách chọn file `.db` (từ bản sao lưu, hoặc từ hệ thống cũ cùng loại). Hệ thống kiểm tra file, hỏi xác nhận, tự lưu bản dữ liệu hiện tại (`truoc-khoi-phuc-*.db`) rồi mới thay toàn bộ dữ liệu. Sau khi khôi phục cần đăng nhập lại. Ảnh chấm công không nằm trong file `.db`, muốn mang theo thì chép thư mục `photos/`.

Cách dùng cron bên ngoài (tuỳ chọn, ví dụ ghi sang NAS): xem `deploy/backup-cron.example`. Không cần bật cả hai.

Khôi phục thủ công khi không vào được giao diện: dừng ứng dụng, chép file sao lưu đè lên `DATA_DIR/chamcong.db` (xoá luôn `chamcong.db-wal` và `chamcong.db-shm` nếu còn), chạy lại. Nhớ chép bản sao lưu sang máy khác, đừng chỉ giữ trên cùng máy chủ.

## Bảo mật

- Mật khẩu băm bằng scrypt, phiên đăng nhập dùng token ký HMAC, giới hạn đăng nhập sai (8 lần / 10 phút cho mỗi cặp IP + tài khoản).
- Ảnh chấm công chỉ xem được bằng token ngắn hạn (30 phút) cấp cho quản trị/quản lý đã đăng nhập.
- Giao diện không dùng script nội tuyến (CSP `script-src 'self'`), dữ liệu hiển thị được chèn bằng `textContent` để tránh XSS.
- Đổi `ADMIN_PASSWORD` trước khi mở ra Internet, luôn dùng HTTPS, và giữ `DATA_DIR` ngoài thư mục có thể truy cập công khai.

## Giới hạn cần biết

- **Không nhận diện khuôn mặt.** "Chụp ảnh" chỉ lưu ảnh để quản lý đối chiếu khi cần.
- Chấm công theo WiFi dựa trên IP công khai, không phân biệt được các WiFi khác nhau cùng một đường truyền.
- Quét QR ngay trong app cần trình duyệt hỗ trợ `BarcodeDetector` (Chrome Android có; iPhone dùng camera mặc định hoặc nhập mã 6 số).
- Bảng lương là bản đơn giản (lương theo công, làm thêm giờ, phụ cấp, phạt đi muộn). **Chưa gồm BHXH, thuế TNCN**, hãy dùng như số liệu tham khảo cho kế toán.
- Ngày lễ âm lịch phải nhập tay mỗi năm.
- Dùng SQLite một máy chủ: phù hợp từ vài chục đến vài nghìn nhân viên. Chưa hỗ trợ chạy nhiều bản song song.

## Cấu trúc thư mục

```
server/      máy chủ Node.js (API, tính công, SQLite, tạo QR, xuất xlsx)
public/          app nhân viên (PWA): index.html, app.js, app.css, sw.js, manifest, icons/
public/admin/    web quản lý (/admin/)
public/kiosk/    màn hình QR (/kiosk/)
public/shared/   thư viện và CSS dùng chung
scripts/     backup.js, seed-demo.js, smoke-test.js
deploy/      Caddyfile, nginx.conf, chamcong.service, backup-cron.example
```

## Trang chủ hệ thống (`/`)

Vào tên miền (hoặc `IP:3000`) sẽ thấy màn hình đăng nhập. Đăng nhập bằng tài khoản được cấp (mã nhân viên hoặc số điện thoại) thì vào trang chủ gồm các ô chức năng:

| Ô | Trạng thái | Ai thấy |
|---|---|---|
| Chấm Công | Đang dùng, mở app nhân viên `/cc/` | Mọi người |
| Quản Trị Hệ Thống | Đang dùng, mở web quản lý `/admin/` | `admin`, `manager` |
| Quản Lý Hàng Hoá, Công Nợ Và Hoá Đơn, Công cụ Văn Phòng, Giao Hàng Cho Tài Xế, Tiện Ích Khác | Chưa có, bấm vào báo "Tính năng đang phát triển" | Mọi người |

Khi làm xong một chức năng mới: mở `public/portal.js`, trong danh sách `MODULES` thêm `href: 'duong-dan/'` và xoá `soon: true` của chức năng đó. Ô sẽ tự thành liên kết, cả ở menu trái.

Thông tin đăng nhập dùng chung cho `/`, `/cc/` và `/admin/` (đăng nhập một lần). App cài lên điện thoại trước đây từ `/` sẽ tự chuyển sang trang chủ mới, nhân viên bấm ô Chấm Công (hoặc cài lại app từ `/cc/` để có biểu tượng mở thẳng vào chấm công).
