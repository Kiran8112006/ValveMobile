@echo off
title Valve Dev
cd /d "%~dp0"

echo.
echo  ================================
echo   Valve Mobile ^| Dev Launcher
echo  ================================
echo.
echo  Starting Backend (Fastify :8080) ...
start "Valve Backend" cmd /k "cd /d "%~dp0apps\backend" && npm run dev"

timeout /t 3 /nobreak >nul

echo  Starting Mobile (Expo Android) ...
start "Valve Mobile" cmd /k "cd /d "%~dp0apps\mobile" && npm run android"

echo.
echo  Both servers are starting in separate windows.
echo  Close those windows to stop them.
echo.
pause
