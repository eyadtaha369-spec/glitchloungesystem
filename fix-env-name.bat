@echo off
REM Fixes the single most common setup mistake: Windows hides known file
REM extensions by default, so copying ".env.cloud.example" and renaming
REM it to ".env" in File Explorer often actually produces ".env.txt"
REM (Notepad/Explorer silently keep the .txt), which the app can never
REM find — it looks for a file named EXACTLY ".env", nothing else.
REM
REM This works directly from Command Prompt, so it doesn't matter
REM whether "hide extensions" is on or off in Explorer — it renames the
REM real file on disk either way.

setlocal
cd /d %~dp0

if exist ".env" (
  echo A file named exactly ".env" already exists here — nothing to fix.
  echo Its content:
  echo ----------------------------------------
  type ".env"
  echo ----------------------------------------
  goto :end
)

if exist ".env.txt" (
  echo Found ".env.txt" — this is almost certainly the real problem.
  ren ".env.txt" ".env"
  echo Renamed it to ".env". Its content:
  echo ----------------------------------------
  type ".env"
  echo ----------------------------------------
  goto :end
)

echo No ".env" or ".env.txt" found in this folder at all.
echo Copy ".env.cloud.example" to ".env" here first, fill in your real
echo values, then run this script again to confirm it's named correctly.

:end
echo.
pause
