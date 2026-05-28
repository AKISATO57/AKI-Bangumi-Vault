@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Bangumi Vault - Repair Electron

echo [Bangumi Vault] Repairing Electron installation...
echo [Bangumi Vault] This fixes missing runtime, path.txt newline, and launch path issues.
echo.

call "%~dp0Install-Desktop-Dependencies.cmd"
if errorlevel 1 exit /b 1

if exist "scripts\patch-electron-icon.js" (
  echo [Bangumi Vault] Applying app icon to development Electron runtime...
  node "scripts\patch-electron-icon.js"
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [Bangumi Vault] Electron executable was not found after repair.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path (Get-Location) 'node_modules\electron\path.txt'; [System.IO.File]::WriteAllText($p, 'electron.exe', [System.Text.Encoding]::ASCII)" >nul 2>nul

set "APP_DIR=%CD%"
echo.
echo [Bangumi Vault] Repair complete. Starting desktop app from: %APP_DIR%
"%~dp0node_modules\electron\dist\electron.exe" "%APP_DIR%"
pause
