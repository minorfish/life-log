# life-log

通过和 AI 聊天记录饮食、睡眠、运动，结果写入飞书复盘多维表格。

## 项目约定

- **飞书表** 负责量化数据（时间、分数、卡路里、蛋白质、时长、强度等）
- 微信读书数据可选接入（复盘时询问用户是否开启，接入后补充「心智账户」的阅读数据）

## 你需要准备什么

打开这个仓库后，直接让 AI 说「帮我安装 life-log」。Agent 会按顺序帮你：

1. 检查并安装 Node.js 18+（没有就会帮你装）
2. **向你索要飞书复盘表模版**（模版链接和访问密码**不随仓库公开**，由你提供，或找项目维护者私下获取）
3. **把模版复制到你的个人空间**（这一步必须做，不能直接用模版本身）
4. 把复制后、**可以编辑**的新表格链接发回给 AI
5. 创建一个飞书自建应用，并把它加到这份新表格的协作者里
6. 把 `appId` / `appSecret` 发给 AI

> 🔒 官方模版链接与访问密码**不存放在公开仓库中**：安装时向 AI 提供模版链接即可（或向项目维护者索取）。复制到个人空间后，请把**你自己的副本链接**（可编辑）交给 AI，不要直接使用模版本身。卡点说明见 [docs/feishu-template-setup.md](./docs/feishu-template-setup.md)。

macOS 和 Windows 都可以记到飞书。日历同步只在 macOS 可用，默认关闭。

## 安装

需要 Node.js 18+。不用自己先装：跟 AI 说「帮我安装」即可。Windows 上 Agent 会走 `winget`，Mac 上会走 Homebrew（如果有）。

```bash
npm install
```

然后不要在 agent 对话里直接跑交互式 `npm run setup`。

AI 收齐你复制后的表格链接和应用凭证后，会执行：

```bash
npx tsx scripts/setup_life_log.ts \
  --app-id APP_ID \
  --app-secret APP_SECRET \
  --app-token '你复制后的可编辑表格链接' \
  --yes
```

这会按表名自动发现 Table ID，并生成 `life-log.config.json`。

日历同步只在 macOS 可选。Windows 用户保持默认关闭即可。

## 可选集成：微信读书

在 `life-log.config.json`（不进公共仓库）的 `integrations` 段配置：

```json
{
  "integrations": {
    "weread": {
      "enabled": false
    }
  }
}
```

`weread.enabled` 打开后，复盘时可接入微信读书的划线/笔记数据，补充「心智账户」的阅读时长与书目。

## 开始记录

可以直接和 AI 说：

```text
记录今天午餐：一盒酸奶，一个玉米
记录睡眠：昨天 23:30 睡，今天 07:14 起，87 分
记录昨天 18:00 的瑜伽，60 分钟，挺累的
```

也可以自己跑 CLI：

```bash
npm run life -- inspect --date 2026-08-13
npm run life -- sleep --date 2026-08-13 --sleep-at 23:30 --wake-at 07:14 --quality 87
npm run life -- exercise --date 2026-08-13 --time 18:00 --name "瑜伽" --type "拉伸/塑形" --duration 60 --intensity 2 --feeling "放松"
```

## 周复盘 / 月复盘

记录攒够几天后，可以直接跟 AI 说「帮我做个上周复盘」「本月总结一下」。

**复盘流程：**
1. 从飞书读取饮食/睡眠/运动等量化数据，生成 Markdown 复盘报告
2. 询问你：是否要接入自己的微信读书？（若已开启 `weread.enabled`，自动拉取阅读数据补充「心智账户」）
3. 情绪 / 精神账户以「反思题」形式留白，由你手动补充（系统不自动抓取日记）

复盘报告不会改动任何记录，只读不写。

也可以自己跑：

```bash
npm run review -- --start 2026-08-08 --end 2026-08-14
npm run review -- --start 2026-08-08 --end 2026-08-14 --format text
```

## Skill

给 Cursor / WorkBuddy 用的 skill 在：

- `.agents/skills/life-log/`（记录） + `.agents/skills/life-review/`（复盘）
- `skills/life-log/` + `skills/life-review/`（同上，兼容路径）
- `food-tracking/`、`sleep-tracking/` 是 WorkBuddy 兼容入口，最终仍统一调用 `life-log` CLI

两份内容相同。打开这个仓库后，让 AI 按 skill 把聊天内容转成飞书记录，或生成复盘报告。

## 可选：macOS Calendar

Setup 时选择开启后，睡眠记录会自动同步到日历，也可以手动跑：

```bash
npm run sync:sleep -- --date 2026-08-13
npm run sync:exercise -- --month 2026-08
npm run sync:baduanjin -- --month 2026-08
```

默认日历名：

- 睡眠 -> `睡眠`
- 运动 -> `锻炼`
- 八段锦来源 -> `健康`

首次开启日历同步时会自动编译一个小的 EventKit 辅助 App（`scripts/bin/sleep_sync.app`，不进仓库，每台机器各自编译一次），随后第一次记录睡眠会触发系统的日历权限弹窗，点「允许」即可，之后不会再弹。如果编译失败（通常是没装 Xcode 命令行工具），飞书记录不受影响，可以手动执行：

```bash
xcode-select --install       # 缺 swiftc 时先装一次
npm run build:calendar-helper
```

如果之前点过「不允许」，系统不会再自动弹窗，需要去「系统设置 → 隐私与安全性 → 日历」里手动给 `SleepSync` 打开权限。

## 目录

```text
.
├── skills/life-log/           # 对外 skill：记录
├── skills/life-review/        # 对外 skill：复盘（只读）
├── .agents/skills/            # Cursor / agent 兼容路径
├── scripts/                   # 记录、复盘、安装、可选日历同步
├── docs/                      # 飞书模版和记录协议
└── life-log.config.example.json
```
