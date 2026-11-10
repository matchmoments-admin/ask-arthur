/**
 * Clone Triage — the ONE readable statement of the second state machine on
 * `shopfront_clone_alerts`: `triage_status` and its `triage_source`.
 *
 * `lifecycle.ts` is the enforcement machine (what the vendor and our scans
 * observed). Triage is the operator's: is this alert a clone, and what was
 * done about it. It had four writers and no written spec until #1301, so the
 * rules lived in four bodies:
 *
 *   set_clone_alert_triage       (v335)  the admin triage route — a human
 *   auto-park                    (auto-park.ts)  pre-classifier batches
 *   persist_clone_alert_urlscan  (v346)  a scan that reads parked/unresolved
 *   merge_clone_alert_submission (v338)  the Netcraft auto Lane's submission
 *
 * WHAT `triage_source` MEANS: who set the CURRENT `triage_status` — 'human'
 * or 'machine'. NULL means the status was written before v335 (or never set
 * by a stamping writer) and readers fall back to the note marker
 * (`verdictOrigin` below; the same rule `clone_watch_readiness_inputs`
 * applies in SQL). A writer that leaves the status unchanged leaves the
 * source alone. `triage_at` is stamped only by the human writer and
 * auto-park; the scan and the Netcraft writer never touch it, so on their
 * rows `triage_at` dates the previous writer — the source is what tells them
 * apart.
 *
 * HOW IT IS KEPT HONEST
 *   1. `shopfront_clone_alerts_triage_status_check` (v143): the five statuses.
 *   2. `shopfront_clone_alerts_triage_source_check` (v335): the two sources.
 *   3. `shopfront_clone_alerts_machine_triage_status_check` (v346): a
 *      machine row is `needs_investigation` or `tp_actioned` — machines park
 *      and action, a verdict (`tp_confirmed`, `fp`) or a reset (`pending`) is
 *      human. `MACHINE_STATUSES` mirrors it; cloneWatchTriage.test.ts pins
 *      the two equal and checks every machine writer against it.
 *   4. Each writer's from-states are enforced inside the writer (persist and
 *      merge skip decided rows, auto-park updates only `pending`) — a CHECK
 *      cannot see the old row. `TRIAGE_WRITERS` states them; the tests read
 *      the SQL and TS bodies to keep them matched.
 *
 * Zero imports by design, as lifecycle.ts.
 */

