@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
echo Starting Madar on http://127.0.0.1:3210
echo Keep this window open while you use the system.
echo Press Ctrl+C to stop the server.
node server.mjs
pause
