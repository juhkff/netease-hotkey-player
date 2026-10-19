param([string]$Src)

$ErrorActionPreference = 'Stop'

# 源码目录：优先用 -Src 参数，其次环境变量 NCM_SRC，最后按脚本所在位置往上一级推。
if (-not $Src) { $Src = $env:NCM_SRC }
if (-not $Src -and $PSScriptRoot) { $Src = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $Src) { throw '没给源码目录。用法：build-app.ps1 -Src <仓库根目录>，或设置环境变量 NCM_SRC。' }
$src = $Src
$app = Join-Path $env:LOCALAPPDATA 'ncm-hotkey'
$exe = Join-Path $app 'NcmHotkey.exe'

Write-Host "src = $src"
Write-Host "app = $app"

# ---------- 1. 关掉正在运行的旧程序（它占着 exe 文件和热键） ----------
Get-Process NcmHotkey -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "关闭正在运行的界面程序 pid=$($_.Id)"; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 700

# ---------- 2. 编译 ----------
New-Item -ItemType Directory -Force -Path $app | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'lib') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $app 'logs') | Out-Null

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "找不到 csc.exe：$csc" }

Write-Host "编译中…"
$icoArg = @()
$icoPath = Join-Path $src 'app\app.ico'
if (Test-Path $icoPath) { $icoArg = @("/win32icon:$icoPath") } else { Write-Host "（没有 app.ico，跳过图标嵌入）" }
& $csc /nologo /target:winexe /codepage:65001 /optimize+ /out:"$exe" `
    /reference:System.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    /reference:System.Web.Extensions.dll `
    $icoArg `
    /platform:x64 "$src\app\NcmHotkey.cs" "$src\app\GameEvents.cs" "$src\app\GgstEvents.cs" "$src\app\GameEventForms.cs"

if ($LASTEXITCODE -ne 0) { throw "编译失败，csc 退出码 $LASTEXITCODE" }
Write-Host ("编译成功：" + $exe + "  " + (Get-Item $exe).Length + " 字节")

# ---------- 3. 部署运行时文件 ----------
Copy-Item "$src\worker.mjs" $app -Force
Copy-Item "$src\lib\ncm.mjs" (Join-Path $app 'lib') -Force
Copy-Item "$src\lib\awoo.mjs" (Join-Path $app 'lib') -Force
Write-Host "已拷贝 worker.mjs 与 lib\ncm.mjs"

# ---------- 4. 记录 node 路径（托盘程序启动时 PATH 里常常没有 node） ----------
$nodeExe = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeExe = $cmd.Source }
if (-not $nodeExe) {
    $guess = Join-Path $env:LOCALAPPDATA 'Author Software\nvm\.nodejs\node.exe'
    if (Test-Path $guess) { $nodeExe = $guess }
}
if (-not $nodeExe) { throw "找不到 node.exe，无法运行播放服务" }
Set-Content -Path (Join-Path $app 'node.txt') -Value $nodeExe -Encoding ASCII
Write-Host "node = $nodeExe"

# ---------- 5. 配置文件（已存在就保留用户配好的热键） ----------
$cfg = Join-Path $app 'config.json'
if (-not (Test-Path $cfg)) {
    Set-Content -Path $cfg -Value '{ "port": 9229, "hotkeys": [] }' -Encoding ASCII
    Write-Host "新建了空的 config.json"
} else {
    Write-Host "保留已有 config.json"
}

# ---------- 6. 快捷方式 ----------
$cloud = $null
foreach ($g in @('D:\CloudMusic\cloudmusic.exe',
                 'C:\Program Files\Netease\CloudMusic\cloudmusic.exe',
                 'C:\Program Files (x86)\Netease\CloudMusic\cloudmusic.exe')) {
    if (Test-Path $g) { $cloud = $g; break }
}
if (-not $cloud) {
    try {
        $k = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\CloudMusic' -ErrorAction Stop
        if ($k.DisplayIcon) {
            $p = $k.DisplayIcon.Trim('"').Split(',')[0]
            if (Test-Path $p) { $cloud = $p }
        }
    } catch { }
}
Write-Host "cloudmusic = $cloud"

$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$startup = [Environment]::GetFolderPath('Startup')

# 清掉旧版留下的快捷方式
Get-ChildItem $startup -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*网易云*' } |
    ForEach-Object { Write-Host "删除旧启动项 $($_.Name)"; Remove-Item $_.FullName -Force }
Get-ChildItem $desktop -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*网易云*' } |
    ForEach-Object { Write-Host "删除旧桌面快捷方式 $($_.Name)"; Remove-Item $_.FullName -Force }

# 桌面：带调试端口的网易云
if ($cloud) {
    $lnk = $shell.CreateShortcut((Join-Path $desktop '网易云音乐(带热键).lnk'))
    $lnk.TargetPath = $cloud
    $lnk.Arguments = '--remote-debugging-port=9229 --remote-debugging-address=127.0.0.1'
    $lnk.WorkingDirectory = Split-Path $cloud
    $lnk.IconLocation = "$cloud,0"
    $lnk.Description = '用带调试端口的方式启动网易云音乐，供热键工具控制'
    $lnk.Save()
    Write-Host "已创建桌面快捷方式：网易云音乐(带热键).lnk"
}

# 启动项：托盘热键程序（带 --tray，开机时只留托盘图标，不弹窗口）
$startLnk = $shell.CreateShortcut((Join-Path $startup '网易云热键.lnk'))
$startLnk.TargetPath = $exe
$startLnk.Arguments = '--tray'
$startLnk.WorkingDirectory = $app
$startLnk.IconLocation = "$exe,0"
$startLnk.Description = '开机后在后台生效的网易云一键播放热键'
$startLnk.Save()
Write-Host "已创建开机启动项：网易云热键.lnk"

Write-Host ""
Write-Host "完成。"
