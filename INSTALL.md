# Hướng dẫn cài đặt

Phần mềm chỉ cần **Node.js 22 LTS trở lên** (hoặc 24 LTS). Không cần cơ sở dữ liệu riêng, không cần `npm install`.
Dữ liệu (cơ sở dữ liệu, ảnh chấm công, bản sao lưu, log) nằm trong **thư mục dữ liệu**, tách khỏi phần mềm:
cài lại hay cập nhật đều không mất dữ liệu.

## 1. Máy chủ Windows (hoặc máy tính để bàn)

1. Cài Node.js bản LTS từ https://nodejs.org (chọn *Windows Installer*, bấm Next đến hết).
2. Giải nén `chamcong-x.y.z-cai-dat.zip`, ví dụ vào `C:\PhanMemQuanLy` (thư mục `chamcong` bên trong).
3. Bấm đúp **`start.bat`**. Cửa sổ đen hiện địa chỉ truy cập và trình duyệt tự mở `http://localhost:3000`.
4. Đăng nhập `admin` / `admin123`, hệ thống bắt đổi mật khẩu ngay lần đầu.

Cho phần mềm **tự chạy khi bật máy** (chạy ngầm, không cần mở cửa sổ): bấm chuột phải **`cai-dat-windows.bat`**, chọn *Run as administrator*.
Script tạo tác vụ tự chạy, mở cổng trên tường lửa để máy khác trong mạng vào được. Dừng phần mềm: chạy `stop.bat`.

Dữ liệu nằm ở `chamcong\data`. Đổi cổng hoặc cấu hình: chép `.env.example` thành `.env` rồi sửa (ví dụ `PORT=8080`).

## 2. Máy chủ Linux (Ubuntu, Debian, CentOS, Rocky, Alma)

```bash
sudo mkdir -p /opt && cd /opt
sudo tar -xzf chamcong-x.y.z-cai-dat.tar.gz        # tạo /opt/chamcong
sudo bash /opt/chamcong/install-linux.sh
```

Script tự cài Node.js 22 nếu chưa có, tạo file cấu hình `/opt/chamcong/.env` (in ra mật khẩu quản trị đầu tiên),
tạo dịch vụ `chamcong` tự chạy khi khởi động máy, mở cổng tường lửa. Dữ liệu nằm ở `/var/lib/chamcong`.

```bash
sudo systemctl status chamcong      # xem trạng thái
sudo systemctl restart chamcong     # chạy lại sau khi sửa .env
journalctl -u chamcong -f           # xem log (hoặc /var/lib/chamcong/logs)
```

Chạy thử không cài dịch vụ: `./start.sh` (dừng bằng Ctrl+C hoặc `./stop.sh`).

## 3. Docker

```bash
cp .env.example .env     # sửa DOMAIN, ADMIN_PASSWORD
docker compose up -d --build
```

Caddy đi kèm tự cấp chứng chỉ HTTPS cho tên miền trong `DOMAIN`.

## HTTPS (bắt buộc cho camera, GPS và cài app lên điện thoại)

Trình duyệt chỉ cho dùng camera, định vị và cài app khi trang chạy qua `https://`. Trong mạng nội bộ vẫn dùng được trang quản lý và đặt hàng qua `http://`.
Khi mở ra Internet: dùng Docker (Caddy tự lo HTTPS), hoặc đặt Nginx/Caddy phía trước (mẫu trong `deploy/`), rồi thêm vào `.env`:

```
TRUST_PROXY=1
PUBLIC_URL=https://quanly.congty.vn
```

## Cập nhật phiên bản mới

Đăng nhập quản trị viên, vào **Hệ thống → Cập nhật phần mềm**, kéo thả file `chamcong-update-x.y.z.tgz`
(hoặc cả gói cài đặt `.zip`), nhập mật khẩu, bấm **Cập nhật ngay**. Không cần làm gì trên máy chủ:

- Hệ thống tự sao lưu dữ liệu trước khi cập nhật và giữ bản cũ để **Quay lại bản trước** khi cần.
- Phần lớn bản cập nhật có hiệu lực ngay, không ngắt người đang dùng.
- Bản đổi phần lõi: phần mềm tự khởi động lại trong vài giây (khi chạy bằng `start.bat`, `start.sh`, dịch vụ Linux hoặc Docker), trang tự tải lại.

Muốn tắt hẳn cập nhật trên web: thêm `ALLOW_ONLINE_UPDATE=0` vào `.env`.
Muốn chỉ nhận gói có chữ ký số: `node scripts/gen-update-key.js`, đặt `UPDATE_PUBLIC_KEY` trong `.env`, đóng gói bằng `--sign=...`.

## Cài lại từ đầu, chuyển sang máy khác

1. Trên máy cũ: **Cài đặt → Sao lưu và khôi phục → Tải bản sao lưu** (hoặc chép nguyên thư mục dữ liệu: `chamcong\data` trên Windows, `/var/lib/chamcong` trên Linux).
2. Cài gói mới theo mục 1 hoặc 2 ở trên.
3. Khôi phục bản sao lưu trong trang Cài đặt, hoặc chép thư mục dữ liệu vào đúng chỗ trước khi chạy.

Trên Linux, chạy lại `install-linux.sh` lúc nào cũng an toàn: không xoá dữ liệu, không ghi đè `.env` đã có.

## Đóng gói bản mới (cho người phát triển)

1. Tăng `version` trong `package.json`.
2. `node scripts/make-release.js --notes="Nội dung thay đổi"`.
3. Thư mục `dist/` có: gói cài đặt `.zip` và `.tar.gz`, file cập nhật `.tgz`, `SHA256SUMS.txt`.
4. Kiểm thử: `npm test`.
