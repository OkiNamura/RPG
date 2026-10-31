@echo off
chcp 65001 >nul
title OMIKA
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node "src\server.ts"
) else (
  "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "src\server.ts"
)
pause
