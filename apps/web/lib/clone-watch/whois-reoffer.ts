/**
 * WHOIS re-offer (#1253) — the decision half of re-asking a clone's registrar
 * after the first lookup got no answer.
 *
 * WHY. whoisjson's monthly `batch` guard (700 of 1,000) trips around day 18–20
 * every month. Until #1253, a guarded lookup looked exactly like a served
 * lookup with no registrar, and the enricher saved it as the row's FINAL
 * dossier; its worklist (`attribution IS NULL`) never offered the row again.
 * 130 rows in the 35-day window had no registrar for that reason alone.
 *
 * HOW. The enricher still writes the dossier on the first pass — leaving the
 * row unwritten would re-present it at the head of the oldest-first, capped
 * worklist every run and pin it (the worklist-gate starvation rule). It ALSO
 * stamps `attribution_retry_after`. Inside the same enricher run (no new cron),
 * a bounded re-offer step selects rows whose `attribution_retry_after <= now()`
 * — no 35-day window; a row deferred on day 20 is re-asked on the 1st, by which
 * time it may be 40 days old — re-runs ONLY lookupDomainRegistration, and
 * merges ONLY the dossier's `whois` key (v336 apply_clone_alert_whois_reoffers),
 * so kit_siblings and the rest survive.
 *
 * EVERY re-offered row crosses the worklist predicate (the starvation rule):
 *   - answered (any non-deferred result, even a served record with no
 *     registrar)                       → retry column cleared (resolved)
 *   - deferred again                   → column pushed to the new retryAfter
 *     (quota_deferred — the guard OR a whoisjson 429 — and not_configured
 *     retry on the 1st of next month and are never a strike: a 429 is quota
 *     exhaustion, not the domain refusing)
 *   - http_error for the Nth time      → column cleared (abandoned) — a domain
 *     whoisjson keeps refusing must not cost a lookup a day forever; non-200s
 *     are NOT counted by the monthly guard (whois.ts), so an unbounded retry
 *     would spend quota the guard cannot see
 *   - the lookup threw                 → treated as an http_error deferral, so
 *     a row that always throws still moves (and is abandoned after N)
 * Only rows the wall-clock budget never started stay due, and they are the
 * oldest in the next run's worklist.
 *
 * A deferral never destroys data: a re-offer that is deferred again keeps the
 * previous block's fields and only updates the deferral bookkeeping. A served
 * answer replaces the block — the fresh record is the authority.
 */

import type { DomainRegistration } from "@askarthur/scam-engine/domain-registration";
import { shapeWhoisSection, type CloneAttribution } from "./enrich-attribution";
import { runEnrichBatch } from "./enrich-attribution-batch";

/** Rows re-offered per enricher run. At the 3 s start pace that is ~60 s,
 *  and at most 20 whoisjson calls — 2.9% of the 700 batch guard. The prod
 *  backlog at 2026-09-27 is 141 rows (the v336 backfill), so it drains in a
 *  week of runs from the 1st of the month. */
export const WHOIS_REOFFER_RUN_CAP = 20;

/** http_error deferrals after which a row stops being re-offered. */
export const WHOIS_HTTP_ERROR_MAX_DEFERRALS = 3;

/** Retry delay when the lookup threw or a deferral carried no retryAfter. */
const FALLBACK_RETRY_MS = 24 * 60 * 60 * 1000;

export type WhoisBlock = NonNullable<CloneAttribution["whois"]>;

export type ReofferVerdict = "resolved" | "redeferred" | "abandoned";

export interface ReofferPlan {
  whois: WhoisBlock;
  /** New attribution_retry_after: null clears it. */
  retryAfter: string | null;
  verdict: ReofferVerdict;
}

/**
 * Decide what a re-offer writes. Pure.
 *
 * @param prev  the row's current `attribution.whois` (may be null/absent)
 * @param fresh the re-run lookupDomainRegistration result; null = it threw
 */
export function planWhoisReoffer(
  prev: WhoisBlock | null | undefined,
  fresh: DomainRegistration | null,
  now: Date,
): ReofferPlan {
  if (fresh && fresh.source !== "deferred") {
    // Answered. shapeWhoisSection never returns null for a non-null input.
    return {
      whois: shapeWhoisSection(fresh) as WhoisBlock,
      retryAfter: null,
      verdict: "resolved",
    };
  }

  const reason = fresh?.deferralReason ?? "http_error";
  const prevHttpErrors =
    typeof prev?.httpErrorDeferrals === "number" ? prev.httpErrorDeferrals : 0;
  // Only a real failure is a strike. quota_deferred (the guard, or a vendor
  // 429) and not_configured never are — a 429 is quota exhaustion, not the
  // domain refusing (CLAUDE.md). The status check is belt-and-braces: whois.ts
  // already maps 429 to quota_deferred.
  const isStrike = reason === "http_error" && fresh?.deferralStatus !== 429;
  const httpErrorDeferrals = isStrike ? prevHttpErrors + 1 : prevHttpErrors;
  const status =
    fresh?.deferralStatus !== undefined
      ? { deferralStatus: fresh.deferralStatus }
      : {};
  const base: WhoisBlock =
    prev ??
    (fresh
      ? (shapeWhoisSection(fresh) as WhoisBlock)
      : {
          registrar: null,
          registrarAbuseEmail: null,
          registrantCountry: null,
          createdDate: null,
          nameServers: [],
          statuses: [],
          registrarIanaId: null,
          source: "deferred",
        });
  // Strip the previous retry bookkeeping; the new one is added below.
  const { retryAfter: _prevRetry, deferralStatus: _prevStatus, ...kept } = base;
  void _prevRetry;
  void _prevStatus;

  if (isStrike && httpErrorDeferrals >= WHOIS_HTTP_ERROR_MAX_DEFERRALS) {
    // Given up: still `deferred` (the answer never came), with no retryAfter.
    return {
      whois: {
        ...kept,
        source: "deferred",
        deferralReason: reason,
        ...status,
        httpErrorDeferrals,
      },
      retryAfter: null,
      verdict: "abandoned",
    };
  }

  const retryAfter =
    fresh?.retryAfter ??
    new Date(now.getTime() + FALLBACK_RETRY_MS).toISOString();
  return {
    whois: {
      ...kept,
      source: "deferred",
      retryAfter,
      deferralReason: reason,
      ...status,
      ...(httpErrorDeferrals > 0 ? { httpErrorDeferrals } : {}),
    },
    retryAfter,
    verdict: "redeferred",
  };
}

