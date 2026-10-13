param([string]$Url = 'orpheus://song/29819909/?autoplay=1')
$exe = 'D:\CloudMusic\cloudmusic.exe'
$before = @(Get-Process cloudmusic -ErrorAction SilentlyContinue)
Write-Output "before procs: $($before.Count)  pids=$($before.Id -join ',')"
Write-Output "url: $Url"
try {
  $p = Start-Process -FilePath $exe -ArgumentList "--webcmd=`"$Url`"" -PassThru
  Write-Output "Start-Process ok, pid=$($p.Id)  exited=$($p.HasExited)"
} catch {
  Write-Output "launch error: $($_.Exception.Message)"
}
Start-Sleep -Seconds 6
$after = @(Get-Process cloudmusic -ErrorAction SilentlyContinue)
Write-Output "after procs: $($after.Count)  pids=$($after.Id -join ',')"
$after | Select-Object Id, MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200
