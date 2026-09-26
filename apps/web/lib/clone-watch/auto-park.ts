// Clone-watch AUTO-PARK — the weak not-a-clone tail leaves the human queue.
//
// The daily NRD sweep produces a long tail of `pending` alerts the
// pre-classifier judges `is_clone=false`. Those whose primary signal is the
// noisy weak class (NOT confusable / levenshtein) are lexical-matcher false
// positives; left alone they sit in "awaiting triage" forever. Parking sets
// `triage_status='needs_investigation'` — the same reversible bucket as the
// admin UI's "Park" button, no event, no fan-out.
//
// THE CONSERVATIVE CUT (unchanged from clone-watch-auto-triage, where this
// lived until #1230): is_clone=false rows that DO carry a strong
// brand-similarity signal are KEPT for a human, because that is where the
// pre-classifier's rare false negatives concentrated (~1% of historical
// confirmed clones were is_clone=false, nearly all via the weak class —
// measured on Haiku's boolean; #1238 measures the Jev-era FN rate).
//
// WHY it moved (#1230): auto-triage's confirm half confirmed 0 alerts ever,
// and its park half read `.limit(200)` of an UNORDERED pending set — with
// 938 pending NRD rows (2026-09-26) the 48 eligible ones were outside the
// 200 it saw, so it parked 0 on 09-24 and 09-25 while reporting ok. Parking
// per pre-classifier batch, on the alerts that batch just judged, has no
// worklist to starve.
//
// Two callers, one write path: the pre-classifier batch
// (clone-watch-haiku-preclassify.ts) and the one-off backfill
// (scripts/backfill-auto-park.ts).

import type { createServiceClient } from "@askarthur/supabase/server";

import { primarySignalType } from "@/lib/clone-watch/weaponisation-risk";

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

/** Deliberate-deception signal classes a human must still see. */
const STRONG_SIGNALS: ReadonlySet<string> = new Set(["confusable", "levenshtein"]);

/** Persisted on every parked row. The `auto-park:` prefix is what prod
 *  queries count on (`triage_notes LIKE 'auto-park:%'`) — keep it. Names the
 *  pre-classifier, not Haiku: since ADR-0026 the verdict is Jev's. */
export const AUTO_PARK_NOTE =
  "auto-park: pre-classifier is_clone=false + weak (non-confusable/levenshtein) signal — lexical-matcher FP, parked from the human queue (reversible)";

/** True when the alert's primary signal is confusable/levenshtein. Pure. */
export function hasStrongBrandSignal(signals: unknown): boolean {
  const t = primarySignalType(signals);
  return t !== null && STRONG_SIGNALS.has(t);
}

/** The conservative cut: not a clone AND no strong signal. Pure. */
export function isAutoParkEligible(isNotClone: boolean, signals: unknown): boolean {
  return isNotClone && !hasStrongBrandSignal(signals);
}

export interface AutoParkResult {
  /** Rows actually moved pending → needs_investigation. */
  parked: number;
  /** Set when a read or the update failed; nothing is thrown. */
  error: string | null;
}

/**
 * Park the eligible subset of `notCloneIds` — alerts the CALLER knows the
 * pre-classifier judged is_clone=false. Re-reads each row's signals and
 * requires `source='nrd'` and `triage_status='pending'` both in the read and
 * in the UPDATE's own WHERE, so an alert a human (or anything else) actioned
 * in between is never overwritten. One SELECT + one bulk UPDATE.
 *
 * Never throws: the pre-classifier is a hot path and a failed park must not
 * fail (and re-run) a batch of paid classifications.
 */
export async function autoParkNotClones(
  sb: Sb,
  notCloneIds: readonly number[],
  nowIso: string = new Date().toISOString(),
): Promise<AutoParkResult> {
  if (notCloneIds.length === 0) return { parked: 0, error: null };
  try {
    const { data: rows, error: readErr } = await sb
      .from("shopfront_clone_alerts")
      .select("id, signals")
      .in("id", [...notCloneIds])
      .eq("source", "nrd")
      .eq("triage_status", "pending");
    if (readErr) return { parked: 0, error: `read: ${readErr.message}` };

    const parkIds = ((rows ?? []) as Array<{ id: number; signals: unknown }>)
      .filter((r) => isAutoParkEligible(true, r.signals))
      .map((r) => r.id);
    if (parkIds.length === 0) return { parked: 0, error: null };

    const { data: updated, error: upErr } = await sb
      .from("shopfront_clone_alerts")
      .update({
        triage_status: "needs_investigation",
        triage_at: nowIso,
        triage_notes: AUTO_PARK_NOTE,
        // Verdict origin (v335, #1237): the readiness scorecard counts only
        // human verdicts, and the note is not a reliable discriminator — a
        // later human verdict keeps this note (set_clone_alert_triage
        // COALESCEs it). The human path stamps 'human' over this.
        triage_source: "machine",
      })
      .in("id", parkIds)
      .eq("triage_status", "pending")
      .select("id");
    if (upErr) return { parked: 0, error: `update: ${upErr.message}` };
    return { parked: (updated ?? []).length, error: null };
  } catch (err) {
    return {
      parked: 0,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    };
  }
}
