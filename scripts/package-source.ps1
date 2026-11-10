param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Root = [System.IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)))
$Package = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ArchiveRoot = "Bangumi-Vault-v$($Package.version)-source"
$ManifestPath = Join-Path $Root "scripts\source-package-manifest.txt"

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $Root "dist\$ArchiveRoot.zip"
} elseif (![System.IO.Path]::IsPathRooted($OutputPath)) {
  $OutputPath = Join-Path $Root $OutputPath
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$OutputDirectory = Split-Path -Parent $OutputPath
$ChecksumPath = "$OutputPath.sha256"

$DataDirectoryName = -join [char[]](36164, 26009, 24211)
$ForbiddenDirectories = @(
  ".git",
  ".npm-cache",
  ".electron-cache",
  "node_modules",
  "dist",
  "release",
  "out",
  $DataDirectoryName,
  "VaultData"
)
$ForbiddenFilePatterns = @(
  ".env",
  ".env.*",
  ".npmrc",
  "*.blockmap",
  "*.key",
  "*.pem",
  "*.pfx",
  "*.p12",
  "*.token",
  "*credential*",
  "*secret*",
  "npm-debug.log*",
  "yarn-debug.log*",
  "yarn-error.log*",
  "pnpm-debug.log*",
  "*.tmp"
)

if (!(Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  throw "Source package manifest is missing: $ManifestPath"
}

$ManifestEntries = @(
  Get-Content -LiteralPath $ManifestPath -Encoding UTF8 |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and !$_.StartsWith("#") }
)
if (!$ManifestEntries.Count) {
  throw "Source package manifest is empty: $ManifestPath"
}

$NormalizedEntries = @()
foreach ($Entry in $ManifestEntries) {
  $Relative = $Entry.Replace("\", "/").Trim()
  $Segments = @($Relative -split "/")
  if ([System.IO.Path]::IsPathRooted($Relative) -or $Segments.Count -eq 0 -or $Segments -contains "" -or $Segments -contains "." -or $Segments -contains "..") {
    throw "Source package manifest contains an invalid path: $Entry"
  }
  if ($Segments | Where-Object { $ForbiddenDirectories -contains $_ }) {
    throw "Source package manifest contains a forbidden directory: $Relative"
  }
  foreach ($Pattern in $ForbiddenFilePatterns) {
    if ($Segments[-1] -like $Pattern) {
      throw "Source package manifest contains a forbidden file: $Relative"
    }
  }
  $NormalizedEntries += $Segments -join "/"
}

$DuplicateEntries = @($NormalizedEntries | Group-Object { $_.ToLowerInvariant() } | Where-Object { $_.Count -gt 1 })
if ($DuplicateEntries.Count) {
  throw "Source package manifest contains duplicate paths: $($DuplicateEntries.Name -join ', ')"
}

$RootPrefix = $Root.TrimEnd([char[]]@(92, 47)) + [System.IO.Path]::DirectorySeparatorChar
$Files = @($NormalizedEntries | ForEach-Object {
  $Relative = $_
  $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root ($Relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar))))
  if (!$FullPath.StartsWith($RootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Source package manifest path escapes the repository: $Relative"
  }
  if (!(Test-Path -LiteralPath $FullPath -PathType Leaf)) {
    throw "Source package manifest entry is missing: $Relative"
  }
  $File = Get-Item -LiteralPath $FullPath
  if (($File.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Source package manifest entry cannot be a reparse point: $Relative"
  }
  [PSCustomObject]@{
    Relative = $Relative
    File = $File
  }
} | Sort-Object Relative)

foreach ($TargetPath in @($OutputPath, $ChecksumPath)) {
  if ($Files.File.FullName -contains $TargetPath) {
    throw "Source package output cannot overwrite a manifest entry: $TargetPath"
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
[System.IO.File]::Delete($ChecksumPath)

$RequiredEntries = @("package.json", "main.js", "preload.js", "app/BangumiVault.html", "LICENSE")
$FileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  $Archive = [System.IO.Compression.ZipArchive]::new($FileStream, [System.IO.Compression.ZipArchiveMode]::Create, $false, [System.Text.Encoding]::UTF8)
  try {
    foreach ($Source in $Files) {
      $File = $Source.File
      $Relative = $Source.Relative
      $Entry = $Archive.CreateEntry("$ArchiveRoot/$Relative", [System.IO.Compression.CompressionLevel]::Optimal)
      $Entry.LastWriteTime = [System.DateTimeOffset]$File.LastWriteTime
      $Input = $File.OpenRead()
      try {
        $Output = $Entry.Open()
        try { $Input.CopyTo($Output) } finally { $Output.Dispose() }
      } finally {
        $Input.Dispose()
      }
    }
  } finally {
    $Archive.Dispose()
  }
} finally {
  $FileStream.Dispose()
}

$Verification = [System.IO.Compression.ZipFile]::OpenRead($OutputPath)
try {
  $Names = @($Verification.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName })
  $ExpectedNames = @($Files | ForEach-Object { "$ArchiveRoot/$($_.Relative)" })
  $Differences = @(Compare-Object -ReferenceObject $ExpectedNames -DifferenceObject $Names -CaseSensitive)
  if ($Differences.Count) {
    $Summary = ($Differences | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }) -join ", "
    throw "Source archive does not match its manifest: $Summary"
  }
  foreach ($Required in $RequiredEntries) {
    if ($Names -notcontains "$ArchiveRoot/$Required") {
      throw "Source archive is missing required entry: $Required"
    }
  }
} finally {
  $Verification.Dispose()
}

$Hash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
$ChecksumLine = "$Hash  $([System.IO.Path]::GetFileName($OutputPath))"
[System.IO.File]::WriteAllText($ChecksumPath, "$ChecksumLine`r`n", [System.Text.UTF8Encoding]::new($false))
if ((Get-Content -LiteralPath $ChecksumPath -Raw -Encoding UTF8).Trim() -ne $ChecksumLine) {
  throw "Source archive checksum file verification failed: $ChecksumPath"
}

Write-Host "Source archive: $OutputPath"
Write-Host "Checksum file: $ChecksumPath"
Write-Host "Files: $($Files.Count)"
Write-Host "SHA256: $Hash"
