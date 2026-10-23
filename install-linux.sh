#!/usr/bin/env bash
# Cài phần mềm thành dịch vụ chạy nền trên máy chủ Linux (Ubuntu, Debian, CentOS/Rocky/Alma).
#   1) Giải nén gói cài đặt, ví dụ vào /opt/chamcong
#   2) sudo bash /opt/chamcong/install-linux.sh
# Chạy lại script này bất kỳ lúc nào (cài lại, đổi cổng) đều an toàn: dữ liệu giữ nguyên.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE=chamcong
APP_USER=chamcong
DATA_DIR_DEFAULT=/var/lib/chamcong

[ "$(id -u)" -eq 0 ] || { echo "[!] Hãy chạy bằng quyền root: sudo bash $0"; exit 1; }
command -v systemctl >/dev/null || { echo "[!] Máy không dùng systemd. Hãy chạy bằng: ./start.sh"; exit 1; }

# ---------- Node.js 22 LTS trở lên ----------
need_node() {
  command -v node >/dev/null 2>&1 || return 0
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?1:0)'
}
if need_node; then
  echo "==> Cài Node.js 22 LTS"
  if command -v apt-get >/dev/null; then
    apt-get update -y && apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null || command -v yum >/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    (command -v dnf >/dev/null && dnf install -y nodejs) || yum install -y nodejs
  else
    echo "[!] Không tự cài được Node.js trên hệ điều hành này. Cài Node.js 22 LTS thủ công rồi chạy lại."; exit 1
  fi
fi
NODE_BIN="$(command -v node)"
echo "==> Node.js $(node -v) tại $NODE_BIN"

# ---------- tài khoản chạy dịch vụ, thư mục dữ liệu ----------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Tạo file cấu hình $APP_DIR/.env"
  ADMIN_PW="$(node -e 'console.log(require("crypto").randomBytes(6).toString("base64url"))')"
  cat > "$APP_DIR/.env" <<CONF
# Cấu hình phần mềm (sửa xong chạy: sudo systemctl restart $SERVICE)
PORT=3000
HOST=0.0.0.0
DATA_DIR=$DATA_DIR_DEFAULT
APP_TZ=Asia/Ho_Chi_Minh
# Tài khoản quản trị đầu tiên (chỉ dùng khi cơ sở dữ liệu còn trống; lần đăng nhập đầu sẽ bắt đổi mật khẩu)
ADMIN_CODE=admin
ADMIN_PASSWORD=$ADMIN_PW
# Khi chạy sau Nginx/Caddy (HTTPS) thì bật dòng dưới và điền tên miền
# TRUST_PROXY=1
# PUBLIC_URL=https://quanly.congty.vn
CONF
  NEW_ADMIN=1
fi
# Đọc lại cấu hình đang dùng
set -a; . "$APP_DIR/.env"; set +a
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
PORT="${PORT:-3000}"
mkdir -p "$DATA_DIR"

# Chuyển dữ liệu cũ nằm trong thư mục phần mềm (bản chạy bằng start.sh) sang thư mục dữ liệu mới
if [ "$DATA_DIR" != "$APP_DIR/data" ] && [ -f "$APP_DIR/data/chamcong.db" ] && [ ! -f "$DATA_DIR/chamcong.db" ]; then
  echo "==> Chuyển dữ liệu cũ từ $APP_DIR/data sang $DATA_DIR"
  cp -a "$APP_DIR/data/." "$DATA_DIR/"
fi
chown -R "$APP_USER": "$APP_DIR" "$DATA_DIR"
chmod 600 "$APP_DIR/.env"
chmod +x "$APP_DIR"/start.sh "$APP_DIR"/stop.sh "$APP_DIR"/start.js 2>/dev/null || true

# ---------- dịch vụ systemd ----------
CAP=""
[ "$PORT" -lt 1024 ] && CAP="AmbientCapabilities=CAP_NET_BIND_SERVICE"
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=Phan mem quan ly (chamcong ERP)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN $APP_DIR/start.js
Restart=always
RestartSec=3
KillMode=mixed
TimeoutStopSec=20
$CAP
# Thư mục phần mềm phải ghi được để cập nhật trên web hoạt động
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP_DIR $DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null
systemctl restart $SERVICE

# ---------- tường lửa ----------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow "$PORT"/tcp >/dev/null || true; fi
if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --permanent --add-port="$PORT"/tcp >/dev/null && firewall-cmd --reload >/dev/null || true; fi

echo "==> Chờ phần mềm khởi động..."
for i in $(seq 1 30); do
  if node -e "fetch('http://127.0.0.1:$PORT/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then OK=1; break; fi
  sleep 1
done
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
if [ "${OK:-0}" = 1 ]; then
  echo "  Đã cài xong, phần mềm đang chạy và sẽ tự chạy khi khởi động máy."
else
  echo "  [!] Phần mềm chưa lên. Xem log: journalctl -u $SERVICE -n 50   hoặc   $DATA_DIR/logs/"
fi
echo "  Địa chỉ:            http://${IP:-<ip-máy-chủ>}:$PORT"
echo "  Dữ liệu:            $DATA_DIR"
[ "${NEW_ADMIN:-0}" = 1 ] && echo "  Đăng nhập lần đầu:  admin / $ADMIN_PW   (hệ thống sẽ bắt đổi mật khẩu)"
echo "  Quản lý dịch vụ:    sudo systemctl status|restart|stop $SERVICE"
echo "  Cập nhật phiên bản: vào Hệ thống → Cập nhật phần mềm, chọn file cập nhật"
