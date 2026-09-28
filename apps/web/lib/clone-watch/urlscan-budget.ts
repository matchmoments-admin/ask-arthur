/**
 * urlscan UNLISTED budget — the one Module that knows the key-wide quota and
 * every lane that spends it.
 *
 * urlscan's unlisted quota is 60/min, 100/hour, 1,000/day (read from
 * `/user/quotas`, 2026-09-26). It is per API KEY, and four lanes submit
 * unlisted scans on the same key. Before this Module each lane encoded its own
 * share and cron hours and comments kept them apart. The comments had drifted
 * (the submit lane said the recheck lane spends ~200/day when it spends 360),
 * and the one runtime guard, recheck's manual cooldown, read only recheck's
 * own rows. So a manual recheck at 09:05 passed while the 09:00 submit batch
 * was still spending: 90 + 75 = 165 against 100/hour.
 *
 * What lives here:
 *   - `URLSCAN_UNLISTED`: the vendor limits. This is the only copy.
 *   - `URLSCAN_SPENDERS`: the roster. Each entry has its schedule (read from
 *     the lane's own declaration, never re-typed), its worst-case submits per
 *     run, its pacing, and its row in the cost_telemetry ledger. Lanes read
 *     their caps FROM here.
 *   - `decideUnlistedSpend`: the pure headroom decision a manual-trigger
 *     spender makes before it spends.
 *   - `readUnlistedLedger`: its one I/O read, trailing 24h of ledger rows,
 *     `null` when unreadable.
 *
 * Two kinds of guarantee, deliberately split:
 *   - SCHEDULED spend is proven statically. `__tests__/urlscanBudget.test.ts`
 *     places every cron fire on the week and asserts no rolling hour exceeds
 *     100, no minute exceeds 60 and no day exceeds 1,000. Moving a cron or
 *     raising a cap fails that test, not prod.
 *   - MANUAL spend is guarded at runtime. A manual-trigger fire (recheck,
 *     submit) or an admin "Scan now" asks `decideUnlistedSpend`. That call
 *     counts ALL unlisted spend in the trailing hour and day, in UNITS, plus
 *     the worst case of any scheduled run still in flight or due within the
 *     hour. It refuses when the request does not fit, and when the ledger
 *     cannot be read (fail closed).
 *
 * Inngest `throttle` is NOT a submission cap. It counts RUNS and queues the
 * excess (docs/inngest-brakes.md §glossary). A lane's submit ceiling is
 * `perRun` × the runs that actually happen, and for manual runs that is
 * whatever this guard admits.
 */

import type { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  URLSCAN_ENRICHMENT_CRONS,
  URLSCAN_ENRICHMENT_MAX_PER_RUN,
} from "@askarthur/scam-engine/inngest/urlscan-enrichment-schedule";
import { cronFiringsOfWeek } from "@/lib/cron-cadence";
import { LANE_SHAPES, laneGate } from "@/lib/laneHealth";

/** urlscan's UNLISTED submission quota for our key (/user/quotas, 2026-09-26). */
export const URLSCAN_UNLISTED = {
  perMinute: 60,
  perHour: 100,
  perDay: 1_000,
} as const;

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MINUTES = 7 * 24 * 60;

/** A cost_telemetry row as the ledger read selects it. */
export interface LedgerRow {
  feature: string;
  operation: string;
  created_at: string;
  units: number | string | null;
  metadata: Record<string, unknown> | null;
}

const num = (v: unknown): number => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
};

export type SpenderId = "submit" | "recheck" | "scanOne" | "enrichment";

