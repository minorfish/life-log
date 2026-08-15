---
name: sleep-tracking
description: Records sleep from text or screenshots through the life-log CLI. Use when the user says 记录睡眠、记录睡觉、记录昨晚睡眠, shares a sleep screenshot, or asks to save sleep data to Feishu or Calendar.
---

# Sleep Tracking

This is a compatibility entry point for WorkBuddy. The canonical workflow is
the sibling `life-log` skill.

## Required workflow

1. Extract or ask only for:
   - wake-up date (`YYYY-MM-DD`)
   - sleep time (`HH:mm`)
   - wake time (`HH:mm`)
   - quality score (`0-100`)
   - optional reason and feeling
2. Treat `--date` as the wake-up date. Do not calculate timestamps manually.
3. If sleep time is between `00:00` and `05:59`, ask for the late-sleep reason.
4. From the repository root, execute:

```bash
npm run life -- sleep \
  --date YYYY-MM-DD \
  --sleep-at HH:mm \
  --wake-at HH:mm \
  --quality SCORE \
  [--reason "晚睡原因"] \
  [--feeling "感想或截图摘要"]
```

## Hard rules

- Never call Feishu record APIs or `addRecord`/`addRecords` directly.
- Never store or hardcode app tokens, table IDs, credentials, or Feishu URLs.
- Never add `--no-calendar-sync` unless the user explicitly requests it.
- Do not write Feishu first and sync Calendar separately.
- The CLI owns cross-midnight calculation, Feishu writes, and optional macOS
  Calendar sync. Windows automatically skips all macOS-only operations.
- A Calendar warning must not trigger a second Feishu write.
- Report Feishu and Calendar outcomes separately based on actual CLI output.
