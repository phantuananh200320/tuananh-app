@echo off
rem Dung phan mem dang chay (ke ca khi dang chay ngam luc bat may).
setlocal
cd /d "%~dp0"
node start.js --stop
timeout /t 3 >nul
