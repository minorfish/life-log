import { execFileSync } from "child_process";
import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { dateTimeMs, formatDateKey, getAllRecords, getCalendarName, getTableId, getToken, loadConfig } from "./utils/feishu_life.js";
import { assertMacOSCalendar } from "./utils/calendar_platform.js";

const JXA_SCRIPT = join(__dirname, "utils", "sync_calendar.jxa.js");
const DEFAULT_CALENDAR = "锻炼";

type CalendarEvent = {
  start: number;
  end: number;
  title: string;
  notes: string;
};

function usage(): never {
  console.log(`
Sync exercise records from Feishu to macOS Calendar.app

Usage:
  npx tsx scripts/sync_exercise_to_calendar.ts --month 2026-08
  npx tsx scripts/sync_exercise_to_calendar.ts --month 2026-08 --calendar 锻炼

Rules:
  - Excludes 八段锦 (those are tracked in another calendar).
  - If the Feishu time is exactly 00:00, default time is inferred:
    - 瑜伽 / 羽毛球 / 尊巴 -> 18:00
    - 骑行 / 骑车 -> 19:00
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.replace(/^--/, "");
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function parseMonth(month: string) {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid month format: ${month}. Expected YYYY-MM.`);
  }
  return {
    start: `${match[1]}-${match[2]}-01`,
    prefix: `${match[1]}-${match[2]}`,
  };
}

function isExactMidnight(ms: number): boolean {
  const d = new Date(ms);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
}

function inferFallbackTime(name: string): string {
  if (/骑行|骑车/.test(name)) return "19:00";
  if (/瑜伽|羽毛球|尊巴|zumba/i.test(name)) return "18:00";
  return "18:00";
}

function buildTitle(name: string, duration: string): string {
  if (/骑行|骑车/.test(name)) return `🚴 ${name} ${duration}分钟`;
  if (/瑜伽/.test(name)) return `🧘 ${name} ${duration}分钟`;
  if (/羽毛球|尊巴|zumba/i.test(name)) return `🏃 ${name} ${duration}分钟`;
  return `🏃 ${name} ${duration}分钟`;
}

function buildCalendarEvent(fields: Record<string, unknown>): CalendarEvent | null {
  const name = String(fields["运动项目"] || "").trim();
  if (!name || name.includes("八段锦")) return null;

  const originalStart = Number(fields["时间"]);
  const duration = String(fields["运动时长"] || "").trim();
  const durationMinutes = Number(duration);
  const dateKey = formatDateKey(originalStart);

  if (!Number.isFinite(originalStart) || !dateKey || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  const inferred = isExactMidnight(originalStart);
  const start = inferred ? dateTimeMs(dateKey, inferFallbackTime(name)) : originalStart;
  const end = start + durationMinutes * 60 * 1000;

  const notesLines = [
    `项目：${name}`,
    `日期：${dateKey}`,
    `时长：${durationMinutes}分钟`,
  ];

  const type = String(fields["类型"] || "").trim();
  const intensity = String(fields["强度（星星）"] || "").trim();
  const feeling = String(fields["感受"] || "").trim();
  if (type) notesLines.push(`类型：${type}`);
  if (intensity) notesLines.push(`强度：${intensity}`);
  if (feeling) notesLines.push(`感受：${feeling}`);
  if (inferred) {
    notesLines.push(`原记录时间：00:00，日历按规则显示为 ${inferFallbackTime(name)}`);
  }

  return {
    start,
    end,
    title: buildTitle(name, duration),
    notes: notesLines.join("\n"),
  };
}

async function main() {
  assertMacOSCalendar();
  const options = parseArgs(process.argv.slice(2));
  const month = typeof options.month === "string" ? options.month : "";
  if (!month) usage();

  const { prefix } = parseMonth(month);

  const config = loadConfig();
  const token = await getToken(config);
  const resolvedCalendarName = typeof options.calendar === "string" ? options.calendar : getCalendarName(config, "exercise");
  const records = await getAllRecords(token, config.appToken, getTableId(config, "exercise"));

  const events = records
    .filter((record) => {
      const dateKey = formatDateKey(record.fields?.["时间"]);
      return Boolean(dateKey?.startsWith(prefix));
    })
    .map((record) => buildCalendarEvent(record.fields || {}))
    .filter((event): event is CalendarEvent => event !== null)
    .sort((a, b) => a.start - b.start);

  if (events.length === 0) {
    console.log(`No matching exercise records found for ${month}.`);
    return;
  }

  const tempPath = join(tmpdir(), `exercise_calendar_sync_${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify(events), "utf-8");

  try {
    const output = execFileSync("osascript", ["-l", "JavaScript", JXA_SCRIPT, resolvedCalendarName, tempPath], {
      encoding: "utf-8",
    }).trim();
    const result = JSON.parse(output);
    if (result.error) {
      throw new Error(result.error);
    }
    console.log(`Found ${events.length} exercise record(s) for ${month}.`);
    console.log(`✅ Synced to "${resolvedCalendarName}": ${result.created} created, ${result.skipped} already existed.`);
    if (Array.isArray(result.failed) && result.failed.length > 0) {
      console.log(`⚠️ ${result.failed.length} event(s) failed to create:`);
      for (const item of result.failed) {
        console.log(`  - ${item.title}: ${item.error}`);
      }
    }
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
