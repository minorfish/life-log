import { getCalendarName, getToken, loadConfig } from "./utils/feishu_life.js";
import { DEFAULT_SLEEP_CALENDAR, fetchAndSyncSleepToCalendar, printSyncResult } from "./utils/sleep_calendar_sync.js";

function usage(): never {
  console.log(`
Sync sleep records from Feishu Bitable into macOS Calendar.app

Usage:
  npx tsx scripts/sync_sleep_to_calendar.ts --date 2026-08-14
  npx tsx scripts/sync_sleep_to_calendar.ts --start 2026-08-01 --end 2026-08-14
  npx tsx scripts/sync_sleep_to_calendar.ts --all
  npx tsx scripts/sync_sleep_to_calendar.ts --date 2026-08-14 --calendar "睡眠"

Notes:
  - Matches sleep records by 日期 (wake-up date).
  - Skips creating an event if one already starts within 5 minutes of an
    existing event in the target calendar (avoids duplicates on re-run).
  - Default calendar: "${DEFAULT_SLEEP_CALENDAR}" (must already exist).
  - Sleep records saved via life_log.ts are synced automatically when
    enableSleepCalendarSync is true in life-log.config.json.
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

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (typeof options.date !== "string" && !(typeof options.start === "string" && typeof options.end === "string") && !options.all) {
    usage();
  }

  const config = loadConfig();
  const defaultCalendarName = getCalendarName(config, "sleep") || DEFAULT_SLEEP_CALENDAR;
  const calendarName = typeof options.calendar === "string" ? options.calendar : defaultCalendarName;
  const token = await getToken(config);
  const result = await fetchAndSyncSleepToCalendar(token, config, {
    date: typeof options.date === "string" ? options.date : undefined,
    start: typeof options.start === "string" ? options.start : undefined,
    end: typeof options.end === "string" ? options.end : undefined,
    all: options.all === true,
    calendar: calendarName,
  });

  if (result.matched > 0) {
    console.log(`Found ${result.matched} sleep record(s) in range.`);
  }
  printSyncResult(result, calendarName);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
