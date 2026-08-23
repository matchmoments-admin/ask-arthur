/**
 * Clone Lifecycle — the ONE readable statement of the enforcement state
 * machine for `shopfront_clone_alerts.lifecycle_state`.
 *
 * WHY THIS FILE EXISTS. Before it, answering "can a weaponised alert go back
 * to monitoring?" required reading five independent encodings of the legal
 * transitions, in four different idioms:
 *
 *   advance_clone_lifecycle        (v199) — nested IF, validates the TARGET
 *                                          state only, not the (from,to) pair
 *   apply_clone_urlscan_verdict    (v200) — its own edge table as nested IF
 *   apply_netcraft_reconcile       (v249) — a CASE inside a bare UPDATE, with
 *                                          its own no-downgrade set
 *   mark_stale_clone_alerts_dormant(v285/286) — a raw UPDATE
 *   NO_DOWNGRADE_STATES / classifyByUrlState (netcraft-urls.ts) — a TS mirror
 *                                          of v249, existing only because SQL
 *                                          functions have no unit-test seam
 *
 * That smearing is not theoretical: v285 added a fourth terminal writer
 * WITHOUT the `alert_state` sync rule that v199's header names as the entire
 * reason the guarded RPC exists, and nothing caught it but a hand-written prod
 * cross-tab (v286). There was no CHECK, no trigger and no test.
 *
 * WHAT THIS FILE IS — AND IS NOT. It is the SPEC: the states, the legal edges,
 * the terminal set, and the coarse-disposition mapping, in one place a human
 * or an agent can read in one sitting. It is NOT yet the enforcement point —
 * the SQL guards above still execute the transitions. Two things keep the spec
 * honest rather than decorative:
 *
 *   1. `clone_alert_terminal_state_sync` (v288) — a table CHECK that makes the
 *      v285 bug class IMPOSSIBLE rather than merely discouraged. A writer that
 *      sets a terminal `lifecycle_state` without the matching `alert_state`
 *      now fails its write instead of silently inflating
 *      `aggregate_open_clone_alerts_by_brand` on /admin/brand-register.
 *   2. `cloneWatchLifecycle.test.ts` — property tests over the edge set.
 *
 * Step 2 (deliberately NOT done in the same change as the guardrail, because
 * the enforcement crons run daily and a bug here breaks live takedown
 * reporting) is to route the four SQL writers through one set-based
 * transition RPC that consults this same edge set.
 *
 * Zero imports by design — importable from server components, Inngest
 * closures, the caption CLI and email templates without dragging in the data
 * layer. Same discipline as `outcome-copy.ts`.
 */

export const CLONE_LIFECYCLE_STATES = [
  "detected",
  "monitoring",
  "weaponised",
  "reported",
  "declined",
  "taken_down",
  "dormant",
] as const;

export type CloneLifecycleState = (typeof CLONE_LIFECYCLE_STATES)[number];

/**
 * States nothing moves out of. `apply_netcraft_reconcile` (v249) additionally
 * refuses to downgrade OFF `weaponised` — but weaponised is not terminal,
 * because `weaponised -> taken_down` is exactly the outcome the whole
 * enforcement path exists to produce.
 */
export const TERMINAL_STATES = ["taken_down", "dormant"] as const;

/**
 * The coarse operator disposition (`alert_state`) that MUST accompany each
 * terminal lifecycle state. This is the rule v199 introduced, that three SQL
 * writers each re-implement by hand, and that v285 omitted.
 *
 * Readers that would be wrong if this drifted, all verified:
 *   - `aggregate_open_clone_alerts_by_brand` (v198) — WHERE alert_state='open',
 *     no date or lifecycle filter; feeds /admin/brand-register open_count
 *   - the public /clone-watch page — .eq("alert_state","open")
 */
export const TERMINAL_ALERT_STATE: Record<
  (typeof TERMINAL_STATES)[number],
  "taken_down" | "expired"
> = {
  taken_down: "taken_down",
  dormant: "expired",
};

