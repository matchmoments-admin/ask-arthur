// Lane Outcome — the one cost_telemetry row a clone-watch Lane writes per run.
//
// WHY this module exists: the silent-zero detector (apps/web/lib/laneHealth.ts,
// #1145) reads each Lane's per-run row and pages when the Lane ran-and-did-
// nothing or stopped writing. Before this module the write side lived in nine
// function files, each hand-assembling `{feature, provider, operation, units,
// metadata: {pool, rechecked, …}}`, and the read side hand-read the same keys.
// Rename `pool` on either side and the detector's `num()` read 0 — for
// `pool>0 ∧ rechecked=0` that is SILENT, the exact failure class the detector
// exists for. Here the roster (which row a Lane writes) and the outcome shape
// (which keys) are declared once; `recordLaneOutcome` is the only writer and
// laneHealth.ts types its predicates against `LaneOutcome`, so a misspelt key
// is a compile error on whichever side drifts. Deletion test: deleting this
// re-scatters eight (feature, provider, operation) triples and the key coupling
// across nine files — it concentrates, so it earns its keep.
//
// It lives in scam-engine because the NRD ingest Lane is in this package and
// apps/web depends on scam-engine, not the reverse (see cost-log.ts header).
//
// A Lane's Outcome Row is written EVERY run, including the quiet-day path
// (`reason` set, units 0) — that is what makes "no row" a real signal
// (#1166). Skip-paths (flag off, brake engaged, cooldown, no DB) deliberately
// write nothing: a disabled Lane SHOULD read as absent. ADR-0025 records why
// the ledger is cost_telemetry and not a new table.
//
// The (feature, provider, operation) triples are a contract with /admin/costs
// and with the recheck / issue cooldowns, which read "this feature's latest
// row" — never rename one here without grepping both.

import { logCost } from "./cost-log";

export interface LaneRowKey {
  feature: string;
  provider: string;
  operation: string;
  /** `feature_brakes.feature` for Lanes that have a kill-switch. */
  brake?: string;
}

/**
 * The roster: a Lane key → the row it writes. The key IS the Lane's Inngest
 * function id (CONTEXT.md "Lane"); a function that runs two independently
 * watched sub-lanes writes `<fnId>/<sub>`. apps/web/__tests__/laneRoster.test.ts
 * checks every key against the real function ids and every clone-watch
 * function against roster ∪ absence watches ∪ an explicit, reasoned exemption
 * list — so "not watched" is always a decision, never drift.
 */
export const LANES = {
  "shopfront-clone-lifecycle-recheck": {
    feature: "shopfront_clone_recheck",
    provider: "internal",
    operation: "recheck_batch",
    brake: "shopfront_clone_recheck",
  },
  "shopfront-clone-urlscan-submit": {
    feature: "shopfront_clone_urlscan",
    provider: "urlscan",
    operation: "submit_batch",
  },
  "shopfront-clone-urlscan-retrieve": {
    feature: "shopfront_clone_urlscan",
    provider: "urlscan",
    operation: "retrieve_batch",
  },
  "shopfront-clone-netcraft-issue": {
    feature: "shopfront_clone_netcraft_issue",
    provider: "netcraft",
    operation: "issue_report",
    brake: "clone_netcraft_issue",
  },
  "shopfront-clone-netcraft-auto/resubmit": {
    feature: "shopfront_clone_netcraft_resubmit",
    provider: "netcraft",
    operation: "resubmit_bulk",
    brake: "clone_netcraft_resubmit",
  },
  "shopfront-clone-netcraft-reconcile": {
    feature: "shopfront_clone_netcraft_reconcile",
    provider: "netcraft",
    operation: "lifecycle_reconcile",
  },
  "shopfront-nrd-daily-ingest": {
    feature: "shopfront_clone_watch",
    provider: "whoisds",
    operation: "nrd_daily_ingest",
  },
  "clone-watch-auto-triage": {
    feature: "shopfront_clone_auto_triage",
    provider: "diagnostic",
    operation: "run",
  },
  "shopfront-clone-feed-platform": {
    feature: "clone_watch_feed_entity",
    provider: "internal",
    operation: "feed_batch",
  },
  "shopfront-clone-netcraft-auto/auto": {
    feature: "shopfront_clone_netcraft_auto",
    provider: "netcraft",
    operation: "bulk_submit",
  },
  "clone-watch-enrich-attribution": {
    feature: "shopfront_clone_enrich",
    provider: "internal",
    operation: "enrich_batch",
    brake: "shopfront_clone_outreach",
  },
  "shopfront-clone-notify-brand-prepare": {
    feature: "shopfront_clone_notify_brand_prepare",
    provider: "telegram",
    operation: "summary_notification",
    brake: "shopfront_clone_outreach",
  },
  "shopfront-clone-reemergence-monitor": {
    feature: "clone_enforcement",
    provider: "internal",
    operation: "reemergence_batch",
  },
  "shopfront-clone-weekly-digest": {
    feature: "shopfront_clone_weekly_digest",
    provider: "telegram",
    operation: "weekly_digest_send",
  },
  "shopfront-clone-enforcement-execute": {
    feature: "clone_enforcement",
    provider: "internal",
    operation: "execute_batch",
    brake: "clone_enforcement",
  },
  "shopfront-clone-fp-cluster-digest": {
    feature: "shopfront_clone_fp_cluster_digest",
    provider: "telegram",
    operation: "weekly_digest",
  },
} as const satisfies Record<string, LaneRowKey>;

