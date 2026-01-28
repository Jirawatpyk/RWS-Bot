@echo off
title Auto RWS Control Menu

:menu
cls
echo.
echo ============================
echo      Auto RWS Control
echo ============================
echo [1] Start Auto RWS
echo [2] Restart Auto RWS
echo [3] Stop Auto RWS
echo [4] Show Logs
echo [5] Setup Auto-Start (PM2 boot)
echo [6] Exit
echo.
set /p choice="Enter your choice [1-6]: "

if "%choice%"=="1" goto opt_start
if "%choice%"=="2" goto opt_restart
if "%choice%"=="3" goto opt_stop
if "%choice%"=="4" goto opt_logs
if "%choice%"=="5" goto opt_autostart
if "%choice%"=="6" goto opt_exit

echo.
echo Invalid input. Please enter a number between 1 and 6.
pause
goto menu

:opt_start
echo Starting Auto RWS...
pm2 start ecosystem.config.js
pm2 save
pause
goto menu

:opt_restart
echo Restarting Auto RWS...
pm2 restart AutoRWS
pm2 save
pause
goto menu

:opt_stop
echo Stopping Auto RWS...
pm2 stop AutoRWS
pause
goto menu

:opt_logs
echo Showing logs... (Press Ctrl+C to exit)
pm2 logs AutoRWS
goto menu

:opt_autostart
cls
echo.
echo ============================
echo     Auto-Start Options
echo ============================
echo [1] Install auto-start (first time)
echo [2] Enable auto-start
echo [3] Disable auto-start
echo [4] Back to main menu
echo.
set /p subchoice="Enter your choice [1-4]: "

if "%subchoice%"=="1" goto sub_install
if "%subchoice%"=="2" goto sub_enable
if "%subchoice%"=="3" goto sub_disable
if "%subchoice%"=="4" goto menu

echo Invalid input.
pause
goto opt_autostart

:sub_install
echo.
echo Installing pm2-windows-startup...
call npm install pm2-windows-startup -g
echo.
echo Registering startup...
call pm2-startup install
call pm2 save
echo.
echo Done! Auto-start installed.
pause
goto menu

:sub_enable
echo.
echo Enabling auto-start...
call pm2-startup install
call pm2 save
echo Done!
pause
goto menu

:sub_disable
echo.
echo Disabling auto-start...
call pm2-startup uninstall
echo Done!
pause
goto menu

:opt_exit
echo Exiting...
exit
