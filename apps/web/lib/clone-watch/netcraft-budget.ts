/**
 * Netcraft budget — the one Module that knows every Lane that files reports
 * with Netcraft in Ask Arthur's name, each Lane's daily cap, and the ceiling
 * the reporter account as a whole must stay under.
 *
 * WHY. Three Lanes file with Netcraft, all as one reporter (Netcraft credits
 * reports to the submitting email, `netcraftReporterEmail()`):
 *
 *   auto      shopfront-clone-netcraft-auto   bulk URL report   cap 50 / day
 *   resubmit  same fn, second Lane            bulk URL report   cap 15 / day
 *   issue     shopfront-clone-netcraft-issue  report_issue      cap 20 / day
 *
 * Before this Module each Lane counted only itself, in its own place (the
 * auto worklist RPC's `today` CTE, the resubmit RPC's `used` CTE, and
 * `count_todays_netcraft_issues()` for issues), and nothing bounded the
 * three together: 50 + 15 + 20 = 85 reports a day were legal. Netcraft
 * publishes no rate limit for the report API, so the bound that matters is
 * reporter STANDING — every report goes out in our name, and the record
 * (89% of 2,151 pre-v284 auto submissions declined) shows volume is what
 * burns it.
 *
 * WHAT LIVES HERE
 *   - `NETCRAFT_DAILY_CEILING`: the account-wide ceiling (50). Chosen as the
 *     largest single Lane cap, so the auto Lane alone can still use its whole
 *     designed day, but the three together can no longer exceed it. Measured
 *     2026-10-13: the highest combined day since the v284 evidence gate
 *     (2026-08-24, 50 days) is 13 (11 URL reports + 2 issues); pre-v284 the
 *     account filed >50 on 2 days (287 on 2026-06-15, 54 on 2026-07-29).
 *   - `NETCRAFT_LANES`: the roster. Lanes read their caps FROM here.
 *   - `decideNetcraftSpend`: the pure decision.
 *   - `readNetcraftSpentToday`: its one I/O read, `null` when unreadable.
 *   - `claimNetcraftBudget`: read + decide, returning a `NetcraftGrant`.
 *
 * ONE CLOCK: the UTC calendar day (00:00 UTC to 00:00 UTC). Netcraft
 * documents no quota and so no vendor clock to align with; UTC day is the
 * clock all three per-Lane counters already used (`date_trunc('day', now())`
 * with the database TimeZone = UTC, verified in prod 2026-10-13), and the
 * Lanes' crons are UTC. Never a rolling window — a periodic job bounding
 * itself on a rolling window it writes into spends its cap twice (v258).
 *
 * ONE LEDGER: each Lane's Outcome Row in cost_telemetry (`recordLaneOutcome`),
 * whose `units` is what the Lane actually filed — URLs marked for auto and
 * resubmit, report_issue POSTs accepted for issue (a dry-run row counts 0).
 * Checked against the alert table's own submission stamps for the 30 days to
 * 2026-10-12: identical per Lane per day. Units mix URLs and issues on
 * purpose: the ceiling counts reports filed in our name, and one issue is one
 * filing.
 *
 * THE GRANT IS THE GATE. `postNetcraftBulk` (live) and `postNetcraftIssue`
 * refuse to send without a `NetcraftGrant` for their Lane that covers the
 * request, so a caller cannot reach Netcraft's intake without passing through
 * here. `__tests__/netcraftBudget.test.ts` proves statically that every file
 * calling either POST also claims a grant, and that no file outside the
 * Adapters names the intake URL.
 *
 * Known bound, not a bug: the ledger row lands at the END of a run, so two
 * DIFFERENT functions running at the same moment (issue at 11:00 or on a
 * weaponisation event, auto/resubmit at 13:00) can each see the other's
 * spend as zero. The worst overshoot is one Lane's grant. auto and resubmit
 * run sequentially in one function, and auto writes its row before resubmit
 * claims, so they never race each other.
 *
 * The per-Lane counters inside the worklist RPCs stay as an inner bound (same
 * clock, same predicate); this Module is the outer one and the only place
 * the caps are declared.
 */

