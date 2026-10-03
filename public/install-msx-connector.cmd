@echo off
rem Cloud Delivery: installs the MSX connector on this PC so the Cloud Delivery web app can read MSX as you.
rem It checks Node.js, gets msx-mcp if it's missing, installs the connector (started hidden at every Windows
rem sign-in) and opens Cloud Delivery. Nothing here needs admin rights. To remove it later:
rem   node "%LOCALAPPDATA%\CloudDelivery\msx-connector.mjs" --uninstall
setlocal
title Cloud Delivery - MSX connector
if not defined CD_APP set "CD_APP=https://clouddelivery-nzdefv.azurewebsites.net"
set "MSXMCP=%USERPROFILE%\msx-mcp\bundle\msx.mjs"
echo.
echo  Cloud Delivery - MSX connector
echo  ------------------------------
echo.

where node >nul 2>nul || goto :nonode
for /f "tokens=1 delims=v." %%v in ('node -v') do set "NODEMAJOR=%%v"
if %NODEMAJOR% LSS 22 goto :nonode
echo  [ok] Node.js v%NODEMAJOR%

if exist "%MSXMCP%" goto :havemsxmcp
echo  msx-mcp isn't in %USERPROFILE%\msx-mcp yet.
echo  Your browser will now download it from GitHub. If GitHub asks, sign in with your Microsoft EMU account.
start "" "https://github.com/mcaps-microsoft/msx-mcp/archive/HEAD.zip"
echo  Waiting for the download (up to 4 minutes)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d = Join-Path $env:USERPROFILE 'Downloads'; $since = (Get-Date).AddMinutes(-1); for ($i = 0; $i -lt 120; $i++) { $z = Get-ChildItem $d -Filter 'msx-mcp-*.zip' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $since } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if ($z) { Start-Sleep 2; $x = Join-Path $env:TEMP 'cd-msx-mcp'; Remove-Item $x -Recurse -Force -ErrorAction SilentlyContinue; Expand-Archive $z.FullName $x -Force; $in = Get-ChildItem $x -Directory | Select-Object -First 1; Move-Item $in.FullName (Join-Path $env:USERPROFILE 'msx-mcp'); Remove-Item $x -Recurse -Force; exit 0 }; Start-Sleep 2 }; exit 1"
if not exist "%MSXMCP%" goto :nomsxmcp
:havemsxmcp
echo  [ok] msx-mcp

echo  Downloading the connector...
curl.exe -fsSL "%CD_APP%/msx-connector.mjs" -o "%TEMP%\msx-connector.mjs" || goto :nodownload
node "%TEMP%\msx-connector.mjs" --install || goto :failed
del "%TEMP%\msx-connector.mjs" >nul 2>nul

echo.
echo  Done. Opening Cloud Delivery.
echo  - Keep the corporate VPN on.
echo  - If Edge asks to let the site access apps and services on this device, click Allow.
echo  - Then click "Sign in to MSX" once.
start "" "%CD_APP%/customers/onboard"
echo.
pause
exit /b 0

:nonode
echo  Node.js 22 or later is needed (msx-mcp runs on it).
echo  Install it with:  winget install OpenJS.NodeJS.LTS
echo  or from https://nodejs.org, then double-click this file again.
goto :end

:nomsxmcp
echo  msx-mcp didn't arrive. Download https://github.com/mcaps-microsoft/msx-mcp (Code, Download ZIP),
echo  unzip it to %USERPROFILE%\msx-mcp, then double-click this file again.
goto :end

:nodownload
echo  Couldn't download the connector from %CD_APP%. Check your connection and try again.
goto :end

:failed
echo  The connector didn't start. Run this file again; if it still fails, send this window to the Cloud Delivery team.

:end
echo.
pause
exit /b 1
