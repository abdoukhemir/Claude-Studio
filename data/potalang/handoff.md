Continue PotaLang (E:\ClaudeCode\LangAno). Read your memory notes first: they hold the rules (no emojis, keep PotaWorkspace/state/status.json updated, light tests only) and where everything is.

Where we stopped (2026-10-20):
1. APK for friends: EAS preview build ee2342f2-fb78-4f50-8d8a-18446d926636 (eas.json "preview" makes an .apk). When it shows FINISHED (`npx eas-cli@latest build:view <id> --json`), download the APK, install it on my phone with adb (phone over Wi-Fi: Studio, Phone panel, "Connect over Wi-Fi"), and give me the download link to share. It includes the 8 lessons per level, review chips, unit checkpoint, placement test, "Fix my mistakes", Slice changes, and the speaking and "Eu" fixes.
2. Tests: the essential engine tests (lesson without the full sweep, rewards, progress, checkpoint) were running; re-run them with `npx jest --runInBand <files>`. The full "every part of every level" sweep for all 20 pairs takes hours: run it only when the PC is idle. If anything fails, fix it and rebuild the APK.
3. Italian course: 7,215 lines left (C1, C2, end of B2). It is written by a Claude Haiku helper with `scripts/lang/missing.mjs it 8`, sidecars in PotaWorkspace/state/it-claude/, and rules in it-claude/ITALIAN-RULES.md. It is PAUSED: do not restart it until I say so. The tip translations are left for the local Gemma worker (paused, file state/it-course.pause).
4. After Italian: run the course check on Italian (like Portuguese and German), then release Italian (i18n block, story, remove the preview flag).

Keep messages short and save credits: no heavy test runs while other work runs, and fresh sessions per topic.
