import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

import {
  DEFAULT_CALENDARS,
  DEFAULTS,
  getBitableTables,
  getToken,
  type AnyTableKey,
  type Config,
  type OptionalTableKey,
  type TableKey,
} from "./utils/feishu_life.js";
import { isMacOS } from "./utils/calendar_platform.js";
import { ensureSleepSyncAppBuilt } from "./utils/build_sleep_sync.js";

const CONFIG_PATH = join(process.cwd(), "life-log.config.json");
const TEMPLATE_PATH = join(process.cwd(), "docs/template.json");

const REQUIRED_TABLES: Record<TableKey, string> = {
  diet: "饮食记录",
  dailySummary: "每日饮食汇总",
  sleep: "入睡记录",
  exercise: "健身管理",
  dateIndex: "日期索引",
  foodComp: "食物成分表",
};

// Present in the shared template, used only by the optional review skill.
// Not required: setup succeeds even if these are missing or renamed.
const OPTIONAL_TABLES: Record<OptionalTableKey, string> = {
  reading: "阅读｜Reading",
  podcast: "播客｜Podcast",
  documentary: "纪录片｜Documentary",
  media: "影视综艺 | Variety",
  time: "每日时间记录跟踪",
};

type CliOptions = {
  appId?: string;
  appSecret?: string;
  appToken?: string;
  recorderName?: string;
  calorieTarget?: string;
  enableCalendar?: boolean;
  sleepCalendar?: string;
  exerciseCalendar?: string;
  healthCalendar?: string;
  overwrite?: boolean;
  printTemplate?: boolean;
  check?: boolean;
  help?: boolean;
};

function usage(exitCode = 1): never {
  console.log(`
Setup for the shareable life log workflow.

Agent / non-interactive (preferred in chat):
  npx tsx scripts/setup_life_log.ts \\
    --app-id APP_ID \\
    --app-secret APP_SECRET \\
    --app-token APP_TOKEN_OR_BASE_URL \\
    [--recorder-name NAME] \\
    [--calorie-target 1800] \\
    [--enable-calendar] \\
    [--yes]

Helpers:
  --print-template   Print the official Feishu template URL
  --check            Report Node, platform, calendar support, and config

Do not run the interactive wizard from an agent chat. Collect the duplicated
editable base URL and Feishu app credentials from the user first.
`);
  process.exit(exitCode);
}

function readTemplateInfo(): { title: string; url: string; instruction: string } {
  if (!existsSync(TEMPLATE_PATH)) {
    return {
      title: "Life Log 飞书复盘表模版",
      url: "",
      instruction: "用户必须先把官方模版复制到自己的个人飞书空间，再把复制后、可编辑的新表格链接发给 agent。",
    };
  }
  return JSON.parse(readFileSync(TEMPLATE_PATH, "utf-8")) as {
    title: string;
    url: string;
    instruction: string;
  };
}

function printCheck(): void {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  const nodeOk = Number.isFinite(major) && major >= 18;
  console.log(`runtime: node v${nodeVersion} (${nodeOk ? "ok" : "need >= 18"})`);
  console.log(`platform: ${process.platform}`);
  console.log(`calendar: ${isMacOS() ? "available" : "macOS only — skip on this machine"}`);
  console.log(existsSync(CONFIG_PATH) ? `config: ${CONFIG_PATH}` : "config: not configured");
  if (!nodeOk) process.exitCode = 1;
}

