---
name: life-log
description: Logs daily meals, sleep, exercise, and simple corrections into a Feishu life-review Bitable through the repo's unified CLI. Use when the user wants to record food, sleep, workouts, body feelings, corrections, inspect a day's data, or set up the Feishu template and app credentials.
---

# Life Log

Use this skill to turn a chat message into structured life-log records in Feishu.

## Before logging

1. Confirm Node.js 18+ exists (`node -v`). If missing, follow [SETUP.md](SETUP.md) Step 0 and install it for the user.
2. Confirm setup exists:
   - Prefer `life-log.config.json` in the repo root.
   - Check with `npx tsx scripts/setup_life_log.ts --check`.
3. If setup is missing, follow [SETUP.md](SETUP.md). This is a **chat checklist**, not a terminal wizard.
   - Ask the user to provide the official template link (it is **not published in this repo**; the project owner distributes it privately). `--print-template` only prints setup status.
   - Require them to copy it into **their personal Feishu space**.
   - Require them to send back a **new editable** base URL (`/base/...`), not the official template.
   - Then collect Feishu `appId` / `appSecret` and run setup with flags.
   - Never run `npm run setup` or `npx tsx scripts/setup_life_log.ts` without flags in chat.
4. Route all standard writes through `scripts/life_log.ts`.
5. Use `scripts/query_food.ts` only when nutrition needs lookup help.

## Supported flows

- `diet`: meals, snacks, drinks, bloating feedback
- `sleep`: sleep / wake time, score, reason, feeling
- `exercise`: workout name, time, duration, type, intensity, feeling
- `inspect`: read back one date before corrections or when the user asks what is already logged

## Workflow

### 1. Classify the request

- Food / meal / snack -> `diet`
- Sleep / wake / score -> `sleep`
- Workout / yoga / badminton / cycling -> `exercise`
- Correction / what is already there -> `inspect` first, then update or append
- Install / setup / 配置飞书 / 还没有表格 -> [SETUP.md](SETUP.md)
- 周复盘 / 月复盘 / 本周总结 / review -> the `life-review` skill (`../life-review/SKILL.md`), not this file

### 2. Ask only for missing critical fields

Only block when a record cannot be written safely.

- `diet`: date, meal, item list
- `sleep`: wake-up date, sleep time, wake time, quality
- `exercise`: date, time, name, duration, type, intensity, feeling

If the user already gave enough information, do not over-question.

### 3. Run the unified CLI

Prefer writing diet JSON with the Write tool to `tmp/diet-items.json`, then pass `--items-file`. Do not inline JSON on Windows `cmd.exe`.

```bash
npm run life -- diet --date YYYY-MM-DD --meal Lunch --items-file tmp/diet-items.json
npm run life -- sleep --date YYYY-MM-DD --sleep-at 23:30 --wake-at 07:30 --quality 85 --feeling "还行"
npm run life -- exercise --date YYYY-MM-DD --time 18:00 --name "瑜伽" --type "拉伸/塑形" --duration 60 --intensity 2 --feeling "放松"
npm run life -- inspect --date YYYY-MM-DD
```

## Important rules

- Sleep uses the wake-up date as the main date.
- Cross-midnight sleep is handled automatically by the CLI.
- Late sleep after 00:00 requires a reason before saving.
- Diet summary is recalculated automatically after diet writes.
- Sleep records sync to macOS Calendar automatically only when enabled in config, and only on macOS.
- First sync on a machine compiles a small helper app and macOS shows a one-time Calendar permission prompt — tell the user to expect and allow it. Calendar failures never block or fail the Feishu write.
- If the sync warning mentions "permission was denied", the user previously clicked Deny; macOS won't prompt again — send them to System Settings → Privacy & Security → Calendar to enable it for "SleepSync" manually.
- Exercise calendar sync is optional and uses separate scripts.

## Corrections

When the user says something was wrong:

1. Run `inspect` for that date.
2. Confirm which record should change.
3. Apply a targeted update rather than adding a duplicate when practical.

## Additional references

- Setup guide: [SETUP.md](SETUP.md)
- Logging examples: [EXAMPLES.md](EXAMPLES.md)
- Shared rules: [FIELD-RULES.md](FIELD-RULES.md)
- Weekly/monthly review (read-only): `../life-review/SKILL.md`
