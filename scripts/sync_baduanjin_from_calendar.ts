import { execFileSync } from "child_process";

import {
  addRecord,
  formatDateKey,
  getAllRecords,
  getCalendarName,
  getTableId,
  getToken,
  loadConfig,
  resolveWeekRecordId,
} from "./utils/feishu_life.js";
import { assertMacOSCalendar } from "./utils/calendar_platform.js";

const DEFAULT_CALENDAR = "健康";
const DEFAULT_KEYWORD = "八段锦";
const DUPLICATE_WINDOW_MS = 60 * 1000;

type CalendarEvent = {
  title: string;
  startMs: number;
  endMs: number;
};

function usage(): never {
  console.log(`
Sync Baduanjin events from macOS Calendar to Feishu exercise table.

Usage:
  npx tsx scripts/sync_baduanjin_from_calendar.ts --month 2026-08
  npx tsx scripts/sync_baduanjin_from_calendar.ts --month 2026-08 --calendar 健康

Notes:
  - Only events whose title contains "${DEFAULT_KEYWORD}" are synced.
  - Default source calendar: "${DEFAULT_CALENDAR}".
  - Dedupe key: 运动项目=八段锦 and start time within 1 minute.
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

function parseMonth(month: string): { startIso: string; endIso: string } {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid month format: ${month}. Expected YYYY-MM.`);
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error(`Invalid month value: ${month}`);
  }

  const start = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthNumber, 1, 0, 0, 0));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function fetchCalendarEvents(calendarName: string, keyword: string, month: string): CalendarEvent[] {
  const { startIso, endIso } = parseMonth(month);
  const script = `
function run(argv) {
  var calName = argv[0];
  var keyword = argv[1];
  var start = new Date(argv[2]);
  var end = new Date(argv[3]);
  var app = Application("Calendar");
  var cal = app.calendars.byName(calName);
  if (!cal.exists()) {
    throw new Error("Calendar not found: " + calName);
  }
  var evs = cal.events.whose({
    summary: { _contains: keyword },
    startDate: { _greaterThanEquals: start, _lessThan: end }
  })();
  var out = [];
  for (var i = 0; i < evs.length; i++) {
    out.push({
      title: evs[i].summary() || "",
      startMs: evs[i].startDate().getTime(),
      endMs: evs[i].endDate().getTime()
    });
  }
  return JSON.stringify(out);
}
`;

  const output = execFileSync("osascript", ["-l", "JavaScript", "-e", script, calendarName, keyword, startIso, endIso], {
    encoding: "utf-8",
  }).trim();

  return JSON.parse(output) as CalendarEvent[];
}

function inferDurationMinutes(event: CalendarEvent): string {
  let minutes: number | null = null;

  const hourMinuteMatch = event.title.match(/(\d+)\s*小时\s*(\d+)\s*分钟/);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1]);
    const extraMinutes = Number(hourMinuteMatch[2]);
    minutes = hours * 60 + extraMinutes;
  }

  if (minutes === null) {
    const minuteOnlyMatch = event.title.match(/(\d+)\s*分钟/);
    if (minuteOnlyMatch) {
      minutes = Number(minuteOnlyMatch[1]!);
    }
  }

  if (minutes === null) {
    minutes = Math.max(1, Math.round((event.endMs - event.startMs) / 60000));
  }

  // Baduanjin sessions are usually short; hour-long calendar titles are
  // treated as mistaken records and normalized to the common session length.
  if (minutes > 30) {
    return "17";
  }

  return String(minutes);
}

async function main() {
  assertMacOSCalendar();
  const options = parseArgs(process.argv.slice(2));
  const month = typeof options.month === "string" ? options.month : "";
  if (!month) usage();

  const config = loadConfig();
  const calendarName = typeof options.calendar === "string" ? options.calendar : getCalendarName(config, "health");
  const keyword = typeof options.keyword === "string" ? options.keyword : DEFAULT_KEYWORD;
  const token = await getToken(config);
  const exerciseTableId = getTableId(config, "exercise");
  const existing = await getAllRecords(token, config.appToken, exerciseTableId);

  const events = fetchCalendarEvents(calendarName, keyword, month).sort((a, b) => a.startMs - b.startMs);
  if (events.length === 0) {
    console.log(`No "${keyword}" events found in calendar "${calendarName}" for ${month}.`);
    return;
  }

  console.log(`Found ${events.length} "${keyword}" calendar event(s) in ${month}.`);

  let created = 0;
  let skipped = 0;

  for (const event of events) {
    const duplicate = existing.some((record) => {
      const fields = record.fields || {};
      return fields["运动项目"] === "八段锦"
        && Math.abs(Number(fields["时间"]) - event.startMs) < DUPLICATE_WINDOW_MS;
    });

    if (duplicate) {
      skipped += 1;
      console.log(`Skipping existing record: ${formatDateKey(event.startMs)} ${event.title}`);
      continue;
    }

    const date = formatDateKey(event.startMs);
    if (!date) {
      throw new Error(`Unable to parse event date for ${event.title}`);
    }

    const weekRecordId = await resolveWeekRecordId(token, config.appToken, date, config);
    const fields: Record<string, unknown> = {
      "运动项目": "八段锦",
      "运动时长": inferDurationMinutes(event),
      "类型": "养生",
      "时间": event.startMs,
      "强度（星星）": 2,
      "感受": "放松",
    };
    if (weekRecordId) {
      fields["运动月份"] = [weekRecordId];
    }

    await addRecord(token, config.appToken, exerciseTableId, fields);
    existing.push({ fields });
    created += 1;
    console.log(`✅ exercise saved: ${date} ${event.title}`);
  }

  console.log(`Done: ${created} created, ${skipped} skipped.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
