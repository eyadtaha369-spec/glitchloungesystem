@echo off
REM Double-click this file to start GLITCH Lounge OS locally in background.

echo ============================================
echo    GLITCH Lounge OS - Starting local system
echo ============================================
echo.

echo [1/3] Starting the local database server (port 4000)...
start /b cmd /c "cd /d %~dp0server && npm start"
timeout /t 4 /nobreak > nul

echo [2/3] Starting the app dev server (port 8080)...
start /b cmd /c "cd /d %~dp0 && npm run dev"
timeout /t 6 /nobreak > nul

echo [3/3] Starting the desktop app...
start /b cmd /c "cd /d %~dp0 && npm run electron:dev"

echo.
echo All services started silently in the background!
