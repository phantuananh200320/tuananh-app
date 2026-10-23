@echo off
rem Chay phan mem tren Windows: bam dup vao file nay.
setlocal
cd /d "%~dp0"
title Phan mem quan ly - dang chay (dong cua so nay de dung)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [!] May chua cai Node.js.
  echo      Hay tai ban LTS tai https://nodejs.org ^(chon "Windows Installer"^), cai xong chay lai file nay.
  echo.
  start "" "https://nodejs.org/vi/download"
  pause
  exit /b 1
)
node start.js --open %*
if errorlevel 1 pause
