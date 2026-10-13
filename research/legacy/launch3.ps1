param([string]$Uri = '', [int]$Port = 9229)
$exe = 'D:\CloudMusic\cloudmusic.exe'
Get-Process cloudmusic -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 6
Write-Output ("kill 后残留进程数: " + @(Get-Process cloudmusic -ErrorAction SilentlyContinue).Count)
$args = @("--remote-debugging-port=$Port", '--remote-debugging-address=127.0.0.1')
if ($Uri) { $args += ('--webcmd=' + $Uri) }
$p = Start-Process $exe -ArgumentList $args -PassThru
Write-Output ("启动 pid: " + $p.Id)
Write-Output ("args: " + ($args -join ' | '))
Start-Sleep -Seconds 22
Get-Process cloudmusic -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-Table -AutoSize -Wrap
netstat -ano | Select-String (':' + $Port + '.*LISTENING')