export function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * The coarse disposition a terminal state requires, or null for a live state
 * (which leaves `alert_state` alone — v199's contract is terminal-only sync).
 */
export function terminalAlertState(state: string): "taken_down" | "expired" | null {
  return isTerminal(state)
    ? TERMINAL_ALERT_STATE[state as (typeof TERMINAL_STATES)[number]]
    : null;
}

/** What causes a transition — useful for reading the table, not enforced. */
export type LifecycleTrigger =
  | "urlscan_verdict"
  | "netcraft_submit"
  | "netcraft_reconcile"
  | "stale_sweep";

export interface LifecycleEdge {
  from: CloneLifecycleState;
  to: CloneLifecycleState;
  trigger: LifecycleTrigger;
  /** The observation that justifies the move, in the vendor's own words. */
  because: string;
}

/**
 * Every legal transition, reconstructed from the four SQL guards. Read this
 * instead of the migrations.
 *
 * The two rules worth stating in prose because they are what the guards spend
 * their complexity on:
 *   - NO DOWNGRADE: once `weaponised`, the only exit is `taken_down`. A
 *     later benign vendor verdict must NOT move it back to declined —
 *     `apply_netcraft_reconcile` enforces this and `classifyByUrlState`
 *     mirrors it.
 *   - `declined -> weaponised` is the money transition: the vendor graded it
 *     "no threat", we later observed live phishing. It is the entire premise
 *     of the recheck loop and of the false-negative escalation lane.
 */
export const LIFECYCLE_EDGES: readonly LifecycleEdge[] = [
  // urlscan verdicts (v200)
  { from: "detected", to: "monitoring", trigger: "urlscan_verdict", because: "parked, neutral or unresolved at first scan" },
  { from: "detected", to: "weaponised", trigger: "urlscan_verdict", because: "phishing at first scan" },
  { from: "monitoring", to: "weaponised", trigger: "urlscan_verdict", because: "flipped to phishing on a recheck" },
  { from: "declined", to: "weaponised", trigger: "urlscan_verdict", because: "vendor graded no-threat, then it weaponised" },
  { from: "reported", to: "weaponised", trigger: "urlscan_verdict", because: "weaponised while awaiting a vendor verdict" },

  // manual per-candidate Netcraft submission (v199 via clone-watch-submit-netcraft)
  { from: "detected", to: "reported", trigger: "netcraft_submit", because: "operator triaged and submitted" },
  { from: "monitoring", to: "reported", trigger: "netcraft_submit", because: "operator triaged and submitted" },

  // Netcraft per-URL reconcile (v249)
  { from: "detected", to: "declined", trigger: "netcraft_reconcile", because: "vendor returned no threats / unavailable" },
  { from: "monitoring", to: "declined", trigger: "netcraft_reconcile", because: "vendor returned no threats / unavailable" },
  { from: "reported", to: "declined", trigger: "netcraft_reconcile", because: "vendor returned no threats / unavailable" },
  { from: "detected", to: "taken_down", trigger: "netcraft_reconcile", because: "vendor actioned it" },
  { from: "monitoring", to: "taken_down", trigger: "netcraft_reconcile", because: "vendor actioned it" },
  { from: "reported", to: "taken_down", trigger: "netcraft_reconcile", because: "vendor actioned it" },
  { from: "declined", to: "taken_down", trigger: "netcraft_reconcile", because: "vendor actioned it after a re-file" },
  { from: "weaponised", to: "taken_down", trigger: "netcraft_reconcile", because: "vendor actioned live phishing — the outcome we want" },

  // aged out without ever being scanned (v285/v286)
  { from: "detected", to: "dormant", trigger: "stale_sweep", because: "passed the 90-day scan horizon unscanned" },
];

/** The question that used to take five file reads. */
export function canTransition(from: string, to: string): boolean {
  if (from === to) return true; // a no-op write is always legal
  return LIFECYCLE_EDGES.some((e) => e.from === from && e.to === to);
}

/** Every state reachable from `from`, for rendering and for tests. */
export function nextStates(from: string): CloneLifecycleState[] {
  return LIFECYCLE_EDGES.filter((e) => e.from === from).map((e) => e.to);
}
