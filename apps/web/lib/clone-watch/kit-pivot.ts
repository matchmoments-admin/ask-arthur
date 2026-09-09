import type { BudgetClock } from "@askarthur/scam-engine/inngest/step-budget";
import type {
  UrlscanSearchHit,
  UrlscanSearchOutcome,
} from "@askarthur/scam-engine/urlscan-search";
import type { WriteOutcome } from "@askarthur/utils/concurrency";

/**
 * attribution.kit_siblings — other sites urlscan has seen on the SAME hosting
 * IP as a confirmed phishing clone. A phishing kit is typically deployed many
 * times on one host, so siblings are strong "same actor" evidence.
 *
 * NOTE: kit_siblings is currently STORED evidence only — computeCampaignKey
 * derives its key from registrar + NS roots + ASN + cert issuer and does NOT
 * yet consume kit_siblings. Folding shared-IP/sibling overlap into campaign
 * grouping (so two clones from the same kit but different registrar cluster
 * together) is a tracked follow-up.
 */
export interface KitSiblingsBlock {
  pivot: "ip";
  /** null when there was no hosting IP to pivot on (see reason). */
  pivot_value: string | null;
  siblings: Array<{ domain: string; last_seen: string | null }>;
  result_count: number;
  /** Present when no pivot was performed, e.g. "no_ip". */
  reason?: string;
  searched_at: string;
}

const MAX_SIBLINGS = 20;

/**
 * Sentinel block for an alert that qualified for a pivot but had no hosting IP
 * (e.g. a reputation-only likely_phishing classification stores no server.ip).
 * Writing it moves the row across the `kit_siblings IS NULL` worklist predicate
 * so it isn't re-selected forever (the op-review "cross the predicate you filter
 * on" rule) — the row simply can't be pivoted, and that's recorded.
 */
export function noIpKitSiblings(now: Date = new Date()): KitSiblingsBlock {
  return {
    pivot: "ip",
    pivot_value: null,
    siblings: [],
    result_count: 0,
    reason: "no_ip",
    searched_at: now.toISOString(),
  };
}

/**
 * Shape a urlscan search result set into the stored block. ALWAYS returns a
 * block (even with zero siblings) so the row crosses the
 * `attribution->'kit_siblings' IS NULL` predicate and is never re-searched
 * (the op-review "move the row across the consume predicate" rule). Excludes
 * the clone domain itself and dedups by domain.
 */
export function shapeKitSiblings(
  selfDomain: string,
  pivotIp: string,
  hits: UrlscanSearchHit[],
  now: Date = new Date(),
): KitSiblingsBlock {
  const self = selfDomain.toLowerCase();
  const seen = new Set<string>();
  const siblings: KitSiblingsBlock["siblings"] = [];
  for (const h of hits) {
    const domain = h.domain?.toLowerCase();
    if (!domain || domain === self || seen.has(domain)) continue;
    seen.add(domain);
    siblings.push({ domain, last_seen: h.lastSeen });
    if (siblings.length >= MAX_SIBLINGS) break;
  }
  return {
    pivot: "ip",
    pivot_value: pivotIp,
    siblings,
    result_count: hits.length,
    searched_at: now.toISOString(),
  };
}

/**
 * A Write Outcome plus the two reasons this loop stops short, both counted.
 *
 * Every candidate is accounted for:
 *
 *     attempted - written - failed - notReachedQuota - notReachedBudget = 0
 *
 * #1131 gave the loop a Write Outcome but returned `deadlineHit: false` with
 * `notReachedQuota` in a log line only, so a caller reading the shape saw a
 * gap of up to nine rows and no field explaining it — a silent drop wearing
 * the type that exists to prevent one. CONTEXT.md permits the gap only where
 * "the site says so", and a log line is not the shape a consumer reads.
 */
export interface KitPivotOutcome extends WriteOutcome {
  /** Rows abandoned on a urlscan 429. Quota is not evidence about a row. */
  notReachedQuota: number;
  /** Rows the wall-clock budget never got to. */
  notReachedBudget: number;
}

