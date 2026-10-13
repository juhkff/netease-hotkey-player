# 用 SendInput 合成一次按键，用来验证 RegisterHotKey 是否真的能收到。
# 用法：powershell.exe -NoProfile -ExecutionPolicy Bypass -File sendkeys.ps1 -Mods 3 -Vk 0x50
param([int]$Mods = 3, [int]$Vk = 0x50)

Add-Type -Namespace NcmKey -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct INPUT { public uint type; public KEYBDINPUT ki; public int pad1; public int pad2; }
[StructLayout(LayoutKind.Sequential)]
public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[DllImport("user32.dll", SetLastError = true)]
public static extern uint SendInput(uint n, INPUT[] inputs, int size);
'@

function Key([int]$vk, [bool]$up) {
  $i = New-Object 'NcmKey.Native+INPUT'
  $i.type = 1
  $i.ki.wVk = [uint16]$vk
  $i.ki.dwFlags = if ($up) { 2 } else { 0 }
  return $i
}

$modVk = @()
if ($Mods -band 1) { $modVk += 0x12 }   # Alt
if ($Mods -band 2) { $modVk += 0x11 }   # Ctrl
if ($Mods -band 4) { $modVk += 0x10 }   # Shift
if ($Mods -band 8) { $modVk += 0x5B }   # Win

$list = @()
foreach ($m in $modVk) { $list += (Key $m $false) }
$list += (Key $Vk $false)
$list += (Key $Vk $true)
foreach ($m in $modVk) { $list += (Key $m $true) }

$sent = [NcmKey.Native]::SendInput($list.Count, $list, [Runtime.InteropServices.Marshal]::SizeOf((New-Object 'NcmKey.Native+INPUT')))
Write-Output "SENT $sent"