export type LaneId = keyof typeof LANES;

/**
 * One entry per Lane: the keys the Lane writes AND the detector reads.
 * `reason` is present only on a quiet run (units 0).
 *
 * Deliberately NO index signature here: `keyof` must stay the literal key
 * union so a predicate in laneHealth.ts cannot name a key that is not
 * written (an index signature widens `keyof` to `string` and that guarantee
 * silently disappears — verified by go-red). Lanes may log MORE than this —
 * `recordLaneOutcome` accepts extras — but only these keys are the contract.
 */
export interface LaneOutcome {
  "shopfront-clone-lifecycle-recheck": {
    reason?: "nothing_due";
    pool: number;
    rechecked: number;
    submitted: number;
    submit_failed: number;
  };
  "shopfront-clone-urlscan-submit": {
    reason?: "no_gated_candidates";
    submitted: number;
    submit_failed: number;
    rate_limited: number;
    dormant_retired: number;
  };
  "shopfront-clone-urlscan-retrieve": {
    classified: number;
    still_pending: number;
    /** null = the probe itself failed; 0 = genuinely none outstanding. */
    unnotified_weaponised: number | null;
  };
  "shopfront-clone-netcraft-issue": {
    reason?: "nothing_pending" | "daily_cap_reached";
    uuids: number;
    filed: number;
    permanentRejects: number;
    /** True when THIS run tripped the brake. Live brake state is feature_brakes. */
    braked: boolean;
  };
  "shopfront-clone-netcraft-auto/resubmit": {
    reason?: "none_pending_or_cap" | "all_dead" | "bulk_submit_failed";
    candidates: number;
    marked: number;
    deferred: number;
    dead: number;
  };
  "shopfront-clone-netcraft-reconcile": {
    reason?: "nothing_pending";
    uuids: number;
  };
  "shopfront-nrd-daily-ingest": {
    domains_scanned: number;
    total_chunks: number;
    failed_chunks: number;
  };
  "clone-watch-auto-triage": {
    /** Set when the confirm path found nothing eligible; the park path still ran. */
    reason?: "no_eligible";
    parked: number;
    eligible: number;
    confirmed: number;
    offline: number;
  };
  "shopfront-clone-feed-platform": {
    pool: number;
    written: number;
  };
  "shopfront-clone-netcraft-auto/auto": {
    reason?: "no_candidates_or_cap_reached" | "bulk_submit_failed";
    candidates: number;
    marked: number;
  };
  "clone-watch-enrich-attribution": {
    reason?: "nothing_pending";
    pending: number;
    enriched: number;
  };
  "shopfront-clone-notify-brand-prepare": {
    reason?: "no_unbatched_rows";
    batches_prepared: number;
    groups_failed: number;
  };
  "shopfront-clone-reemergence-monitor": {
    reason?: "nothing_due";
    checked: number;
    reemerged: number;
  };
  "shopfront-clone-weekly-digest": {
    candidates_total: number;
  };
  "shopfront-clone-enforcement-execute": {
    reason?: "nothing_pending";
    candidates: number;
    enqueued: number;
  };
  "shopfront-clone-fp-cluster-digest": {
    reason?: "no_fps_in_window" | "no_clusters_above_threshold";
    clusters: number;
    fp_count: number;
  };
}

/**
 * Write a Lane's Outcome Row. Awaited (never fire-and-forget): inside an
 * Inngest step a finish-cancelled run kills pending promises, and the
 * 2026-08-31 submit row vanished exactly that way (#1069). Best-effort like
 * every telemetry write — an insert failure is a warn, never a thrown error;
 * the detector then reads the Lane as absent, which is the loud direction.
 *
 * `units` is the row column the detector sees beside the metadata (the submit
 * predicate reads it: candidates offered, not submitted).
 */
export async function recordLaneOutcome<L extends LaneId>(
  lane: L,
  units: number,
  outcome: LaneOutcome[L] & Record<string, unknown>,
): Promise<void> {
  const row = LANES[lane];
  await logCost({
    feature: row.feature,
    provider: row.provider,
    operation: row.operation,
    units,
    estimatedCostUsd: 0,
    metadata: outcome,
  });
}

/**
 * A Lane's failure row: `<feature>_error`, $0, awaited. The ONE shape for
 * "this Lane failed" (was ≥3 hand-rolled shapes with `_error` / `-error`
 * suffixes the health digest's `%error%` matcher only half-caught).
 */
export async function recordLaneError<L extends LaneId>(
  lane: L,
  error: unknown,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const row = LANES[lane];
  await logCost({
    feature: `${row.feature}_error`,
    provider: row.provider,
    operation: row.operation,
    units: 0,
    estimatedCostUsd: 0,
    metadata: {
      ...metadata,
      lane,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    },
  });
}

/** The distinct `feature` values the roster writes — the detector's fetch filter. */
export const LANE_FEATURES: readonly string[] = Array.from(
  new Set(Object.values(LANES).map((l) => l.feature)),
);

/** The `feature_brakes.feature` keys the roster references. */
export const LANE_BRAKES: readonly string[] = Object.values(LANES).flatMap(
  (l) => ("brake" in l ? [l.brake] : []),
);