import type { createServiceClient } from "@askarthur/supabase/server";
import { LANES } from "@askarthur/scam-engine/lane-outcome";

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

/** Reports per UTC day the reporter account may file across every Lane. */
export const NETCRAFT_DAILY_CEILING = 50;

export type NetcraftLaneId = "auto" | "resubmit" | "issue";

export interface NetcraftLane {
  /** The Lane key in LANES (scam-engine/lane-outcome), whose Outcome Row is
   *  this Lane's ledger. */
  lane:
    | "shopfront-clone-netcraft-auto/auto"
    | "shopfront-clone-netcraft-auto/resubmit"
    | "shopfront-clone-netcraft-issue";
  /** What one unit is. */
  unit: "url" | "issue";
  /** Default daily cap. */
  defaultCap: number;
  /** Env var that overrides the cap (a positive integer), if any. */
  capEnv?: string;
}

export const NETCRAFT_LANES: Record<NetcraftLaneId, NetcraftLane> = {
  // A ceiling, not a target: since the v284 evidence gate the Lane files
  // ~1-2/day (max 6 in the 30 days to 2026-10-12). The worklist RPC also
  // hard-caps its LIMIT at 50.
  auto: {
    lane: "shopfront-clone-netcraft-auto/auto",
    unit: "url",
    defaultCap: 50,
  },
  // A precision cap (#1231; was 10). Max 10 in the last 30 days.
  resubmit: {
    lane: "shopfront-clone-netcraft-auto/resubmit",
    unit: "url",
    defaultCap: 15,
    capEnv: "NETCRAFT_RESUBMIT_DAILY_CAP",
  },
  // One report_issue per submission uuid. Max 4 in the last 30 days.
  issue: {
    lane: "shopfront-clone-netcraft-issue",
    unit: "issue",
    defaultCap: 20,
    capEnv: "NETCRAFT_ISSUE_DAILY_CAP",
  },
};

const LANE_IDS = Object.keys(NETCRAFT_LANES) as NetcraftLaneId[];

