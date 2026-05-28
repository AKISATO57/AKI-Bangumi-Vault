@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Bangumi Vault - Install Desktop Dependencies

echo [Bangumi Vault] Installing desktop dependencies...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [Bangumi Vault] Node.js was not found. Please install Node.js LTS first.
  echo Download: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [Bangumi Vault] npm was not found. Please reinstall Node.js LTS.
  pause
  exit /b 1
)

set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "npm_config_electron_skip_binary_download="
set "ELECTRON_CUSTOM_DIR="
set "npm_config_electron_custom_dir="
set "ELECTRON_VERSION=31.7.7"
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "npm_config_registry=https://registry.npmmirror.com"
set "npm_config_cache=%CD%\.npm-cache"
set "npm_config_fetch_retries=5"
set "npm_config_fetch_retry_mintimeout=10000"
set "npm_config_fetch_retry_maxtimeout=120000"

if exist "node_modules\electron" (
  echo [Bangumi Vault] Removing incomplete Electron package...
  rmdir /s /q "node_modules\electron"
)

if exist "package-lock.json" (
  echo [Bangumi Vault] Removing old package-lock.json...
  del /q "package-lock.json"
)

echo [Bangumi Vault] Using npm registry: https://registry.npmmirror.com
echo [Bangumi Vault] Using Electron mirror: %ELECTRON_MIRROR%
echo.

call npm install --registry=https://registry.npmmirror.com --foreground-scripts --loglevel=info --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [Bangumi Vault] npm install failed.
  echo [Bangumi Vault] Try switching networks, disabling VPN/proxy temporarily, or running this file again.
  pause
  exit /b 1
)

if exist "scripts\patch-electron-icon.js" (
  echo [Bangumi Vault] Applying app icon to development Electron runtime...
  node "scripts\patch-electron-icon.js"
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo [Bangumi Vault] Electron npm package installed, but runtime executable is missing.
  echo [Bangumi Vault] This usually means Electron binary download was skipped or interrupted.
  echo [Bangumi Vault] Installing the Electron runtime manually now...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Electron-Runtime.ps1" -Version %ELECTRON_VERSION% -Mirror "%ELECTRON_MIRROR%"
  if errorlevel 1 (
    echo.
    echo [Bangumi Vault] Manual Electron runtime install failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo [Bangumi Vault] Electron executable is still missing. Repairing runtime...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Electron-Runtime.ps1" -Version %ELECTRON_VERSION% -Mirror "%ELECTRON_MIRROR%"
)

if exist "node_modules\electron\dist\electron.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path (Get-Location) 'node_modules\electron\path.txt'; [System.IO.File]::WriteAllText($p, 'electron.exe', [System.Text.Encoding]::ASCII)" >nul 2>nul
)

if exist "scripts\patch-electron-icon.js" (
  echo [Bangumi Vault] Applying app icon to development Electron runtime...
  node "scripts\patch-electron-icon.js"
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo [Bangumi Vault] Electron runtime is still incomplete.
  echo [Bangumi Vault] Please delete the node_modules folder and run this file again.
  pause
  exit /b 1
)

echo.
echo [Bangumi Vault] Desktop dependencies are ready.
exit /b 0
