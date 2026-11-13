@echo off
rem Starts Claude Studio (if it is not running yet) and opens it in the browser.
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:4600/api/projects -UseBasicParsing -TimeoutSec 1 | Out-Null } catch { Start-Process wscript -ArgumentList \"%~dp0studio.vbs\"; Start-Sleep -Seconds 2 }"
powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:4548/ping -UseBasicParsing -TimeoutSec 1 | Out-Null } catch { Start-Process wscript -ArgumentList \"E:\ClaudeCode\PotaWorkspace\helper.vbs\" }"
start "" http://localhost:4600
