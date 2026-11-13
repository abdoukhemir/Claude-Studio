' Starts Claude Studio hidden (port 4600), outside any terminal, so it keeps running on its own.
CreateObject("WScript.Shell").Run "cmd /c cd /d E:\ClaudeCode\Studio && node server.mjs >> data\server.log 2>&1", 0, False
