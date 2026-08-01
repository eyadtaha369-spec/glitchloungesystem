@echo off
REM Closes all three GLITCH windows cleanly. Use this before shutting
REM down for the day, or if something seems stuck - it specifically
REM targets only windows titled "GLITCH - ..." (the ones start-local.bat
REM opens), so it won't touch any other unrelated programs on your PC.
REM
REM This matters more than it might seem: a server window left running
REM in the background after you think you've closed everything is
REM exactly what caused the "database is locked" bug fixed earlier -
REM a leftover process quietly still holding the database file open.

echo Stopping GLITCH windows...
taskkill /FI "WINDOWTITLE eq GLITCH - Server*" /T /F > nul 2>&1
taskkill /FI "WINDOWTITLE eq GLITCH - Dev Server*" /T /F > nul 2>&1
taskkill /FI "WINDOWTITLE eq GLITCH - Desktop*" /T /F > nul 2>&1

echo Done. Run this again anytime you're not sure if something's still running.
pause
