Write-Output '--- cloudmusic 进程 ---'
$procs = @(Get-Process cloudmusic -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Write-Output '(无进程)' } else {
  $procs | Select-Object Id,MainWindowTitle | Format-Table -AutoSize -Wrap
}
Write-Output '--- 各 cloudmusic 进程的监听端口 ---'
$pids = @($procs | ForEach-Object { $_.Id })
if ($pids.Count -gt 0) {
  netstat -ano | Select-String 'LISTENING' | ForEach-Object {
    $line = $_.ToString()
    foreach ($p in $pids) { if ($line -match ('\s' + $p + '\s*$')) { Write-Output $line.Trim() } }
  }
}
Write-Output '--- D:\CloudMusic 下的配置文件 ---'
Get-ChildItem 'D:\CloudMusic' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in '.ini','.json','.cfg','.conf' } |
  Select-Object Name,Length | Format-Table -AutoSize
Write-Output '--- 用户配置目录 ---'
foreach ($d in @("$env:APPDATA\CloudMusic", "$env:LOCALAPPDATA\CloudMusic")) {
  if (Test-Path $d) {
    Write-Output $d
    Get-ChildItem $d -File -ErrorAction SilentlyContinue | Select-Object -First 20 Name,Length | Format-Table -AutoSize
    Get-ChildItem $d -Directory -ErrorAction SilentlyContinue | Select-Object -First 20 Name | Format-Table -AutoSize
  } else { Write-Output ($d + '  (不存在)') }
}
