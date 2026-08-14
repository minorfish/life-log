# Setup

Setup is an **agent-driven conversation**. Do not run the interactive terminal wizard from chat.

The user is not ready to log until they have:

1. Node.js 18+ (you may install this for them)
2. duplicated the official Feishu template into **their own personal space**
3. sent you a **new editable** base URL (not the official template)
4. given you a Feishu internal app `appId` / `appSecret` that can access that copied base

## Step 0 — Node.js

Node is required. Check it **before** `npx tsx`, because those commands cannot run without Node.

1. Run `node -v` and `npm -v` in the shell.
2. Need Node **18 or newer**.
3. If the command is missing or too old, tell the user you can install it, then do it:

**Windows (preferred):**

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
```

After winget, refresh PATH in the same session if `node` is still missing:

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
node -v
```

**macOS with Homebrew:**

```bash
brew install node
```

**If those fail:** send https://nodejs.org/zh-cn/download and wait until the user installs it. Do not try to bootstrap Homebrew just to get Node.

Installing Node may show a permission / UAC prompt. Tell the user to allow it.

4. If `node -v` still fails after a successful installer, ask them to **restart Cursor / WorkBuddy / the terminal**, then check again.
5. In the repo root, run `npm install`.
6. Then:

```bash
npx tsx scripts/setup_life_log.ts --check
npx tsx scripts/setup_life_log.ts --print-template
```

- If already configured, skip the Feishu steps unless the user asks to reconfigure.
- Never call `npm run setup` or `npx tsx scripts/setup_life_log.ts` with no flags in a non-TTY chat. It will hang or fail.
- `--enable-calendar` is macOS-only. On Windows, skip calendar.

对用户说：

> 记录功能需要 Node.js 18+。我先帮你检查；没有的话我可以帮你安装。装完可能要重启一下这个应用。

## Required user actions

Block on each Feishu step. Do not skip. Do not assume the official template is already theirs.

对用户直接说：

> 记录功能需要一份飞书复盘表模版。模版链接**不随这个仓库公开**，需要你提供（或找项目维护者私下索取）。拿到链接后，打开它，在你的**个人飞书空间**里复制一份。复制完成后，把**新的、你可以编辑的表格链接**发我。不要直接把官方模版链接拿来配置。

### Step 1 — Get the official template, then duplicate it

Tell the user:

1. Ask the user to provide the official template link (the link and its access password are **not published in this repo**; the project owner distributes them privately).
2. In Feishu, copy / duplicate it into **their personal space**.
3. After copying, they must have a **new table they can edit**.
4. Send that **new editable table link** back in chat.

Do **not** continue until the user sends a new link.

Reject these as the configuration target:

- the official template URL itself
- a view-only / wiki / knowledge-base link without `/base/`
- “I already opened the template” without a new personal copy

Accept:

- a URL containing `/base/<appToken>`
- or a raw Bitable `appToken`

If they send a `wiki` URL, ask them to open the copied 多维表格 itself and resend a `/base/` link.

### Step 2 — Create a Feishu app and grant access to the copied base

After you have the duplicated editable base, ask the user to:

1. Open [Feishu Open Platform](https://open.feishu.cn/) and create a **internal / 企业自建** app.
2. Copy `App ID` and `App Secret`.
3. Enable Bitable permissions (read/write records, list tables).
4. Publish / create a version if the platform requires it.
5. Open **their copied base** (not the official template) and add this app as a collaborator with edit permission.

Then collect `appId` and `appSecret` in chat.

### Step 3 — Write config non-interactively

Optional questions, with defaults if they skip:

- recorder name (default `User`)
- daily calorie target (default `1800`)
- macOS Calendar sync (default off; do not offer on Windows)

Then run:

```bash
npx tsx scripts/setup_life_log.ts \
  --app-id APP_ID \
  --app-secret APP_SECRET \
  --app-token USER_DUPLICATED_BASE_URL_OR_TOKEN \
  --recorder-name NAME \
  --calorie-target 1800 \
  --yes
```

Add `--enable-calendar` only on macOS and only if they asked for calendar sync.

If setup fails because required tables are missing, the user likely sent the official template or an incomplete copy. Ask them to duplicate again into personal space and resend the **new editable** `/base/` URL.

### Step 4 — Confirm

Run:

```bash
npm run life -- inspect --date YYYY-MM-DD
```

Use today's date. If it reads the copied base without auth errors, setup is done. Then start logging.

## Required template tables

- `饮食记录`
- `每日饮食汇总`
- `入睡记录`
- `健身管理`
- `日期索引`
- `食物成分表`

## Calendar integration

Optional. macOS only. Default off.

- `睡眠`
- `锻炼`
- `健康` (source for 八段锦 reverse-sync)
