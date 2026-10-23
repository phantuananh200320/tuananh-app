#!/bin/sh
# Dừng phần mềm (khi chạy bằng start.sh). Nếu đã cài dịch vụ: sudo systemctl stop chamcong
cd "$(dirname "$0")" || exit 1
exec node start.js --stop
