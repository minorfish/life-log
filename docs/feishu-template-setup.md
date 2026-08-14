# Feishu Template Setup

The shareable workflow assumes the official template is **read-only for new users**. They must copy it into their own space before the agent can configure anything.

## What the agent must require

1. Ask the user to provide the official template link (the link and its access password are **not published in this repo**; the project owner distributes them privately). `npx tsx scripts/setup_life_log.ts --print-template` prints the current status.
2. Ask the user to duplicate it into **their personal Feishu space**.
3. Wait until the user sends back a **new editable** base URL or appToken. Do not use the official template as the config target.
4. Guide them to create a Feishu internal app and add it as a collaborator on **the copied base**.
5. Write `life-log.config.json` with the non-interactive CLI.

```bash
npx tsx scripts/setup_life_log.ts \
  --app-id APP_ID \
  --app-secret APP_SECRET \
  --app-token 'USER_DUPLICATED_BASE_URL_OR_TOKEN' \
  --yes
```

Do not run the interactive wizard from an agent chat. It needs a TTY and will fail or hang.

## Official template URL

The official template link and its access password are **NOT stored in this repo** (public repos would leak them). The project owner distributes the link privately; the agent asks the user to provide it during setup.

Example `docs/template.json`:

```json
{
  "title": "Life Log 飞书复盘表模版",
  "url": "",
  "instruction": "官方模版链接和访问密码不随仓库公开：请向用户索要飞书模版链接（或由项目维护者私下分发）。用户必须先把模版复制到自己的个人飞书空间，再把复制后、可编辑的新表格链接发给 agent。不要直接用官方模版链接做配置。"
}
```

- `url` left empty means the template is not published here — the agent must ask the user for it.
- If the template is an encrypted Feishu link, tell the user the password is typed **into the page**, never appended to the URL.

Users must still duplicate the template into their personal space before setup.

## Required tables

| Logical key | Template table name | Purpose |
| --- | --- | --- |
| `diet` | `饮食记录` | Per-food meal records |
| `dailySummary` | `每日饮食汇总` | Daily nutrition rollup |
| `sleep` | `入睡记录` | Sleep archive keyed by wake-up date |
| `exercise` | `健身管理` | Exercise sessions |
| `dateIndex` | `日期索引` | Week / month link records |
| `foodComp` | `食物成分表` | Nutrition lookup library |

## Optional tables (life-review skill only)

These come with the shared template but are **not required** for diet/sleep/exercise logging. Setup auto-detects them by name if present and writes them into `life-log.config.json`; if missing or renamed, setup still succeeds and the `life-review` skill just skips that dimension.

| Logical key | Template table name | Purpose |
| --- | --- | --- |
| `reading` | `阅读｜Reading` | Books read, linked to a week via `阅读月份` |
| `podcast` | `播客｜Podcast` | Podcast episodes, linked via `收听时间` |
| `documentary` | `纪录片｜Documentary` | Documentaries, linked via `观看月份` |
| `media` | `影视综艺 \| Variety` | Movies/shows, linked via `观看月份` |
| `time` | `每日时间记录跟踪` | Manually logged time blocks with `开始时间`/`结束时间` |

## Minimum field expectations

### 入睡记录

- `日期`
- `入睡时间`
- `起床时间`
- `睡眠质量`
- `感想`

### 饮食记录

- `记录人`
- `日期`
- `餐别`
- `食物`
- `分量`
- `卡路里`
- `蛋白质`
- `脂肪`
- `碳水`
- `备注`
- `是否胀气`

### 每日饮食汇总

- `日期`
- `总热量`
- `蛋白质`
- `脂肪`
- `碳水`
- `热量缺口`

### 健身管理

- `运动项目`
- `运动时长`
- `类型`
- `时间`
- `强度（星星）`
- `感受`
- `运动月份`

### 日期索引

- `具体周数`
- `周开始`
- `周结束`
- `所属周数`
- `所属季度`
- `所属月份`

## Installation promise

- Official template link is NOT stored in the repo; the user or project owner provides it during setup
- Template duplication into the user's personal space is a required agent-gated step
- App credential creation is manual, collected in chat
- Table ID discovery is automatic after the user provides credentials and their duplicated `appToken`
