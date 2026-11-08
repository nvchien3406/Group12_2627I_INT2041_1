@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Cai dat chua thanh cong. Doc thong bao phia tren.
  pause
  exit /b 1
)
echo.
echo Cai dat xong. Chay run.bat de mo ung dung.
pause
