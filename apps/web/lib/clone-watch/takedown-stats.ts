/**
 * The ONE reader of `clone_watch_takedown_stats` (v145 → v329, #1234).
 *
 * WHY THIS FILE EXISTS. Three surfaces read that RPC — the public /clone-watch
 * page, /admin/clone-watch and the weekly digest — and each parsed the row its
 * own way, all with `?? 0`. That is how "no sample" and "zero minutes" became
 * the same number: v145 COALESCEd an empty median to 0 in SQL, the readers
 * COALESCEd again, and the public page printed "0 min" (and, with a mixed
 * clock, −2 min as the fastest). A null here means NOT MEASURED and must never
 * be rendered as a duration.
 *
 * Accepts both shapes: the v145 row (latency columns only) and the v329 row
 * (separate clocks + the weaponised cohort). Against a v145 row every v329
 * field reads null and `triageMinutes` is withheld — the v145 median subtracts
 * our submitted_at from Netcraft's classification time and cannot be trusted
 * as a duration — so a deploy that lands before the migration shows less, not
 * something wrong.
 *
 * Zero imports, so server pages, Inngest closures and tests share it.
 */

export interface TakedownStats {
  windowDays: number;
  /** Netcraft malicious classifications dated inside the window. */
  blocklisted: number;
  /** Netcraft's triage latency, BOTH ends on Netcraft's clock
   *  (its receipt → its malicious classification). null = no sample. */
  triageMinutes: {
    n: number;
    median: number | null;
    p90: number | null;
  } | null;
  /** Our witness of live phishing (weaponised_at) → Netcraft's classification. */
  detectToBlock: {
    n: number;
    median: number | null;
    p90: number | null;
  } | null;
  /** Netcraft already had it blocked before we saw it phishing (not our credit). */
  blockedBeforeDetection: number | null;
  alreadyBlocklistedAtSubmit: number | null;
  /** The cohort weaponised inside the window, by where each clone is now. */
  cohort: {
    weaponised: number;
    blocklisted: number;
    offline: number;
    open: number;
    vendorGap: number;
    escalated: number;
    detectToOfflineMedianMinutes: number | null;
  } | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse one RPC row (or the RPC's array result). Null when there is no row. */
export function parseTakedownStats(data: unknown): TakedownStats | null {
  const row = (Array.isArray(data) ? data[0] : data) as
    | Record<string, unknown>
    | undefined;
  if (!row || typeof row !== "object") return null;

  // The latency sample is `timed_n` and nothing else. A v145 row has no such
  // column — its median belongs to takedowns_total and mixes two clocks — so
  // a missing timed_n means "no trustworthy sample", never "n = total".
  const timedN = num(row.timed_n);
  const detectN = num(row.detect_to_block_n);
  const weaponised = num(row.weaponised_n);

  return {
    windowDays: num(row.window_days) ?? 30,
    blocklisted: num(row.takedowns_total) ?? 0,
    triageMinutes:
      timedN !== null
        ? {
            n: timedN,
            median: num(row.median_minutes),
            p90: num(row.p90_minutes),
          }
        : null,
    detectToBlock:
      detectN !== null
        ? {
            n: detectN,
            median: num(row.detect_to_block_median_minutes),
            p90: num(row.detect_to_block_p90_minutes),
          }
        : null,
    blockedBeforeDetection: num(row.blocked_before_detection),
    alreadyBlocklistedAtSubmit: num(row.already_blocklisted_at_submit),
    cohort:
      weaponised !== null
        ? {
            weaponised,
            blocklisted: num(row.weaponised_blocklisted) ?? 0,
            offline: num(row.weaponised_offline) ?? 0,
            open: num(row.weaponised_open) ?? 0,
            vendorGap: num(row.weaponised_vendor_gap) ?? 0,
            escalated: num(row.weaponised_escalated) ?? 0,
            detectToOfflineMedianMinutes: num(
              row.detect_to_offline_median_minutes,
            ),
          }
        : null,
  };
}

/** A median fit to publish: a sample at or above `floor` AND a value. */
export function publishableMedian(
  sample: { n: number; median: number | null } | null,
  floor: number,
): number | null {
  if (!sample || sample.n < floor || sample.median === null) return null;
  return sample.median;
}

/** "42 min" / "3.9h" / "2.1d"; "—" for not measured. Never renders a negative. */
export function formatDurationMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

/** The ~13:00 UTC daily Netcraft submit (laneHealth NETCRAFT_AUTO_CRONS). */
export const NETCRAFT_SUBMIT_CADENCE = "13:00 UTC";

export interface BlocklistTile {
  value: string;
  label: string;
  /** The sample, labelled against the weaponised cohort it comes from. */
  sub: string;
  /** Why the number is mostly OUR time, not Netcraft's. */
  note: string;
}

/**
 * The ONE wording of the public "time to blocklisting" figure (lead's decision,
 * #1254): detection → blocklist, labelled "n=7 of 41 weaponised in window",
 * with the explanation that most of that time is our own submit cadence. Null
 * below the publish floor or when unmeasured — the caller shows its fallback.
 */
export function blocklistTile(
  stats: TakedownStats | null,
  floor: number,
): BlocklistTile | null {
  const d = stats?.detectToBlock ?? null;
  const median = publishableMedian(d, floor);
  if (median === null || !d) return null;
  const of = stats?.cohort ? ` of ${stats.cohort.weaponised} weaponised in window` : "";
  return {
    value: formatDurationMinutes(median),
    label: "Median time to blocklisting",
    sub: `phishing detected → Netcraft blocklist · n=${d.n}${of}`,
    note: `Most of this is our own cadence — we submit to Netcraft once a day at ~${NETCRAFT_SUBMIT_CADENCE} — not Netcraft, which classifies within minutes of receiving a report.`,
  };
}
