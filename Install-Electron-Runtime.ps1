param(
  [string]$Version = "31.7.7",
  [string]$Mirror = "https://npmmirror.com/mirrors/electron/"
)

$ErrorActionPreference = "Stop"

function Write-BV($Text) {
  Write-Host "[Bangumi Vault] $Text"
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ElectronDir = Join-Path $Root "node_modules\electron"
$DistDir = Join-Path $ElectronDir "dist"
$PathTxt = Join-Path $ElectronDir "path.txt"
$ExePath = Join-Path $DistDir "electron.exe"

if (-not (Test-Path $ElectronDir)) {
  throw "node_modules\electron was not found. Run Install-Desktop-Dependencies.cmd first."
}

$processor = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$processor = [string]$processor
switch -Regex ($processor) {
  "ARM64" { $Arch = "arm64"; break }
  "86" { $Arch = "ia32"; break }
  default { $Arch = "x64" }
}

$ZipName = "electron-v$Version-win32-$Arch.zip"
$CacheDir = Join-Path $Root ".electron-cache\v$Version"
$ZipPath = Join-Path $CacheDir $ZipName
$PrimaryUrl = ($Mirror.TrimEnd('/') + "/v$Version/$ZipName")
$FallbackUrl = "https://github.com/electron/electron/releases/download/v$Version/$ZipName"

Write-BV "Installing Electron runtime manually..."
Write-BV "Version: $Version"
Write-BV "Arch: $Arch"
Write-BV "Mirror: $PrimaryUrl"

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

if ((Test-Path $ZipPath) -and ((Get-Item $ZipPath).Length -lt 1000000)) {
  Write-BV "Removing tiny/corrupt cached zip."
  Remove-Item -Force $ZipPath
}

if (-not (Test-Path $ZipPath)) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $downloaded = $false
  foreach ($Url in @($PrimaryUrl, $FallbackUrl)) {
    try {
      Write-BV "Downloading: $Url"
      Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing
      $downloaded = $true
      break
    } catch {
      Write-BV "Download failed: $($_.Exception.Message)"
      if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
    }
  }
  if (-not $downloaded) {
    throw "Could not download Electron runtime. Please check network/proxy/VPN and retry."
  }
} else {
  Write-BV "Using cached Electron zip: $ZipPath"
}

if (Test-Path $DistDir) {
  Write-BV "Removing old Electron dist folder..."
  Remove-Item -Recurse -Force $DistDir
}
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

Write-BV "Extracting Electron runtime..."
try {
  Expand-Archive -Path $ZipPath -DestinationPath $DistDir -Force
} catch {
  Write-BV "Extract failed, removing cached zip and retrying once..."
  Remove-Item -Force $ZipPath
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $PrimaryUrl -OutFile $ZipPath -UseBasicParsing
  Expand-Archive -Path $ZipPath -DestinationPath $DistDir -Force
}

if (-not (Test-Path $ExePath)) {
  throw "Electron runtime extracted, but electron.exe was not found at $ExePath"
}

[System.IO.File]::WriteAllText($PathTxt, "electron.exe", [System.Text.Encoding]::ASCII)
Write-BV "Electron runtime ready: $ExePath"
Write-BV "path.txt written without newline: $PathTxt"
