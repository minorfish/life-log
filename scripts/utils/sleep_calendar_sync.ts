import { execFileSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { dateMs, formatDateKey, getAllRecords, getTableId, type Config } from "./feishu_life.js";
import { assertMacOSCalendar } from "./calendar_platform.js";
import { APP_DIR as SWIFT_APP, BINARY_PATH as SWIFT_BINARY, ensureSleepSyncAppBuilt } from "./build_sleep_sync.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Swift/EventKit binary inside a minimal .app bundle.  We launch it via `open -W`
// (not by running the binary directly) so that macOS gives it a proper GUI
// context — this is what allows the system to show the Calendar permission
// prompt on first run.  Running the bare binary from a shell does NOT trigger
// the prompt on macOS 14+.
//
// The .app itself is a gitignored build artifact (machine-specific); see
// build_sleep_sync.ts for how it gets compiled from sleep_sync.swift, either
// proactively during `setup_life_log.ts --enable-calendar` or lazily here on
// first use.

// Legacy JXA fallback (requires Automation permission — kept for edge cases only).
const JXA_SCRIPT = join(__dirname, "sync_calendar.jxa.js");

export const DEFAULT_SLEEP_CALENDAR = "睡眠";

// Local cache so we can avoid duplicate events even under "add-only" Calendar
// access (which cannot read existing events for de-dup). Persisted next to the
// project so repeated runs skip already-synced records.
const CACHE_DIR = join(__dirname, "..", "..", "tmp");
const CACHE_PATH = join(CACHE_DIR, ".sleep_calendar_sync_cache.json");

function loadSyncCache(): Record<string, boolean> {
  try {
    if (!existsSync(CACHE_PATH)) return {};
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveSyncCache(cache: Record<string, boolean>): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf-8");
  } catch {
    // best-effort; if the cache can't be written we just lose de-dup next run
  }
}

function cacheKey(calendarName: string, start: number): string {
  return `${calendarName}|${start}`;
}

export type CalendarEvent = {
  start: number;
  end: number;
  title: string;
  notes: string;
};

export type SyncResult = {
  created: number;
  skipped: number;
  failed: Array<{ title: string; start: number; error: string }>;
  total: number;
  invalid: string[];
};

function formatDuration(ms: number): { hours: number; minutes: number } {
  const totalMinutes = Math.round(ms / 60000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function sleepRecordToCalendarEvent(fields: Record<string, unknown>): CalendarEvent | null {
  const sleepAt = Number(fields["入睡时间"]);
  const wakeAt = Number(fields["起床时间"]);
  const quality = fields["睡眠质量"];
  const note = String(fields["感想"] || "").trim();
  const dateKey = formatDateKey(fields["日期"]) || "";

  if (!Number.isFinite(sleepAt) || !Number.isFinite(wakeAt) || wakeAt <= sleepAt) {
    return null;
  }

  const { hours, minutes } = formatDuration(wakeAt - sleepAt);
  const isEarlySleep = formatDateKey(sleepAt) !== dateKey;
  const earlyBadge = isEarlySleep ? "🌙 零点前｜" : "";
  const title = `${earlyBadge}😴 睡眠 ${hours}h${minutes}m（评分${quality}）`;
  const notesLines = [
    `日期：${dateKey}`,
    `入睡：${formatTime(sleepAt)}`,
    `起床：${formatTime(wakeAt)}`,
    `时长：${hours}小时${minutes}分钟`,
    `评分：${quality}`,
  ];
  if (isEarlySleep) {
    notesLines.push("🌙 零点前入睡");
  }
  if (note) {
    notesLines.push("", note);
  }

  return {
    start: sleepAt,
    end: wakeAt,
    title,
    notes: notesLines.join("\n"),
  };
}

export function pushEventsToCalendar(events: CalendarEvent[], calendarName = DEFAULT_SLEEP_CALENDAR): SyncResult {
  assertMacOSCalendar();

  // Filter out events already recorded in our local cache so we don't create
  // duplicates when Calendar read access is unavailable for de-dup.
  const cache = loadSyncCache();
  const pending: CalendarEvent[] = [];
  let cacheSkipped = 0;
  for (const ev of events) {
    if (cache[cacheKey(calendarName, ev.start)]) {
      cacheSkipped += 1;
    } else {
      pending.push(ev);
    }
  }

  if (pending.length === 0) {
    return { created: 0, skipped: cacheSkipped, failed: [], total: events.length, invalid: [] };
  }

  // Lazily compile the EventKit helper app the first time it's needed, so a
  // fresh clone (where scripts/bin/ doesn't exist yet) still gets the proper
  // GUI permission-prompt path instead of silently falling back to the more
  // limited JXA/osascript path below.
  const buildResult = ensureSleepSyncAppBuilt();
  if (buildResult.built) {
    console.log("🔧 Compiled the macOS Calendar helper app (first run on this machine).");
  } else if (!buildResult.ok && buildResult.error) {
    console.warn(`⚠️ Could not build the Calendar helper app (${buildResult.error}); falling back to a more limited sync method.`);
  }

  if (existsSync(SWIFT_BINARY)) {
    // --- Swift / EventKit path (preferred) ---
    // Launch via `open -W` (no --args — Launch Services drops them).
    // Communication is via a fixed input file; the output path is embedded inside.
    const FIXED_INPUT = "/tmp/sleep_sync_input.json";
    const outputPath = join(tmpdir(), `sleep_sync_out_${Date.now()}.json`);

    writeFileSync(FIXED_INPUT, JSON.stringify({
      calendarName,
      outputPath,
      events: pending.map(ev => ({
        start: ev.start,
        end: ev.end,
        title: ev.title,
        notes: ev.notes,
      })),
    }), "utf-8");

    try {
      execFileSync("open", ["-W", SWIFT_APP], {
        encoding: "utf-8",
        timeout: 120_000, // 2 min — user time to respond to the permission prompt
      });

      if (!existsSync(outputPath)) {
        // Also check fallback path
        const fallbackPath = "/tmp/sleep_sync_output.json";
        if (existsSync(fallbackPath)) {
          const result = JSON.parse(readFileSync(fallbackPath, "utf-8"));
          if (result.error) throw new Error(result.error);
          return {
            created: result.created ?? 0,
            skipped: cacheSkipped,
            failed: Array.isArray(result.failed) ? result.failed : [],
            total: result.total ?? events.length,
            invalid: [],
          };
        }
        throw new Error("Calendar sync app exited without producing output. It may have crashed or been denied permission.");
      }

      const result = JSON.parse(readFileSync(outputPath, "utf-8"));
      if (result.error) {
        throw new Error(result.error);
      }

      const createdStarts: number[] = Array.isArray(result.createdStarts) ? result.createdStarts : [];
      for (const start of createdStarts) {
        cache[cacheKey(calendarName, start)] = true;
      }
      saveSyncCache(cache);

      if (result.calendarUsed && result.calendarUsed !== calendarName) {
        console.warn(`⚠️ Event created on calendar "${result.calendarUsed}" instead of "${calendarName}". Grant Full Calendar Access for the named calendar.`);
      }

      return {
        created: result.created ?? 0,
        skipped: (result.skipped ?? 0) + cacheSkipped,
        failed: Array.isArray(result.failed) ? result.failed : [],
        total: result.total ?? events.length,
        invalid: [],
      };
    } finally {
      try { unlinkSync(outputPath); } catch { /* ignore */ }
      try { unlinkSync(FIXED_INPUT); } catch { /* ignore */ }
    }
  }

  // --- Legacy osascript/JXA fallback (requires Automation permission) ---
  const tempPath = join(tmpdir(), `sleep_calendar_sync_${Date.now()}.json`);
  writeFileSync(tempPath, JSON.stringify(pending), "utf-8");

  try {
    const output = execFileSync("osascript", ["-l", "JavaScript", JXA_SCRIPT, calendarName, tempPath], {
      encoding: "utf-8",
    }).trim();

    const result = JSON.parse(output);
    if (result.error) {
      throw new Error(result.error);
    }

    const createdStarts: number[] = Array.isArray(result.createdStarts) ? result.createdStarts : [];
    for (const start of createdStarts) {
      cache[cacheKey(calendarName, start)] = true;
    }
    saveSyncCache(cache);

    return {
      created: result.created ?? 0,
      skipped: (result.skipped ?? 0) + cacheSkipped,
      failed: Array.isArray(result.failed) ? result.failed : [],
      total: result.total ?? events.length,
      invalid: [],
    };
  } finally {
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }
}

export function syncSleepRecordsToCalendar(
  records: Array<{ fields?: Record<string, unknown> }>,
  calendarName = DEFAULT_SLEEP_CALENDAR
): SyncResult {
  const invalid: string[] = [];
  const events: CalendarEvent[] = [];

  for (const record of records) {
    const fields = record.fields || {};
    const dateKey = formatDateKey(fields["日期"]) || "未知日期";
    const event = sleepRecordToCalendarEvent(fields);
    if (event) {
      events.push(event);
    } else {
      invalid.push(`${dateKey}（入睡/起床时间缺失或异常）`);
    }
  }

  if (events.length === 0) {
    return { created: 0, skipped: 0, failed: [], total: 0, invalid };
  }

  const result = pushEventsToCalendar(events, calendarName);
  result.invalid = invalid;
  return result;
}

export async function fetchAndSyncSleepToCalendar(
  token: string,
  appTokenOrConfig: string | Config,
  options: {
    date?: string;
    start?: string;
    end?: string;
    all?: boolean;
    calendar?: string;
  }
): Promise<SyncResult & { matched: number }> {
  const calendarName = options.calendar ?? DEFAULT_SLEEP_CALENDAR;
  if (typeof appTokenOrConfig === "string") {
    throw new Error("fetchAndSyncSleepToCalendar requires a full config object with table mappings.");
  }
  const appToken = appTokenOrConfig.appToken;
  const sleepTableId = getTableId(appTokenOrConfig, "sleep");
  let startTs: number | null = null;
  let endTs: number | null = null;

  if (options.date) {
    startTs = dateMs(options.date);
    endTs = startTs;
  } else if (options.start && options.end) {
    startTs = dateMs(options.start);
    endTs = dateMs(options.end);
  } else if (options.all) {
    startTs = null;
    endTs = null;
  } else {
    throw new Error("Provide date, start/end, or all");
  }

  const sleepRecords = await getAllRecords(token, appToken, sleepTableId);
  const filtered = sleepRecords.filter((record) => {
    const dateTs = record.fields?.["日期"];
    if (typeof dateTs !== "number") return false;
    if (startTs === null) return true;
    return dateTs >= startTs && dateTs <= (endTs ?? startTs);
  });

  if (filtered.length === 0) {
    return { created: 0, skipped: 0, failed: [], total: 0, invalid: [], matched: 0 };
  }

  const result = syncSleepRecordsToCalendar(filtered, calendarName);
  return { ...result, matched: filtered.length };
}

export function printSyncResult(result: SyncResult, calendarName = DEFAULT_SLEEP_CALENDAR): void {
  if (result.total === 0 && result.invalid.length === 0) {
    console.log("No matching sleep records found for the given range.");
    return;
  }

  console.log(`✅ Synced to "${calendarName}": ${result.created} created, ${result.skipped} already existed.`);
  if (result.failed.length > 0) {
    console.log(`⚠️ ${result.failed.length} event(s) failed to create:`);
    for (const item of result.failed) {
      console.log(`  - ${item.title}: ${item.error}`);
    }
  }
  if (result.invalid.length > 0) {
    console.log(`⚠️ Skipped ${result.invalid.length} record(s) with invalid sleep/wake times:`);
    for (const item of result.invalid) {
      console.log(`  - ${item}`);
    }
  }
}
