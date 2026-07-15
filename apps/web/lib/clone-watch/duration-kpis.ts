import type { CloneAlertRow } from "@/app/api/inngest/functions/report-brand-stewardship";
import { canonicalRegistrar } from "@/lib/clone-watch/registrar-canonical";

/**
 * The vendor-gap clock — pure duration computations over a month cohort of
 * clone alerts. TS twin of the rolling-window clone_watch_vendor_gap_stats
 * RPC (v231): same legs, same honesty guards, DIFFERENT window semantics —
 * this module receives the report card's first_seen_at cohort, the RPC
 * windows on each leg's end event. The two are EXPECTED to differ; the card
 * carries a footnote saying so.
 *
 * Honesty rules (mirror the v231 migration header):
 *  - netcraft_declined_at is LAST-touch (re-stamped per decline) and can
 *    postdate weaponised_at → strict non-negative guard per leg; dropped
 *    pairs are counted in excludedNegativeN, never silently discarded.
 *  - weaponised_at is first-touch and quantised by the 6h recheck + 3h
 *    retrieve crons → hours, never minutes.
 *  - the re-file signal is netcraft_issue.issue_reported_at specifically
 *    (the sibling key alone also marks skips).
 *  - takedown_at is witnessed-transition-only (v219) → takedown legs are
 *    automatically honest.
 *  - medians are null when a leg has no rows (never a fake 0).
 *
 * No SQL copy of THIS cohort math exists by design (the v222 lesson: one
 * formula, one home). Pure + unit-tested.
 */

export interface DurationLeg {
  n: number;
  medianHours: number | null;
}

export interface DurationKpis {
  declineToWeaponise: DurationLeg;
  weaponiseToRefile: DurationLeg;
  refileToTakedown: DurationLeg;
  fullLoop: DurationLeg;
  /** decline→weaponise pairs dropped because the LAST-touch
   *  netcraft_declined_at was re-stamped at/after weaponised_at — the one
   *  inversion that is an EXPECTED data pathology. Only that leg counts here. */
  excludedNegativeN: number;
  /** Inverted pairs dropped from the OTHER three legs (e.g. a takedown
   *  witnessed by the 10:00 reconciler before the 11:00 filer stamped the
   *  re-file). Not expected; anything >0 is worth a look, so it is counted
   *  separately rather than folded into the decline-pathology number. */
  anomalousInversionsN: number;
  /** ISO timestamp the KPIs were computed (stamped into duration_kpis jsonb). */
  asOf: string;
}

/** A published median needs a defensible sample: counts always render, but a
 *  leg's median only renders at n >= this floor. ONE home — both the public
 *  /clone-watch strip and the admin report-card appendix import it, so the
 *  appendix always previews exactly what the public page publishes. */
export const MEDIAN_FLOOR = 5;

/** Render an integer median-hours value honestly: a median that rounded to 0
 *  reads "<1h" (never a fake "0h"), short spans read as hours, long spans as
 *  days. Shared by the public strip and the admin appendix so the same
 *  statistic never renders two ways. */