export interface UrlscanSpender {
  /** The Inngest function that makes the unlisted urlscan POSTs. */
  fnId: string;
  /** Cron expressions (UTC). Empty = never scheduled (manual/event only).
   *  Read from the lane's own declaration, never re-typed here. */
  crons: readonly string[];
  /** Worst-case unlisted submits in one run. The lane reads its cap from here. */
  perRun: number;
  /** Pacing: minimum ms between two submit STARTS, across all workers. The
   *  lane passes it to submitCandidateBatch. Absent = bounded by perRun only. */
  minStartIntervalMs?: number;
  /** Own caps on a manual-only spender, in units (admin "Scan now"). */
  ownCap?: { perHour: number; perDay: number };
  /** Its rows in cost_telemetry, and how many unlisted POSTs one row is worth
   *  (an upper bound, never an undercount). */
  ledger: {
    feature: string;
    operation: string;
    spend: (row: LedgerRow) => number;
  };
  /** Whether the lane would spend at all right now (its gate). A disabled
   *  lane reserves nothing at runtime; the static test counts it regardless. */
  active: () => boolean;
}

/** Scheduled crons of a clone-watch Lane, from LANE_SHAPES (parked → none). */
function laneSchedule(lane: keyof typeof LANE_SHAPES): readonly string[] {
  const shape = LANE_SHAPES[lane];
  return shape.parked ? [] : (shape.crons ?? []);
}

/**
 * The roster of every UNLISTED urlscan spender on our key. Verified against
 * the only unlisted submit call site (`submitURLScanWithDetails`,
 * packages/scam-engine/src/urlscan.ts): callers are urlscan-submit-one.ts
 * (submit, recheck, scan-one) and urlscan-enrichment.ts. urlscan SEARCH
 * (`shopfront_clone_watch/search`) and RETRIEVE use other quotas and are out
 * of scope.
 */
export const URLSCAN_SPENDERS: Record<SpenderId, UrlscanSpender> = {
  // Daily gated batch, 09:00 UTC. perRun includes the not-a-clone audit share
  // (`auditShare` below): samples ride inside the batch, never on top.
  submit: {
    fnId: "shopfront-clone-urlscan-submit",
    crons: laneSchedule("shopfront-clone-urlscan-submit"),
    perRun: 75,
    // Sequential submits measured ~1.5–2.2 s each, but that is latency, not a
    // bound. The pacing makes the per-minute claim true by construction.
    minStartIntervalMs: 1_100,
    // units = regular rows offered (DNS-skipped ones included — an upper
    // bound); audit samples are counted apart in metadata.audit_offered.
    ledger: {
      feature: "shopfront_clone_urlscan",
      operation: "submit_batch",
      spend: (r) => num(r.units) + num(r.metadata?.audit_offered),
    },
    active: () => laneGate("shopfront-clone-urlscan-submit").ok,
  },
  // Six-hourly rescans at :30 (00/06/12/18). 90 × 4 = 360/day.
  recheck: {
    fnId: "shopfront-clone-lifecycle-recheck",
    crons: laneSchedule("shopfront-clone-lifecycle-recheck"),
    perRun: 90,
    minStartIntervalMs: 1_100,
    // units = successful submits; a genuine failure may still have been a
    // POST urlscan counted, so it is added (upper bound).
    ledger: {
      feature: "shopfront_clone_urlscan",
      operation: "recheck_submit",
      spend: (r) => num(r.units) + num(r.metadata?.submit_failed),
    },
    active: () => laneGate("shopfront-clone-lifecycle-recheck").ok,
  },
  // Admin "Scan now" (/api/admin/clone-watch/scan) → one scan-one run → one
  // submit. Never scheduled; its own caps are enforced at the route.
  scanOne: {
    fnId: "shopfront-clone-urlscan-scan-one",
    crons: [],
    perRun: 1,
    ownCap: { perHour: 20, perDay: 100 },
    ledger: {
      feature: "shopfront_clone_urlscan",
      operation: "scan_one",
      spend: (r) => num(r.units),
    },
    active: () => featureFlags.shopfrontCloneUrlscan,
  },
  // Entity enrichment (scam-engine), cron-only. Declared in scam-engine
  // because that package cannot import this one.
  enrichment: {
    fnId: "pipeline-urlscan-enrichment",
    crons: URLSCAN_ENRICHMENT_CRONS,
    perRun: URLSCAN_ENRICHMENT_MAX_PER_RUN,
    ledger: {
      feature: "urlscan-enrichment",
      operation: "scan.submit",
      spend: (r) => num(r.units),
    },
    active: () => featureFlags.urlScanIO,
  },
};

