import { readFileSync } from "fs";

import {
  addRecord,
  addRecords,
  dateMs,
  dateTimeMs,
  getAllRecords,
  getCalendarName,
  getRecorderName,
  getTableId,
  getToken,
  isSleepCalendarSyncEnabled,
  loadConfig,
  normalizeText,
  resolveWeekRecordId,
  upsertDailyDietSummary,
  type Config,
} from "./utils/feishu_life.js";
import { fetchAndSyncSleepToCalendar, printSyncResult } from "./utils/sleep_calendar_sync.js";

type DietItemInput = {
  食物?: string;
  food?: string;
  name?: string;
  分量?: number;
  amount?: number;
  卡路里?: number;
  calories?: number;
  蛋白质?: number;
  protein?: number;
  脂肪?: number;
  fat?: number;
  碳水?: number;
  carb?: number;
  备注?: string;
  note?: string;
};

function usage(): void {
  console.log(`
Life Log CLI

Usage:
  npx tsx scripts/life_log.ts diet --date YYYY-MM-DD --meal Lunch --items-file tmp/diet-items.json [--bloated]
  npx tsx scripts/life_log.ts sleep --date YYYY-MM-DD --sleep-at 01:20 --wake-at 08:01 --quality 81 [--reason "..."] [--feeling "..."]
  npx tsx scripts/life_log.ts exercise --date YYYY-MM-DD --time 18:00 --name "瑜伽 (Yoga)" --type "拉伸/塑形" --duration 60 --intensity 2 --feeling 放松
  npx tsx scripts/life_log.ts inspect --date YYYY-MM-DD

Notes:
  - Prefer --items-file over inline --items so Windows shells do not break JSON quotes.
  - Diet items are split into multiple records.
  - Exercise auto-links to the matching week in 日期索引.
  - Sleep感想 only records your own reason/feeling; it will not auto-fill with image text.
  - Late sleep (00:00 or later) requires a reason before saving.
  - Sleep records are synced to macOS Calendar ("睡眠") automatically after save.
  - Pass --no-calendar-sync to skip calendar sync.
  - Diet summary is updated automatically after insert.
`);
  process.exit(1);
}

function parseArgs(argv: string[]): { action: string; options: Record<string, string | boolean | undefined> } {
  const [action = ""] = argv;
  if (!action || action.startsWith("-")) usage();

  const options: Record<string, string | boolean | undefined> = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) continue;
    const next = argv[i + 1];
    if (arg === "--bloated") {
      options.bloated = true;
      continue;
    }
    if (arg.startsWith("--no-")) {
      options[arg.slice(5)] = false;
      continue;
    }
    if (!next || next.startsWith("-")) {
      options[arg.replace(/^--/, "")] = true;
      continue;
    }
    options[arg.replace(/^--/, "")] = next;
    i += 1;
  }

  return { action, options };
}

