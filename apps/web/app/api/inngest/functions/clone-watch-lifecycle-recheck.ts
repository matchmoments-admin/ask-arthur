import { isFeatureBrakedOrUnknown } from "@askarthur/scam-engine/cost-log";
import {
  LANES,
  recordLaneError,
  recordLaneOutcome,
} from "@askarthur/scam-engine/lane-outcome";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { logCostAsync } from "@/lib/cost-telemetry";
import {
  computeWeaponisationRisk,
  riskBand,
} from "@/lib/clone-watch/weaponisation-risk";
import { submitCandidateBatch } from "@/lib/clone-watch/urlscan-submit-one";
import { attributionRiskInputs } from "@/lib/clone-watch/attribution";
import {
  RECHECK_DNS,
  isUrlscanFloorDue,
  readRecheckDns,
  type DnsRead,
} from "@/lib/clone-watch/recheck-dns-gate";
import { laneCrons, laneGate } from "@/lib/laneHealth";

/**
 * Clone-Watch — lifecycle re-check loop (Wave 0 PR-B).
 *
 * The founder's "we need to press these somehow" ask, in code. Netcraft grades
 * on LIVE content, so a lookalike that is parked / cloaked / pre-weaponisation
 * at first scan comes back "no threats" (→ lifecycle 'declined') or benign
 * (→ 'monitoring'). Those domains very often weaponise LATER. This cron re-scans
 * the 'monitoring'/'declined' tail on a cadence: when the re-scan verdict flips
 * to likely_phishing, clone-watch-urlscan-retrieve promotes the alert to
 * 'weaponised' and emits shopfront/clone.weaponised.v1 — the contradiction we
 * exploit ("we saw the phish, Netcraft didn't").
 *
 * v224 (ops review): rescans are submitted INLINE here (one step.run per
 * candidate, mirroring clone-watch-urlscan-submit), NOT fanned out as 50
 * scan-requested events to scan-one — that fan-out was ~200 Inngest
 * invocations/day of the operator-single-click path. The daily throttle keeps
 * total rescans structurally bounded (the May-27 lesson); a manual-trigger
 * cooldown prevents same-hour stacking (which breached urlscan's 100/hour
 * unlisted cap). The retrieve stage picks up the fresh submissions (v224 also
 * fixed retrieve to see re-submitted-since-last-scan rows, so classified rows
 * that flip are finally detectable).
 *
 * v334 (#1229 part 2a) — CHANGE-TRIGGERED. The designed cadence wants ~3,800
 * urlscan rescans a day against a 1,000/day quota. Each run now DNS-reads up to
 * RECHECK_DNS.limit due rows (free) and spends urlscan only on rows whose DNS
 * fingerprint changed, read inconclusive, have no baseline yet, or are owed a
 * mandatory floor rescan (7 d under 14 days old, 30 d after). Unchanged rows
 * get a DNS stamp that moves them back in the queue. The gate, the floor and
 * their evidence live in lib/clone-watch/recheck-dns-gate.ts; the per-run
 * decision is planUrlscanRechecks below. Weaponisation is still decided only
 * by the urlscan verdict (retrieve stage).
 *
 * Gated by FF_SHOPFRONT_CLONE_RECHECK (canary independently of Netcraft
 * submission) + a feature_brakes.shopfront_clone_recheck operator kill-switch.
 */

