param(
    [string]$Version = 'v1.0.6',
    [string]$Src = '',
    [string]$RuntimeDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Src) {
    if ($PSScriptRoot) { $Src = Split-Path -Parent $PSScriptRoot } else { $Src = (Get-Location).Path }
}
if (-not (Test-Path (Join-Path $Src 'app\NcmHotkey.cs'))) {
    throw "没找到源码目录（缺 app\NcmHotkey.cs）：$Src"
}
if ($Version -notmatch '^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
if (-not $RuntimeDir) { $RuntimeDir = Join-Path $Src 'out\runtime' }
if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir 'node.exe'))) {
    & (Join-Path $Src 'tools\fetch-runtime.ps1')
}
foreach ($name in @('node.exe','LICENSE')) {
    if (-not (Test-Path -LiteralPath (Join-Path $RuntimeDir $name))) { throw "Missing private runtime file: $name" }
}

$csc   = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 csc.exe（需要 .NET Framework 4.x）' }

$dist  = Join-Path $Src 'dist'
$stage = Join-Path $dist ("stage-$Version-" + [Guid]::NewGuid().ToString('N'))
$zip   = Join-Path $dist "netease-hotkey-player-$Version-win-x64.zip"

New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'lib'), (Join-Path $stage 'runtime'), $dist | Out-Null

Write-Host '编译 NcmHotkey.exe ...'
$iconArg = @()
$icoFile = Join-Path $Src 'app\app.ico'
if (Test-Path $icoFile) { $iconArg = @("/win32icon:$icoFile") }

& $csc /nologo /target:winexe /codepage:65001 /optimize+ @iconArg `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll `
    /platform:x64 /out:"$stage\NcmHotkey.exe" (Join-Path $Src 'app\NcmHotkey.cs') `
    (Join-Path $Src 'app\GameEvents.cs') (Join-Path $Src 'app\GgstEvents.cs') (Join-Path $Src 'app\GameEventForms.cs')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $stage 'NcmHotkey.exe'))) { throw '编译失败，没有产出 exe' }

Copy-Item (Join-Path $Src 'worker.mjs')          $stage -Force
Copy-Item (Join-Path $Src 'lib\ncm.mjs')         (Join-Path $stage 'lib') -Force
Copy-Item (Join-Path $Src 'README.md')           $stage -Force
Copy-Item (Join-Path $Src 'LICENSE')             $stage -Force
Copy-Item (Join-Path $Src 'config.example.json') $stage -Force
Copy-Item (Join-Path $Src 'install\install.ps1') $stage -Force
Copy-Item (Join-Path $Src 'install\install.cmd') $stage -Force
Copy-Item -LiteralPath (Join-Path $RuntimeDir 'node.exe') -Destination (Join-Path $stage 'runtime\node.exe')
Copy-Item -LiteralPath (Join-Path $RuntimeDir 'LICENSE') -Destination (Join-Path $stage 'runtime\LICENSE')
if (Test-Path -LiteralPath (Join-Path $RuntimeDir 'version.txt')) {
    Copy-Item -LiteralPath (Join-Path $RuntimeDir 'version.txt') -Destination (Join-Path $stage 'runtime\version.txt')
}

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal -Force
$checksums = Join-Path $dist "SHA256SUMS-$Version.txt"
$checksum = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + (Split-Path $zip -Leaf)
Set-Content -LiteralPath $checksums -Value $checksum -Encoding ASCII
[pscustomobject]@{ stage = $stage; zip = $zip; checksums = $checksums } | ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $dist 'build-result.json') -Encoding UTF8

Write-Host ''
Write-Host ("打包完成：" + $zip)
Write-Host ("压缩包大小：" + [math]::Round((Get-Item $zip).Length / 1KB, 1) + " KB")
Write-Host ("免安装程序：" + (Join-Path $stage 'NcmHotkey.exe'))
