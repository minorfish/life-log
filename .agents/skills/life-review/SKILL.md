---
name: life-review
description: Generates a structured weekly or monthly life review (复盘) from the life-log Feishu data — sleep, diet, exercise, and optionally reading/podcast/documentary/media/time-tracking. Use when the user asks for a "周复盘", "月复盘", "本周总结", "上个月复盘", or a similar personal review.
---

# Life Review

Turns the raw records already logged via the `life-log` skill into a narrative review report. This skill only reads data — it never writes records.

## Before reviewing

1. Confirm `life-log.config.json` exists (see the `life-log` skill's [SETUP.md](../life-log/SETUP.md) if not).
2. Resolve the date range the user means:
   - "上周" -> last Mon–Sun
   - "这周" -> this Mon–today
   - "8月" / "上个月" -> full calendar month
   - Otherwise ask for explicit `--start`/`--end` (YYYY-MM-DD, inclusive).

## Fetch the raw data

Run the aggregation script once per review — it fetches diet/sleep/exercise (always) plus reading/podcast/documentary/media/time-tracking (only if those tables are configured; otherwise they are silently skipped):

```bash
npm run review -- --start 2026-08-08 --end 2026-08-14
```

This prints one JSON object with per-day breakdowns and aggregates. Do not hand-fetch tables yourself — this script already handles date filtering and the week-index linking that reading/podcast/documentary/media records use.

## Write the report

Turn the JSON into a Markdown report. Only include a dimension if its data is non-empty (e.g. skip "内容输入" entirely if `content` is absent or all counts are 0). Use these dimensions when data is available:

1. **睡眠** — average score, average duration, early/late sleep pattern, notable notes (`sleep.entries[].note`).
2. **饮食** — days tracked, average calories/protein, foods linked to bloating (`diet.bloatingFoods`).
3. **运动** — session count, total minutes, breakdown by type (`exercise.byType`).
4. **内容输入**（可选）— reading/podcast/documentary/media titles from `content`, grouped by type, with a short theme summary if a pattern is obvious.
5. **时间投入**（可选）— entries from `timeTracking`, especially anything the user tagged as high-output (`efficiency`), compared against what the user says their current focus/goals are (ask if unclear; do not invent goals).

## Output format

- Markdown, one `##`/`###` heading per dimension, short bullet points over long paragraphs.
- State numbers first, then 1–2 sentences of interpretation — do not just restate the JSON as prose.
- If a whole dimension has no data in range, omit it rather than writing "无数据" filler.

## Notes

- This skill is read-only; for corrections to underlying records, use the `life-log` skill's `inspect` + update flow instead.
- `npm run review -- --format text` prints a short human digest instead of JSON, useful for a quick sanity check before writing the full report.
