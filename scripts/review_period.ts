import {
  dateMs,
  getAllRecords,
  getOptionalTableId,
  getTableId,
  getToken,
  loadConfig,
  type Config,
} from "./utils/feishu_life.js";

type CliOptions = {
  start?: string;
  end?: string;
  format?: "json" | "text";
  help?: boolean;
};

function usage(exitCode = 1): never {
  console.log(`
Fetch and aggregate diet / sleep / exercise (+ optional reading / podcast /
documentary / media / time-tracking) records for a date range, so an agent
can write a weekly/monthly review narrative on top of the facts.

Usage:
  npx tsx scripts/review_period.ts --start 2026-08-01 --end 2026-08-07 [--format json|text]

Notes:
  - --start/--end are inclusive, YYYY-MM-DD, using the same day boundary as life_log.ts.
  - Optional tables (reading/podcast/documentary/media/time) are skipped silently
    if not present in life-log.config.json.
  - Default output is JSON; pass --format text for a quick human-readable digest.
`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--start":
        options.start = next();
        break;
      case "--end":
        options.end = next();
        break;
      case "--format":
        options.format = next() as CliOptions["format"];
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function text(value: any): string {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => v?.text || v?.name || "").filter(Boolean).join("、");
  return value.text || value.name || "";
}

function inRange(value: unknown, startTs: number, endTs: number): boolean {
  return typeof value === "number" && value >= startTs && value <= endTs;
}

function dateKey(value: number): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function durationMinutes(start?: number, end?: number): number {
  if (typeof start !== "number" || typeof end !== "number") return 0;
  return Math.round((end - start) / 60000);
}

function linkedToAny(record: any, field: string, ids: Set<string>): boolean {
  const value = record.fields?.[field];
  if (!Array.isArray(value)) return false;
  return value.some((item: any) => Array.isArray(item.record_ids) && item.record_ids.some((id: string) => ids.has(id)));
}

async function getRecordsSafe(token: string, appToken: string, tableId: string, label: string): Promise<any[]> {
  try {
    return await getAllRecords(token, appToken, tableId);
  } catch (error) {
    console.error(`⚠️ skipped ${label}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function buildDateIndexIds(
  token: string,
  config: Config,
  startTs: number,
  endTs: number
): Promise<Set<string>> {
  const dateIndexRecords = await getRecordsSafe(token, config.appToken, getTableId(config, "dateIndex"), "dateIndex");
  const ids = new Set<string>();
  for (const record of dateIndexRecords) {
    const weekStart = Number(record.fields?.["周开始"]);
    const weekEnd = Number(record.fields?.["周结束"]);
    const overlaps =
      Number.isFinite(weekStart) && Number.isFinite(weekEnd) && weekStart <= endTs && weekEnd >= startTs;
    if (overlaps) ids.add(record.record_id);
  }
  return ids;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) usage(0);
  if (!options.start || !options.end) {
    console.error("Missing --start/--end");
    usage();
  }

  const start = options.start!;
  const end = options.end!;
  const startTs = dateMs(start);
  const endTs = dateMs(end) + 24 * 60 * 60 * 1000 - 1;
  const format = options.format || "json";

  const config = loadConfig();
  const token = await getToken(config);

  const [dietRecords, sleepRecords, exerciseRecords] = await Promise.all([
    getRecordsSafe(token, config.appToken, getTableId(config, "diet"), "diet"),
    getRecordsSafe(token, config.appToken, getTableId(config, "sleep"), "sleep"),
    getRecordsSafe(token, config.appToken, getTableId(config, "exercise"), "exercise"),
  ]);

  const diet = dietRecords.filter((r) => inRange(r.fields?.["日期"], startTs, endTs));
  const sleep = sleepRecords
    .filter((r) => inRange(r.fields?.["日期"], startTs, endTs))
    .map((r) => ({
      date: dateKey(r.fields["日期"]),
      score: Number(r.fields?.["睡眠质量"] || 0),
      minutes: durationMinutes(r.fields?.["入睡时间"], r.fields?.["起床时间"]),
      note: String(r.fields?.["感想"] || ""),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const exercise = exerciseRecords.filter((r) => inRange(r.fields?.["时间"], startTs, endTs));

  const dietByDay = new Map<string, { kcal: number; protein: number; fat: number; carb: number; count: number; bloating: string[] }>();
  for (const r of diet) {
    const key = dateKey(r.fields["日期"]);
    const current = dietByDay.get(key) || { kcal: 0, protein: 0, fat: 0, carb: 0, count: 0, bloating: [] };
    current.kcal += Number(r.fields?.["卡路里"] || 0);
    current.protein += Number(r.fields?.["蛋白质"] || 0);
    current.fat += Number(r.fields?.["脂肪"] || 0);
    current.carb += Number(r.fields?.["碳水"] || 0);
    current.count += 1;
    if (r.fields?.["是否胀气"]) current.bloating.push(String(r.fields?.["食物"] || ""));
    dietByDay.set(key, current);
  }

  const exerciseByType = new Map<string, { count: number; minutes: number }>();
  for (const r of exercise) {
    const type = text(r.fields?.["类型"]) || "其他";
    const current = exerciseByType.get(type) || { count: 0, minutes: 0 };
    current.count += 1;
    current.minutes += Number(r.fields?.["运动时长"] || 0);
    exerciseByType.set(type, current);
  }

  const result: Record<string, unknown> = {
    range: { start, end },
    sleep: {
      days: sleep.length,
      avgScore: sleep.length ? Math.round(sleep.reduce((s, x) => s + x.score, 0) / sleep.length) : null,
      avgMinutes: sleep.length ? Math.round(sleep.reduce((s, x) => s + x.minutes, 0) / sleep.length) : null,
      entries: sleep,
    },
    diet: {
      totalEntries: diet.length,
      daysTracked: dietByDay.size,
      byDay: [...dietByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, ...d })),
      bloatingFoods: [...new Set([...dietByDay.values()].flatMap((d) => d.bloating))],
    },
    exercise: {
      sessions: exercise.length,
      totalMinutes: exercise.reduce((s, r) => s + Number(r.fields?.["运动时长"] || 0), 0),
      byType: [...exerciseByType.entries()].map(([type, v]) => ({ type, ...v })),
      names: exercise.map((r) => text(r.fields?.["运动项目"])).filter(Boolean),
    },
  };

  const optionalTables: Array<{ key: "reading" | "podcast" | "documentary" | "media"; field: string; label: string }> = [
    { key: "reading", field: "阅读月份", label: "reading" },
    { key: "podcast", field: "收听时间", label: "podcast" },
    { key: "documentary", field: "观看月份", label: "documentary" },
    { key: "media", field: "观看月份", label: "media" },
  ];

  const anyOptionalContent = optionalTables.some((t) => getOptionalTableId(config, t.key));
  if (anyOptionalContent) {
    const dateIndexIds = await buildDateIndexIds(token, config, startTs, endTs);
    const content: Record<string, unknown> = {};
    for (const { key, field, label } of optionalTables) {
      const tableId = getOptionalTableId(config, key);
      if (!tableId) continue;
      const records = await getRecordsSafe(token, config.appToken, tableId, label);
      const hits = records.filter((r) => linkedToAny(r, field, dateIndexIds));
      content[key] = {
        count: hits.length,
        titles: hits.map(
          (r) => text(r.fields?.["书籍名称"]) || text(r.fields?.["标题"]) || text(r.fields?.["纪录片"]) || text(r.fields?.["影剧名称"])
        ),
      };
    }
    result.content = content;
  }

  const timeTableId = getOptionalTableId(config, "time");
  if (timeTableId) {
    const timeRecords = await getRecordsSafe(token, config.appToken, timeTableId, "time");
    const hits = timeRecords.filter((r) => inRange(r.fields?.["开始时间"], startTs, endTs));
    result.timeTracking = {
      entries: hits.length,
      items: hits.map((r) => ({
        event: text(r.fields?.["事件"]),
        output: text(r.fields?.["产出成果"]),
        efficiency: text(r.fields?.["产出效能"]),
      })),
    };
  }

  if (format === "text") {
    const sleepInfo = result.sleep as any;
    const dietInfo = result.diet as any;
    const exerciseInfo = result.exercise as any;
    console.log(`复盘区间: ${start} ~ ${end}`);
    console.log(`睡眠: ${sleepInfo.days} 天记录, 平均评分 ${sleepInfo.avgScore ?? "-"}, 平均时长 ${sleepInfo.avgMinutes ?? "-"} 分钟`);
    console.log(`饮食: ${dietInfo.daysTracked} 天记录, ${dietInfo.totalEntries} 条明细, 胀气食物: ${dietInfo.bloatingFoods.join("、") || "无"}`);
    console.log(`运动: ${exerciseInfo.sessions} 次, 共 ${exerciseInfo.totalMinutes} 分钟`);
    if (result.content) {
      for (const [key, value] of Object.entries(result.content as Record<string, any>)) {
        console.log(`${key}: ${value.count} 项 - ${value.titles.join("、") || "无"}`);
      }
    }
    if (result.timeTracking) {
      console.log(`时间记录: ${(result.timeTracking as any).entries} 条`);
    }
    console.log("\n(使用 --format json 获取完整结构化数据用于生成复盘报告)");
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