function printTemplate(): void {
  const template = readTemplateInfo();
  console.log(template.title);
  console.log(template.url ? `url: ${template.url}` : "url: (not published in this repo — ask the user to provide the official template)");
  console.log(`instruction: ${template.instruction}`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--print-template":
        options.printTemplate = true;
        break;
      case "--check":
        options.check = true;
        break;
      case "--yes":
      case "--overwrite":
        options.overwrite = true;
        break;
      case "--enable-calendar":
        options.enableCalendar = true;
        break;
      case "--app-id":
        options.appId = next();
        break;
      case "--app-secret":
        options.appSecret = next();
        break;
      case "--app-token":
      case "--base-url":
        options.appToken = next();
        break;
      case "--recorder-name":
        options.recorderName = next();
        break;
      case "--calorie-target":
        options.calorieTarget = next();
        break;
      case "--sleep-calendar":
        options.sleepCalendar = next();
        break;
      case "--exercise-calendar":
        options.exerciseCalendar = next();
        break;
      case "--health-calendar":
        options.healthCalendar = next();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parseAppToken(inputValue: string): string {
  const trimmed = inputValue.trim();
  if (!trimmed) {
    throw new Error("Missing Bitable appToken or base URL.");
  }

  const baseMatch = trimmed.match(/\/base\/([a-zA-Z0-9]+)/);
  if (baseMatch) return baseMatch[1];

  const queryMatch = trimmed.match(/[?&](?:app_token|appToken)=([a-zA-Z0-9]+)/i);
  if (queryMatch) return queryMatch[1];

  if (/\/wiki\//.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    throw new Error(
      "That looks like a wiki/knowledge-base URL, not the duplicated Bitable itself. Ask the user to open the copied table and send a URL containing `/base/...`, or paste the appToken directly."
    );
  }

  if (/^[a-zA-Z0-9]{10,}$/.test(trimmed)) return trimmed;
  throw new Error("Could not parse a Bitable appToken from that value.");
}

function assertPersonalCopy(inputValue: string, appToken: string): void {
  const template = readTemplateInfo();
  const official = template.url?.trim();
  if (!official) return;

  if (inputValue.trim() === official) {
    throw new Error(
      "That is the official template URL. Duplicate it into the user's personal Feishu space first, then use the new editable /base/ URL."
    );
  }

  try {
    if (parseAppToken(official) === appToken) {
      throw new Error(
        "That is the official template, not a personal copy. Ask the user to duplicate it into their own space and send the new editable table link."
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("official template")) {
      throw error;
    }
  }
}

function hasCredentialFlags(options: CliOptions): boolean {
  return Boolean(options.appId || options.appSecret || options.appToken);
}

async function promptWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue = ""
): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function discoverTables(config: Config): Promise<{
  tables: Array<{ name: string; table_id: string }>;
  resolved: Partial<Record<AnyTableKey, string>>;
  missing: string[];
  optionalMissing: string[];
}> {
  const token = await getToken(config);
  const tables = await getBitableTables(token, config.appToken);
  const tableMap = new Map(tables.map((table) => [table.name, table.table_id]));
  const resolved = {} as Partial<Record<AnyTableKey, string>>;
  const missing: string[] = [];
  const optionalMissing: string[] = [];

  for (const [key, expectedName] of Object.entries(REQUIRED_TABLES) as Array<[TableKey, string]>) {
    const exactMatch = tableMap.get(expectedName);
    if (exactMatch) {
      resolved[key] = exactMatch;
    } else {
      missing.push(`${key} (${expectedName})`);
    }
  }

  for (const [key, expectedName] of Object.entries(OPTIONAL_TABLES) as Array<[OptionalTableKey, string]>) {
    const exactMatch = tableMap.get(expectedName);
    if (exactMatch) {
      resolved[key] = exactMatch;
    } else {
      optionalMissing.push(`${key} (${expectedName})`);
    }
  }

  return { tables, resolved, missing, optionalMissing };
}

function printDetectedTables(tables: Array<{ name: string; table_id: string }>): void {
  console.log("\nDetected Feishu tables:");
  for (const table of tables) {
    console.log(`- ${table.name} (${table.table_id})`);
  }
}

function writeConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  console.log(`\nSaved config to ${CONFIG_PATH}`);
}

// Compile the EventKit Calendar helper app right away when the user opts in,
// instead of waiting for the first sleep record to trigger a slower, more
// surprising build (and a possibly confusing failure mid-log). This is
// best-effort: setup still succeeds even if the build fails (e.g. no Xcode
// Command Line Tools) — the CLI falls back to a more limited sync method.
function maybeBuildCalendarHelper(enableCalendar: boolean): void {
  if (!enableCalendar || !isMacOS()) return;

  console.log("\nBuilding the macOS Calendar helper app (needed for the permission prompt)...");
  const result = ensureSleepSyncAppBuilt();
  if (result.ok) {
    console.log("✅ Calendar helper app ready. The first `sleep` record will trigger a one-time macOS permission prompt — allow it to enable sync.");
  } else {
    console.log(`⚠️ Could not build the Calendar helper app now: ${result.error}`);
    console.log("Sleep logging to Feishu still works. Calendar sync will retry building automatically on the next sleep record, or run: npm run build:calendar-helper");
  }
}

async function runNonInteractive(options: CliOptions): Promise<void> {
  if (!options.appId || !options.appSecret || !options.appToken) {
    throw new Error("Non-interactive setup requires --app-id, --app-secret, and --app-token (or --base-url).");
  }

  if (existsSync(CONFIG_PATH) && !options.overwrite) {
    throw new Error("life-log.config.json already exists. Re-run with --yes to overwrite.");
  }

  const appToken = parseAppToken(options.appToken);
  assertPersonalCopy(options.appToken, appToken);
  const enableCalendar = Boolean(options.enableCalendar);
  if (enableCalendar && !isMacOS()) {
    throw new Error("Calendar sync is macOS-only. Omit --enable-calendar on Windows/Linux.");
  }
  const config: Config = { appId: options.appId, appSecret: options.appSecret, appToken };
  const { tables, resolved, missing, optionalMissing } = await discoverTables(config);
  printDetectedTables(tables);

  if (missing.length > 0) {
    throw new Error(
      `Missing required tables: ${missing.join(", ")}. The user may have sent the official template instead of their duplicated editable copy, or the copy is incomplete.`
    );
  }

  if (optionalMissing.length > 0) {
    console.log(`\nOptional review tables not found (life-review skill will skip them): ${optionalMissing.join(", ")}`);
  }

  writeConfig({
    appId: options.appId,
    appSecret: options.appSecret,
    appToken,
    tables: resolved,
    calendars: {
      sleep: options.sleepCalendar || DEFAULT_CALENDARS.sleep,
      exercise: options.exerciseCalendar || DEFAULT_CALENDARS.exercise,
      health: options.healthCalendar || DEFAULT_CALENDARS.health,
    },
    defaults: {
      recorderName: options.recorderName || DEFAULTS.recorderName,
      dailyCalorieTarget: Number(options.calorieTarget) || DEFAULTS.dailyCalorieTarget,
      timezone: DEFAULTS.timezone,
      enableSleepCalendarSync: enableCalendar,
    },
  });

  maybeBuildCalendarHelper(enableCalendar);
}

