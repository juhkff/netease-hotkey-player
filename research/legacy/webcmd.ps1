param([Parameter(Mandatory=$true)][string]$Url, [switch]$NoQuotes)
$exe = 'D:\CloudMusic\cloudmusic.exe'
$arg = if ($NoQuotes) { "--webcmd=$Url" } else { '--webcmd="' + $Url + '"' }
Write-Output "arg = $arg"
try {
  $p = Start-Process -FilePath $exe -ArgumentList $arg -PassThru
  Write-Output "spawned pid=$($p.Id)"
} catch { Write-Output "launch error: $($_.Exception.Message)" }
Start-Sleep -Seconds 4
$live = @(Get-Process cloudmusic -ErrorAction SilentlyContinue)
Write-Output "live procs: $($live.Count)"
