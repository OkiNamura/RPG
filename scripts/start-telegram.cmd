@echo off
chcp 65001 >nul
title OMIKA · Telegram
cd /d "%~dp0.."
where node >nul 2>nul
if %errorlevel%==0 (
  node "scripts\telegram-bot.mjs"
) else (
  "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "scripts\telegram-bot.mjs"
)
pause
