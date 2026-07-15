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
  /** Weaponised AND previously vendor-declined — the provable flip subset. */
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
    const flip =
      kpis.weaponisedAfterDecline > 0
        ? ` — ${kpis.weaponisedAfterDecline} previously graded “no threat”`
        : "";
    parts.push(
      `${kpis.weaponised} confirmed serving active phishing by our scans${flip}`,
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
    const flip =
      kpis.weaponisedAfterDecline > 0
        ? ` — ${kpis.weaponisedAfterDecline} of them had earlier been graded “no threat” by the vendor, proof that “no threat” doesn’t mean safe`
        : "";
    sentences.push(
      `Our scans confirmed ${kpis.weaponised} ${plural(kpis.weaponised, "domain", "domains")} now serving active phishing${flip}.`,
    );
  }

  if (kpis.escalated > 0) {
    sentences.push(
      `We have escalated ${kpis.escalated} back to the vendor with the scan evidence.`,
    );
  }

  return sentences.join(" ");
}
