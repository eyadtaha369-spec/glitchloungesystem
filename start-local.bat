@echo off
REM Double-click this file (or run it from PowerShell/cmd) to start
REM everything needed to run GLITCH Lounge OS locally, in the right
REM order, each in its own window. No need to type the same commands
REM into three separate PowerShell windows every time.

echo ============================================
echo   GLITCH Lounge OS - Starting local system
echo ============================================
echo.

echo [1/3] Starting the local database server (port 4000)...
start "GLITCH - Server (port 4000)" cmd /k "cd /d %~dp0server && npm start"
timeout /t 4 /nobreak > nul

echo [2/3] Starting the app dev server (port 8080)...
start "GLITCH - Dev Server (port 8080)" cmd /k "cd /d %~dp0 && npm run dev"
timeout /t 6 /nobreak > nul

echo [3/3] Starting the desktop app...
start "GLITCH - Desktop App" cmd /k "cd /d %~dp0 && npm run electron:dev"

echo.
echo All three windows launched. This window can be closed -
echo just leave the three new ones open while you work.
echo.
pause
