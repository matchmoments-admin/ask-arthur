// Nightly per-provider infra-spend rollup → infra_cost_daily (v134).
//
// Complements cost_telemetry (per-call, AI-only, event-driven) with the
// non-event-driven daily billing the cloud providers report via their
// own APIs. One row per (date, provider). All three steps target
// "yesterday UTC" so the source data is complete.
//
// Providers in this iteration:
//   - 'vercel'         — GET /v1/billing/charges (FOCUS v1.3 JSONL);
//                        SUM EffectiveCost over the day.
//   - 'anthropic'      — SUM cost_telemetry.estimated_cost_usd over the
//                        day (already populated by logCost() at request
//                        time). Single round-trip aggregation.
//   - 'github-actions' — GET /users/{user}/settings/billing/usage (the
//                        enhanced-billing endpoint that replaced the
//                        deprecated /actions/billing per gh.io 2025-Q1).
//                        Sums grossAmount filtered to yesterday's date.
//                        netAmount excluded — most rows zero out via the
//                        free tier, but we want the gross figure for
//                        when this user upgrades to a paid plan.
//
// Supabase: NOT ingested as a daily provider row. The Pro $25/mo
// subscription is invariant (would write $0.83/day forever — pure noise)
// and the variable per-day usage (compute add-ons, egress overage) isn't
// exposed by the Mgmt API. The flat $25/mo is rendered as a static
// "Fixed monthly subscriptions" card on /admin/costs/infra instead, so
// the operator still sees it. Historical 'supabase-base' rows from PR
// #309 remain in infra_cost_daily but are filtered out at the page
// render layer.
//
// Deferred providers (no public usage API):
//   - Supabase compute / storage / egress — per-dimension daily breakdown
//     not exposed; only the dashboard surfaces it. Tracked in BACKLOG.
//
// Expected duration <2 min. pg-stuck-query-watchdog (v120) pages at 10 min.
// Hot-table check: infra_cost_daily is new + lean, not a hot table.
// upsert on PK (date, provider) is idempotent → safe to re-run.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";

interface VercelChargeLine {
  EffectiveCost?: number;
  BilledCost?: number;
  ChargePeriodStart?: string;
  ChargePeriodEnd?: string;
  ChargeCategory?: string;
  ServiceName?: string;
}

function yesterdayIsoDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

/** ISO 8601 boundaries for a single UTC day. End is exclusive. */
function dayBoundsUtc(isoDate: string): { from: string; to: string } {
  const start = new Date(`${isoDate}T00:00:00Z`);
  const end = new Date(start.getTime() + 86400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

function toCents(usd: number): number {
  return Math.round(usd * 100);
}

async function pullVercelCents(date: string): Promise<{
  cents: number;
  raw: { lineCount: number; services: Record<string, number> };
}> {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !teamId) {
    throw new Error(
      "VERCEL_TOKEN / VERCEL_TEAM_ID missing — set in Vercel env (Production + Preview + Development).",
    );
  }
  const { from, to } = dayBoundsUtc(date);
  const url = `https://api.vercel.com/v1/billing/charges?teamId=${encodeURIComponent(
    teamId,
  )}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity" },
    // Finite timeout (#522 M-bill) — a hung Vercel billing endpoint must not
    // block the step indefinitely (and, pre-fix, drop the other providers).
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Vercel /v1/billing/charges ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const text = await res.text();
  let totalUsd = 0;
  let lineCount = 0;
  const services: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: VercelChargeLine;
    try {
      row = JSON.parse(trimmed) as VercelChargeLine;
    } catch {
      continue;
    }
    lineCount += 1;
    const cost = Number(row.EffectiveCost ?? row.BilledCost ?? 0);
    if (Number.isFinite(cost)) {
      totalUsd += cost;
      const svc = row.ServiceName ?? "Unknown";
      services[svc] = (services[svc] ?? 0) + cost;
    }
  }
  return { cents: toCents(totalUsd), raw: { lineCount, services } };
}

async function pullAnthropicCents(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  date: string,
): Promise<{ cents: number; raw: { eventCount: number } }> {
  const { from, to } = dayBoundsUtc(date);
  const { data, error } = await supabase
    .from("cost_telemetry")
    .select("estimated_cost_usd")
    .eq("provider", "anthropic")
    .gte("created_at", from)
    .lt("created_at", to);
  if (error) {
    throw new Error(`cost_telemetry pull failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ estimated_cost_usd: number | string }>;
  const totalUsd = rows.reduce(
    (s, r) => s + Number(r.estimated_cost_usd ?? 0),
    0,
  );
  return { cents: toCents(totalUsd), raw: { eventCount: rows.length } };
}

interface GitHubUsageItem {
  date?: string;
  product?: string;
  sku?: string;
  quantity?: number;
  grossAmount?: number;
  netAmount?: number;
  repositoryName?: string;
}

