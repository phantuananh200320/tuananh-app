#!/bin/sh
# Chạy phần mềm trên Linux/macOS: ./start.sh   (thêm --open để mở trình duyệt)
# Máy chủ Linux nên cài thành dịch vụ tự chạy: sudo bash install-linux.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Máy chưa cài Node.js 22 trở lên. Xem INSTALL.md hoặc chạy: sudo bash install-linux.sh"
  exit 1
fi
exec node start.js "$@"
