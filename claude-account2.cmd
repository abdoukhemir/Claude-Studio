@echo off
rem Claude Code on account 2. Its login key (from "claude setup-token", made once by the account
rem owner) is read from token.txt in its folder; conversations are shared with account 1.
set CLAUDE_CONFIG_DIR=C:\Users\abder\.claude-accounts\second
if exist "%CLAUDE_CONFIG_DIR%\token.txt" set /p CLAUDE_CODE_OAUTH_TOKEN=<"%CLAUDE_CONFIG_DIR%\token.txt"
cd /d E:\ClaudeCode\LangAno
claude %*
