@echo off
title ScriptFlow Live Server
cd /d "%~dp0"

REM --- Find Python (py launcher first, then python) ---
where py >nul 2>nul
if %errorlevel%==0 (
  py server.py
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  goto :end
)

echo.
echo  Python was not found on this PC.
echo  Install it once from https://www.python.org/downloads/  (tick "Add to PATH"),
echo  then double-click this file again.
echo.
pause

:end