/** The not-a-clone audit's share of the submit batch (#1238). Samples take at
 *  most this many of `URLSCAN_SPENDERS.submit.perRun` slots, never extra. */
export const SUBMIT_AUDIT_SHARE = 25;

/** Worst-case submits a spender can make in any one minute. */
export function perMinuteCeiling(s: UrlscanSpender): number {
  const own = s.ownCap ? Math.min(s.perRun, s.ownCap.perHour) : s.perRun;
  if (!s.minStartIntervalMs) return own;
  return Math.min(own, Math.ceil(MIN_MS / s.minStartIntervalMs));
}

const SPENDER_LIST = Object.entries(URLSCAN_SPENDERS) as Array<
  [SpenderId, UrlscanSpender]
>;

function spenderOf(row: LedgerRow): SpenderId | null {
  for (const [id, s] of SPENDER_LIST) {
    if (s.ledger.feature === row.feature && s.ledger.operation === row.operation) {
      return id;
    }
  }
  return null;
}

/** Minute-of-week (0 = Sunday 00:00 UTC) of an epoch-ms instant. */
function minuteOfWeek(ms: number): number {
  const d = new Date(ms);
  return d.getUTCDay() * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes();
}

export type UnlistedDecision =
  | {
      ok: true;
      request: number;
      usedHour: number;
      reservedHour: number;
      usedDay: number;
    }
  | {
      ok: false;
      reason:
        | "ledger_unreadable"
        | "hourly_headroom"
        | "daily_headroom"
        | "own_hourly_cap"
        | "own_daily_cap";
      request: number;
      usedHour: number | null;
      reservedHour: number | null;
      usedDay: number | null;
    };

/**
 * May `spender` spend `request` unlisted submits now?
 *
 *   used_hour     = ledger units of EVERY spender in the trailing 60 min
 *   reserved_hour = for each ACTIVE scheduled spender: perRun for a cron fire
 *                   due in the next 60 min, and for one that fired in the last
 *                   60 min, perRun MINUS the units it has logged since. That
 *                   covers both ledger shapes: submit/recheck write one row at
 *                   the END of a run (in flight = the whole perRun reserved),
 *                   while enrichment writes a row per submit (a partial run
 *                   keeps the rest reserved).
 *   refuse when used_hour + reserved_hour + request > 100
 *            or used_day (trailing 24h) + request > 1,000
 *            or the spender's own caps (scanOne) would be exceeded
 *            or `rows` is null — an unreadable ledger is never zero spend.
 *
 * The reserve on BOTH sides of now is deliberate: urlscan does not document
 * whether its hour is a clock hour or rolling. So a manual batch that lands
 * 30 min before a scheduled one is treated as sharing its hour.
 */
