@echo off
REM Fixes the two most common setup mistakes:
REM   1. Windows hides known file extensions by default, so renaming a
REM      copy to ".env" in File Explorer often actually produces
REM      ".env.txt" (Notepad/Explorer silently keep the .txt).
REM   2. Editing ".env.cloud.example" directly with real values, but
REM      never actually making a COPY named ".env" — the app only ever
REM      looks for a file named EXACTLY ".env", never the .example one.
REM
REM Works entirely from Command Prompt, so it doesn't matter whether
REM "hide extensions" is on or off in Explorer, and it shows the real
REM file list so there's no more guessing about what's actually here.

setlocal
cd /d %~dp0

echo Files in this folder that start with ".env":
dir /b ".env*" 2>nul
if errorlevel 1 echo   (none found at all)
echo.

if exist ".env" (
  echo A file named exactly ".env" already exists here. Its content:
  echo ----------------------------------------
  type ".env"
  echo ----------------------------------------
  goto :end
)

if exist ".env.txt" (
  echo Found ".env.txt" — this is almost certainly the problem.
  ren ".env.txt" ".env"
  echo Renamed it to ".env". Its content:
  echo ----------------------------------------
  type ".env"
  echo ----------------------------------------
  goto :end
)

if exist ".env.cloud.example" (
  findstr /C:"PASTE_YOUR_DEPLOYMENT_ID_HERE" ".env.cloud.example" >nul
  if errorlevel 1 (
    echo ".env.cloud.example" no longer has the placeholder text in it —
    echo it looks like real values were typed directly into this template
    echo file, but it was never actually copied to a file named ".env".
    copy ".env.cloud.example" ".env" >nul
    echo Copied it to ".env" just now. Its content:
    echo ----------------------------------------
    type ".env"
    echo ----------------------------------------
    goto :end
  )
)

echo No ".env", ".env.txt", or edited ".env.cloud.example" found here.
echo Copy ".env.cloud.example" to ".env" here first, fill in your real
echo values, then run this script again to confirm it's named correctly.

:end
echo.
pause
