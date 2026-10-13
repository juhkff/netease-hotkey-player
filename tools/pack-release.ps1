param(
    [string]$Version = 'v1.0.0',
    [string]$Src = ''
)

$ErrorActionPreference = 'Stop'

if (-not $Src) {
    if ($PSScriptRoot) { $Src = Split-Path -Parent $PSScriptRoot } else { $Src = (Get-Location).Path }
}
if (-not (Test-Path (Join-Path $Src 'app\NcmHotkey.cs'))) {
    throw "没找到源码目录（缺 app\NcmHotkey.cs）：$Src"
}

$csc   = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 csc.exe（需要 .NET Framework 4.x）' }

$dist  = Join-Path $Src 'dist'
$stage = Join-Path $dist "stage-$Version"
$zip   = Join-Path $dist "netease-hotkey-player-$Version.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'lib'), $dist | Out-Null

Write-Host '编译 NcmHotkey.exe ...'
$iconArg = @()
$icoFile = Join-Path $Src 'app\app.ico'
if (Test-Path $icoFile) { $iconArg = @("/win32icon:$icoFile") }

& $csc /nologo /target:winexe /codepage:65001 /optimize+ @iconArg `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll `
    /out:"$stage\NcmHotkey.exe" (Join-Path $Src 'app\NcmHotkey.cs')
if (-not (Test-Path (Join-Path $stage 'NcmHotkey.exe'))) { throw '编译失败，没有产出 exe' }

Copy-Item (Join-Path $Src 'worker.mjs')          $stage -Force
Copy-Item (Join-Path $Src 'lib\ncm.mjs')         (Join-Path $stage 'lib') -Force
Copy-Item (Join-Path $Src 'README.md')           $stage -Force
Copy-Item (Join-Path $Src 'LICENSE')             $stage -Force
Copy-Item (Join-Path $Src 'config.example.json') $stage -Force
Copy-Item (Join-Path $Src 'install\install.ps1') $stage -Force
Copy-Item (Join-Path $Src 'install\install.cmd') $stage -Force

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

Write-Host ''
Write-Host ("打包完成：" + $zip)
Write-Host ("压缩包大小：" + [math]::Round((Get-Item $zip).Length / 1KB, 1) + " KB")
$exe = Join-Path $stage 'NcmHotkey.exe'
