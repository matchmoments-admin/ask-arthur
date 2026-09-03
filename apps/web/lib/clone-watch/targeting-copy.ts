/**
 * Published wording for targeting characterisation (#1075).
 *
 * Sibling of outcome-copy.ts, and separate from it on purpose: that module is
 * the VENDOR-outcome vocabulary (reported / declined / taken down), this one is
 * name-shape and infrastructure. Different axis, different honesty rules, same
 * discipline — zero imports, so it can be read from a server component, the
 * caption CLI and an email template alike.
 *
 * HONESTY RULES (pinned by apps/web/__tests__/cloneWatchTargetingCopy.test.ts):
 *
 *  1. TACTIC IS ABOUT THE NAME, NEVER THE SITE. The classifier's whole input is
 *     {brand, candidate_domain, candidate_url} — it never loads the page. So
 *     "how the name is built" is a fact and "what the site does" is not.
 *
 *  2. NO INTENT CLAIM WITHOUT A SCAN. Intent is only ever quoted over rows a
 *     real urlscan graded likely_phishing, and the n travels with it. That n is
 *     small (52 cohort-wide in August 2026) and near zero per brand.
 *
 *  3. SHARED INFRASTRUCTURE, NEVER "CAMPAIGN" OR "ONE ACTOR". campaign_key
 *     hashes registrar + nameservers + ASN + cert issuer; nothing in it is
 *     actor-specific. Cohort-wide the largest cluster is the shape of the
 *     internet; scoped to one brand it is an observation.
 *
 *  4. LOCATION CLAIMS EXCLUDE CDN-FRONTED ROWS AND SAY SO. The recorded country
 *     for a proxied domain is an edge POP. August 2026: only 201 of 1,032 rows
 *     had a visible origin.
 *
 *  5. EVERY PERCENTAGE NAMES ITS DENOMINATOR IN THE SAME SENTENCE.
 *
 *  6. A TREND CLAIM CARRIES ITS EXCLUSIONS. Month-over-month movement is only
 *     shown for brands monitored across both months and above the floor; the
 *     count of what was withheld, and why, is published beside it. The numbers
 *     come from the gate that made the decision, never from a hand count.
 */

/** Human labels for the classifier's tactic enum — name-shape wording only. */
const TACTIC_LABELS: Record<string, string> = {
  typosquat: "a one-character misspelling",
  compound_word: "the brand buried inside a longer word",
  brandjack: "the brand plus an extra word",
  lookalike_tld: "the exact name on a different domain ending",
  homograph: "look-alike characters",
  subdomain_abuse: "the brand used as a subdomain",
  parked: "registered and parked",
  unrelated: "coincidental name overlap",
  other: "another naming pattern",
};

export function tacticLabel(tactic: string): string {
  return TACTIC_LABELS[tactic] ?? "another naming pattern";
}

export interface TrendExclusions {
  claimable: number;
  coverageStarted: number;
  coverageEnded: number;
  belowFloor: number;
  unknown: number;
}

/**
 * The sentence that must accompany any published month-over-month movement.
 *
 * Built from the gate's own counts (rule 6) so it cannot drift from the
 * decision it describes. Returns "" when there is nothing to claim, so a caller
 * that publishes no trend also publishes no dangling caveat.
 */
export function buildTrendDisclosure(x: TrendExclusions): string {
  if (x.claimable === 0) return "";
  const withheld = x.coverageStarted + x.coverageEnded + x.belowFloor + x.unknown;
  if (withheld === 0) {
    return `Month-on-month change is shown for all ${x.claimable} brands we monitored across both months.`;
  }
  const reasons: string[] = [];
  if (x.coverageStarted > 0) {
    reasons.push(`${x.coverageStarted} we only started monitoring part-way through`);
  }
  if (x.coverageEnded > 0) {
    reasons.push(`${x.coverageEnded} we stopped monitoring part-way through`);
  }
  if (x.belowFloor > 0) {
    reasons.push(`${x.belowFloor} had too few lookalikes for a change to mean anything`);
  }
  if (x.unknown > 0) {
    reasons.push(`${x.unknown} we cannot confirm we monitored for the whole period`);
  }
  return (
    `Month-on-month change is shown only for the ${x.claimable} brands we monitored ` +
    `across both months with enough volume to compare. ${withheld} are excluded: ` +
    `${reasons.join("; ")}. Everything else here is a count, not a trend.`
  );
}

/**
 * The classifier-rejection caveat.
 *
 * `clones` is every lexical match; `deliberate` is the subset the classifier
 * judged intentional. Publishing the first as "lookalikes" without this
 * sentence overstates by the difference (14% in August 2026).
 */
export function buildClassifierCaveat(clones: number, deliberate: number): string {
  const rejected = clones - deliberate;
  if (rejected <= 0) return "";
  return (
    `${rejected} of the ${clones} name matches were judged coincidental rather than ` +
    `deliberate, and are excluded from the naming breakdown.`
  );
}

/**
 * TLD concentration — the most defensible line in the report, and the most
 * directly actionable: a brand can ask whether its monitoring vendor watches
 * these zones. Derived from the domain string, so no model or vendor is
 * involved and coverage is total (rule 5 still applies: n of total).
 */
export function buildTldLine(
  top: Array<{ key: string; n: number }>,
  total: number,
): string {
  if (top.length === 0 || total === 0) return "";
  const named = top.slice(0, 3);
  const sum = named.reduce((s, t) => s + t.n, 0);
  const list = named.map((t) => `.${t.key}`).join(", ");
  return `${sum} of ${total} lookalikes were registered on just three domain endings — ${list}.`;
}
