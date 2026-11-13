' Restarts Claude Studio at a quiet moment (no tab working for a minute), hidden.
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""E:\ClaudeCode\Studio\restart-studio.ps1""", 0, False
