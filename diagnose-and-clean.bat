@echo off
REM Fully automated diagnostic + clean restart — removes any chance of
REM a missed manual step. Kills stray processes, deletes every cache
REM folder that could hold a stale build, prints the ACTUAL raw content
REM of .env directly (so there's no ambiguity about what's really in
REM it), then starts fresh in cloud mode.

echo ============================================
echo   DIAGNOSE AND CLEAN RESTART
echo ============================================
echo.

echo [1/5] Killing any stray node/electron processes...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
timeout /t 2 /nobreak > nul

echo [2/5] Deleting all cache folders...
if exist "%~dp0.output" rmdir /s /q "%~dp0.output"
if exist "%~dp0.vinxi" rmdir /s /q "%~dp0.vinxi"
if exist "%~dp0.tanstack" rmdir /s /q "%~dp0.tanstack"
if exist "%~dp0.nitro" rmdir /s /q "%~dp0.nitro"
if exist "%~dp0node_modules\.vite" rmdir /s /q "%~dp0node_modules\.vite"
echo   Done.

echo [3/5] Showing the ACTUAL current content of .env (this is the real
echo        source of truth — if this doesn't show your real cloud URL,
echo        nothing else will work regardless of what we've tried):
echo.
echo ----------------------------------------
type "%~dp0.env"
echo ----------------------------------------
echo.

echo [4/5] Starting the app dev server (port 8080)...
start /b cmd /c "cd /d %~dp0 && npm run dev"
timeout /t 6 /nobreak > nul

echo [5/5] Starting the desktop app...
start /b cmd /c "cd /d %~dp0 && npm run electron:dev"

echo.
echo Done. Watch this window for the [callAppsScript] line once you
echo try to log in — it will show the exact URL being used.
