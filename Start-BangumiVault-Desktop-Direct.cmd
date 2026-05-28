@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Bangumi Vault Desktop Direct

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Bangumi Vault] electron.exe was not found.
  echo [Bangumi Vault] Run Start-BangumiVault-Desktop.cmd or Repair-Electron-Install.cmd first.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path (Get-Location) 'node_modules\electron\path.txt'; [System.IO.File]::WriteAllText($p, 'electron.exe', [System.Text.Encoding]::ASCII)" >nul 2>nul
if exist "scripts\patch-electron-icon.js" (
  echo [Bangumi Vault] Applying app icon to development Electron runtime...
  node "scripts\patch-electron-icon.js"
)

set "APP_DIR=%CD%"
echo [Bangumi Vault] Starting desktop window from: %APP_DIR%
"%~dp0node_modules\electron\dist\electron.exe" "%APP_DIR%"
if errorlevel 1 pause
