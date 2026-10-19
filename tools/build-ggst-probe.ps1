$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $repo 'out\ggst-probe\app'
New-Item -ItemType Directory -Force $stage,(Join-Path $stage 'lib'),(Join-Path $stage 'runtime') | Out-Null
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$references = @('/r:System.dll','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/r:System.Web.Extensions.dll')
$eventSources = @((Join-Path $repo 'app\GameEvents.cs'),(Join-Path $repo 'app\GgstEvents.cs'),(Join-Path $repo 'app\GameEventForms.cs'))
& $csc /nologo /target:winexe /platform:x64 /codepage:65001 /optimize+ @references /main:NcmHotkey.GgstProbeProgram "/out:$stage\GgstMusicProbe.exe" (Join-Path $repo 'app\NcmHotkey.cs') (Join-Path $repo 'app\GgstMusicProbe.cs') @eventSources
if ($LASTEXITCODE -ne 0) { throw 'Probe build failed' }
& $csc /nologo /target:exe /platform:x64 /codepage:65001 @references /main:GgstGateTests "/out:$stage\GateTests.exe" (Join-Path $repo 'app\NcmHotkey.cs') (Join-Path $repo 'app\GgstMusicProbe.cs') @eventSources (Join-Path $repo 'tools\test-ggst-probe.cs')
if ($LASTEXITCODE -ne 0) { throw 'Gate test build failed' }
& (Join-Path $stage 'GateTests.exe')
if ($LASTEXITCODE -ne 0) { throw 'Gate tests failed' }
Copy-Item -LiteralPath (Join-Path $repo 'worker.mjs') -Destination $stage -Force
Copy-Item -LiteralPath (Join-Path $repo 'lib\ncm.mjs') -Destination (Join-Path $stage 'lib\ncm.mjs') -Force
Copy-Item -LiteralPath (Join-Path $repo 'lib\awoo.mjs') -Destination (Join-Path $stage 'lib\awoo.mjs') -Force
Copy-Item -LiteralPath (Join-Path $repo 'out\runtime\node.exe') -Destination (Join-Path $stage 'runtime\node.exe') -Force
Write-Output (Join-Path $stage 'GgstMusicProbe.exe')
