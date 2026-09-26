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
    brake: "clone_netcraft_auto",
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
  "shopfront-clone-haiku-preclassify": {
    feature: "shopfront_clone_preclassify",
    provider: "internal",
    operation: "batch",
    brake: "shopfront_clone_outreach",
  },
  "clone-watch-report-summary": {
    feature: "clone_watch_report_summary",
    provider: "internal",
    operation: "monthly_snapshot",
  },
  "clone-watch-month-end-liveness": {
    feature: "clone_watch_month_end_liveness",
    provider: "internal",
    operation: "stock_snapshot",
  },
  "report-brand-stewardship": {
    feature: "brand_stewardship",
    provider: "internal",
    operation: "monthly_prepare",
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
    /** Proved no-host by the DNS precheck — no urlscan call (2026-09-24);
     *  absent on quiet runs and rows written before it existed. */
    dns_skipped?: number;
    /** A and AAAA both SERVFAIL at the DNS precheck — no urlscan call, stamped
     *  like dns_skipped (2026-09-25); absent on older rows. */
    dns_servfail?: number;
    /** urlscan 429s — our quota, not a failure; rows left unstamped to retry
     *  first. Absent on quiet runs and rows before 2026-09-24 (when this lane
     *  still folded 429s into submit_failed). */
    rate_limited?: number;
    /** Never-scanned dead rows the v326 worklist holds out (no uuid, 400
     *  status, failure streak >= 8). null = the count failed; absent before
     *  2026-09-26. */
    dormant_dead?: number | null;
    /** Candidates the wall-clock budget stopped before; they re-present. */
    unreached?: number;
    /** #1231 — the per-run cap, and whether this run was held by it. Absent
     *  on quiet runs and rows written before 2026-09-26. */
    cap?: number;
    cap_reached?: boolean;
    /** Rows due in total (v328 window count). null = not returned. */
    due_total?: number | null;
  };
  "shopfront-clone-urlscan-submit": {
    reason?: "no_gated_candidates";
    submitted: number;
    submit_failed: number;
    /** Proved no-host by the DNS precheck — no urlscan call (2026-09-24);
     *  absent on quiet runs and rows written before it existed. */
    dns_skipped?: number;
    /** A and AAAA both SERVFAIL at the DNS precheck — no urlscan call, stamped
     *  like dns_skipped (2026-09-25); absent on older rows. */
    dns_servfail?: number;
    rate_limited: number;
    dormant_retired: number;
    /** Candidates the wall-clock budget stopped before (2026-09-24). */
    unreached?: number;
    /** #1231 — the per-run cap, and whether this run was held by it. Absent
     *  on quiet runs and rows written before 2026-09-26. */
    cap?: number;
    cap_reached?: boolean;
    /** Not-a-clone audit (#1238, v330). Kept OUT of `units`, `submitted` and
     *  `dns_*` on purpose: those describe the regular gated batch, which is
     *  what the silent-zero shape judges; the audit tally is separate. All
     *  absent before v330. The FN rate itself is
     *  clone_watch_not_a_clone_audit_summary(), not a per-run field. */
    /** Sample rows the weekly draw marked on this run (0 on six days of seven,
     *  and while the weekly flag is off). */
    audit_drawn?: number;
    /** Misses surfaced this run — each also shipped as an always-ship Axiom
     *  warn, and stamped miss_warned_at only after this row is written. */
    audit_misses?: number;
    /** The alert ids of those misses: the durable record of what was surfaced. */
    audit_miss_ids?: number[];
    /** Audit samples in this run's batch (≤ AUDIT_SLOTS_PER_RUN). */
    audit_offered?: number;
    /** Samples tried (an attempt recorded; excludes 429s and unreached). */
    audit_attempted?: number;
    audit_submitted?: number;
    /** no_host + SERVFAIL at the DNS precheck. */
    audit_dns_skipped?: number;
    audit_submit_failed?: number;
    audit_rate_limited?: number;
  };
  "shopfront-clone-urlscan-retrieve": {
    classified: number;
    still_pending: number;
    /** Rows the wall-clock budget left for the next tick (#1231). null =
     *  replayed from before the field existed. */
    unreached?: number | null;
    /** #1231 — the per-run cap, and whether this run was held by it. Absent
     *  on quiet runs and rows written before 2026-09-26. */
    cap?: number;
    cap_reached?: boolean;
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
    /** #1148 — uuids Netcraft was still processing: deferred 24 h, never
     *  POSTed or drained. Absent on quiet runs and rows before 2026-09-26. */
    processingDeferred?: number;
  };
  "shopfront-clone-netcraft-auto/resubmit": {
    reason?: "none_pending_or_cap" | "all_dead" | "bulk_submit_failed";
    candidates: number;
    marked: number;
    deferred: number;
    dead: number;
    /** #1231 — the per-run cap, and whether this run was held by it. Absent
     *  on quiet runs and rows written before 2026-09-26. */
    cap?: number;
    cap_reached?: boolean;
    /** v329 — weaponised rows the worklist now EXCLUDES because Netcraft
     *  answered "Already reported and rejected." (routed to the operator
     *  instead). null = the count failed; absent before v329. */
    rejected_excluded?: number | null;
  };
  "shopfront-clone-netcraft-reconcile": {
    reason?: "nothing_pending";
    uuids: number;
    /** #1231 — the per-run cap, and whether this run was held by it. Absent
     *  on quiet runs and rows written before 2026-09-26. */
    cap?: number;
    cap_reached?: boolean;
    // ── v329 (#1234) weaponised outcome observation. Every key the lane writes
    // is typed here, so laneHealth's silent-zero predicate can only read keys
    // that exist. All absent on rows before 2026-09-26.
    /** Rows read by the DNS sweep. null = the sweep's RPC failed (see
     *  liveness_error). */
    liveness_checked?: number | null;
    /** Why the sweep did nothing ("list: …" / "record: …"). */
    liveness_error?: string;
    /** Rows due a read (weaponised daily + offline dormant weekly), counted
     *  before the per-run LIMIT. */
    liveness_due?: number;
    /** The name exists. */
    liveness_present?: number;
    /** NXDOMAIN, not yet confirmed (first read, or a second inside 12 h). */
    liveness_gone_unconfirmed?: number;
    /** The resolver proved nothing. */
    liveness_inconclusive?: number;
    /** Due rows the in-step budget did not reach; they lead the next run. */
    liveness_unreached?: number;
    /** Second NXDOMAIN >= 12 h after the first: weaponised → dormant. */
    offline_confirmed?: number;
    /** An offline (dormant) clone resolved again: dormant → weaponised. */
    re_emerged?: number;
    /** No-threat-on-phishing alerts paged to the operator and stamped
     *  submitted_to.vendor_gap this run. null = list or mark failed. */
    vendor_gap_escalated?: number | null;
    /** The operator page was delivered this run. */
    vendor_gap_paged?: boolean;
    /** Listed but not paged (send failed / no Telegram config); they re-list. */
    vendor_gap_unpaged?: number;
    /** Why the escalation did not complete ("list: …" / "page: …" / "mark: …"). */
    vendor_gap_error?: string;
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
    /** Worklist rows that now carry a dossier — this attempt's writes plus
     *  rows an earlier attempt of the same step wrote (#1229). */
    enriched: number;
    /** #1229 — the folded enrich batch. Absent on rows before the fold. */
    already_enriched?: number;
    lookup_failed?: number;
    write_failed?: number;
    not_reached_budget?: number;
    /** #1231 — the per-run cap, and whether this run was held by it. Absent
     *  on quiet runs and rows written before 2026-09-26. */
    cap?: number;
    cap_reached?: boolean;
    /** Rows eligible in the 35-day window (head count). null = count failed. */
    backlog?: number | null;
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
  "shopfront-clone-haiku-preclassify": {
    reason?: "braked";
    alerts: number;
    classified: number;
    failed: number;
  };
  "clone-watch-report-summary": {
    reason?: "frozen" | "no_clones";
    total: number;
    brand_rows: number;
    /** v325 — false = no month-end snapshot, active_stock_eom NULL. Absent on
     *  frozen / no-clone runs (nothing was written). */
    stock_measured?: boolean;
    /** Why: measured | no_run | partial | read_error (v325). */
    stock_state?: "measured" | "no_run" | "partial" | "read_error";
  };
  "clone-watch-month-end-liveness": {
    reason?: "no_stock";
    /** Active-stock alerts the snapshot had to cover. */
    stock: number;
    /** Rows written with a real DNS verdict (excludes `unverified`). */
    probed: number;
    /** Rows written as `unverified` — resolver proved nothing, or never
     *  reached (the latter also counted in `not_probed`). */
    unverified: number;
    /** Rows written as `unverified` because the run ran out of chunks. */
    not_probed: number;
  };
  "report-brand-stewardship": {
    reason?: "no_activity";
    prepared: number;
    failed: number;
    clone_brands: number;
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