async function pullGitHubActionsCents(date: string): Promise<{
  cents: number;
  raw: { itemCount: number; bySku: Record<string, number> };
}> {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_BILLING_USERNAME;
  if (!token || !username) {
    throw new Error(
      "GITHUB_TOKEN / GITHUB_BILLING_USERNAME missing — set in Vercel env.",
    );
  }
  // Endpoint is month-scoped; the prior month rolls into a new endpoint
  // call on the 1st. Pull the month containing `date` and filter rows.
  const [year, month] = date.split("-");
  const url = `https://api.github.com/users/${encodeURIComponent(
    username,
  )}/settings/billing/usage?year=${year}&month=${Number(month)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // Finite timeout (#522 M-bill).
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub /users/.../settings/billing/usage ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as { usageItems?: GitHubUsageItem[] };
  let totalUsd = 0;
  let itemCount = 0;
  const bySku: Record<string, number> = {};
  for (const item of body.usageItems ?? []) {
    if (item.product !== "actions") continue;
    if (!item.date?.startsWith(date)) continue;
    const cost = Number(item.grossAmount ?? 0);
    if (!Number.isFinite(cost)) continue;
    totalUsd += cost;
    itemCount += 1;
    const sku = item.sku ?? "unknown";
    bySku[sku] = (bySku[sku] ?? 0) + cost;
  }
  return { cents: toCents(totalUsd), raw: { itemCount, bySku } };
}

export const billingIngestNightly = inngest.createFunction(
  {
    id: "billing-ingest-nightly",
    name: "Billing: Nightly per-provider infra-spend rollup",
    retries: 2,
  },
  { cron: "0 2 * * *" }, // 02:00 UTC daily — runs before cost-telemetry-retention (04:00 UTC).
  withAxiomLogging({ fnId: "billing-ingest-nightly" }, async ({ step }) => {
    const targetDate = yesterdayIsoDate();

    // Run each provider independently (#522 M-bill). Previously the 3 steps
    // ran sequentially and a throw in one (e.g. a flaky Vercel billing API)
    // aborted the function, dropping the OTHER two providers' rows for the
    // day. runProvider catches a step's post-retry failure so the remaining
    // providers still run; the failed provider is logged and reported with
    // cents: null. Step-level retries (fn retries: 2) still apply inside.
    const runProvider = async (
      label: string,
      body: () => Promise<{ cents: number; [k: string]: unknown }>,
    ): Promise<{ cents: number | null; error?: string; [k: string]: unknown }> => {
      try {
        return await step.run(label, body);
      } catch (e) {
        logger.error(`billing-ingest-nightly: ${label} provider failed`, {
          date: targetDate,
          error: String(e),
        });
        return { cents: null, error: String(e) };
      }
    };

    const vercel = await runProvider("vercel", async () => {
      const { cents, raw } = await pullVercelCents(targetDate);
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { error } = await supabase.from("infra_cost_daily").upsert(
        {
          date: targetDate,
          provider: "vercel",
          usd_cents: cents,
          raw_usage_jsonb: raw,
          ingested_at: new Date().toISOString(),
        },
        { onConflict: "date,provider" },
      );
      if (error) throw new Error(`upsert vercel row failed: ${error.message}`);
      return { cents, ...raw };
    });

    const anthropic = await runProvider("anthropic", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { cents, raw } = await pullAnthropicCents(supabase, targetDate);
      const { error } = await supabase.from("infra_cost_daily").upsert(
        {
          date: targetDate,
          provider: "anthropic",
          usd_cents: cents,
          raw_usage_jsonb: raw,
          ingested_at: new Date().toISOString(),
        },
        { onConflict: "date,provider" },
      );
      if (error)
        throw new Error(`upsert anthropic row failed: ${error.message}`);
      return { cents, ...raw };
    });

    const githubActions = await runProvider("github-actions", async () => {
      const { cents, raw } = await pullGitHubActionsCents(targetDate);
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { error } = await supabase.from("infra_cost_daily").upsert(
        {
          date: targetDate,
          provider: "github-actions",
          usd_cents: cents,
          raw_usage_jsonb: raw,
          ingested_at: new Date().toISOString(),
        },
        { onConflict: "date,provider" },
      );
      if (error)
        throw new Error(`upsert github-actions row failed: ${error.message}`);
      return { cents, ...raw };
    });

    logger.info("billing-ingest-nightly: complete", {
      date: targetDate,
      vercelCents: vercel.cents,
      anthropicCents: anthropic.cents,
      githubActionsCents: githubActions.cents,
    });

    return {
      date: targetDate,
      providers: {
        vercel: vercel.cents,
        anthropic: anthropic.cents,
        "github-actions": githubActions.cents,
      },
    };
  }),
);
