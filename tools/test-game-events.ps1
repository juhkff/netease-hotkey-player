$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'out\game-events-tests'
New-Item -ItemType Directory -Force $stage | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources = @('app\NcmHotkey.cs','app\GameEvents.cs','app\GgstEvents.cs','app\GameEventForms.cs','tools\GameEventTests.cs') | ForEach-Object { Join-Path $root $_ }
& $csc /nologo /target:exe /platform:x64 /codepage:65001 /main:GameEventTests "/out:$stage\GameEventTests.exe" `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll $sources
if ($LASTEXITCODE -ne 0) { throw 'Game-event test compilation failed' }
& (Join-Path $stage 'GameEventTests.exe') $stage
if ($LASTEXITCODE -ne 0) { throw 'Game-event tests failed' }
