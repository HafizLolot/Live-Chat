@echo off
title HaloDesk Live Chat
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js belum terpasang. Silakan install Node.js versi 18 atau lebih baru
  echo dari https://nodejs.org kemudian jalankan file ini lagi.
  echo.
  pause
  exit /b 1
)

echo.
echo  Membuka HaloDesk Live Chat...
echo  Tekan Ctrl+C untuk menghentikan pelayan.
echo.

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
node server.js

pause
