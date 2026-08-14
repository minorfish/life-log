// Fetch last-week (or any week) WeRead reading stats and print a structured digest.
// Usage: npx tsx scripts/weread_weekly.ts --date 2026-08-05   (any date inside the week)
//        npx tsx scripts/weread_weekly.ts --start 2026-08-03 --end 2026-08-09
// Env: WEREAD_API_KEY (wrk-xxxx) must be set.
//
// Note: uses `curl` under the hood because the agent environment egresses through
// HTTPS_PROXY, which Node's global fetch (undici) does not honor by default.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dateMs } from "./utils/feishu_life.js";

const GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.4";
const execFileAsync = promisify(execFile);

function hm(sec: number): string {
  const s = Math.round(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}小时${m}分钟` : `${m}分钟`;
}

function dkey(ts: number): string {
  // WeRead timestamps are China time (+08:00). Shift +8h then read the UTC date
  // so we get the correct local calendar day (toISOString alone would be off by one).
  return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): { date?: string; start?: string; end?: string } {
  const o: any = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date" || a === "--start" || a === "--end") o[a.slice(2)] = argv[++i];
  }
  return o;
}

async function callGateway(body: object): Promise<any> {
  const key = process.env.WEREAD_API_KEY;
  if (!key) throw new Error("WEREAD_API_KEY is not set. Run: export WEREAD_API_KEY=wrk-xxxx");
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s", "-X", "POST", GATEWAY,
      "-H", `Authorization: Bearer ${key}`,
      "-H", "Content-Type: application/json",
      "-d", JSON.stringify(body),
    ],
    { maxBuffer: 16 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.date && !args.start) {
    console.error("Missing --date or --start");
    process.exit(1);
  }
  const baseDate = args.date || args.start!;
  const baseTimeSec = Math.floor(dateMs(baseDate) / 1000);

  const data = await callGateway({ api_name: "/readdata/detail", mode: "weekly", baseTime: baseTimeSec, skill_version: SKILL_VERSION });
  if (data.upgrade_info) {
    console.error("⚠️ WeRead skill upgrade required:", JSON.stringify(data.upgrade_info));
    process.exit(2);
  }
  if (data.errcode && data.errcode !== 0) {
    console.error("WeRead error:", data.errmsg || JSON.stringify(data));
    process.exit(1);
  }

  const rt = data.readTimes || {};
  const perDay: Record<string, number> = {};
  let sum = 0;
  for (const [k, v] of Object.entries(rt)) {
    perDay[dkey(Number(k))] = Number(v);
    sum += Number(v);
  }
  const books = (data.readLongest || []).map((it: any) => ({
    title: it.book?.title,
    author: it.book?.author,
    readTime: hm(it.readTime),
    readTimeSec: it.readTime,
    finished: it.book?.finished === 1,
    tags: it.tags || [],
  }));

  const result = {
    weekStart: dkey(Number(data.baseTime)),
    readDays: data.readDays,
    totalReadTime: hm(data.totalReadTime ?? sum),
    totalReadTimeSec: data.totalReadTime ?? sum,
    dayAverage: hm(data.dayAverageReadTime),
    perDay,
    books,
  };
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
