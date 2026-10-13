param([string]$Mode = 'raw', [int]$Port = 9229)
$exe = 'D:\CloudMusic\cloudmusic.exe'
$inner = '{"cmd":"play","type":"song","id":186016}'
switch ($Mode) {
  'raw'       { $payload = $inner }
  'b64'       { $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($inner)) }
  'url'       { $payload = [Uri]::EscapeDataString($inner) }
  'nested'    { $payload = '{"message":' + $inner + '}' }
  'nestedb64' { $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('{"message":' + $inner + '}')) }
}
Get-Process cloudmusic -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
$arg = '--webcmd=' + ($payload -replace '"','\"')
Write-Output ("LAUNCH mode=" + $Mode)
Write-Output ("ARG    " + $arg)
Start-Process $exe -ArgumentList ("--remote-debugging-port=" + $Port), '--remote-debugging-address=127.0.0.1', $arg
Start-Sleep -Seconds 18
Get-Process cloudmusic -ErrorAction SilentlyContinue | Select-Object Id,MainWindowTitle | Format-Table -AutoSize -Wrap
netstat -ano | Select-String (':' + $Port + '.*LISTENING')
