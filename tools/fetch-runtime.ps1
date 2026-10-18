param([string]$Version = '24.19.0')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid Node.js version.' }
$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root 'out\runtime-cache'
$runtime = Join-Path $root 'out\runtime'
$null = New-Item -ItemType Directory -Path $cache,$runtime -Force
$filename = "node-v$Version-win-x64.zip"
$archive = Join-Path $cache $filename
$baseUrl = "https://nodejs.org/dist/v$Version"
$sums = (Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content
$match = [regex]::Match($sums, '(?m)^([a-f0-9]{64})\s+' + [regex]::Escape($filename) + '\r?$')
if (-not $match.Success) { throw 'Official archive checksum not found.' }
$expected = $match.Groups[1].Value
if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
    Invoke-WebRequest -Uri "$baseUrl/$filename" -OutFile $archive -UseBasicParsing
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) { throw 'Runtime checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($name in @('node.exe','LICENSE')) {
        $entry = $zip.GetEntry("node-v$Version-win-x64/$name")
        if (-not $entry) { throw "Missing runtime file: $name" }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $runtime $name), $true)
    }
} finally { $zip.Dispose() }
$actual = (& (Join-Path $runtime 'node.exe') --version).Trim()
if ($LASTEXITCODE -ne 0 -or $actual -ne "v$Version") { throw 'Runtime version check failed.' }
Set-Content -LiteralPath (Join-Path $runtime 'version.txt') -Value $actual -Encoding ASCII
Write-Host "Verified private runtime: $runtime ($actual)"
