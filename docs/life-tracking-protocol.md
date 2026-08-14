# 生活复盘数据记录协议

本文档定义将生活数据写入飞书多维表格的标准逻辑。Table ID 以用户自己的 `life-log.config.json` 为准，不要写死某个个人表格。

## 配置

- Runtime: Node.js 18+
- 配置文件: 项目根目录 `life-log.config.json`
  - `appId`, `appSecret`, `appToken`
  - `tables`: 逻辑表名到实际 Table ID
  - `calendars`: 可选 macOS Calendar 名称
  - `defaults`: 记录人、热量目标、是否开启睡眠日历同步

生成配置：

```bash
npm run setup
```

## 睡眠

- 归档日期必须使用起床日期。
- 所有时间字段使用 13 位毫秒时间戳。
- 如果入睡钟点晚于起床钟点，入睡时间记到前一天。
- 00:00 及之后入睡，保存前必须有原因。

必填字段：`日期`、`入睡时间`、`起床时间`、`睡眠质量`。可选：`感想`。

```bash
npm run life -- sleep --date YYYY-MM-DD --sleep-at 23:30 --wake-at 07:14 --quality 87
```

## 饮食

- 一餐拆成多条食物记录。
- 优先用食物成分表折算营养。
- 写入后立即重算当日汇总。

营养折算：`实际数值 = 库中单位数值 * (用户输入分量 / 库中标注分量)`。

必填字段：`记录人`、`日期`、`餐别`、`食物`、`分量`、`卡路里`、`蛋白质`、`脂肪`、`碳水`、`备注`、`是否胀气`。

```bash
npm run life -- diet --date YYYY-MM-DD --meal Lunch --items '[{"食物":"酸奶","卡路里":75}]'
```

## 运动

- 一条记录对应一次运动。
- 自动关联 `日期索引` 对应周。
- 时间不确定时，日历显示可用默认规则：瑜伽 / 羽毛球 / 尊巴 18:00，骑行 19:00。

必填字段：`运动项目`、`运动时长`、`类型`、`时间`、`强度（星星）`、`感受`、`运动月份`。

```bash
npm run life -- exercise --date YYYY-MM-DD --time 18:00 --name "瑜伽" --type "拉伸/塑形" --duration 60 --intensity 2 --feeling "放松"
```

## 模版表名

| 逻辑 key | 模版表名 |
| --- | --- |
| diet | 饮食记录 |
| dailySummary | 每日饮食汇总 |
| sleep | 入睡记录 |
| exercise | 健身管理 |
| dateIndex | 日期索引 |
| foodComp | 食物成分表 |
