param(
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$Repository,
    [string]$AssetDirectory = 'release-assets'
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid version tag.' }
$archive = Join-Path $AssetDirectory "netease-hotkey-player-$Version-win-x64.zip"
$checksums = Join-Path $AssetDirectory "SHA256SUMS-$Version.txt"
$expected = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path $archive -Leaf)
if ((Get-Content -LiteralPath $checksums -Raw).Trim() -cne $expected) { throw 'Downloaded package checksum mismatch.' }

# Verify that the remote tag exists before creating a draft release.
& gh api "repos/$Repository/git/ref/tags/$Version" --silent
if ($LASTEXITCODE -ne 0) { throw 'Release tag is missing on GitHub.' }
$existing = & gh release list --repo $Repository --limit 100 --json tagName,isDraft | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing releases.' }
$release = $existing | Where-Object { $_.tagName -eq $Version } | Select-Object -First 1
if (-not $release) {
    $arguments = @('release','create',$Version,'--repo',$Repository,'--verify-tag','--draft','--title',"$Version - Windows portable")
    $notes = Join-Path (Split-Path -Parent $PSScriptRoot) "docs\releases\$Version.md"
    if (Test-Path -LiteralPath $notes) { $arguments += @('--notes-file',$notes) }
    else { $arguments += '--generate-notes' }
    if ($Version.Contains('-')) { $arguments += '--prerelease' }
    & gh @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create release draft.' }
}
& gh release upload $Version $archive $checksums --repo $Repository --clobber
if ($LASTEXITCODE -ne 0) { throw 'Failed to upload release files.' }
if (-not $release -or $release.isDraft) {
    $arguments = @('release','edit',$Version,'--repo',$Repository,'--draft=false')
    if (-not $Version.Contains('-')) { $arguments += '--latest' }
    & gh @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Files uploaded but release publication failed.' }
}
Write-Host "Published https://github.com/$Repository/releases/tag/$Version"
