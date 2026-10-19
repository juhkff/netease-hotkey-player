param([int]$Port = 9229)

$ErrorActionPreference = 'Stop'

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$app  = Join-Path $env:LOCALAPPDATA 'ncm-hotkey'
$exe  = Join-Path $app 'NcmHotkey.exe'

Write-Host ''
Write-Host '========================================'
Write-Host '  网易云一键播放 · 热键设置  安装程序'
Write-Host '========================================'
Write-Host ''
Write-Host "安装到: $app"
Write-Host ''

# ---------- 1. 找 Node.js ----------
$nodeExe = $null
$bundledNode = Join-Path $here 'runtime\node.exe'
if (Test-Path -LiteralPath $bundledNode) { $nodeExe = $bundledNode }
if (-not $nodeExe) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $nodeExe = $cmd.Source }
}
if (-not $nodeExe) {
    foreach ($g in @(
        (Join-Path $env:LOCALAPPDATA 'Author Software\nvm\.nodejs\node.exe'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'))) {
        if ($g -and (Test-Path $g)) { $nodeExe = $g; break }
    }
}
if (-not $nodeExe) {
    Write-Host '× 没找到随包运行时。' -ForegroundColor Red
    Write-Host '  请完整解压新版免安装包，保留 runtime\node.exe；无需安装系统级 Node.js。'
    exit 1
}
Write-Host "√ Node.js: $nodeExe" -ForegroundColor Green

# ---------- 2. 关掉正在运行的旧版本 ----------
Get-Process NcmHotkey -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $exe } |
    ForEach-Object { Write-Host "  关闭旧版本 pid=$($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

# ---------- 3. 拷文件 ----------
New-Item -ItemType Directory -Force -Path $app | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'lib') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'logs') | Out-Null
if (Test-Path -LiteralPath $bundledNode) {
    $null = New-Item -ItemType Directory -Path (Join-Path $app 'runtime') -Force
    Copy-Item -LiteralPath $bundledNode -Destination (Join-Path $app 'runtime\node.exe') -Force
    Copy-Item -LiteralPath (Join-Path $here 'runtime\LICENSE') -Destination (Join-Path $app 'runtime\LICENSE') -Force
    if (Test-Path -LiteralPath (Join-Path $here 'runtime\version.txt')) {
        Copy-Item -LiteralPath (Join-Path $here 'runtime\version.txt') -Destination (Join-Path $app 'runtime\version.txt') -Force
    }
    $nodeExe = Join-Path $app 'runtime\node.exe'
}

Copy-Item (Join-Path $here 'NcmHotkey.exe')  $app -Force
Copy-Item (Join-Path $here 'worker.mjs')     $app -Force
Copy-Item (Join-Path $here 'lib\ncm.mjs')    (Join-Path $app 'lib') -Force
Copy-Item (Join-Path $here 'lib\awoo.mjs')   (Join-Path $app 'lib') -Force
if (Test-Path (Join-Path $here 'README.md')) {
    Copy-Item (Join-Path $here 'README.md')  $app -Force
}
Set-Content -Path (Join-Path $app 'node.txt') -Value $nodeExe -Encoding ASCII
Write-Host '√ 程序文件已就位' -ForegroundColor Green

# 配置：第一次装才写默认值，以后升级不动用户自己的配置
$cfg = Join-Path $app 'config.json'
if (Test-Path $cfg) {
    Write-Host '  保留已有 config.json（你的热键配置不会被覆盖）'
} elseif (Test-Path (Join-Path $here 'config.example.json')) {
    Copy-Item (Join-Path $here 'config.example.json') $cfg -Force
    Write-Host '√ 生成了默认 config.json' -ForegroundColor Green
} else {
    Set-Content -Path $cfg -Encoding UTF8 -Value (ConvertTo-Json @{ port = $Port; hotkeys = @() })
    Write-Host '√ 生成了空 config.json' -ForegroundColor Green
}

# ---------- 4. 找网易云客户端 ----------
$cloud = $null
foreach ($g in @('D:\CloudMusic\cloudmusic.exe',
                 'C:\Program Files\Netease\CloudMusic\cloudmusic.exe',
                 'C:\Program Files (x86)\Netease\CloudMusic\cloudmusic.exe')) {
    if (Test-Path $g) { $cloud = $g; break }
}
if (-not $cloud) {
    foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\CloudMusic',
                     'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\CloudMusic')) {
        try {
            $it = Get-ItemProperty $k -ErrorAction Stop
            if ($it.DisplayIcon) {
                $p = $it.DisplayIcon.Trim('"').Split(',')[0]
                if (Test-Path $p) { $cloud = $p; break }
            }
        } catch { }
    }
}

$shell   = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

# Only replace shortcuts created by this tool; preserve other NetEase shortcuts.
Get-ChildItem $desktop, $startup -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @('网易云音乐(带热键).lnk', '网易云热键.lnk') } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

if ($cloud) {
    $lnk = $shell.CreateShortcut((Join-Path $desktop '网易云音乐(带热键).lnk'))
    $lnk.TargetPath       = $cloud
    $lnk.Arguments        = "--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1"
    $lnk.WorkingDirectory = Split-Path $cloud
    $lnk.IconLocation     = "$cloud,0"
    $lnk.Description      = '用带调试端口的方式启动网易云音乐，供热键工具控制'
    $lnk.Save()
    Write-Host "√ 桌面快捷方式：网易云音乐(带热键).lnk → $cloud" -ForegroundColor Green
} else {
    Write-Host '! 没自动找到网易云客户端，请自己确认一下安装路径' -ForegroundColor Yellow
}

$startLnk = $shell.CreateShortcut((Join-Path $startup '网易云热键.lnk'))
$startLnk.TargetPath       = $exe
$startLnk.Arguments        = '--tray'
$startLnk.WorkingDirectory = $app
$startLnk.IconLocation     = "$exe,0"
$startLnk.Description      = '开机后在后台生效的网易云一键播放热键'
$startLnk.Save()
Write-Host '√ 开机自启项：网易云热键.lnk（只留托盘图标，不弹窗口）' -ForegroundColor Green

# ---------- 5. 启动 ----------
Start-Process $exe -ArgumentList '--tray' -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Host '√ 程序已在后台运行（看右下角托盘里的蓝色播放图标）' -ForegroundColor Green

Write-Host ''
Write-Host '========================================'
Write-Host '  装好了，接下来这样做：'
Write-Host '========================================'
Write-Host ''
Write-Host '  1. 双击桌面上的「网易云音乐(带热键)」打开网易云'
Write-Host '     （一定要用这个快捷方式，普通方式打开的控制不了）'
Write-Host ''
Write-Host '  2. 右键托盘图标 →「打开设置」→ 添加你自己的热键和歌'
Write-Host ''
Write-Host '  3. 试着按一下热键，网易云会立刻切过去并从指定秒开始播'
Write-Host ''
Write-Host "  设置文件: $cfg"
Write-Host "  运行日志: $(Join-Path $app 'logs\app.log')"
Write-Host ''
