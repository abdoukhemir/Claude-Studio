# Restarts Claude Studio right away (desktop shortcut "Restart Claude Studio"). Tabs that were
# running reopen by themselves a few seconds later and continue their conversations.
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'restart-studio\.ps1' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.mjs' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }
Start-Sleep -Seconds 2
Start-Process wscript -ArgumentList '"E:\ClaudeCode\Studio\studio.vbs"'
"restarted by hand $(Get-Date -Format s)" | Out-File -Append E:\ClaudeCode\Studio\data\restart.log
