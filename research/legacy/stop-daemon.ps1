# 停掉热键守护进程（按命令行里有 daemon.mjs 来匹配，避免误杀别的 node）
$found = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -like '*daemon.mjs*' }
if (-not $found) { Write-Output '守护进程没在跑'; exit 0 }
foreach ($p in $found) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Output "已停止守护进程 pid=$($p.ProcessId)"
}
