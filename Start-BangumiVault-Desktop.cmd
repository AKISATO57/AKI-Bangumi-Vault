@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Bangumi Vault Desktop

where npm >nul 2>nul
if errorlevel 1 (
  echo [Bangumi Vault] Node.js / npm was not found. Please install Node.js LTS first.
  pause
  exit /b 1
)

set "ELECTRON_VERSION=31.7.7"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "npm_config_registry=https://registry.npmmirror.com"
set "npm_config_cache=%CD%\.npm-cache"
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "npm_config_electron_skip_binary_download="

if not exist "node_modules\electron\package.json" (
  echo [Bangumi Vault] Electron package is missing.
  echo [Bangumi Vault] Installing desktop dependencies now...
  echo.
  call "%~dp0Install-Desktop-Dependencies.cmd"
  if errorlevel 1 exit /b 1
)

if exist "scripts\patch-electron-icon.js" (
  echo [Bangumi Vault] Applying app icon to development Electron runtime...
  node "scripts\patch-electron-icon.js"
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Bangumi Vault] Electron runtime is missing or incomplete.
  echo [Bangumi Vault] Installing Electron runtime now...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Electron-Runtime.ps1" -Version %ELECTRON_VERSION% -Mirror "%ELECTRON_MIRROR%"
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if exist "node_modules\electron\dist\electron.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path (Get-Location) 'node_modules\electron\path.txt'; [System.IO.File]::WriteAllText($p, 'electron.exe', [System.Text.Encoding]::ASCII)" >nul 2>nul
)

if exist "scripts\patch-electron-icon.js" (
  echo [Bangumi Vault] Applying app icon to development Electron runtime...
  node "scripts\patch-electron-icon.js"
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Bangumi Vault] Electron executable is still missing.
  echo [Bangumi Vault] Please run Repair-Electron-Install.cmd.
  pause
  exit /b 1
)

set "APP_DIR=%CD%"
echo [Bangumi Vault] Starting desktop window from: %APP_DIR%
"%~dp0node_modules\electron\dist\electron.exe" "%APP_DIR%"
set "BV_EXIT=%ERRORLEVEL%"
if not "%BV_EXIT%"=="0" (
  echo.
  echo [Bangumi Vault] Electron exited with code %BV_EXIT%.
  echo [Bangumi Vault] If you see "Unable to find Electron app", try Start-BangumiVault-Desktop-Direct.cmd.
  pause
)
exit /b %BV_EXIT%
