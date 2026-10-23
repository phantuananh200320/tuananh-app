@echo off
rem Cai dat cho phan mem TU CHAY khi bat may tinh (chay ngam, khong can dang nhap Windows)
rem va mo cong tuong lua de may khac trong mang truy cap duoc.
rem Cach dung: bam chuot phai vao file nay, chon "Run as administrator".
setlocal
cd /d "%~dp0"
set TASK=PhanMemQuanLy
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] Hay bam chuot phai vao file nay va chon "Run as administrator".
  echo.
  pause
  exit /b 1
)
set NODE=
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
if not defined NODE (
  echo.
  echo  [!] May chua cai Node.js. Tai ban LTS tai https://nodejs.org, cai xong chay lai file nay.
  start "" "https://nodejs.org/vi/download"
  pause
  exit /b 1
)
set PORT=3000
if exist ".env" for /f "tokens=1,* delims==" %%a in ('findstr /b /i "PORT=" ".env"') do set "PORT=%%b"

echo Dung ban dang chay (neu co)...
"%NODE%" start.js --stop >nul 2>&1
schtasks /End /TN "%TASK%" >nul 2>&1

echo Tao tac vu tu chay khi bat may: %TASK%
schtasks /Create /TN "%TASK%" /TR "\"%NODE%\" \"%~dp0start.js\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F >nul
if errorlevel 1 (
  echo  [!] Khong tao duoc tac vu tu chay.
  pause
  exit /b 1
)
echo Mo cong %PORT% tren tuong lua Windows...
netsh advfirewall firewall delete rule name="%TASK%" >nul 2>&1
netsh advfirewall firewall add rule name="%TASK%" dir=in action=allow protocol=TCP localport=%PORT% >nul

echo Khoi dong phan mem...
schtasks /Run /TN "%TASK%" >nul
timeout /t 6 >nul
start "" "http://localhost:%PORT%"
echo.
echo  Xong. Phan mem dang chay ngam va se tu chay moi khi bat may.
echo  - Mo tren may nay: http://localhost:%PORT%
echo  - Dung phan mem:   chay stop.bat
echo  - Go tu chay:      schtasks /Delete /TN %TASK% /F
echo.
pause
