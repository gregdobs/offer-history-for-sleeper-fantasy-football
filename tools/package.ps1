# Builds dist\offer-history-for-sleeper-fantasy-football-v<version>.zip from the extension folder.
# The zip has manifest.json at its root, so it can be unzipped and loaded as-is.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\package.ps1
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'extension'
$manifest = Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "offer-history-for-sleeper-fantasy-football-v$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  Get-ChildItem $src -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')   # forward slashes, as zip requires
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }

$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path $zip -Leaf)" | Set-Content (Join-Path $dist "offer-history-for-sleeper-fantasy-football-v$version.sha256") -Encoding ascii
$check = [System.IO.Compression.ZipFile]::OpenRead($zip)
try { $check.Entries | ForEach-Object { $_.FullName } } finally { $check.Dispose() }
"Built $zip"
"SHA256 $hash"