/** Per-run tallies for the Outcome Row. Accumulated inside ONE step (replay
 *  safe — see enrich-attribution-batch.ts REPLAY SAFETY). */
export interface ReofferTally {
  resolved: number;
  redeferred: number;
  abandoned: number;
}

export const NO_REOFFER_TALLY: Readonly<ReofferTally> = Object.freeze({
  resolved: 0,
  redeferred: 0,
  abandoned: 0,
});

/** A row the re-offer select hands in. */
export interface ReofferRow {
  id: number;
  candidate_domain: string;
  attribution: (Partial<CloneAttribution> & Record<string, unknown>) | null;
}

/** One re-offer write — the v336 apply_clone_alert_whois_reoffers element. */
export interface ReofferWrite {
  id: number;
  whois: WhoisBlock;
  /** null clears attribution_retry_after. */
  retry_after: string | null;
  /** null leaves campaign_key alone. */
  campaign_key: string | null;
}

export interface WhoisReofferOutcome extends ReofferTally {
  /** Rows handed in (due, capped). */
  due: number;
  /** Lookups started. */
  reoffered: number;
  /** Rows the RPC wrote. */
  written: number;
  /** Rows in chunk writes that errored — they stay due. */
  writeFailed: number;
  /** Rows no longer marked by the time the write ran (a retried step's
   *  first attempt already wrote them) — a race, not a loss. */
  writeSkipped: number;
  /** Rows the wall-clock budget stopped before their lookup started. */
  notReachedBudget: number;
}

export const NO_REOFFER: Readonly<WhoisReofferOutcome> = Object.freeze({
  ...NO_REOFFER_TALLY,
  due: 0,
  reoffered: 0,
  written: 0,
  writeFailed: 0,
  writeSkipped: 0,
  notReachedBudget: 0,
});

/**
 * Re-offer a batch of due rows. Pacing, chunked flushing and the wall-clock
 * stop are runEnrichBatch's (enrich-attribution-batch.ts) — the same 3 s
 * minimum start interval that keeps whoisjson under 20/min, and the re-offer
 * runs AFTER the enrich batch finishes, never beside it, so the two cannot
 * combine above that pace. Every counter lives in this call (one step), so an
 * Inngest replay cannot reset it.
 */
export async function runWhoisReoffer(args: {
  rows: readonly ReofferRow[];
  budget: { expired(): boolean };
  /** lookupDomainRegistration at `batch` priority. A throw is a deferral. */
  lookup: (domain: string) => Promise<DomainRegistration | null>;
  flush: (
    writes: ReofferWrite[],
  ) => Promise<{ written: number } | { error: string }>;
  /** Campaign key for the merged dossier; null = leave the column alone.
   *  Only consulted when the re-offer resolved (the WHOIS block changed). */
  campaignKey?: (dossier: Record<string, unknown>) => string | null;
  onFlushError?: (ids: number[], message: string) => void;
  now?: () => Date;
  concurrency?: number;
  minStartIntervalMs?: number;
  flushEvery?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}): Promise<WhoisReofferOutcome> {
  const now = args.now ?? (() => new Date());
  const tally: ReofferTally = { ...NO_REOFFER_TALLY };
  const byId = new Map(args.rows.map((r) => [r.id, r]));

  const batch = await runEnrichBatch<ReofferWrite>({
    rows: args.rows,
    budget: args.budget,
    // The rows were selected inside this same step attempt, so they ARE the
    // fresh worklist; a retried attempt re-selects, and rows its first attempt
    // wrote have already left the predicate.
    readBack: async (ids) => new Set(ids),
    enrich: async (row) => {
      const current = byId.get(row.id)!;
      let fresh: DomainRegistration | null;
      try {
        fresh = await args.lookup(row.candidate_domain);
      } catch {
        fresh = null;
      }
      const prev = (current.attribution?.whois ?? null) as WhoisBlock | null;
      const plan = planWhoisReoffer(prev, fresh, now());
      tally[plan.verdict] += 1;
      const campaign_key =
        plan.verdict === "resolved" && args.campaignKey
          ? args.campaignKey({
              ...(current.attribution ?? {}),
              whois: plan.whois,
            })
          : null;
      const write: ReofferWrite = {
        id: row.id,
        whois: plan.whois,
        retry_after: plan.retryAfter,
        campaign_key,
      };
      return { id: row.id, attribution: write, campaign_key };
    },
    flush: (writes) => args.flush(writes.map((w) => w.attribution)),
    onFlushError: args.onFlushError,
    concurrency: args.concurrency,
    minStartIntervalMs: args.minStartIntervalMs,
    flushEvery: args.flushEvery,
    sleep: args.sleep,
    now: args.clock,
  });

  return {
    ...tally,
    due: args.rows.length,
    reoffered: batch.attempted,
    written: batch.written,
    writeFailed: batch.writeFailed,
    writeSkipped: batch.writeSkipped,
    notReachedBudget: batch.notReachedBudget,
  };
}
