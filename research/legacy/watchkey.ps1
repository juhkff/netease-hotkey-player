# 只做一件事：轮询看 vk 键有没有被按下。用来判断 SendInput 合成出来的按键到底有没有进系统。
param([int]$Vk = 0x31, [int]$Seconds = 12)
Add-Type -Namespace NcmKey -Name Probe -MemberDefinition @'
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
'@
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  $s = [NcmKey.Probe]::GetAsyncKeyState($Vk)
  if ($s -band 0x8000) { Write-Output "SEEN vk=$Vk raw=$s"; exit 0 }
  Start-Sleep -Milliseconds 15
}
Write-Output "NOT-SEEN"
