/**
 * Vendor-outcome vocabulary — THE single source of the published outcome copy
 * for the monthly LinkedIn carousel (slide 06) and the deterministic caption.
 * The Brand Stewardship email shares the guard + verb discipline (its richer
 * multi-line JSX stays in the template, but its claims follow the same rules).
 *
 * HONESTY RULES (hard — pinned by cloneWatchCaption.test.ts):
 *  - Lifecycle buckets are MUTUALLY EXCLUSIVE current states (the aggregator's
 *    else-if chain): a weaponised domain is NOT in the declined count, and
 *    takenDown INCLUDES reTakenDown. Copy must never imply subset/additive
 *    relations the data doesn't have.
 *  - The "graded no-threat, later flipped" story may be claimed ONLY for
 *    weaponisedAfterDecline (netcraft_declined_at witnessed) — in prod
 *    2026-07-11 that was 1 of 33 weaponised; the rest were phishing at first
 *    scan and were never graded by the vendor.
 *  - Escalation is claimed ONLY when kpis.escalated > 0 (the reporter is
 *    capped/gated; weaponised>0 with escalated=0 is a normal state).
 *  - Verbs: "actioned by Netcraft" / "actioned" (their action — never "we
 *    took down"); "graded “no threat” and left live"; "serving active
 *    phishing". Never publish time-to-takedown *in the carousel/caption* —
 *    that rule targets the v145-era stat whose backfill was unwitnessed.
 *    The /clone-watch vendor-gap strip and impact tile DO publish takedown
 *    durations legitimately: those draw only on witnessed-transition
 *    takedown_at stamps (v219 rule), which is the construction that made
 *    the original ban necessary in the first place. Typographic quotes
 *    (“ ”) in BOTH surfaces so slide and caption match.
 *  - Numbers only from data; no URLs; no domain names.
 *
 * Zero imports by design: importable from server components, the caption CLI,
 * and email templates without dragging in the data layer.
 */

export interface CloneOutcomeKpis {
  /** Netcraft actioned (lifecycle taken_down) — INCLUDES reTakenDown. */
  takenDown: number;
  /** Currently graded non-malicious and still live (lifecycle declined). */
  declined: number;
  /** We filed a report_issue to force a re-review. */
  escalated: number;
  /** Currently serving active phishing (lifecycle weaponised). */
  weaponised: number;
  /** Weaponised AFTER the vendor declined it, from timestamps — whatever its
   *  state is now. NOT a subset of `weaponised` since v329 (a flipped clone
   *  that later went offline or was taken down still counts), so the copy
   *  below never words it as "of them". */
  weaponisedAfterDecline: number;
  /** Escalated AND now taken_down — subset of takenDown. */
  reTakenDown: number;
}

/** True when the month's cohort has any vendor outcome worth publishing.
 *  Includes escalated so an escalated-only month is never silently hidden. */