export const TRIAGE_STATUSES = [
  "pending",
  "needs_investigation",
  "tp_confirmed",
  "tp_actioned",
  "fp",
] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export const TRIAGE_SOURCES = ["human", "machine"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

/** What each status means. */
export const TRIAGE_MEANING: Record<TriageStatus, string> = {
  pending: "awaiting an operator (the column default)",
  needs_investigation:
    "parked: out of the queue, reversible — a deferral, not a verdict",
  tp_confirmed: "a human confirmed it is a clone",
  tp_actioned:
    "reported to a vendor (Netcraft) — a human's confirmed clone actioned, or a machine's submission",
  fp: "a human ruled it not a clone; suppresses it from reporting and public pages",
};

/** Statuses an operator has decided. The scan and Netcraft writers never
 *  move a row out of one of these (except tp_confirmed → tp_actioned, which
 *  executes the decision). */
export const DECIDED_STATUSES: ReadonlySet<string> = new Set([
  "tp_confirmed",
  "tp_actioned",
  "fp",
]);

/** Statuses a machine may set — mirrors the v346 CHECK. */
export const MACHINE_STATUSES = ["needs_investigation", "tp_actioned"] as const;

export type TriageWriterId =
  | "human"
  | "auto_park"
  | "persist_urlscan"
  | "merge_submission";

export interface TriageWriter {
  /** The SQL function or TS module that performs the write. */
  where: string;
  source: TriageSource;
  /** Statuses this writer may set. */
  to: readonly TriageStatus[];
  /** Statuses it may move a row FROM (null = a row with no status). */
  from: readonly (TriageStatus | null)[];
  stampsTriageAt: boolean;
  /** What it does to triage_source when it changes the status. */
  stamps: string;
}

const ANY_FROM: readonly (TriageStatus | null)[] = [...TRIAGE_STATUSES, null];

export const TRIAGE_WRITERS: Record<TriageWriterId, TriageWriter> = {
  // The operator has full authority, including reset to pending and un-park.
  human: {
    where: "set_clone_alert_triage (v335) via /api/admin/clone-watch/triage",
    source: "human",
    to: TRIAGE_STATUSES,
    from: ANY_FROM,
    stampsTriageAt: true,
    stamps: "p_source (the route passes 'human'); triage_by, triage_at = now()",
  },
  // Weak-signal not-a-clone tail leaves the queue. UPDATE ... WHERE
  // triage_status = 'pending'.
  auto_park: {
    where: "apps/web/lib/clone-watch/auto-park.ts",
    source: "machine",
    to: ["needs_investigation"],
    from: ["pending"],
    stampsTriageAt: true,
    stamps: "'machine', triage_at, the auto-park note",
  },
  // A scan that reads parked_for_sale or unresolved parks the row, unless a
  // human has decided it.
  persist_urlscan: {
    where: "persist_clone_alert_urlscan (v346) via urlscan-retrieve",
    source: "machine",
    to: ["needs_investigation"],
    from: ["pending", "needs_investigation", null],
    stampsTriageAt: false,
    stamps: "'machine' on a change (v346)",
  },
  // The Netcraft auto Lane's submission. The worklist excludes fp, so fp is
  // not a legal from-state even though the SQL body alone would accept it.
  merge_submission: {
    where: "merge_clone_alert_submission (v338) via recordAutoSubmission",
    source: "machine",
    to: ["tp_actioned"],
    from: [
      "pending",
      "needs_investigation",
      "tp_confirmed",
      "tp_actioned",
      null,
    ],
    stampsTriageAt: false,
    stamps:
      "'machine' on a change, except tp_confirmed → tp_actioned keeps the origin",
  },
};

/** May `writer` move a row from `from` to `to`? An unchanged status is a
 *  no-op and always legal. */
export function canWriteTriage(
  writer: TriageWriterId,
  from: string | null,
  to: string,
): boolean {
  if (from === to) return true;
  const w = TRIAGE_WRITERS[writer];
  return (
    (w.from as readonly (string | null)[]).includes(from) &&
    (w.to as readonly string[]).includes(to)
  );
}

/**
 * The triage_source a write leaves behind — the rule the SQL writers
 * implement, in one place. `source` is the human writer's p_source.
 */
export function sourceAfterWrite(
  writer: TriageWriterId,
  from: string | null,
  to: string,
  priorSource: TriageSource | null,
  source: TriageSource = "human",
): TriageSource | null {
  if (from === to) return priorSource;
  if (writer === "human") return source;
  if (
    writer === "merge_submission" &&
    from === "tp_confirmed" &&
    to === "tp_actioned"
  ) {
    return priorSource;
  }
  return "machine";
}

/** Rows written before v335 carry no source; their note says who wrote
 *  them. Mirrors clone_watch_readiness_inputs (v335). */
export const MACHINE_NOTE_PREFIXES = [
  "auto-park",
  "auto-triage",
  "[matcher-v4-audit]",
] as const;

/** Who set this row's current status, as the readiness scorecard judges it. */
export function verdictOrigin(row: {
  triage_source: string | null;
  triage_notes: string | null;
}): TriageSource {
  if (row.triage_source === "human" || row.triage_source === "machine")
    return row.triage_source;
  const note = row.triage_notes ?? "";
  return MACHINE_NOTE_PREFIXES.some((p) => note.startsWith(p))
    ? "machine"
    : "human";
}
