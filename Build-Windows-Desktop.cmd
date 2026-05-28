@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Bangumi Vault - Build Windows Desktop

echo [Bangumi Vault] Preparing Windows build...
echo.

set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
set "npm_config_registry=https://registry.npmmirror.com"
set "npm_config_cache=%CD%\.npm-cache"
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "npm_config_electron_skip_binary_download="

if not exist "node_modules\electron\dist\electron.exe" (
  call "%~dp0Install-Desktop-Dependencies.cmd"
  if errorlevel 1 exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Bangumi Vault] Electron executable is missing. Repairing runtime...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Electron-Runtime.ps1" -Version 31.7.7 -Mirror "%ELECTRON_MIRROR%"
  if errorlevel 1 exit /b 1
)

if exist "node_modules\electron\dist\electron.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path (Get-Location) 'node_modules\electron\path.txt'; [System.IO.File]::WriteAllText($p, 'electron.exe', [System.Text.Encoding]::ASCII)" >nul 2>nul
)

echo.
echo [Bangumi Vault] Building Windows exe. Output will be in the dist folder.
echo.
call npm run dist:win
if errorlevel 1 (
  echo.
  echo [Bangumi Vault] Build failed.
  pause
  exit /b 1
)

echo.
echo [Bangumi Vault] Build complete. Opening dist folder...
start "" "%~dp0dist"
pause
