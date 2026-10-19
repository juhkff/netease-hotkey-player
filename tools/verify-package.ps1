param([string]$BuildResult = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $BuildResult) { $BuildResult = Join-Path $root 'dist\build-result.json' }
$build = Get-Content -LiteralPath $BuildResult -Raw | ConvertFrom-Json
$required = @('NcmHotkey.exe','worker.mjs','lib/ncm.mjs','lib/awoo.mjs','README.md','LICENSE',
    'config.example.json','install.ps1','install.cmd','runtime/node.exe','runtime/LICENSE','runtime/version.txt')
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($build.zip)
try {
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('\','/')
        if ($name.EndsWith('/')) { continue }
        if ($required -notcontains $name -or -not $seen.Add($name)) { throw "Unexpected/duplicate package file: $name" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
        finally { $stream.Dispose(); $sha.Dispose() }
        $expected = (Get-FileHash -LiteralPath (Join-Path $build.stage $name) -Algorithm SHA256).Hash
        if ($actual -ne $expected) { throw "Packaged file mismatch: $name" }
    }
    foreach ($name in $required) { if (-not $seen.Contains($name)) { throw "Missing package file: $name" } }
} finally { $archive.Dispose() }
$checksumLine = (Get-Content -LiteralPath $build.checksums -Raw).Trim()
$expectedLine = (Get-FileHash -LiteralPath $build.zip -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path $build.zip -Leaf)
if ($checksumLine -cne $expectedLine) { throw 'Release checksum does not match the ZIP.' }
Write-Host "Verified $($seen.Count) package files and release SHA-256."
