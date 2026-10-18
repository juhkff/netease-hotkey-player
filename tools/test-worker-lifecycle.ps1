param([string]$NodeExe)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $NodeExe) { $NodeExe = Join-Path $root 'out\runtime\node.exe' }
$out = Join-Path $root ('dist\regression-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $out -Force
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$exe = Join-Path $out 'WorkerRegressionTests.exe'
& $csc /nologo /target:exe /codepage:65001 /main:WorkerRegressionTests /out:$exe `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll `
    (Join-Path $root 'app\NcmHotkey.cs') (Join-Path $root 'app\GameEvents.cs') `
    (Join-Path $root 'app\GgstEvents.cs') (Join-Path $root 'app\GameEventForms.cs') (Join-Path $root 'tools\WorkerRegressionTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Regression test compilation failed.' }
& $exe $NodeExe (Join-Path $root 'tools\fixtures\worker-echo.mjs') (Join-Path $root 'worker.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Worker lifecycle regression failed.' }
& $exe $NodeExe (Join-Path $root 'tools\fixtures\worker-echo.mjs') (Join-Path $root 'worker.mjs') --utf8-console
if ($LASTEXITCODE -ne 0) { throw 'UTF-8 console regression failed.' }
