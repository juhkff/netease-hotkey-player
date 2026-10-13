' Start the hotkey daemon with no visible window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName) & "\.."
sh.CurrentDirectory = base
sh.Run "node daemon.mjs", 0, False