/** A Lane's cap today: its env override when that is a positive integer. */
export function netcraftLaneCap(id: NetcraftLaneId): number {
  const { capEnv, defaultCap } = NETCRAFT_LANES[id];
  if (!capEnv) return defaultCap;
  const raw = Number.parseInt(process.env[capEnv]?.trim() ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultCap;
}

export type NetcraftSpentToday = Record<NetcraftLaneId, number>;

/** Proof that a send was admitted. JSON-safe, so it survives an Inngest
 *  step.run memo. Only this Module builds one (the static test checks). */
export interface NetcraftGrant {
  readonly kind: "netcraft-budget-grant";
  lane: NetcraftLaneId;
  /** Units the Lane may file in this run. Always >= 1. */
  allowed: number;
  /** The UTC day the grant counts against, YYYY-MM-DD. */
  day: string;
  spentLane: number;
  spentTotal: number;
  cap: number;
  ceiling: number;
}

export type NetcraftBudgetDecision =
  | { ok: true; grant: NetcraftGrant }
  | {
      ok: false;
      reason:
        | "ledger_unreadable"
        | "lane_cap_reached"
        | "daily_ceiling_reached"
        | "nothing_requested";
      lane: NetcraftLaneId;
      day: string;
      spentLane: number | null;
      spentTotal: number | null;
      cap: number;
      ceiling: number;
    };

/** Start of the UTC day containing `nowMs`. The Module's one clock. */
export function utcDayStart(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const isoDay = (nowMs: number) =>
  new Date(utcDayStart(nowMs)).toISOString().slice(0, 10);

/**
 * May `lane` file `request` units now? Grants
 *   min(request, cap - spentLane, ceiling - spentTotal)
 * and refuses when that is below 1, or when `spent` is null — an unreadable
 * ledger is never zero spend (fail closed).
 */
export function decideNetcraftSpend(
  lane: NetcraftLaneId,
  request: number,
  spent: NetcraftSpentToday | null,
  nowMs: number,
  cap: number = netcraftLaneCap(lane),
): NetcraftBudgetDecision {
  const day = isoDay(nowMs);
  const ceiling = NETCRAFT_DAILY_CEILING;
  if (spent === null) {
    return {
      ok: false,
      reason: "ledger_unreadable",
      lane,
      day,
      spentLane: null,
      spentTotal: null,
      cap,
      ceiling,
    };
  }
  const spentLane = Math.max(0, spent[lane] ?? 0);
  const spentTotal = LANE_IDS.reduce(
    (a, id) => a + Math.max(0, spent[id] ?? 0),
    0,
  );
  const base = { lane, day, spentLane, spentTotal, cap, ceiling };
  if (!(request >= 1))
    return { ok: false, reason: "nothing_requested", ...base };
  const laneLeft = cap - spentLane;
  if (laneLeft < 1) return { ok: false, reason: "lane_cap_reached", ...base };
  const accountLeft = ceiling - spentTotal;
  if (accountLeft < 1)
    return { ok: false, reason: "daily_ceiling_reached", ...base };
  const allowed = Math.floor(Math.min(request, laneLeft, accountLeft));
  return {
    ok: true,
    grant: { kind: "netcraft-budget-grant", allowed, ...base },
  };
}

/** Rows the read accepts before calling itself incomplete. ~5 rows a day. */
const LEDGER_READ_LIMIT = 500;

const num = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

/**
 * Units each Lane filed since 00:00 UTC, from its Outcome Rows. `null` when
 * the read failed or may be incomplete — never zeros (the head-count lesson:
 * a failed read must not print a confident zero). A dry-run row is not spend.
 */
export async function readNetcraftSpentToday(
  sb: Sb,
  nowMs: number,
): Promise<NetcraftSpentToday | null> {
  const byFeature = new Map<string, NetcraftLaneId>();
  for (const id of LANE_IDS)
    byFeature.set(LANES[NETCRAFT_LANES[id].lane].feature, id);
  try {
    const { data, error } = await sb
      .from("cost_telemetry")
      .select("feature, operation, units, metadata")
      .in("feature", [...byFeature.keys()])
      .gte("created_at", new Date(utcDayStart(nowMs)).toISOString())
      .limit(LEDGER_READ_LIMIT);
    if (error || !Array.isArray(data)) return null;
    if (data.length >= LEDGER_READ_LIMIT) return null;
    const spent: NetcraftSpentToday = { auto: 0, resubmit: 0, issue: 0 };
    for (const row of data as Array<{
      feature: string;
      operation: string;
      units: unknown;
      metadata: Record<string, unknown> | null;
    }>) {
      const id = byFeature.get(row.feature);
      if (!id || row.operation !== LANES[NETCRAFT_LANES[id].lane].operation)
        continue;
      if (row.metadata?.dryRun === true) continue;
      spent[id] += num(row.units);
    }
    return spent;
  } catch {
    return null;
  }
}

/**
 * Read the ledger and decide `lane`'s request. Read-only: it reserves
 * nothing (see the header's concurrency note). Call it inside a step.run so
 * a replay reuses the decision.
 */
export async function claimNetcraftBudget(
  sb: Sb,
  lane: NetcraftLaneId,
  request: number,
  nowMs: number = Date.now(),
): Promise<NetcraftBudgetDecision> {
  const spent = await readNetcraftSpentToday(sb, nowMs);
  return decideNetcraftSpend(lane, request, spent, nowMs);
}

/**
 * Does `grant` admit `lane` filing `units`? The POST Adapters call this and
 * refuse to send otherwise. A grant for another Lane or for fewer units does
 * not count. The grant's day is NOT re-checked: a run that claims at 23:58
 * and posts at 00:01 spends against a day that has just reset, which is
 * conservative — refusing there would read as a vendor failure downstream.
 */
export function grantCovers(
  grant: NetcraftGrant | null | undefined,
  lane: NetcraftLaneId,
  units: number,
): boolean {
  return (
    !!grant &&
    grant.kind === "netcraft-budget-grant" &&
    grant.lane === lane &&
    units >= 1 &&
    units <= grant.allowed
  );
}