// × 4 runs/day = ≤360 rescans/day. Bounded by urlscan's UNLISTED quota —
// 100/hour, 1,000/day (/user/quotas, read 2026-09-26): one batch lands inside
// one hour, so 90 leaves 10 of the hour for any other unlisted caller. Was 50
// (#1231): 50/50 on every run since 2026-09-17 with 1,420 rows due.
//
// This does NOT meet the designed cadence and cannot: at 6h/24h/168h the pool
// asks for ~3,800 rescans/day, ~4x the whole daily quota. So since v334 the
// cadence is met by DNS, not urlscan (#1229 part 2a, recheck-dns-gate.ts): up
// to RECHECK_DNS.limit due rows are DNS-read per run, and only rows whose
// fingerprint changed, read inconclusive, have no baseline, or are floor-due
// spend one of these 90 urlscan slots. Unchanged rows get a DNS stamp that
// moves them back in the queue. `due_total` still shows what is left due.
export const RECHECK_BATCH_LIMIT = 90;
// Submits in flight inside the batch step, PACED: urlscan's unlisted cap is
// 60/min and a sequential submit is ~1.5–2.2 s (measured), so width alone
// would push ~80/min. One start per 1.1 s holds it near 55/min; width 3 hides
// each row's latency so the pacing, not the latency, sets the rate. 90 rows
// ≈ 100 s, inside RECHECK_SUBMIT_WALL_CLOCK_MS.
const RECHECK_SUBMIT_CONCURRENCY = 3;
const RECHECK_SUBMIT_MIN_INTERVAL_MS = 1_100;
// Same-window cooldown for a manual fire. 65 min, not 50: the unlisted quota
// is 100/HOUR, and two batches of 90 inside one hour is 180 (at 50/batch a
// 51-minute stack was 100 and just fit).
const RECHECK_COOLDOWN_MS = 65 * 60 * 1000;
// F3: over-fetch the staleness-ordered pool, rank by weaponisation risk in TS
// (ONE scorer — weaponisation-risk.ts), rescan the top RECHECK_BATCH_LIMIT. Unselected rows keep
// their stale last_rechecked_at and rotate through on later runs.
//
// That rotation does NOT happen on its own. This comment used to claim
// "staleness-ordered pool → no starvation; full ~800-row rotation ≈ 4 days";
// measured in prod 2026-08-09, 108 pool rows had never been rechecked at all and
// 41 had gone >7.8 days. The pool is staleness-ordered but the SELECTION is
// risk-ordered, so a persistently low-risk row is fetched every run and picked
// never. selectTopRiskCandidates now reserves STALE_FLOOR_SHARE of each batch
// for the stalest rows, which is what actually bounds the rotation.
//
// v334: 200 -> 1,000 (the RPC clamp moved 500 -> 1,000 in the same migration).
// The ranked slice is now the DNS slice (RECHECK_DNS.limit = 600), not the
// urlscan batch, so the over-fetch ratio stays ~1.7x (was 200 -> 90, 2.2x).
// Ranking happens INSIDE the load step and only a slim projection of the
// slice leaves it: 1,000 full rows measured ~1.15 MB of step output.
export const RECHECK_FETCH_LIMIT = 1_000;
// Share of each batch reserved for the stalest rows regardless of risk score.
// 20% of 90 = 18 slots/run x 4 runs/day = 72 guaranteed rotations/day.
const STALE_FLOOR_SHARE = 0.2;
const RECHECK_CADENCE_HOURS = 6; // don't re-scan the same domain more often
// Break the submit loop before the ROUTE's maxDuration — the loop runs inside
// ONE step, so Vercel's 300s request kill is the bound that applies, not the
// 15m finish budget (step-budget.ts). In-step: the clock starts at step entry.
// Was 400_000 as a spanning budget measured from event.ts (#1124–#1130), which
// is the wrong constructor for a single-step loop and above budgetedStep's 240s
// ceiling; the :30 cron never sat on the fleet pileup so it happened not to
// expire at index 0 the way the 09:00 submit lane did. Leftovers rotate next run.
const RECHECK_SUBMIT_WALL_CLOCK_MS = 220_000;
const BRAKE = LANES["shopfront-clone-lifecycle-recheck"].brake;

interface RecheckRow {
  id: number;
  /** v328: rows due in total (window count before the LIMIT). */
  due_total?: number | string | null;
  candidate_domain: string;
  candidate_url: string;
  lifecycle_state: string;
  urlscan_classification: string | null;
  recheck_count: number;
  last_rechecked_at: string | null;
  // v222 risk-score inputs (all nullable — enrichment/classification partial).
  signals: unknown;
  /** attribution jsonb — read via attributionRiskInputs, never destructured. */
  attribution: unknown;
  clf_is_clone: boolean | null;
  clf_confidence: number | null;
  clf_attack_intent: string | null;
  clf_clone_tactic: string | null;
  brand_category: string | null;
  // v334 DNS-gate inputs (absent before the migration: every row then reads
  // no_baseline + floor-due, i.e. is scanned exactly as before).
  first_seen_at?: string | null;
  recheck_dns_fingerprint?: string | null;
  recheck_dns_checked_at?: string | null;
  /** The worklist's own queue clock (GREATEST of the urlscan and DNS clocks). */
  queue_clock_at?: string | null;
}

