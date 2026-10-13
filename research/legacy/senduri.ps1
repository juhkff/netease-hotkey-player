param([string]$Uri)
Start-Process 'D:\CloudMusic\cloudmusic.exe' -ArgumentList ('--webcmd=' + $Uri)
