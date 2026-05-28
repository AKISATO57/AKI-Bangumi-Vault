@echo off
setlocal EnableExtensions
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$name = [string]([char]36164) + [string]([char]26009) + [string]([char]24211); $p = Join-Path (Get-Location) $name; New-Item -ItemType Directory -Force -Path $p | Out-Null; Invoke-Item $p"