type ScoredRow = RecheckRow & { risk: number };

/** Which timestamp "stale" means. The urlscan batch ranks by the URLSCAN
 *  clock (last_rechecked_at); the DNS slice by the worklist's queue clock. */
interface ClockFields {
  id: number;
  last_rechecked_at: string | null;
  queue_clock_at?: string | null;
}
type StalenessClock = (r: ClockFields) => string | null | undefined;
const urlscanClock: StalenessClock = (r) => r.last_rechecked_at;
const queueClock: StalenessClock = (r) =>
  r.queue_clock_at !== undefined ? r.queue_clock_at : r.last_rechecked_at;

/** Staleness ascending, nulls first, then id — the pool's own fetch order. */
function byStalenessOf(clock: StalenessClock) {
  return (a: ClockFields, b: ClockFields): number => {
    const ca = clock(a);
    const cb = clock(b);
    const ta = ca ? Date.parse(ca) : -Infinity;
    const tb = cb ? Date.parse(cb) : -Infinity;
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  };
}

/**
 * Rank the fetched pool: risk desc, then staleness (asc, nulls first), then id —
 * deterministic. Exported for unit tests.
 *
 * STARVATION FLOOR. Risk sorts BEFORE staleness, and the pool is over-fetched
 * (RECHECK_FETCH_LIMIT rows ranked down to `limit`), so a persistently low-risk
 * row is fetched every run and selected never. The original comment on
 * RECHECK_FETCH_LIMIT asserted the opposite — "staleness-ordered pool → no
 * starvation; full ~800-row rotation ≈ 4 days" — and prod disagreed: 108 pool
 * rows had never been rechecked at all and 41 had gone more than 7.8 days,
 * against a claimed 4-day full rotation.
 *
 * So a fixed share of each batch is reserved for the stalest rows regardless of
 * risk. Every row therefore reaches the front of the staleness queue in bounded
 * time, while the large majority of the batch still goes to the risk ranking the
 * feature exists for. This is a floor, not a quota: if the risk-ranked selection
 * already contains the stalest rows, the reserve costs nothing.
 */
export function selectTopRiskCandidates(
  rows: RecheckRow[],
  limit: number,
  nowMs: number,
  // Proportional, deliberately NOT max(1, …): at a batch of 2 a one-slot reserve
  // would be half the run. The floor is a production-scale device — it is 0 below
  // a limit of 5 and 10 at the real batch size of 50.
  staleFloor: number = Math.floor(limit * STALE_FLOOR_SHARE),
  clock: StalenessClock = urlscanClock,
): ScoredRow[] {
  const scored: ScoredRow[] = rows.map((r) => ({
    ...r,
    risk: computeWeaponisationRisk({
      urlscanClassification: r.urlscan_classification,
      signals: r.signals,
      isClone: r.clf_is_clone,
      confidence: r.clf_confidence,
      attackIntent: r.clf_attack_intent,
      brandCategory: r.brand_category,
      ...attributionRiskInputs(r.attribution),
      nowMs,
    }).score,
  }));
  return pickWithStaleFloor(scored, limit, staleFloor, clock);
}

/**
 * The selection half of selectTopRiskCandidates, over rows already scored:
 * risk order, with `staleFloor` slots reserved for the stalest rows by
 * `clock`. Generic so the urlscan planner can re-pick from the DNS slice's
 * slim rows without re-scoring them.
 */
