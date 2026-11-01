@echo off
setlocal
set "ROOT=%~dp0.."
set "TOKEN="
for /f "usebackq tokens=1,* delims==" %%A in ("%ROOT%\.cloudflare-tunnel.env") do (
  if /i "%%A"=="CLOUDFLARE_TUNNEL_TOKEN" set "TOKEN=%%B"
)
if "%TOKEN%"=="" (
  echo Нет .cloudflare-tunnel.env с CLOUDFLARE_TUNNEL_TOKEN
  exit /b 1
)
"%ROOT%\tools\cloudflared\cloudflared.exe" tunnel --no-autoupdate run --token %TOKEN%
