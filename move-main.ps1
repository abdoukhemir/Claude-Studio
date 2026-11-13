# Moves the PotaLang main conversation from the old workspace (port 4545) into Studio's Main tab:
# waits so Claude can finish its reply, closes the old workspace (and the Claude inside it), then
# resumes the same conversation in Studio.
Start-Sleep -Seconds 45
$all = Get-CimInstance Win32_Process
$old = $all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'server\.js' -and $_.CommandLine -notmatch 'helper' }
foreach ($p in $old) { taskkill /PID $p.ProcessId /T /F | Out-Null }
# The old start.cmd window too.
$all | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'PotaWorkspace\start\.cmd' } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }
# Wait until no Claude is left on this conversation, so only one ever writes to it.
for ($i = 0; $i -lt 30; $i++) {
  $left = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | Where-Object { $_.CommandLine -match 'b380f15d' }
  if (-not $left) { break }
  Start-Sleep -Seconds 1
}
Start-Sleep -Seconds 2
Invoke-WebRequest -UseBasicParsing -Method Post -Uri http://127.0.0.1:4600/api/s/potamain01/restart -Headers @{ Origin = 'http://localhost:4600' } -ContentType 'application/json' -Body '{"effort":"medium"}' | Out-Null
"moved $(Get-Date -Format s)" | Out-File -Append E:\ClaudeCode\Studio\data\move-main.log