function pickWithStaleFloor<T extends ClockFields & { risk: number }>(
  scored: T[],
  limit: number,
  staleFloor: number,
  clock: StalenessClock,
): T[] {
  const byStaleness = byStalenessOf(clock);
  const byRisk = [...scored].sort((a, b) => {
    if (a.risk !== b.risk) return b.risk - a.risk;
    return byStaleness(a, b);
  });

  const floor = Math.min(Math.max(0, staleFloor), limit);
  const chosen = new Map<number, T>();
  for (const r of byRisk.slice(0, Math.max(0, limit - floor)))
    chosen.set(r.id, r);
  // Fill the reserve from the stalest end, then top back up from the risk order
  // if the reserve overlapped what risk already picked.
  for (const r of [...scored].sort(byStaleness)) {
    if (chosen.size >= limit) break;
    chosen.set(r.id, r);
  }
  for (const r of byRisk) {
    if (chosen.size >= limit) break;
    chosen.set(r.id, r);
  }

  // Return in risk order so the wall-clock guard spends the batch's early,
  // guaranteed-to-run slots on the highest-risk candidates.
  return [...chosen.values()].sort((a, b) => {
    if (a.risk !== b.risk) return b.risk - a.risk;
    return byStaleness(a, b);
  });
}

/** What leaves the load step for each row of the DNS slice — enough to probe,
 *  plan and submit, and nothing else (a full worklist row is ~1.1 KB). */
export interface SliceRow {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  lifecycle_state: string;
  last_rechecked_at: string | null;
  queue_clock_at?: string | null;
  first_seen_at: string | null;
  recheck_dns_fingerprint: string | null;
  risk: number;
}

export function toSliceRow(r: ScoredRow): SliceRow {
  return {
    id: r.id,
    candidate_domain: r.candidate_domain,
    candidate_url: r.candidate_url,
    lifecycle_state: r.lifecycle_state,
    last_rechecked_at: r.last_rechecked_at,
    queue_clock_at: r.queue_clock_at ?? null,
    first_seen_at: r.first_seen_at ?? null,
    recheck_dns_fingerprint: r.recheck_dns_fingerprint ?? null,
    risk: r.risk,
  };
}

export interface UrlscanPlan {
  /** Rows to urlscan, risk order. */
  scan: SliceRow[];
  /** DNS unchanged, not floor-due, not scanned: stamp the DNS clock only. */
  unchangedIds: number[];
  counts: {
    dns_checked: number;
    dns_unchanged: number;
    dns_changed: number;
    dns_unknown: number;
    dns_no_baseline: number;
    /** Offered rows owed a mandatory rescan (whatever DNS said). */
    floor_due: number;
    /** Eligible for urlscan but left out by the cap — unstamped, lead next run. */
    deferred: number;
  };
}

/**
 * The DNS Gate's decision for one run. Pure (tested in recheckDnsGate.test.ts).
 *
 *   eligible = floor-due  OR  DNS read changed / unknown / no_baseline
 *
 * A row the DNS phase did not reach is eligible only if floor-due — so a
 * broken or slow resolver can never starve the floor. Selection inside the
 * cap: CHANGED rows first (a DNS change is the flip signal), in risk order;
 * the remaining slots go through the same risk-plus-stale-floor pick as
 * before, staleness measured on the URLSCAN clock, so floor-due rows (the
 * urlscan-stalest) keep their reserved share.
 *
 * Worklist-gate starvation rule: every row this gate REJECTS (unchanged, not
 * floor-due) is in `unchangedIds` and gets stamped. Eligible rows the cap
 * leaves out are deliberately not stamped — each run scans `limit` of them,
 * so that set drains rather than parking at the head.
 */
export function planUrlscanRechecks(
  slice: readonly SliceRow[],
  reads: readonly DnsRead[],
  limit: number,
  nowMs: number,
): UrlscanPlan {
  const byId = new Map(reads.map((r) => [r.id, r]));
  const eligible: SliceRow[] = [];
  const changed: SliceRow[] = [];
  const unchangedIds: number[] = [];
  const counts: UrlscanPlan["counts"] = {
    dns_checked: reads.length,
    dns_unchanged: 0,
    dns_changed: 0,
    dns_unknown: 0,
    dns_no_baseline: 0,
    floor_due: 0,
    deferred: 0,
  };
  for (const row of slice) {
    const read = byId.get(row.id);
    const floorDue = isUrlscanFloorDue(row, nowMs);
    if (floorDue) counts.floor_due++;
    if (read) {
      if (read.verdict === "changed") counts.dns_changed++;
      else if (read.verdict === "unknown") counts.dns_unknown++;
      else if (read.verdict === "no_baseline") counts.dns_no_baseline++;
    }
    if (read?.verdict === "unchanged" && !floorDue) {
      counts.dns_unchanged++;
      unchangedIds.push(row.id);
      continue;
    }
    if (!read && !floorDue) continue; // unreached by DNS: stays due, untouched
    if (read?.verdict === "changed") changed.push(row);
    else eligible.push(row);
  }

  const byRiskDesc = (a: SliceRow, b: SliceRow) =>
    a.risk !== b.risk ? b.risk - a.risk : a.id - b.id;
  const first = [...changed].sort(byRiskDesc).slice(0, Math.max(0, limit));
  const room = Math.max(0, limit - first.length);
  const rest = pickWithStaleFloor(
    eligible,
    room,
    Math.floor(room * STALE_FLOOR_SHARE),
    urlscanClock,
  );
  // Changed rows lead the submit order too, so a wall-clock stop falls on the
  // tail of the no-signal rows, never on a DNS change.
  const scan = [...first, ...rest];
  counts.deferred = changed.length + eligible.length - scan.length;
  return { scan, unchangedIds, counts };
}

