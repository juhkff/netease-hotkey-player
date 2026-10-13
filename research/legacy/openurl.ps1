function Open-NcmUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [switch]$Bare
  )
  $exe = 'D:\CloudMusic\cloudmusic.exe'
  if ($Bare) { $arg = $Url } else { $arg = '--webcmd="' + $Url + '"' }
  Write-Output "arg = $arg"
  try {
    $p = Start-Process -FilePath $exe -ArgumentList $arg -PassThru
    Write-Output "spawned pid = $($p.Id)"
  } catch {
    Write-Output "launch error: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 6
  $live = @(Get-Process cloudmusic -ErrorAction SilentlyContinue)
  Write-Output "live procs = $($live.Count)"
}