async function runInteractive(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    if (existsSync(CONFIG_PATH)) {
      const overwrite = await promptWithDefault(rl, "life-log.config.json already exists. Overwrite? (y/N)", "N");
      if (!/^y(es)?$/i.test(overwrite)) {
        console.log("Setup cancelled.");
        return;
      }
    }

    const template = readTemplateInfo();
    console.log("Feishu setup:");
    console.log("1. Ask the user for the official template link (not published in this repo), then have them duplicate it into their personal Feishu space.");
    if (template.url) console.log(`   Template: ${template.url}`);
    console.log("2. Send back the new editable base URL (it should contain /base/...).");
    console.log("3. Create a Feishu internal app and add it as a collaborator on that copied base.");
    console.log("");

    const appId = await promptWithDefault(rl, "Feishu appId");
    const appSecret = await promptWithDefault(rl, "Feishu appSecret");
    const appTokenInput = await promptWithDefault(rl, "Duplicated editable base URL or appToken");
    const appToken = parseAppToken(appTokenInput);
    assertPersonalCopy(appTokenInput, appToken);
    const recorderName = await promptWithDefault(rl, "Default recorder name", DEFAULTS.recorderName);
    const dailyCalorieTargetRaw = await promptWithDefault(
      rl,
      "Daily calorie target",
      String(DEFAULTS.dailyCalorieTarget)
    );
    const enableCalendarRaw = isMacOS()
      ? await promptWithDefault(rl, "Enable optional macOS Calendar integration? (y/N)", "N")
      : "N";
    if (!isMacOS()) {
      console.log("Calendar sync is macOS-only; skipping on this machine.");
    }
    const enableCalendar = /^y(es)?$/i.test(enableCalendarRaw);

    const config: Config = { appId, appSecret, appToken };
    const { tables, resolved, missing, optionalMissing } = await discoverTables(config);
    printDetectedTables(tables);

    for (const [key, expectedName] of Object.entries(REQUIRED_TABLES) as Array<[TableKey, string]>) {
      if (resolved[key]) continue;
      const manual = await promptWithDefault(
        rl,
        `Table "${expectedName}" not found. Enter a table ID or another table name for ${key}`
      );
      const match = tables.find((table) => table.name === manual || table.table_id === manual);
      resolved[key] = match?.table_id || manual;
    }

    if (missing.length > 0) {
      console.log(`\nWarning: these template table names were missing: ${missing.join(", ")}`);
    }

    if (optionalMissing.length > 0) {
      console.log(`Optional review tables not found (life-review skill will skip them): ${optionalMissing.join(", ")}`);
    }

    const calendars = enableCalendar
      ? {
          sleep: await promptWithDefault(rl, "Sleep calendar name", DEFAULT_CALENDARS.sleep),
          exercise: await promptWithDefault(rl, "Exercise calendar name", DEFAULT_CALENDARS.exercise),
          health: await promptWithDefault(rl, "Health calendar name", DEFAULT_CALENDARS.health),
        }
      : DEFAULT_CALENDARS;

    writeConfig({
      appId,
      appSecret,
      appToken,
      tables: resolved,
      calendars,
      defaults: {
        recorderName,
        dailyCalorieTarget: Number(dailyCalorieTargetRaw) || DEFAULTS.dailyCalorieTarget,
        timezone: DEFAULTS.timezone,
        enableSleepCalendarSync: enableCalendar,
      },
    });

    maybeBuildCalendarHelper(enableCalendar);
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) usage(0);
  if (options.printTemplate) {
    printTemplate();
    return;
  }
  if (options.check) {
    printCheck();
    return;
  }

  try {
    if (hasCredentialFlags(options)) {
      await runNonInteractive(options);
      return;
    }

    if (!process.stdin.isTTY) {
      console.error("No TTY detected. Do not run interactive setup from an agent.");
      console.error("Collect the duplicated editable Feishu base and app credentials in chat, then run:");
      console.error(
        "  npx tsx scripts/setup_life_log.ts --app-id ... --app-secret ... --app-token ... --yes"
      );
      process.exitCode = 1;
      return;
    }

    await runInteractive();
  } catch (error) {
    console.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Check the duplicated editable Bitable URL, Feishu app credentials, and template table names.");
    process.exitCode = 1;
  }
}

main();
