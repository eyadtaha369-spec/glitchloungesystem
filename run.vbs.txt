' Always resolves relative to THIS script's own real location, not
' whatever the current working directory happens to be — critical if
' this file gets moved, copied, or launched via a Desktop shortcut,
' since "cmd /c start-local.bat" alone would otherwise look for that
' file in the wrong place (or worse, silently find and run a stale
' copy sitting somewhere else on the same machine).
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir
WshShell.Run "cmd /c """ & scriptDir & "\start-local.bat""", 0, False