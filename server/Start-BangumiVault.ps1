$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$AppHtml = Join-Path $Root "app\BangumiVault.html"
$DataDir = Join-Path $Root "资料库"
$ImagesDir = Join-Path $DataDir "封面缓存"
$BackupsDir = Join-Path $DataDir "备份"
$LogsDir = Join-Path $DataDir "日志"
$StateFile = Join-Path $DataDir "收藏数据.json"
New-Item -ItemType Directory -Force -Path $DataDir,$ImagesDir,$BackupsDir,$LogsDir | Out-Null
if (!(Test-Path $StateFile)) { Set-Content -LiteralPath $StateFile -Value "" -Encoding UTF8 }
$Port = 51237
$Listener = New-Object System.Net.HttpListener
$Prefix = "http://127.0.0.1:$Port/"
$Listener.Prefixes.Add($Prefix)
try { $Listener.Start() } catch {
  Write-Host "Port $Port is busy. Close old Bangumi 保管库 windows or edit server\Start-BangumiVault.ps1 to change port." -ForegroundColor Red
  throw
}
Write-Host "Bangumi 保管库 portable server running at $Prefix" -ForegroundColor Green

function Send-Text($ctx, [string]$text, [string]$type="text/plain; charset=utf-8", [int]$status=200) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $ctx.Response.StatusCode = $status
  $ctx.Response.ContentType = $type
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
  $ctx.Response.Close()
}
function Send-File($ctx, [string]$path, [string]$type="application/octet-stream") {
  if (!(Test-Path -LiteralPath $path)) { Send-Text $ctx "Not found" "text/plain; charset=utf-8" 404; return }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $ctx.Response.StatusCode = 200
  $ctx.Response.ContentType = $type
  $ctx.Response.ContentLength64 = $bytes.Length
  $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
  $ctx.Response.Close()
}
function Get-BodyText($req) {
  $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}
function Safe-Name([string]$name) {
  if ([string]::IsNullOrWhiteSpace($name)) { return "file" }
  $invalid = [System.IO.Path]::GetInvalidFileNameChars()
  foreach($ch in $invalid){ $name = $name.Replace([string]$ch, "_") }
  return $name
}
function Guess-Ext([string]$contentType, [string]$url) {
  if ($contentType -match "png") { return ".png" }
  if ($contentType -match "webp") { return ".webp" }
  if ($contentType -match "gif") { return ".gif" }
  if ($contentType -match "jpeg|jpg") { return ".jpg" }
  try { $e = [System.IO.Path]::GetExtension(([Uri]$url).AbsolutePath); if ($e) { return $e } } catch {}
  return ".jpg"
}

# Open browser after server starts
$Url = $Prefix
$edge = (Get-Command msedge.exe -ErrorAction SilentlyContinue).Source
$chrome = (Get-Command chrome.exe -ErrorAction SilentlyContinue).Source
if ($edge) { Start-Process $edge -ArgumentList @("--app=$Url", "--user-data-dir=$DataDir\EdgeProfile", "--disk-cache-dir=$DataDir\BrowserCache") }
elseif ($chrome) { Start-Process $chrome -ArgumentList @("--app=$Url", "--user-data-dir=$DataDir\ChromeProfile", "--disk-cache-dir=$DataDir\BrowserCache") }
else { Start-Process $Url }

try {
  while ($Listener.IsListening) {
    $ctx = $Listener.GetContext()
    try {
      $req = $ctx.Request
      $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($req.HttpMethod -eq "GET" -and ($path -eq "/" -or $path -eq "/BangumiVault.html")) { Send-File $ctx $AppHtml "text/html; charset=utf-8"; continue }
      if ($req.HttpMethod -eq "GET" -and $path -eq "/api/ping") { Send-Text $ctx '{"ok":true}' "application/json; charset=utf-8"; continue }
      if ($req.HttpMethod -eq "GET" -and $path -eq "/api/state") {
        if ((Test-Path $StateFile) -and ((Get-Item $StateFile).Length -gt 0)) { Send-File $ctx $StateFile "application/json; charset=utf-8" } else { Send-Text $ctx "" "application/json; charset=utf-8" 204 }
        continue
      }
      if ($req.HttpMethod -eq "POST" -and $path -eq "/api/state") {
        $body = Get-BodyText $req
        $tmp = "$StateFile.tmp"
        [System.IO.File]::WriteAllText($tmp, $body, [System.Text.Encoding]::UTF8)
        Move-Item -Force -LiteralPath $tmp -Destination $StateFile
        Send-Text $ctx '{"ok":true}' "application/json; charset=utf-8"; continue
      }
      if ($req.HttpMethod -eq "POST" -and $path -eq "/api/cache-cover") {
        $body = Get-BodyText $req | ConvertFrom-Json
        $sid = Safe-Name ([string]$body.subject_id)
        $url = [string]$body.url
        if ([string]::IsNullOrWhiteSpace($sid) -or [string]::IsNullOrWhiteSpace($url)) { Send-Text $ctx '{"ok":false,"error":"missing subject_id or url"}' "application/json; charset=utf-8" 400; continue }
        $request = [System.Net.HttpWebRequest]::Create($url)
        $request.UserAgent = "BangumiVaultPortable/0.27 (local image backup)"
        $request.Referer = "https://bgm.tv/"
        $request.Timeout = 30000
        $response = $request.GetResponse()
        try {
          $ext = Guess-Ext ([string]$response.ContentType) $url
          $file = "$sid$ext"
          $target = Join-Path $ImagesDir $file
          $stream = $response.GetResponseStream()
          $fs = [System.IO.File]::Open($target, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
          try { $stream.CopyTo($fs) } finally { $fs.Close(); $stream.Close() }
        } finally { $response.Close() }
        $json = @{ ok=$true; url="/images/$file"; file="封面缓存/$file" } | ConvertTo-Json -Compress
        Send-Text $ctx $json "application/json; charset=utf-8"; continue
      }
      if ($req.HttpMethod -eq "GET" -and $path.StartsWith("/images/")) {
        $file = Safe-Name ($path.Substring(8))
        $img = Join-Path $ImagesDir $file
        $ext = [System.IO.Path]::GetExtension($img).ToLowerInvariant()
        $type = switch($ext){ ".png" {"image/png"} ".webp" {"image/webp"} ".gif" {"image/gif"} default {"image/jpeg"} }
        Send-File $ctx $img $type; continue
      }
      if ($req.HttpMethod -eq "POST" -and $path -eq "/api/save-file") {
        $name = Safe-Name ($req.QueryString["name"])
        $target = Join-Path $BackupsDir $name
        $fs = [System.IO.File]::Open($target, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
        try { $req.InputStream.CopyTo($fs) } finally { $fs.Close() }
        Send-Text $ctx (@{ok=$true; file="备份/$name"} | ConvertTo-Json -Compress) "application/json; charset=utf-8"; continue
      }
      Send-Text $ctx "Not found" "text/plain; charset=utf-8" 404
    } catch {
      $msg = $_.Exception.Message.Replace('"','\"')
      try { Send-Text $ctx "{\"ok\":false,\"error\":\"$msg\"}" "application/json; charset=utf-8" 500 } catch {}
    }
  }
} finally { if($Listener.IsListening){ $Listener.Stop() } }
