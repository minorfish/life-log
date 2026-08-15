---
name: food-tracking
description: Records meals, snacks, drinks, and food photos through the life-log CLI. Use when the user says 记录早餐、记录午餐、记录晚餐、饮食记录、吃了什么, shares a meal photo, or asks for nutrition tracking.
---

# Food Tracking

This is a compatibility entry point for WorkBuddy. The canonical workflow is
the sibling `life-log` skill.

## Required workflow

1. Determine the date, meal, foods, and approximate portions from text or an
   image. Ask only for missing information needed to save safely.
2. Confirm uncertain image recognition or portions with the user.
3. When nutrition values need lookup help, execute:

```bash
npm run query-food -- "食物一" "食物二"
```

Use matching configured food-composition data when available. Otherwise make a
reasonable estimate and state that it is estimated.

4. Write a JSON array to `tmp/diet-items.json`:

```json
[
  {
    "食物": "食物名称",
    "分量": 100,
    "卡路里": 100,
    "蛋白质": 5,
    "脂肪": 2,
    "碳水": 15,
    "备注": ""
  }
]
```

5. From the repository root, execute:

```bash
npm run life -- diet \
  --date YYYY-MM-DD \
  --meal Breakfast \
  --items-file tmp/diet-items.json \
  [--bloated]
```

Use the configured meal values expected by the user's Feishu template.

## Hard rules

- Never call Feishu record APIs or `addRecord`/`addRecords` directly.
- Never store or hardcode app tokens, table IDs, credentials, Feishu URLs,
  recorder names, or personal nutrition targets.
- Never calculate or write the daily summary separately; the CLI updates it.
- Do not inline JSON in shell arguments; always use `--items-file`.
- A failed command must not be retried by writing directly to Feishu.
- Report only the foods and totals actually saved by the CLI.