export function formatMedianHours(hours: number): string {
  if (hours < 1) return "<1h";
  if (hours < 48) return `${hours}h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export interface RegistrarWeaponisationRow {
  registrar: string;
  /** Clones in the cohort that ever weaponised (weaponised_at set — includes
   *  ones that later reached taken_down; first-touch survives transitions). */
  weaponised: number;
  /** Median days first_seen_at → weaponised_at; null when weaponised = 0. */
  medianDaysToWeaponise: number | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function ts(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** submitted_to.netcraft / netcraft_issue timestamps off the jsonb ledger. */
function netcraftTimes(row: CloneAlertRow): {
  submittedAt: number | null;
  takedownAt: number | null;
  refiledAt: number | null;
} {
  const netcraft = row.submitted_to?.["netcraft"] as
    | { submitted_at?: unknown; takedown_at?: unknown }
    | undefined;
  const issue = row.submitted_to?.["netcraft_issue"] as
    | { issue_reported_at?: unknown }
    | undefined;
  return {
    submittedAt: ts(netcraft?.submitted_at),
    takedownAt: ts(netcraft?.takedown_at),
    refiledAt: ts(issue?.issue_reported_at),
  };
}

/** percentile_cont(0.5)-compatible median (linear interpolation), rounded.
 *  Exported as THE median for every clone-watch duration surface — the admin
 *  appendix's detection-lag path must use this, not an inline copy. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  const lo = sorted[Math.floor(mid)];
  const hi = sorted[Math.ceil(mid)];
  return Math.round((lo + hi) / 2);
}

/** Dedupe rows by candidate_domain (first occurrence wins), matching the
 *  shared aggregator's dedup convention so counts reconcile with the card. */
function dedupeByCandidate(rows: CloneAlertRow[]): CloneAlertRow[] {
  const seen = new Set<string>();
  const out: CloneAlertRow[] = [];
  for (const row of rows) {
    if (!row.candidate_domain || seen.has(row.candidate_domain)) continue;
    seen.add(row.candidate_domain);
    out.push(row);
  }
  return out;
}

export function computeDurationKpis(
  rows: CloneAlertRow[],
  now: Date = new Date(),
): DurationKpis {
  const declineToWeaponise: number[] = [];
  const weaponiseToRefile: number[] = [];
  const refileToTakedown: number[] = [];
  const fullLoop: number[] = [];
  let excludedNegativeN = 0;
  let anomalousInversionsN = 0;

  // A pair with both endpoints present either counts or is excluded; a strict
  // guard (< / <=) drops equal-or-inverted pairs because they prove nothing
  // about the gap. Exclusions land in TWO counters: the decline→weaponise leg
  // feeds excludedNegativeN (the EXPECTED last-touch pathology the UI copy
  // names), every other leg feeds anomalousInversionsN — folding them together
  // mislabeled and inflated the pathology count.
  const leg = (
    startMs: number | null,
    endMs: number | null,
    sink: number[],
    opts: { allowEqual: boolean; expectedPathology?: boolean },
  ): void => {
    if (startMs == null || endMs == null) return;
    if (opts.allowEqual ? startMs <= endMs : startMs < endMs) {
      sink.push((endMs - startMs) / HOUR_MS);
    } else if (opts.expectedPathology) {
      excludedNegativeN += 1;
    } else {
      anomalousInversionsN += 1;
    }
  };

  for (const row of dedupeByCandidate(rows)) {
    const declinedAt = ts(row.netcraft_declined_at);
    const weaponisedAt = ts(row.weaponised_at);
    const { submittedAt, takedownAt, refiledAt } = netcraftTimes(row);

    leg(declinedAt, weaponisedAt, declineToWeaponise, {
      allowEqual: false,
      expectedPathology: true,
    });
    leg(weaponisedAt, refiledAt, weaponiseToRefile, { allowEqual: true });
    leg(refiledAt, takedownAt, refileToTakedown, { allowEqual: true });
    leg(submittedAt, takedownAt, fullLoop, { allowEqual: true });
  }

  const toLeg = (durations: number[]): DurationLeg => ({
    n: durations.length,
    medianHours: medianOf(durations),
  });

  return {
    declineToWeaponise: toLeg(declineToWeaponise),
    weaponiseToRefile: toLeg(weaponiseToRefile),
    refileToTakedown: toLeg(refileToTakedown),
    fullLoop: toLeg(fullLoop),
    excludedNegativeN,
    anomalousInversionsN,
    asOf: now.toISOString(),
  };
}

/** The "Unknown" bucket label — rendered on the internal card for honesty,
 *  dropped from the v193 trend-table insert (matches rollupRegistrars). */
export const UNKNOWN_REGISTRAR = "Unknown";

/**
 * Per-registrar weaponisation cut: which registrars' clones actually turn
 * into live phishing, and how fast. Canonicalised via canonicalRegistrar;
 * null/redacted registrars land in the explicit Unknown bucket.
 */
export function registrarWeaponisation(
  rows: CloneAlertRow[],
): RegistrarWeaponisationRow[] {
  const days = new Map<string, number[]>();

  for (const row of dedupeByCandidate(rows)) {
    const weaponisedAt = ts(row.weaponised_at);
    if (weaponisedAt == null) continue;
    const firstSeenAt = ts(row.first_seen_at);
    const name =
      canonicalRegistrar(row.attribution?.whois?.registrar) ?? UNKNOWN_REGISTRAR;
    const list = days.get(name) ?? [];
    // first_seen_at missing or inverted → count the weaponisation, skip the
    // duration sample (NaN days would poison the median).
    if (firstSeenAt != null && firstSeenAt <= weaponisedAt) {
      list.push((weaponisedAt - firstSeenAt) / DAY_MS);
    } else {
      list.push(Number.NaN);
    }
    days.set(name, list);
  }

  return [...days.entries()]
    .map(([registrar, samples]) => {
      const clean = samples.filter((d) => !Number.isNaN(d));
      return {
        registrar,
        weaponised: samples.length,
        medianDaysToWeaponise: medianOf(clean),
      };
    })
    .sort(
      (a, b) =>
        b.weaponised - a.weaponised || a.registrar.localeCompare(b.registrar),
    );
}

/** Multi-part public suffixes that actually occur in the clone data. Anything
 *  else falls back to the last label. Card-render heuristic only. */
const TWO_LABEL_TLDS = new Set(["com.au", "net.au", "org.au", "co.uk", "co.nz"]);

export function tldOf(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  if (labels.length >= 3) {
    const two = labels.slice(-2).join(".");
    if (TWO_LABEL_TLDS.has(two)) return two;
  }
  return labels[labels.length - 1] ?? "";
}

/** Per-TLD weaponisation counts (card-render only, not persisted). */
export function tldWeaponisation(
  rows: CloneAlertRow[],
): Array<{ tld: string; weaponised: number }> {
  const counts = new Map<string, number>();
  for (const row of dedupeByCandidate(rows)) {
    if (ts(row.weaponised_at) == null) continue;
    const tld = tldOf(row.candidate_domain);
    if (!tld) continue;
    counts.set(tld, (counts.get(tld) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tld, weaponised]) => ({ tld, weaponised }))
    .sort((a, b) => b.weaponised - a.weaponised || a.tld.localeCompare(b.tld));
}