export function decideUnlistedSpend(
  spender: SpenderId,
  request: number,
  rows: readonly LedgerRow[] | null,
  nowMs: number,
): UnlistedDecision {
  if (rows === null) {
    return {
      ok: false,
      reason: "ledger_unreadable",
      request,
      usedHour: null,
      reservedHour: null,
      usedDay: null,
    };
  }
  let usedHour = 0;
  let usedDay = 0;
  let ownHour = 0;
  let ownDay = 0;
  /** Ledger entries per spender, to net a past fire's reserve. */
  const seen: Array<{ id: SpenderId; at: number; units: number }> = [];
  for (const row of rows) {
    const id = spenderOf(row);
    if (!id) continue;
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at) || at > nowMs || at <= nowMs - DAY_MS) continue;
    const units = URLSCAN_SPENDERS[id].ledger.spend(row);
    usedDay += units;
    if (id === spender) ownDay += units;
    if (at > nowMs - HOUR_MS) {
      usedHour += units;
      if (id === spender) ownHour += units;
    }
    seen.push({ id, at, units });
  }

  let reservedHour = 0;
  const nowMinuteMs = Math.floor(nowMs / MIN_MS) * MIN_MS;
  const nowMow = minuteOfWeek(nowMs);
  for (const [id, s] of SPENDER_LIST) {
    if (s.crons.length === 0 || !s.active()) continue;
    const fires = new Set(cronFiringsOfWeek(s.crons));
    // Offsets -59..+60 min around now: fired within the last hour, or due
    // within the next.
    for (let k = -59; k <= 60; k++) {
      const mow = (((nowMow + k) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
      if (!fires.has(mow)) continue;
      const fireMs = nowMinuteMs + k * MIN_MS;
      // A past fire's logged units are already in usedHour: reserve only the
      // part of its worst case not yet seen.
      const logged =
        k <= 0
          ? seen
              .filter((e) => e.id === id && e.at >= fireMs)
              .reduce((a, e) => a + e.units, 0)
          : 0;
      reservedHour += Math.max(0, s.perRun - logged);
    }
  }

  const base = { request, usedHour, reservedHour, usedDay };
  const own = URLSCAN_SPENDERS[spender].ownCap;
  if (own && ownHour + request > own.perHour) {
    return { ok: false, reason: "own_hourly_cap", ...base };
  }
  if (own && ownDay + request > own.perDay) {
    return { ok: false, reason: "own_daily_cap", ...base };
  }
  if (usedHour + reservedHour + request > URLSCAN_UNLISTED.perHour) {
    return { ok: false, reason: "hourly_headroom", ...base };
  }
  if (usedDay + request > URLSCAN_UNLISTED.perDay) {
    return { ok: false, reason: "daily_headroom", ...base };
  }
  return { ok: true, ...base };
}

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

/** Rows the read will accept before it calls itself incomplete. ~10 rows a
 *  day today (plus ≤100 admin scans); a full page means rows were cut off. */
const LEDGER_READ_LIMIT = 1_000;

/**
 * Trailing-24h unlisted-urlscan ledger rows, or `null` when the read failed or
 * may be incomplete. Never `[]` on failure: an empty ledger means "nothing
 * spent" and would open every guard (the head-count lesson — a failed read
 * must not print a confident zero).
 */
export async function readUnlistedLedger(
  sb: Sb,
  nowMs: number,
): Promise<LedgerRow[] | null> {
  const features = [...new Set(SPENDER_LIST.map(([, s]) => s.ledger.feature))];
  const operations = [
    ...new Set(SPENDER_LIST.map(([, s]) => s.ledger.operation)),
  ];
  try {
    const { data, error } = await sb
      .from("cost_telemetry")
      .select("feature, operation, created_at, units, metadata")
      .in("feature", features)
      .in("operation", operations)
      .gt("created_at", new Date(nowMs - DAY_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(LEDGER_READ_LIMIT);
    if (error || !Array.isArray(data)) return null;
    if (data.length >= LEDGER_READ_LIMIT) return null;
    return data as LedgerRow[];
  } catch {
    return null;
  }
}

/** Read the ledger and decide `spender`'s full per-run request. For
 *  manual-trigger runs; call it inside a step.run so a replay reuses it. */
export async function checkUnlistedHeadroom(
  sb: Sb,
  spender: SpenderId,
  nowMs: number = Date.now(),
): Promise<UnlistedDecision> {
  const rows = await readUnlistedLedger(sb, nowMs);
  return decideUnlistedSpend(
    spender,
    URLSCAN_SPENDERS[spender].perRun,
    rows,
    nowMs,
  );
}
