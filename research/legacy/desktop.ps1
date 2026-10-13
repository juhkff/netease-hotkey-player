Add-Type -Namespace W -Name D -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint id);
[DllImport("user32.dll")] public static extern IntPtr GetProcessWindowStation();
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetUserObjectInformation(IntPtr h, int idx, System.Text.StringBuilder p, int n, out int len);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@
$len = 0
$a = New-Object System.Text.StringBuilder 256
[void][W.D]::GetUserObjectInformation([W.D]::GetProcessWindowStation(), 2, $a, 1024, [ref]$len)
$b = New-Object System.Text.StringBuilder 256
[void][W.D]::GetUserObjectInformation([W.D]::GetThreadDesktop([W.D]::GetCurrentThreadId()), 2, $b, 1024, [ref]$len)
"WinSta=$($a.ToString())  Desktop=$($b.ToString())  Session=$((Get-Process -Id $PID).SessionId)"
