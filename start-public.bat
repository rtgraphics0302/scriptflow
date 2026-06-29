@echo off
title ScriptFlow - PUBLIC (share with anyone)
cd /d "%~dp0"

echo ============================================================
echo   Starting ScriptFlow server...
echo ============================================================

REM Start the live server in its own window (py first, then python).
where py >nul 2>nul
if %errorlevel%==0 (
  start "ScriptFlow Server" cmd /c "py server.py --no-open"
) else (
  start "ScriptFlow Server" cmd /c "python server.py --no-open"
)

REM Give the server a moment to come up.
timeout /t 4 >nul

echo.
echo ============================================================
echo   Creating your PUBLIC link...
echo.
echo   Look below for a line like:
echo       https://something-something.trycloudflare.com
echo.
echo   Copy that whole https:// address and send it to anyone.
echo   That is your shareable board link.
echo.
echo   Keep THIS window open while people are using the board.
echo ============================================================
echo.

cloudflared.exe tunnel --url http://localhost:8765 --no-autoupdate

echo.
echo Tunnel closed. Your board is no longer public.
pause