function requiredString(options: Record<string, string | boolean | undefined>, key: string): string {
  const value = options[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required option: --${key}`);
  }
  return value.trim();
}

function toDietItems(input: string): DietItemInput[] {
  const parsed = JSON.parse(input) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Diet items must be a JSON array");
  }
  return parsed as DietItemInput[];
}

function readDietItems(options: Record<string, string | boolean | undefined>): DietItemInput[] {
  if (typeof options["items-file"] === "string" && options["items-file"].trim()) {
    return toDietItems(readFileSync(options["items-file"].trim(), "utf-8"));
  }
  if (typeof options.items === "string" && options.items.trim()) {
    return toDietItems(options.items);
  }
  throw new Error("Missing diet items. Prefer --items-file tmp/diet-items.json (safer on Windows) or pass --items.");
}

function mapDietItem(item: DietItemInput) {
  const food = item.食物 ?? item.food ?? item.name;
  if (!food) {
    throw new Error("Each diet item needs 食物 / food / name");
  }

  return {
    "食物": food,
    "分量": item.分量 ?? item.amount ?? 1,
    "卡路里": item.卡路里 ?? item.calories ?? 0,
    "蛋白质": item.蛋白质 ?? item.protein ?? 0,
    "脂肪": item.脂肪 ?? item.fat ?? 0,
    "碳水": item.碳水 ?? item.carb ?? 0,
    "备注": item.备注 ?? item.note ?? "",
  };
}

function parseSleepMinutes(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid time format: ${value}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return hour * 60 + minute;
}

function resolveSleepDate(wakeDate: string, sleepAt: string, wakeAt: string): string {
  if (parseSleepMinutes(sleepAt) > parseSleepMinutes(wakeAt)) {
    const d = new Date(`${wakeDate}T12:00:00+08:00`);
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return wakeDate;
}

function normalizeSleepNote(reason: string | undefined, feeling: string | undefined): string {
  const parts: string[] = [];
  if (reason?.trim()) parts.push(`原因：${reason.trim()}`);
  if (feeling?.trim()) parts.push(`感想：${feeling.trim()}`);
  return parts.join('；');
}

async function handleDiet(token: string, config: Config, options: Record<string, string | boolean | undefined>) {
  const date = requiredString(options, "date");
  const meal = requiredString(options, "meal");
  const items = readDietItems(options).map(mapDietItem);
  const isBloated = options.bloated === true || normalizeText(options.bloated) === "true";
  const recorderName = getRecorderName(config);
  const dietTableId = getTableId(config, "diet");

  const records = items.map((item) => ({
    fields: {
      "记录人": recorderName,
      "日期": dateMs(date),
      "餐别": meal,
      "食物": item["食物"],
      "分量": item["分量"],
      "卡路里": item["卡路里"],
      "蛋白质": item["蛋白质"],
      "脂肪": item["脂肪"],
      "碳水": item["碳水"],
      "备注": item["备注"],
      "是否胀气": isBloated,
    },
  }));

  await addRecords(token, config.appToken, dietTableId, records);
  await upsertDailyDietSummary(token, config.appToken, date, config);

  console.log(`✅ diet saved: ${date} ${meal} (${records.length} items)`);
}

async function handleSleep(token: string, config: Config, options: Record<string, string | boolean | undefined>) {
  const date = requiredString(options, "date");
  const sleepAt = requiredString(options, "sleep-at");
  const wakeAt = requiredString(options, "wake-at");
  const quality = Number(requiredString(options, "quality"));
  const reason = typeof options.reason === "string" ? options.reason.trim() : "";
  const feeling = typeof options.feeling === "string" ? options.feeling.trim() : "";

  const sleepMinutes = parseSleepMinutes(sleepAt);
  const afterMidnight = sleepMinutes < 6 * 60;

  if (afterMidnight && !reason) {
    throw new Error("Late sleep after 00:00 requires --reason before saving.");
  }

  const note = normalizeSleepNote(reason || undefined, feeling || undefined);
  const sleepDate = resolveSleepDate(date, sleepAt, wakeAt);
  const fields: Record<string, unknown> = {
    "日期": dateMs(date),
    "入睡时间": dateTimeMs(sleepDate, sleepAt),
    "起床时间": dateTimeMs(date, wakeAt),
    "睡眠质量": quality,
  };

  if (note) {
    fields["感想"] = note;
  }

  await addRecord(token, config.appToken, getTableId(config, "sleep"), fields);

  console.log(`✅ sleep saved: ${date}`);

  if (options["no-calendar-sync"] !== true && isSleepCalendarSyncEnabled(config)) {
    const calendarName = typeof options.calendar === "string" ? options.calendar : getCalendarName(config, "sleep");
    try {
      const result = await fetchAndSyncSleepToCalendar(token, config, { date, calendar: calendarName });
      printSyncResult(result, calendarName);
    } catch (error) {
      console.error(`⚠️ calendar sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function handleExercise(token: string, config: Config, options: Record<string, string | boolean | undefined>) {
  const date = requiredString(options, "date");
  const time = requiredString(options, "time");
  const name = requiredString(options, "name");
  const type = requiredString(options, "type");
  const duration = requiredString(options, "duration");
  const intensity = Number(requiredString(options, "intensity"));
  const feeling = requiredString(options, "feeling");

  const weekRecordId = typeof options["week-record-id"] === "string"
    ? options["week-record-id"]
    : await resolveWeekRecordId(token, config.appToken, date, config);

  if (!weekRecordId) {
    throw new Error(`Unable to resolve week record for ${date}. Pass --week-record-id manually.`);
  }

  await addRecord(token, config.appToken, getTableId(config, "exercise"), {
    "运动项目": name,
    "运动时长": duration,
    "类型": type,
    "时间": dateTimeMs(date, time),
    "强度（星星）": intensity,
    "感受": feeling,
    "运动月份": [weekRecordId],
  });

  console.log(`✅ exercise saved: ${date} ${name}`);
}

async function handleInspect(token: string, config: Config, options: Record<string, string | boolean | undefined>) {
  const date = requiredString(options, "date");
  const dateTs = dateMs(date);

  const [diet, sleep, exercise] = await Promise.all([
    getAllRecords(token, config.appToken, getTableId(config, "diet")),
    getAllRecords(token, config.appToken, getTableId(config, "sleep")),
    getAllRecords(token, config.appToken, getTableId(config, "exercise")),
  ]);

  const dietHits = diet.filter((record) => record.fields?.["日期"] === dateTs);
  const sleepHits = sleep.filter((record) => record.fields?.["日期"] === dateTs);
  const exerciseHits = exercise.filter((record) => record.fields?.["时间"] >= dateTs && record.fields?.["时间"] < dateTs + 24 * 60 * 60 * 1000);

  console.log(JSON.stringify({
    date,
    diet: dietHits.map((record) => record.fields),
    sleep: sleepHits.map((record) => record.fields),
    exercise: exerciseHits.map((record) => record.fields),
  }, null, 2));
}

async function main() {
  const { action, options } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const token = await getToken(config);

  if (action === "diet") {
    await handleDiet(token, config, options);
    return;
  }
  if (action === "sleep") {
    await handleSleep(token, config, options);
    return;
  }
  if (action === "exercise") {
    await handleExercise(token, config, options);
    return;
  }
  if (action === "inspect" || action === "today") {
    await handleInspect(token, config, options);
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
