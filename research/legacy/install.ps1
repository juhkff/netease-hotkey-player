# 在 Windows 侧装好快捷方式：
#   桌面「网易云音乐(带热键).lnk」 —— 带调试端口启动网易云（必须用它打开，否则热键工具连不上）
#   启动文件夹「网易云热键守护.lnk」—— 开机自动后台常驻热键守护
#
# 用法：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $PSScriptRoot          # ...\ncm-hotkey
$exe = 'D:\CloudMusic\cloudmusic.exe'
$port = 9229

$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')
$lnkNcm = Join-Path $desktop '网易云音乐(带热键).lnk'
$lnkDaemon = Join-Path $startup '网易云热键守护.lnk'
$sh = New-Object -ComObject WScript.Shell

if ($Uninstall) {
  foreach ($f in @($lnkNcm, $lnkDaemon)) {
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force; Write-Output "已删除 $f" }
  }
  & (Join-Path $PSScriptRoot 'stop-daemon.ps1')
  exit 0
}

# 1) 桌面：带调试端口启动网易云
if (-not (Test-Path -LiteralPath $exe)) { throw "找不到网易云：$exe（如果不是这个路径，改 install.ps1 里的 `$exe）" }
$a = $sh.CreateShortcut($lnkNcm)
$a.TargetPath = $exe
$a.Arguments = "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1"
$a.WorkingDirectory = Split-Path -Parent $exe
$a.IconLocation = "$exe,0"
$a.Description = '带调试端口启动网易云，供全局热键工具使用'
$a.Save()
Write-Output "已创建桌面快捷方式：$lnkNcm"

# 2) 生成启动脚本（把 node 的绝对路径写死 —— wscript 的 PATH 里不一定有 node）
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source }
if (-not $nodeExe) { throw 'PATH 里找不到 node.exe，装不了自启' }
$vbsPath = Join-Path $PSScriptRoot 'start-daemon.vbs'
$vbs = @"
' 由 install.ps1 自动生成，别手改
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$dir"
sh.Run """$nodeExe"" daemon.mjs", 0, False
"@
Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding Ascii
Write-Output "已生成启动脚本：$vbsPath（node = $nodeExe）"

# 3) 启动文件夹：后台常驻热键守护（用 wscript 跑 vbs，完全无窗口）
$b = $sh.CreateShortcut($lnkDaemon)
$b.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$b.Arguments = '"' + $vbsPath + '"'
$b.WorkingDirectory = $dir
$b.Description = '网易云全局热键守护'
$b.Save()
Write-Output "已创建开机自启项：$lnkDaemon"

# 4) 顺手现在就把守护起起来
& (Join-Path $PSScriptRoot 'stop-daemon.ps1') | Out-Null
Start-Process (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList ('"' + $vbsPath + '"') -WorkingDirectory $dir
Start-Sleep -Seconds 3
$alive = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -like '*daemon.mjs*' }
if ($alive) { Write-Output "守护进程已启动，pid=$($alive.ProcessId -join ',')，日志在 logs\daemon.log" }
else { Write-Output '⚠ 守护进程没起来，手动跑一下 tools\start-daemon.vbs 看看报什么错' }
