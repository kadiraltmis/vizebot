@echo off
title Visa Monitor
echo.
echo === Visa Monitor Baslatici ===
echo.

echo [1/4] Chrome baslatiliyor...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\chrome-debug --no-first-run --no-default-browser-check

echo [2/4] Chrome hazir olana kadar bekleniyor...
:wait
timeout /t 2 /nobreak >nul
curl -s http://localhost:9222/json/version >nul 2>&1
if errorlevel 1 goto wait

echo [3/3] Visa Monitor baslatiliyor...
echo.
cd /d D:\cloudecode\visa-monitor
npm start
pause
