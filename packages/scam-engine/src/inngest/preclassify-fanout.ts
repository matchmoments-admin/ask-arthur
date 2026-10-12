// Pre-classifier fan-out — the daily NRD ingest's hand-off to the
// pre-classifier Lane (`shopfront-clone-haiku-preclassify`; Jev primary per
// ADR-0026, the function id is historical).
//
// One Interface: `fanOutPreclassify(sb, send)` reads the worklist, sends one
// event per alert, measures the worklist's demand, and returns the fields the
// NRD ingest writes onto its Outcome Row. It never throws — the ingest has
// already written the day's alerts, and a fan-out failure must be recorded
// (`preclassify_errored`), not fail the run.
//
// #1300 (v345). Before this module the fan-out:
//   - ignored the selector's `error` (`const { data } = await sb.rpc(…)`), so
//     a broken RPC read as "nothing to classify";
//   - returned { fanned_out, errored } from its step and nothing read it —
//     the Outcome Row was written BEFORE the fan-out;
//   - asked for 50 a day with no record of when 50 bound (it did on
//     2026-10-06: 53 due, 3 waited a day).

import { CLONE_WATCH_PRECLASSIFY_REQUESTED_EVENT } from "./events";

/**
 * Alerts handed to the pre-classifier per daily run.
 *
 * Sized to measured demand (prod, 2026-10-13, last 90 days of NRD alerts):
 * p50 31/day, p95 47.8, max 70 (2026-07-23). 100 is 1.4x the largest day and
 * equals the selector's hard ceiling (v159/v345 `LEAST(p_limit, 100)` — pinned
 * by preclassifyWorklistSql.test.ts). Cost at the full cap: Jev $0.000048 per
 * classification → $0.0048/day; the Haiku rollback $0.002478 → $0.25/day. The
 * shared `shopfront_clone_outreach` brake is $5/day. Inngest: 100 events = 20
 * batches of 5 at concurrency 1.
 */
export const PRECLASSIFY_FANOUT_CAP = 100;

export interface PreclassifyFanOutOutcome {
  /** Events sent this run. */
  preclassify_fanned_out: number;
  /** The selector, the coverage read or the send failed. */
  preclassify_errored: boolean;
  /** Why it errored ("list: …" / "send: …"). */
  preclassify_error?: string;
  /** The per-run cap this run asked for. */
  preclassify_cap: number;
  /** Demand exceeded the cap: alerts were left for tomorrow. */
  preclassify_cap_reached: boolean;
  /** Worklist size before its LIMIT. null = the coverage read failed. */
  preclassify_due_total: number | null;
  /** Unclassified alerts given up after 3 failed days, inside the horizon. */
  preclassify_gave_up: number | null;
  /** …of which given up in the last 24 h. */
  preclassify_gave_up_24h: number | null;
  /** Unclassified alerts past the 14-day horizon, lifetime (0 on 2026-10-13). */
  preclassify_aged_out: number | null;
}

interface WorklistRow {
  id: number;
  inferred_target_domain: string;
  candidate_domain: string;
  candidate_url: string;
}

interface CoverageRow {
  due_total: number | string;
  gave_up_total: number | string;
  gave_up_24h: number | string;
  aged_out_total: number | string;
}

/** The slice of a Supabase client this module uses (`.rpc()` is untyped
 *  app-wide — createServiceClient omits the Database generic). */
export interface FanOutDb {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type SendEvents = (
  events: Array<{ name: string; id: string; data: Record<string, unknown> }>,
) => Promise<unknown>;

const num = (v: number | string | undefined): number | null =>
  v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v);

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).slice(0, 300);

export async function fanOutPreclassify(
  sb: FanOutDb,
  send: SendEvents,
  fanDate: string,
  cap: number = PRECLASSIFY_FANOUT_CAP,
): Promise<PreclassifyFanOutOutcome> {
  const out: PreclassifyFanOutOutcome = {
    preclassify_fanned_out: 0,
    preclassify_errored: false,
    preclassify_cap: cap,
    preclassify_cap_reached: false,
    preclassify_due_total: null,
    preclassify_gave_up: null,
    preclassify_gave_up_24h: null,
    preclassify_aged_out: null,
  };
  const fail = (why: string) => {
    out.preclassify_errored = true;
    out.preclassify_error = out.preclassify_error
      ? `${out.preclassify_error}; ${why}`
      : why;
  };

  // Coverage first: it is the demand the cap is judged against, and it is
  // read whether or not the worklist then fails.
  try {
    const { data, error } = await sb.rpc("clone_watch_preclassify_coverage");
    const row = (data as CoverageRow[] | null)?.[0];
    if (error || !row) fail(`coverage: ${error?.message ?? "no row"}`);
    else {
      out.preclassify_due_total = num(row.due_total);
      out.preclassify_gave_up = num(row.gave_up_total);
      out.preclassify_gave_up_24h = num(row.gave_up_24h);
      out.preclassify_aged_out = num(row.aged_out_total);
    }
  } catch (err) {
    fail(`coverage: ${message(err)}`);
  }

  let rows: WorklistRow[];
  try {
    const { data, error } = await sb.rpc(
      "list_clone_alerts_pending_preclassify",
      { p_limit: cap },
    );
    if (error) {
      fail(`list: ${error.message}`);
      return out;
    }
    rows = (data as WorklistRow[] | null) ?? [];
  } catch (err) {
    fail(`list: ${message(err)}`);
    return out;
  }

  out.preclassify_cap_reached =
    out.preclassify_due_total !== null
      ? out.preclassify_due_total > cap
      : rows.length >= cap;
  if (rows.length === 0) return out;

  // The run date in the event id makes a still-pending alert re-fan with a
  // FRESH id each day (a bare id was deduped forever — 2026-05-29). The
  // selector excludes classified and given-up alerts.
  const events = rows.map((r) => ({
    name: CLONE_WATCH_PRECLASSIFY_REQUESTED_EVENT,
    id: `clone-watch-preclassify:${r.id}:${fanDate}`,
    data: {
      alertId: r.id,
      brand: r.inferred_target_domain,
      candidateDomain: r.candidate_domain,
      candidateUrl: r.candidate_url,
    },
  }));
  try {
    await send(events);
    out.preclassify_fanned_out = events.length;
  } catch (err) {
    fail(`send: ${message(err)}`);
  }
  return out;
}
