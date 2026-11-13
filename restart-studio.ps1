# Restarts Claude Studio's server (to load new server code) at a quiet moment: it waits until no
# running tab has been working for a full minute, so nothing in progress is cut off. Tabs that were
# running reopen by themselves and continue their conversations.
$quiet = 0
while ($quiet -lt 3) {
  Start-Sleep -Seconds 20
  try {
    $tabs = Invoke-RestMethod http://127.0.0.1:4600/api/p/potalang/sessions -TimeoutSec 10
    $busy = $false
    foreach ($t in $tabs | Where-Object { $_.running }) {
      $c = Invoke-RestMethod "http://127.0.0.1:4600/api/s/$($t.sid)/chat" -TimeoutSec 20
      if ($c.busy) { $busy = $true }
    }
    if ($busy) { $quiet = 0 } else { $quiet++ }
  } catch { $quiet = 0 }
}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server\.mjs' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }
Start-Sleep -Seconds 2
Start-Process wscript -ArgumentList '"E:\ClaudeCode\Studio\studio.vbs"'
"restarted $(Get-Date -Format s)" | Out-File -Append E:\ClaudeCode\Studio\data\restart.log
