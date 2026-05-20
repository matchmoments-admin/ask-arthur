// Nightly function-invocation audit -> function_invocation_daily (v138).
//
// Complements infra_cost_daily with the "how often did it run?" view that
// cost work needs before trimming infrastructure. Inngest counts come from
// /v1/events because there is no per-function invocation endpoint. Vercel
// cron counts are deterministic from apps/web/vercel.json.
//
// Expected duration <3 min for a full day of Inngest pagination. The table is
// lean and written once per function per day, so no hot-table risk.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import vercelConfig from "../../../../apps/web/vercel.json";
import { inngest } from "./client";

const FINISHED_EVENT = "inngest/function.finished";
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;
const DAY_MS = 86_400_000;

type FunctionInvocationSource = "inngest" | "vercel-cron";

export interface FunctionInvocationDailyRow {
  date: string;
  function_name: string;
  invocations: number;
  avg_duration_ms: number | null;
  source: FunctionInvocationSource;
}

interface InngestFinishedEvent {
  name?: string;
  data?: {
    function_id?: unknown;
    function?: { id?: unknown; name?: unknown };
    runtime_ms?: unknown;
    duration_ms?: unknown;
    _inngest?: { runtime_ms?: unknown; status?: unknown };
  };
}

interface InngestEventsPage {
  data?: unknown;
  events?: unknown;
  next_cursor?: unknown;
  nextCursor?: unknown;
  next?: { cursor?: unknown };
  page?: { next_cursor?: unknown; nextCursor?: unknown };
}

interface VercelCronEntry {
  path: string;
  schedule: string;
}

function yesterdayIsoDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function dayBoundsUtc(isoDate: string): { from: string; to: string } {
  const start = new Date(`${isoDate}T00:00:00Z`);
  const end = new Date(start.getTime() + DAY_MS);
  return { from: start.toISOString(), to: end.toISOString() };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function extractEventsPage(body: InngestEventsPage): {
  events: InngestFinishedEvent[];
  nextCursor: string | null;
} {
  const rawEvents = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.events)
      ? body.events
      : [];
  const nextCursor =
    asString(body.next_cursor) ??
    asString(body.nextCursor) ??
    asString(body.next?.cursor) ??
    asString(body.page?.next_cursor) ??
    asString(body.page?.nextCursor);

  return {
    events: rawEvents as InngestFinishedEvent[],
    nextCursor,
  };
}

export function aggregateInngestFinishedEvents(
  date: string,
  events: InngestFinishedEvent[],
): FunctionInvocationDailyRow[] {
  const grouped = new Map<
    string,
    { invocations: number; runtimeTotal: number; runtimeCount: number }
  >();

  for (const event of events) {
    const data = event.data ?? {};
    const functionName =
      asString(data.function_id) ??
      asString(data.function?.id) ??
      asString(data.function?.name);
    if (!functionName) continue;

    const group =
      grouped.get(functionName) ??
      { invocations: 0, runtimeTotal: 0, runtimeCount: 0 };
    group.invocations += 1;

    const runtime =
      asFiniteNumber(data.runtime_ms) ??
      asFiniteNumber(data.duration_ms) ??
      asFiniteNumber(data._inngest?.runtime_ms);
    if (runtime !== null) {
      group.runtimeTotal += runtime;
      group.runtimeCount += 1;
    }

    grouped.set(functionName, group);
  }

  return Array.from(grouped.entries())
    .map(([functionName, group]) => ({
      date,
      function_name: functionName,
      invocations: group.invocations,
      avg_duration_ms:
        group.runtimeCount === 0
          ? null
          : Math.round(group.runtimeTotal / group.runtimeCount),
      source: "inngest" as const,
    }))
    .sort((a, b) => a.function_name.localeCompare(b.function_name));
}

