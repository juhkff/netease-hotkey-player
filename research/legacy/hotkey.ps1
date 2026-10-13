# 全局热键监听：注册热键后阻塞在消息循环里，
# 每按下一次就往 stdout 打一行 "FIRE <编号>"，由 node 侧（daemon.mjs）接住。
#
# 用法（必须用 Windows PowerShell 5.1，路径必须是本地路径，UNC 路径下 -File 会失败）：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File hotkey.ps1 -Bindings "1:3:0x50;2:3:0x51"
#   Bindings 格式：<编号>:<修饰键位掩码>:<虚拟键码>，多条用 ; 分隔
#   修饰键：Alt=1  Ctrl=2  Shift=4  Win=8（可相加）
param([Parameter(Mandatory = $true)][string]$Bindings)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace NcmHot -Name Native -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct MSG {
  public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam;
  public uint time; public int ptX; public int ptY;
}
[DllImport("user32.dll", SetLastError = true)]
public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
[DllImport("user32.dll", SetLastError = true)]
public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
[DllImport("user32.dll")]
public static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);
[DllImport("user32.dll")]
public static extern bool TranslateMessage(ref MSG lpMsg);
[DllImport("user32.dll")]
public static extern IntPtr DispatchMessage(ref MSG lpMsg);
'@

function Out-Line([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }

$ok = @()
foreach ($b in $Bindings.Split(';')) {
  if ([string]::IsNullOrWhiteSpace($b)) { continue }
  $p = $b.Trim().Split(':')
  if ($p.Count -ne 3) { Out-Line "FAIL $b 格式不对"; continue }
  $id = [int]$p[0]
  $mods = [uint32]([Convert]::ToInt32($p[1], 10))
  $vk = [uint32]([Convert]::ToInt32($p[2], 10))
  if ([NcmHot.Native]::RegisterHotKey([IntPtr]::Zero, $id, $mods, $vk)) {
    $ok += $id
    Out-Line "OK $id"
  } else {
    Out-Line ("FAIL $id " + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
}
Out-Line "READY $($ok.Count)"

$msg = New-Object 'NcmHot.Native+MSG'
while ([NcmHot.Native]::GetMessage([ref]$msg, [IntPtr]::Zero, 0, 0) -gt 0) {
  if ($msg.message -eq 0x0312) {   # WM_HOTKEY
    Out-Line ("FIRE " + $msg.wParam.ToInt32())
  }
}
