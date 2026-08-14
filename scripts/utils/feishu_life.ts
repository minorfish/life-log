import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface IntegrationConfig {
  weread?: {
    enabled?: boolean;
  };
}

export interface Config {
  appId: string;
  appSecret: string;
  appToken: string;
  tables?: Partial<Record<AnyTableKey, string>>;
  calendars?: Partial<Record<CalendarKey, string>>;
  defaults?: Partial<{
    recorderName: string;
    dailyCalorieTarget: number;
    timezone: string;
    enableSleepCalendarSync: boolean;
  }>;
  integrations?: IntegrationConfig;
}

export type RecordFields = Record<string, any>;

export const TABLE_KEYS = ["diet", "dailySummary", "sleep", "exercise", "dateIndex", "foodComp"] as const;

export type TableKey = (typeof TABLE_KEYS)[number];

// Present in the shared template but optional: a config without them still
// supports diet/sleep/exercise logging. Only `review_period.ts` reads these.
export const OPTIONAL_TABLE_KEYS = ["reading", "podcast", "documentary", "media", "time"] as const;

export type OptionalTableKey = (typeof OPTIONAL_TABLE_KEYS)[number];

export type AnyTableKey = TableKey | OptionalTableKey;

export const DEFAULT_CALENDARS = {
  sleep: "睡眠",
  exercise: "锻炼",
  health: "健康",
} as const;

export type CalendarKey = keyof typeof DEFAULT_CALENDARS;

export const DEFAULTS = {
  recorderName: "User",
  dailyCalorieTarget: 1350,
  timezone: "+08:00",
  enableSleepCalendarSync: false,
} as const;

export const DEFAULT_INTEGRATIONS = {
  weread: { enabled: false },
} as const;

const PROJECT_JSON_CONFIGS = [
  join(process.cwd(), "life-log.config.json"),
  join(process.cwd(), ".baoyu-skills", "baoyu-feishu-bitable", "life-log.config.json"),
];

const LEGACY_MARKDOWN_CONFIGS = [
  join(process.cwd(), ".baoyu-skills", "baoyu-feishu-bitable", "EXTEND.md"),
  join(homedir(), ".baoyu-skills", "baoyu-feishu-bitable", "life-log.config.json"),
  join(homedir(), ".baoyu-skills", "baoyu-feishu-bitable", "EXTEND.md"),
];

function parseMarkdownConfig(content: string): Config {
  const appId = content.match(/app_id:\s*(.+)/)?.[1]?.trim();
  const appSecret = content.match(/app_secret:\s*(.+)/)?.[1]?.trim();
  const appToken = content.match(/app_token:\s*(.+)/)?.[1]?.trim();
  if (!appId || !appSecret || !appToken) {
    throw new Error("Missing Feishu config in EXTEND.md");
  }
  return { appId, appSecret, appToken };
}

function normalizeConfig(raw: Config): Config {
  if (!raw.appId || !raw.appSecret || !raw.appToken) {
    throw new Error("Config is missing appId, appSecret, or appToken");
  }
  return {
    ...raw,
    tables: raw.tables ?? {},
    calendars: raw.calendars ?? {},
    defaults: raw.defaults ?? {},
    integrations: raw.integrations ?? {},
  };
}

function readJsonConfig(path: string): Config | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Config;
  return normalizeConfig(parsed);
}

function readMarkdownConfig(path: string): Config | null {
  if (!existsSync(path)) return null;
  return normalizeConfig(parseMarkdownConfig(readFileSync(path, "utf-8")));
}

export function loadConfig(): Config {
  for (const path of PROJECT_JSON_CONFIGS) {
    const config = readJsonConfig(path);
    if (config) return config;
  }

  for (const path of LEGACY_MARKDOWN_CONFIGS) {
    if (path.endsWith(".json")) {
      const config = readJsonConfig(path);
      if (config) return config;
      continue;
    }
    const config = readMarkdownConfig(path);
    if (config) return config;
  }

  throw new Error(
    "Missing config. Expected life-log.config.json in the project root or ~/.baoyu-skills/baoyu-feishu-bitable/EXTEND.md"
  );
}

