' Runs move-main.ps1 hidden, outside any Claude session.
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File E:\ClaudeCode\Studio\move-main.ps1", 0, False