export function hasOutcomes(kpis: CloneOutcomeKpis): boolean {
  return kpis.takenDown + kpis.declined + kpis.weaponised + kpis.escalated > 0;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * CONFOUNDER (v329 review, #1254). From 2026-09 the reconcile lane's DNS sweep
 * moves weaponised lookalikes whose names stopped resolving to `dormant` —
 * ~63 of the 142 on its first runs. The month-over-month line compares CLONES
 * (#1247), not this figure, and nothing user-facing compares weaponised
 * month-over-month (checked 2026-09-26: trend-copy.ts, clone-watch-caption.ts,
 * /clone-watch/[period]) — but a reader holding August's edition would, so the
 * transition month says why its "active phishing" count is lower.
 */
export const WEAPONISED_SWEEP_FIRST_MONTH = "2026-09";

export function weaponisedStateCaveat(periodMonth: string | undefined): string {
  if (!periodMonth || periodMonth.slice(0, 7) !== WEAPONISED_SWEEP_FIRST_MONTH) return "";
  return "From this month we also check whether each of those sites still exists and stop counting the ones that have disappeared, so a lower figure than last month reflects that check, not fewer attacks.";
}

/** Per-row lifecycle badge for the stewardship watch-list. Labels follow the
 *  module's verb discipline — "actioned by Netcraft", never "removed"/"we
 *  took down". Colors are hex so email clients render them inline. Returns
 *  null for states with nothing honest to badge (detected/unknown). */
export function lifecycleBadge(
  state: string | null,
): { label: string; color: string } | null {
  switch (state) {
    case "weaponised":
      return { label: "ACTIVE PHISHING", color: "#dc2626" };
    // No flat "STILL LIVE" claims — lifecycle_state is not a liveness probe
    // (our own reporter finds declined domains dead at GET time). The dated
    // "still live as of {vendor-observed date}" line carries the honest
    // liveness statement; the badge states only what the data proves.
    case "declined":
      return { label: "GRADED NO-THREAT — UNACTIONED", color: "#d97706" };
    case "monitoring":
      return { label: "UNDER MONITORING", color: "#d97706" };
    case "taken_down":
      return { label: "ACTIONED BY NETCRAFT", color: "#16a34a" };
    case "dormant":
      return { label: "DORMANT", color: "#64748b" };
    default:
      return null;
  }
}

/**
 * Compact one-line summary for carousel slide 06 ("·"-joined, non-zero parts
 * only). Returns "" when the month has no outcomes (caller hides the block).
 */
export function buildOutcomesLine(kpis: CloneOutcomeKpis): string {
  if (!hasOutcomes(kpis)) return "";
  const parts: string[] = [];
  if (kpis.takenDown > 0) {
    const viaEscalation =
      kpis.reTakenDown > 0 ? ` (incl. ${kpis.reTakenDown} after our escalation)` : "";
    parts.push(`${kpis.takenDown} actioned by Netcraft${viaEscalation}`);
  }
  if (kpis.declined > 0) {
    parts.push(`${kpis.declined} currently graded “no threat” and left live`);
  }
  if (kpis.weaponised > 0) {
    parts.push(`${kpis.weaponised} confirmed serving active phishing by our scans`);
  }
  // Its own part, never "— N of them": since v329 it is counted from
  // timestamps and is not a subset of the current-state figure above.
  if (kpis.weaponisedAfterDecline > 0) {
    parts.push(
      `${kpis.weaponisedAfterDecline} served phishing after being graded “no threat”`,
    );
  }
  if (kpis.escalated > 0) {
    parts.push(`${kpis.escalated} escalated back with scan evidence`);
  }
  return parts.join(" · ");
}

/**
 * Full-sentence paragraph for the LinkedIn caption. Every sentence is
 * self-contained (no cross-references like "of those"), so any combination of
 * zero/non-zero KPIs reads correctly. Returns "" when the month has no
 * outcomes — all-zero months keep the pre-F5 caption shape exactly.
 */
export function buildOutcomesBlock(
  kpis: CloneOutcomeKpis & { reportedToNetcraft: number },
  opts: { periodMonth?: string } = {},
): string {
  if (!hasOutcomes(kpis)) return "";
  const sentences: string[] = [];

  const leadParts: string[] = [];
  if (kpis.takenDown > 0) {
    const viaEscalation =
      kpis.reTakenDown > 0
        ? ` (including ${kpis.reTakenDown} only after we escalated)`
        : "";
    leadParts.push(
      `${kpis.takenDown} ${plural(kpis.takenDown, "has", "have")} been actioned${viaEscalation}`,
    );
  }
  if (kpis.declined > 0) {
    leadParts.push(
      `${kpis.declined} ${plural(kpis.declined, "is", "are")} currently graded “no threat” and left live`,
    );
  }
  if (leadParts.length > 0) {
    sentences.push(
      `Of the ${kpis.reportedToNetcraft} we reported to a takedown vendor: ${leadParts.join(" and ")}.`,
    );
  }

  if (kpis.weaponised > 0) {
    sentences.push(
      `Our scans confirmed ${kpis.weaponised} ${plural(kpis.weaponised, "domain", "domains")} now serving active phishing.`,
    );
    const caveat = weaponisedStateCaveat(opts.periodMonth);
    if (caveat) sentences.push(caveat);
  }
  // Its own sentence: counted from timestamps (v329), so it is not a subset of
  // the current-state figure and must not read "of them".
  if (kpis.weaponisedAfterDecline > 0) {
    sentences.push(
      `${kpis.weaponisedAfterDecline} ${plural(kpis.weaponisedAfterDecline, "lookalike", "lookalikes")} served phishing after the vendor had graded ${plural(kpis.weaponisedAfterDecline, "it", "them")} “no threat” — proof that “no threat” doesn’t mean safe.`,
    );
  }

  if (kpis.escalated > 0) {
    sentences.push(
      `We have escalated ${kpis.escalated} back to the vendor with the scan evidence.`,
    );
  }

  return sentences.join(" ");
}