export async function getToken(config: Config): Promise<string> {
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    throw new Error(`Auth failed: ${data.msg}`);
  }
  return data.tenant_access_token;
}

export async function getAllRecords(token: string, appToken: string, tableId: string): Promise<any[]> {
  const records: any[] = [];
  let pageToken = "";
  let hasMore = true;

  while (hasMore) {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ""}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json() as any;
    if (data.code !== 0) {
      throw new Error(`Fetch records from ${tableId} failed: ${data.msg}`);
    }
    records.push(...(data.data?.items || []));
    hasMore = data.data?.has_more || false;
    pageToken = data.data?.page_token || "";
  }

  return records;
}

export async function getBitableTables(token: string, appToken: string): Promise<Array<{ table_id: string; name: string }>> {
  const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables?page_size=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    throw new Error(`Fetch table metadata failed: ${data.msg}`);
  }
  return (data.data?.items || []).map((item: any) => ({
    table_id: item.table_id,
    name: item.name,
  }));
}

export function getTableId(config: Config, key: TableKey): string {
  const tableId = config.tables?.[key];
  if (!tableId) {
    throw new Error(`Missing table mapping for "${key}". Run npm run setup to generate life-log.config.json.`);
  }
  return tableId;
}

export function getOptionalTableId(config: Config, key: OptionalTableKey): string | undefined {
  return config.tables?.[key];
}

export function getCalendarName(config: Config, key: CalendarKey): string {
  return config.calendars?.[key] || DEFAULT_CALENDARS[key];
}

export function getRecorderName(config: Config): string {
  return config.defaults?.recorderName?.trim() || DEFAULTS.recorderName;
}

export function getDailyCalorieTarget(config: Config): number {
  return Number(config.defaults?.dailyCalorieTarget) || DEFAULTS.dailyCalorieTarget;
}

export function isSleepCalendarSyncEnabled(config: Config): boolean {
  return config.defaults?.enableSleepCalendarSync ?? DEFAULTS.enableSleepCalendarSync;
}

export function isWereadEnabled(config: Config): boolean {
  return config.integrations?.weread?.enabled ?? DEFAULT_INTEGRATIONS.weread.enabled;
}

export async function addRecords(token: string, appToken: string, tableId: string, records: any[]) {
  if (records.length === 0) return;

  const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records }),
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    throw new Error(`Batch create failed for ${tableId}: ${data.msg}`);
  }
  return data.data;
}

export async function addRecord(token: string, appToken: string, tableId: string, fields: RecordFields) {
  const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    throw new Error(`Add record failed for ${tableId}: ${data.msg}`);
  }
  return data.data;
}

export async function updateRecord(token: string, appToken: string, tableId: string, recordId: string, fields: RecordFields) {
  const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const data = await resp.json() as any;
  if (data.code !== 0) {
    throw new Error(`Update record failed for ${tableId}: ${data.msg}`);
  }
  return data.data;
}

export function dateMs(date: string): number {
  return new Date(`${date}T00:00:00+08:00`).getTime();
}

export function dateTimeMs(date: string, time: string): number {
  const normalized = time.includes(":") ? time : `${time}:00`;
  return new Date(`${date}T${normalized}+08:00`).getTime();
}