export const NO_KIT_PIVOTS: Readonly<KitPivotOutcome> = Object.freeze({
  attempted: 0,
  written: 0,
  failed: 0,
  deadlineHit: false,
  notReachedQuota: 0,
  notReachedBudget: 0,
});

/** The subset of a clone alert the pivot loop reads. */
export interface KitPivotRow {
  id: number;
  candidate_domain: string;
  urlscan_evidence: { server?: { ip?: string | null } } | null;
  attribution: Record<string, unknown> | null;
}

/**
 * Decide what happens to each kit-pivot candidate, and account for all of them.
 *
 * EXTRACTED FROM THE STEP so the accounting can be TESTED BY CALLING IT rather
 * than grepped. The four outcomes it distinguishes — written, failed,
 * abandoned to quota, never reached — each have a different operational
 * meaning, and until #1136 none of them were assertable: the logic lived
 * inside an Inngest handler with a live Supabase client and a live urlscan
 * call. docs/agents/defect-shapes.md, shape N: "where the fix is a decision,
 * extract it as a pure function so the test has something to call".
 *
 * I/O is injected. `search` and `write` are the only two things this needs
 * from the outside world, and the caller owns both. `search` receives the ROW
 * as well as the ip so the caller can attribute a failure to an alert id: the
 * extraction first passed only the ip, which silently dropped the per-row
 * `kit-pivot search failed` warn the inline loop used to emit and left a run
 * reporting `failed: 7` with no ids and no error kinds to chase.
 *
 * SEQUENTIAL ON PURPOSE — do not parallelise. A 429 must abandon the REST of
 * the batch, and that semantic only holds if rows are visited in order
 * (docs/ops/inngest-slot-budget.md:199-201). A 429 is quota exhaustion, not
 * evidence about the row, so it is counted as never-reached rather than
 * failed; a transient error IS a failure of this run.
 */
export async function runKitPivots(args: {
  rows: readonly KitPivotRow[];
  budget: BudgetClock;
  search: (ip: string, row: KitPivotRow) => Promise<UrlscanSearchOutcome>;
  write: (
    row: KitPivotRow,
    block: KitSiblingsBlock,
  ) => Promise<{ ok: boolean }>;
  now?: () => Date;
}): Promise<KitPivotOutcome> {
  const { rows, budget, search, write } = args;
  const now = args.now ?? (() => new Date());

  let written = 0;
  let failed = 0;
  let notReachedQuota = 0;
  let notReachedBudget = 0;

  for (const [i, row] of rows.entries()) {
    // Checked per row: one iteration can cost a full urlscan abort, so a
    // wave-level check would overshoot by a row's worst case. A row skipped
    // here keeps kit_siblings NULL and is selected again tomorrow.
    if (budget.expired()) {
      notReachedBudget = rows.length - i;
      break;
    }

    const ip = row.urlscan_evidence?.server?.ip ?? null;
    if (!ip) {
      // No IP to pivot on — write a sentinel so the row crosses the
      // kit_siblings-IS-NULL predicate and isn't re-selected forever (the
      // op-review "cross the predicate you filter on" rule). Costs no search.
      const res = await write(row, noIpKitSiblings(now()));
      if (res.ok) written += 1;
      else failed += 1;
      continue;
    }

    const outcome = await search(ip, row);
    if (!outcome.ok) {
      if (outcome.error === "rate_limited") {
        notReachedQuota = rows.length - i;
        break;
      }
      failed += 1;
      continue;
    }

    const res = await write(
      row,
      shapeKitSiblings(row.candidate_domain, ip, outcome.results, now()),
    );
    if (res.ok) written += 1;
    else failed += 1;
  }

  return {
    attempted: rows.length,
    written,
    failed,
    notReachedQuota,
    notReachedBudget,
    deadlineHit: notReachedBudget > 0,
  };
}
