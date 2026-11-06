@echo off
chcp 65001 >nul
title OMIKA · запуск
cd /d "%~dp0"

echo.
echo  OMIKA
echo  ----------------------------------------
echo  Сервер:  http://127.0.0.1:7801
echo  Сайт:    https://game.okinamura.com
echo  Telegram: отдельное окно
echo  ----------------------------------------
echo.

start "OMIKA · SERVER" cmd /k "start.cmd"
timeout /t 3 /nobreak >nul

if exist ".cloudflare-tunnel.env" (
  start "OMIKA · TUNNEL" cmd /k "scripts\start-tunnel.cmd"
) else (
  echo  .cloudflare-tunnel.env не найден — публичный туннель не запускаю.
)

if exist ".telegram.env" (
  start "OMIKA · TELEGRAM" cmd /k "scripts\start-telegram.cmd"
) else (
  echo  .telegram.env не найден — Telegram-бот не запускаю.
)

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:7801"

echo.
echo  Если сервер не поднялся:
echo    node scripts\dev.mjs status
echo    node scripts\dev.mjs restart
echo.
pause