export function formatDateKey(value: unknown): string | null {
  if (typeof value !== "number") return null;
  const d = new Date(value);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function formatShanghaiDate(value: number): string {
  const shifted = new Date(value + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getQuarter(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

function buildDateIndexFields(date: string): RecordFields {
  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date for date index: ${date}`);
  }

  const weekNumber = Math.floor((day - 1) / 7) + 1;
  const monthKey = `${yearText}/${monthText}`;
  const weekStartDay = (weekNumber - 1) * 7 + 1;
  const weekEndDay = Math.min(weekNumber * 7, daysInMonth(year, month));
  const weekStart = dateMs(`${yearText}-${monthText}-${String(weekStartDay).padStart(2, "0")}`);
  const weekEnd = dateMs(`${yearText}-${monthText}-${String(weekEndDay).padStart(2, "0")}`);

  return {
    "具体周数": [{ text: `${monthKey} - 第${weekNumber}周`, type: "text" }],
    "周开始": weekStart,
    "周结束": weekEnd,
    "所属周数": `第${weekNumber}周`,
    "所属季度": `${yearText}-Q${getQuarter(month)}`,
    "所属月份": monthKey,
  };
}

async function createWeekRecord(token: string, appToken: string, date: string, config?: Config): Promise<string> {
  const fields = buildDateIndexFields(date);
  if (!config) {
    throw new Error("resolveWeekRecordId requires a config with table mappings.");
  }
  await addRecord(token, appToken, getTableId(config, "dateIndex"), fields);

  const records = await getAllRecords(token, appToken, getTableId(config, "dateIndex"));
  const expectedLabel = fields["具体周数"]?.[0]?.text;
  const created = records.find((record) => {
    const label = Array.isArray(record.fields?.["具体周数"])
      ? record.fields?.["具体周数"]?.[0]?.text
      : typeof record.fields?.["具体周数"] === "string"
        ? record.fields?.["具体周数"]
        : "";
    return label === expectedLabel;
  });
  return created?.record_id || "";
}

export async function resolveWeekRecordId(token: string, appToken: string, date: string, config?: Config): Promise<string | null> {
  if (!config) {
    throw new Error("resolveWeekRecordId requires a config with table mappings.");
  }
  const targetDate = dateMs(date);
  const dateIndexTableId = getTableId(config, "dateIndex");
  const records = await getAllRecords(token, appToken, dateIndexTableId);
  const byRange = records.find((record) => {
    const start = Number(record.fields?.["周开始"]);
    const end = Number(record.fields?.["周结束"]);
    return Number.isFinite(start) && Number.isFinite(end) && targetDate >= start && targetDate <= end;
  });
  if (byRange?.record_id) {
    return byRange.record_id;
  }

  const expectedFields = buildDateIndexFields(date);
  const expectedLabel = expectedFields["具体周数"]?.[0]?.text;
  const byLabel = records.find((record) => {
    const label = Array.isArray(record.fields?.["具体周数"])
      ? record.fields?.["具体周数"]?.[0]?.text
      : typeof record.fields?.["具体周数"] === "string"
        ? record.fields?.["具体周数"]
        : "";
    return label === expectedLabel;
  });
  if (byLabel?.record_id) {
    return byLabel.record_id;
  }

  return createWeekRecord(token, appToken, date, config);
}

export async function upsertDailyDietSummary(token: string, appToken: string, date: string, config?: Config): Promise<void> {
  if (!config) {
    throw new Error("upsertDailyDietSummary requires a config with table mappings.");
  }
  const dateTs = dateMs(date);
  const dietTableId = getTableId(config, "diet");
  const summaryTableId = getTableId(config, "dailySummary");
  const dailyCalorieTarget = getDailyCalorieTarget(config);
  const records = await getAllRecords(token, appToken, dietTableId);
  const dietRecords = records.filter((record) => record.fields?.["日期"] === dateTs);

  if (dietRecords.length === 0) {
    return;
  }

  const summary = dietRecords.reduce(
    (totals, record) => {
      totals.calories += Number(record.fields?.["卡路里"] || 0);
      totals.protein += Number(record.fields?.["蛋白质"] || 0);
      totals.fat += Number(record.fields?.["脂肪"] || 0);
      totals.carb += Number(record.fields?.["碳水"] || 0);
      return totals;
    },
    { calories: 0, protein: 0, fat: 0, carb: 0 }
  );

  const summaries = await getAllRecords(token, appToken, summaryTableId);
  const existingSummary = summaries.find((record) => record.fields?.["日期"] === dateTs);

  const fields = {
    "日期": dateTs,
    "总热量": summary.calories,
    "蛋白质": summary.protein,
    "脂肪": summary.fat,
    "碳水": summary.carb,
    "热量缺口": dailyCalorieTarget - summary.calories,
  };

  if (existingSummary) {
    await updateRecord(token, appToken, summaryTableId, existingSummary.record_id, fields);
  } else {
    await addRecords(token, appToken, summaryTableId, [{ fields }]);
  }
}
