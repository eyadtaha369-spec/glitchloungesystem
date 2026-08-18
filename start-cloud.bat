@echo off
REM Double-click this file to start GLITCH Lounge OS in CLOUD MODE.
REM
REM Unlike start-local.bat, this does NOT start the local database
REM server (port 4000) at all — it's not needed. This device talks
REM directly to the same cloud backend the web app uses, so only two
REM things need to run: the app itself, and the desktop shell around it.
REM
REM Before using this for the first time:
REM   1. Copy .env.cloud.example to ".env" in this folder and fill in
REM      your real Apps Script URL and secret.
REM   2. Run the one-time "Migrate to Cloud" tool from Setup, if you
REM      haven't already, so this device's existing data moves over
REM      first — otherwise the cloud won't have it yet.

echo ============================================
echo    GLITCH Lounge OS - CLOUD MODE
echo    (talking directly to the cloud - no local server)
echo ============================================
echo.

echo [1/2] Starting the app dev server (port 8080)...
start /b cmd /c "cd /d %~dp0 && npm run dev"
timeout /t 6 /nobreak > nul

echo [2/2] Starting the desktop app...
start /b cmd /c "cd /d %~dp0 && npm run electron:dev"

echo.
echo Cloud mode started! This device now reads and writes the same
echo data as every other device connected to the cloud.