export async function pullInngestFunctionInvocationRows(
  date: string,
  token = process.env.INNGEST_API_TOKEN,
  fetchImpl: typeof fetch = fetch,
): Promise<FunctionInvocationDailyRow[]> {
  if (!token) {
    throw new Error("INNGEST_API_TOKEN missing — set in Vercel env.");
  }

  const { from, to } = dayBoundsUtc(date);
  const events: InngestFinishedEvent[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL("https://api.inngest.com/v1/events");
    url.searchParams.set("name", FINISHED_EVENT);
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Inngest /v1/events ${res.status}: ${body.slice(0, 200)}`,
      );
    }

    const body = (await res.json()) as InngestEventsPage;
    const pageData = extractEventsPage(body);
    events.push(...pageData.events);

    if (!pageData.nextCursor || pageData.nextCursor === cursor) break;
    cursor = pageData.nextCursor;
  }

  return aggregateInngestFinishedEvents(date, events);
}

function parseCronValuePart(part: string, min: number, max: number): Set<number> {
  const values = new Set<number>();
  const addRange = (start: number, end: number, step = 1) => {
    for (let value = start; value <= end; value += step) {
      if (value >= min && value <= max) values.add(value);
    }
  };

  for (const rawToken of part.split(",")) {
    const token = rawToken.trim();
    if (!token) continue;

    const [rangeToken, stepToken] = token.split("/");
    const step = stepToken ? Number(stepToken) : 1;
    if (!Number.isInteger(step) || step <= 0) continue;

    if (rangeToken === "*") {
      addRange(min, max, step);
      continue;
    }

    if (rangeToken?.includes("-")) {
      const [rawStart, rawEnd] = rangeToken.split("-");
      const start = Number(rawStart);
      const end = Number(rawEnd);
      if (Number.isInteger(start) && Number.isInteger(end) && start <= end) {
        addRange(start, end, step);
      }
      continue;
    }

    const value = Number(rangeToken);
    if (Number.isInteger(value) && value >= min && value <= max) {
      values.add(value);
    }
  }

  return values;
}

function cronFieldIsWildcard(field: string): boolean {
  return field.trim() === "*";
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  options?: { sundaySeven?: boolean },
): Set<number> {
  const values = parseCronValuePart(field, min, max);
  if (options?.sundaySeven && values.has(7)) {
    values.delete(7);
    values.add(0);
  }
  return values;
}

export function countCronInvocationsForDay(
  schedule: string,
  isoDate: string,
): number {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Unsupported cron schedule: ${schedule}`);
  }

  const [minuteField, hourField, domField, monthField, dowField] = fields;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const daysOfMonth = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const daysOfWeek = parseCronField(dowField, 0, 7, { sundaySeven: true });
  const domWildcard = cronFieldIsWildcard(domField);
  const dowWildcard = cronFieldIsWildcard(dowField);

  let count = 0;
  const start = new Date(`${isoDate}T00:00:00Z`).getTime();
  for (let offset = 0; offset < DAY_MS; offset += 60_000) {
    const current = new Date(start + offset);
    if (!minutes.has(current.getUTCMinutes())) continue;
    if (!hours.has(current.getUTCHours())) continue;
    if (!months.has(current.getUTCMonth() + 1)) continue;

    const domMatches = daysOfMonth.has(current.getUTCDate());
    const dowMatches = daysOfWeek.has(current.getUTCDay());
    const dayMatches =
      domWildcard || dowWildcard
        ? domMatches && dowMatches
        : domMatches || dowMatches;
    if (!dayMatches) continue;

    count += 1;
  }
  return count;
}

function cronPathToFunctionName(path: string): string {
  return path.replace(/^\/api\/cron\//, "").replace(/^\/+/, "") || path;
}

export function buildVercelCronRows(
  date: string,
  crons: VercelCronEntry[] = (vercelConfig as { crons?: VercelCronEntry[] })
    .crons ?? [],
): FunctionInvocationDailyRow[] {
  return crons
    .map((cron) => ({
      date,
      function_name: cronPathToFunctionName(cron.path),
      invocations: countCronInvocationsForDay(cron.schedule, date),
      avg_duration_ms: null,
      source: "vercel-cron" as const,
    }))
    .sort((a, b) => b.invocations - a.invocations);
}

async function persistRows(rows: FunctionInvocationDailyRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = createServiceClient();
  if (!supabase) throw new Error("supabase service client unavailable");
  const ingestedAt = new Date().toISOString();

  const { error } = await supabase.from("function_invocation_daily").upsert(
    rows.map((row) => ({
      date: row.date,
      function_name: row.function_name,
      invocations: row.invocations,
      avg_duration_ms: row.avg_duration_ms,
      source: row.source,
      ingested_at: ingestedAt,
    })),
    { onConflict: "date,function_name" },
  );
  if (error) {
    throw new Error(`function_invocation_daily upsert failed: ${error.message}`);
  }
  return rows.length;
}

export const functionInvocationAudit = inngest.createFunction(
  {
    id: "function-invocation-audit",
    name: "Cost: Function invocation audit",
    retries: 2,
  },
  { cron: "15 2 * * *" },
  async ({ step }) => {
    const targetDate = yesterdayIsoDate();

    const inngestRows = await step.run("inngest-events", async () =>
      pullInngestFunctionInvocationRows(targetDate),
    );
    const vercelRows = await step.run("vercel-crons", async () =>
      buildVercelCronRows(targetDate),
    );
    const persisted = await step.run("persist", async () =>
      persistRows([...inngestRows, ...vercelRows]),
    );

    logger.info("function-invocation-audit: complete", {
      date: targetDate,
      inngestFunctions: inngestRows.length,
      vercelCrons: vercelRows.length,
      persistedRows: persisted,
    });

    return {
      date: targetDate,
      inngestFunctions: inngestRows.length,
      vercelCrons: vercelRows.length,
      persistedRows: persisted,
    };
  },
);
