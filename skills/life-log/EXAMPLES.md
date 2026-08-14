# Examples

## Diet

User:

```text
记录今天午餐：一盒酸奶，一个玉米，没有胀气
```

Expected flow:

1. Parse date and meal.
2. If nutrition is missing, look up likely values or ask for only the missing critical detail.
3. Write the JSON array to `tmp/diet-items.json`, then run:

```bash
npm run life -- diet --date 2026-08-13 --meal Lunch --items-file tmp/diet-items.json
```

## Sleep

User:

```text
记录睡眠：昨天23:30睡，今天7:14起，87分
```

Expected flow:

```bash
npm run life -- sleep --date 2026-08-13 --sleep-at 23:30 --wake-at 07:14 --quality 87
```

## Exercise

User:

```text
记录昨天的瑜伽，18:00，60分钟，挺累的
```

Expected flow:

```bash
npm run life -- exercise --date 2026-08-12 --time 18:00 --name "瑜伽" --type "拉伸/塑形" --duration 60 --intensity 3 --feeling "挺累的"
```

## Correction

User:

```text
昨天午餐不是一个人吃的，帮我改下分量
```

Expected flow:

1. Inspect the date first:

```bash
npm run life -- inspect --date 2026-08-12
```

2. Update only the affected records instead of appending duplicates.
