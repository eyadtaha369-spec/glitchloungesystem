' Silent launcher for CLOUD MODE — runs start-cloud.bat with no visible
' console windows. Always resolves relative to THIS script's own real
' location (not wherever it happens to be launched from), same fix as
' run.vbs — safe to place a shortcut to this anywhere (Desktop, Start
' Menu) without it losing track of the project folder.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = scriptDir
WshShell.Run "cmd /c """ & scriptDir & "\start-cloud.bat""", 0, False