// inngest-finish-budget: 7 boundaries — check-brake, check-cooldown,
// load-and-rank, dns-gate-and-submit (budgeted 220 s), mark-rechecked,
// record-dns, log-cost (log-cost-quiet replaces the last four on a quiet run).
export const cloneWatchLifecycleRecheck = inngest.createFunction(
  {
    id: "shopfront-clone-lifecycle-recheck",
    name: "Clone-Watch: lifecycle re-check loop",
    retries: 1,
    concurrency: { limit: 1 },
    // Inngest throttle counts RUNS, not submits: this caps runs/day. The
    // submit ceiling is RECHECK_BATCH_LIMIT per run × the 65-min cooldown,
    // which keeps a manual-trigger storm from recreating the May-27 urlscan
    // burst (v224).
    throttle: { limit: 210, period: "1d" },
    // 15m, not 8m (#1069): the inline rescan step legitimately runs minutes
    // (a batch of rechecks incl. urlscan submits), and step boundaries now queue for
    // account-concurrency slots (~30–60s each under contention). Finite per
    // ADR-0019; guarded by inngestFinishBudgets.test.ts.
    // NOTE: this budget now exceeds the 10m pg-stuck-query-watchdog window.
    // That watchdog pages on a Postgres BACKEND running >=10 min; the long
    // pole here is external HTTP plus account-concurrency queue wait, not a
    // PG query, so a long run is expected and is not a watchdog condition
    // (CLAUDE.md requires documenting exactly this).
    timeouts: { finish: "15m" },
  },
  [
    // Offset from urlscan-retrieve (10 */3 since #1069) so a rescan submit and
    // a retrieve tick don't race on the same row (v224). The offset is 20 min,
    // narrowed from 30 when retrieve moved off the top of the hour.
    ...laneCrons("shopfront-clone-lifecycle-recheck"),
    { event: "shopfront/clone.lifecycle-recheck.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-lifecycle-recheck" },
    async ({ step }) => {
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("shopfront-clone-lifecycle-recheck");
      if (!gate.ok) return { skipped: true, reason: gate.reason };
      if (!process.env.URLSCAN_API_KEY) {
        return { skipped: true, reason: "URLSCAN_API_KEY not set" };
      }
      const braked = await step.run("check-brake", () =>
        isFeatureBrakedOrUnknown(BRAKE),
      );
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // Cooldown: skip if a recheck ran in the last 50 min. The 6h-apart crons
      // never trip this; it exists so rapid MANUAL triggers can't stack three
      // 50-submit runs into one hour and breach urlscan's 100/hour unlisted cap
      // (which happened 2026-07-12 00:00 UTC). The throttle is the structural
      // backstop; this is the operator-ergonomics one.
      const recentRun = await step.run("check-cooldown", async () => {
        const { data } = await sb
          .from("cost_telemetry")
          .select("created_at")
          .eq("feature", "shopfront_clone_recheck")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data?.created_at) return false;
        return (
          Date.now() - new Date(data.created_at).getTime() < RECHECK_COOLDOWN_MS
        );
      });
      if (recentRun) {
        return { skipped: true, reason: "cooldown_active" };
      }

      // The worklist holds out never-scanned dead rows (v326: no uuid, 400
      // status, failure streak >= 8); the same step reads how many, so the
      // exclusion is counted in the Outcome Row instead of being silent
      // (worklist-gate-starvation rule). A failed count reads as null, never 0.
      //
      // v334: ranking happens HERE, and only the slim DNS slice leaves the
      // step — 1,000 full rows are ~1.15 MB of step output. Inside step.run,
      // so the ranking (which reads the clock for domain age) is replay-stable.
      // The step id changed with the output shape (was load-recheck-candidates
      // + rank-by-risk), so a run in flight across the deploy cannot replay
      // the old shape into this code.
      const loaded = await step.run("load-and-rank", async () => {
        const [{ data, error }, dormant] = await Promise.all([
          sb.rpc("list_clone_alerts_for_recheck", {
            p_limit: RECHECK_FETCH_LIMIT,
            p_cadence_hours: RECHECK_CADENCE_HOURS,
          }),
          sb.rpc("count_clone_recheck_dormant_dead"),
        ]);
        // A failed worklist read must not look like a quiet "nothing due" run
        // (that is exactly how a broken read hides) — record it and throw.
        if (error) {
          await recordLaneError(
            "shopfront-clone-lifecycle-recheck",
            error.message,
          );
          throw new Error(
            `list_clone_alerts_for_recheck failed: ${error.message}`,
          );
        }
        const rows = (data as RecheckRow[] | null) ?? [];
        // v328: every worklist row carries the full due count (count(*) OVER ()
        // before the LIMIT), so the backlog the cap leaves is on record.
        const dueRaw = rows[0]?.due_total;
        // The DNS slice: risk order with the stale-floor reserve, staleness on
        // the QUEUE clock (the one a DNS stamp moves), so every due row
        // reaches a DNS read in bounded time.
        const slice = selectTopRiskCandidates(
          rows,
          RECHECK_DNS.limit,
          Date.now(),
          undefined,
          queueClock,
        ).map(toSliceRow);
        return {
          pool: rows.length,
          slice,
          dueTotal:
            dueRaw == null || !Number.isFinite(Number(dueRaw))
              ? null
              : Number(dueRaw),
          dormantDead:
            !dormant.error && typeof dormant.data === "number"
              ? dormant.data
              : null,
        };
      });
      const { pool, slice, dueTotal, dormantDead } = loaded;

      if (pool === 0) {
        // Quiet-run Outcome Row (#1145/#1166): "nothing due" used to write
        // nothing and read as "not running". The 65-min cooldown above reads
        // this feature's latest row, so a quiet run also holds off a stacked
        // manual fire — intended.
        await step.run("log-cost-quiet", () =>
          recordLaneOutcome("shopfront-clone-lifecycle-recheck", 0, {
            reason: "nothing_due",
            pool: 0,
            rechecked: 0,
            submitted: 0,
            submit_failed: 0,
            dormant_dead: dormantDead,
          }),
        );
        return { ok: true, rechecked: 0, reason: "nothing_due" };
      }

      // DNS gate + urlscan batch in ONE budgeted step (v334, #1229 part 2a).
      //
      // Phase 1 DNS-reads the slice (RECHECK_DNS.concurrency in flight, capped
      // at RECHECK_DNS.phaseMs of this step's clock). Phase 2 urlscans only the
      // rows planUrlscanRechecks admits — changed / unknown / no baseline /
      // floor-due — up to RECHECK_BATCH_LIMIT, paced exactly as before.
      //
      // Both phases run inside one step instead of one step per candidate:
      // Inngest bills per step execution, and neither phase awaits step.run
      // per item, so the budget is in-step and a replay cannot reset a tally
      // mid-loop. urlscan submit is idempotent (the submit-one helper records
      // urlscan_submitted_at, so a retry re-submits harmlessly and the
      // retrieve worklist de-dupes on it). Each candidate is wrapped in
      // try/catch so one failure doesn't abort the rest. The wall-clock guard
      // breaks before the route's maxDuration (not the 15m finish budget —
      // step-budget.ts); leftovers stay unmarked and rotate through next run.
      const batch = await budgetedStep(
        step,
        "dns-gate-and-submit",
        RECHECK_SUBMIT_WALL_CLOCK_MS,
        async (budget) => {
          const dnsStart = Date.now();
          const dnsDeadline = dnsStart + RECHECK_DNS.phaseMs;
          const dns = await readRecheckDns(slice, {
            expired: () => budget.expired() || Date.now() >= dnsDeadline,
          });
          // Measured, so RECHECK_DNS.limit can be raised from evidence: the
          // cadence wants ~1,000 reads/run and this ships at 600.
          const dnsMs = Date.now() - dnsStart;
          const plan = planUrlscanRechecks(
            slice,
            dns.reads,
            RECHECK_BATCH_LIMIT,
            Date.now(),
          );
          // attemptedIds is every row the loop LOOKED AT, except a 429. The
          // cadence stamp (mark_clone_alerts_rechecked) records "we looked",
          // not "it worked": a submit urlscan refused with a 400 (no DNS) is
          // exactly the row v277's 168h dead-domain cadence exists to park,
          // and that cadence keys on last_rechecked_at. #1127 stamped only
          // successes, so failed rows kept their stale stamp, stayed at the
          // head of the worklist and were re-attempted 4×/day — within a week
          // the same 50 dead domains were the whole batch (worklist-gate
          // starvation rule). A 429 is the one exception: quota exhaustion
          // says nothing about the URL, so the row stays unstamped and retries
          // first (v224), counted as rate_limited, never submit_failed. The
          // mapping lives in ONE place, shared with the daily submit lane.
          const tally = await submitCandidateBatch(plan.scan, budget, {
            concurrency: RECHECK_SUBMIT_CONCURRENCY,
            minStartIntervalMs: RECHECK_SUBMIT_MIN_INTERVAL_MS,
            onRowError: (alertId, err) =>
              logger.error("clone-watch recheck: submit failed", {
                alertId,
                error: err instanceof Error ? err.message : String(err),
              }),
          });
          // The baseline each ATTEMPTED row gets: what DNS said at this rescan.
          const fpById = new Map(dns.reads.map((r) => [r.id, r.fingerprint]));
          const scanned = tally.attemptedIds.map((id) => ({
            id,
            fp: fpById.get(id) ?? null,
          }));
          return {
            tally,
            plan: {
              counts: plan.counts,
              unchangedIds: plan.unchangedIds,
              scanCount: plan.scan.length,
              declined: plan.scan.filter(
                (c) => c.lifecycle_state === "declined",
              ).length,
              monitoring: plan.scan.filter(
                (c) => c.lifecycle_state === "monitoring",
              ).length,
              risks: plan.scan.map((c) => c.risk).sort((a, b) => a - b),
            },
            scanned,
            dnsUnreached: dns.unreached,
            dnsMs,
          };
        },
      );
      const { tally, plan, scanned, dnsUnreached, dnsMs } = batch;
      const {
        submitted,
        submitFailed,
        rateLimited,
        dnsSkipped,
        dnsServfail,
        reputationHits,
        attemptedIds,
        unreached,
      } = tally;

      // Mark every attempted candidate rechecked (bump recheck_count +
      // last_rechecked_at) so it drops out of the cadence window — 6h for a
      // live domain, 168h for one urlscan refused — until its turn comes round.
      // Rows the budget skipped and rows urlscan rate-limited stay unstamped
      // and re-present next run.
      //
      // This used to call advance_clone_lifecycle with
      // `p_to_state: c.lifecycle_state` as a "no-op state change" — a value read
      // back in the load step, BEFORE the submit batch ran. Since #990 the
      // submit step can itself move a row declined -> weaponised, so the no-op
      // stopped being a no-op: it replayed a stale state and overwrote the
      // weaponisation the same run had just discovered. Caught in prod on alert
      // 2272 (`qantasa.exchange`) — weaponised 00:31:43, back to 'declined'
      // 00:32:13. weaponised_at survived (so the alert still fired) but every
      // count reads lifecycle_state, so it landed in the wrong bucket.
      //
      // v278's RPC takes an id and nothing else, so this step cannot name a
      // lifecycle state at all. v331 (#1229) is its array form — the same
      // per-row write for every attempted id in ONE statement. A failure
      // throws for the step's retry; there is no half-stamped batch.
      await step.run("mark-rechecked", async () => {
        if (attemptedIds.length === 0) return;
        const { error } = await sb.rpc("mark_clone_alerts_rechecked", {
          p_alert_ids: attemptedIds,
        });
        if (error) {
          throw new Error(
            `mark_clone_alerts_rechecked failed for ${attemptedIds.length} alerts: ${error.message}`,
          );
        }
      });

      // v334 DNS bookkeeping, its OWN step so a retry never re-runs the
      // recheck_count bump above. Unchanged rows get the DNS stamp (the queue
      // clock moves; nothing else does); attempted rows get their new baseline.
      // A failure is LOUD: an unstamped unchanged row re-presents at the head
      // of the worklist and would crowd the DNS slice every run (worklist-gate
      // starvation), so it is recorded and thrown for the step's retry — never
      // swallowed into a clean-looking Outcome Row.
      await step.run("record-dns", async () => {
        if (plan.unchangedIds.length === 0 && scanned.length === 0) return;
        const { error } = await sb.rpc("record_clone_recheck_dns", {
          p_unchanged_ids: plan.unchangedIds,
          p_scanned: scanned,
        });
        if (error) {
          await recordLaneError(
            "shopfront-clone-lifecycle-recheck",
            `record_clone_recheck_dns: ${error.message}`,
          );
          throw new Error(`record_clone_recheck_dns failed: ${error.message}`);
        }
      });

      // Two telemetry rows: the lane's Outcome Row (risk distribution + the
      // DNS gate's tally) under the recheck feature, AND the urlscan submit
      // VOLUME under the urlscan feature — the recheck path is a major urlscan
      // caller and must show on the cost dashboard / volume ceilings (v224).
      await step.run("log-cost", async () => {
        const risks = plan.risks;
        await recordLaneOutcome(
          "shopfront-clone-lifecycle-recheck",
          attemptedIds.length,
          {
            rechecked: attemptedIds.length,
            pool,
            submitted,
            submit_failed: submitFailed,
            dns_skipped: dnsSkipped,
            dns_servfail: dnsServfail,
            rate_limited: rateLimited,
            unreached,
            dormant_dead: dormantDead,
            // #1231: the cap, whether this run hit it, and the true due count
            // (v328 window count; null = older RPC / not returned). Since v334
            // "due" means due for a recheck of EITHER kind — the queue clock a
            // DNS stamp also moves — so it is the DNS gate's backlog; the
            // urlscan backlog is `deferred`.
            cap: RECHECK_BATCH_LIMIT,
            cap_reached: plan.scanCount >= RECHECK_BATCH_LIMIT,
            due_total: dueTotal,
            // v334 DNS gate (recheck-dns-gate.ts).
            ...plan.counts,
            dns_unreached: dnsUnreached,
            dns_slice: slice.length,
            dns_ms: dnsMs,
            declined: plan.declined,
            monitoring: plan.monitoring,
            top_score: risks[risks.length - 1] ?? null,
            median_score: risks[Math.floor(risks.length / 2)] ?? null,
            bands: {
              critical: risks.filter((r) => riskBand(r) === "critical").length,
              elevated: risks.filter((r) => riskBand(r) === "elevated").length,
              low: risks.filter((r) => riskBand(r) === "low").length,
            },
          },
        );
        await logCostAsync({
          feature: "shopfront_clone_urlscan",
          provider: "urlscan",
          operation: "recheck_submit",
          units: submitted,
          unitCostUsd: 0, // free tier
          metadata: {
            submitted,
            submit_failed: submitFailed,
            dns_skipped: dnsSkipped,
            dns_servfail: dnsServfail,
            rate_limited: rateLimited,
            reputation_hits: reputationHits,
            // What the DNS gate saved this run (v334).
            dns_unchanged: plan.counts.dns_unchanged,
          },
        });
      });

      logger.info("clone-watch lifecycle re-check: complete", {
        rechecked: attemptedIds.length,
        pool,
        submitted,
        submitFailed,
        dnsUnchanged: plan.counts.dns_unchanged,
      });

      return {
        ok: true,
        rechecked: attemptedIds.length,
        pool,
        submitted,
        submitFailed,
        dnsChecked: plan.counts.dns_checked,
        dnsUnchanged: plan.counts.dns_unchanged,
      };
    },
  ),
);
