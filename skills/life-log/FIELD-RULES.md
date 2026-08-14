# Field Rules

## Sleep

- Main date is the wake-up date.
- If sleep time is later than wake time on the clock, the sleep timestamp belongs to the previous day.
- Sleep quality is a numeric score.
- Sleep notes store the user's reason and feeling, not OCR text by default.

## Diet

- Split one meal into multiple food records.
- Store calories, protein, fat, and carbs per food item when available.
- Recalculate the daily diet summary immediately after inserts or corrections.
- Use the food composition table when the user gives a known food but not nutrition.

## Exercise

- Store one exercise session per record.
- Always include `运动项目`, `时间`, `运动时长`, `类型`, `强度（星星）`, and `感受`.
- Link the record to the correct `日期索引` week row.

## Calendar behavior

- Sleep can auto-sync to the `睡眠` calendar when enabled.
- Non-八段锦 exercise can sync from Feishu to the `锻炼` calendar.
- 八段锦 can sync from the `健康` calendar back into Feishu.
