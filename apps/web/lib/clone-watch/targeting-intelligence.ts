/**
 * Monthly targeting characterisation — what a brand's clones look like (#1075).
 *
 * Answers "how are they coming at this brand", which is the part of the picture
 * that survives churn: a domain that lived four days and died is still evidence
 * of how the attacker built the name and where they put it. Volume and outcome
 * live elsewhere (report-card-data.ts); this module is shape.
 *
 * Pure, no I/O, same contract as duration-kpis.ts — takes CloneAlertRow[] and
 * therefore works unchanged on a brand-filtered slice (v222: one formula, one
 * home in TS).
 *
 * ── WHAT THE CLASSIFIER CAN AND CANNOT SEE ────────────────────────────────
 * The Haiku pre-classifier's ENTIRE input is
 *   { brand, candidate_domain, candidate_url }
 * (clone-watch-haiku-preclassify.ts). It never loads the page. That single
 * fact decides which of its outputs may be published:
 *
 *   clone_tactic     — typosquat / homograph / lookalike_tld / compound_word
 *                      are definitionally properties of the STRING. Publishable,
 *                      framed as how the name is built, never as what the site
 *                      does.
 *   attack_intent    — NOT derivable from a domain name. Published here only
 *                      over rows an actual scan graded `likely_phishing`, with
 *                      the n carried so the denominator travels with the claim.
 *   risk_indicators  — `login_form_url`, `payment_form_url`, `urgency_words`
 *                      are page-content signals from a model that never saw a
 *                      page. NOT COMPUTED HERE AT ALL. Do not add them.
 *
 * Every distribution below carries its own denominator and an explicit unknown
 * bucket, so a partial-coverage field can never be silently renormalised to
 * look complete. Coverage measured on August 2026 (1,032 alerts): tactic 99.9%,
 * campaign_key 64%, hosting ASN 53% (of which 48% reverse-proxied).
 */
import {
  dedupeByCandidate,
  type CloneAlertRow,
} from "@/lib/clone-watch/clone-cohort";
import { tldOf } from "@/lib/clone-watch/duration-kpis";
import { summariseCampaigns } from "@/lib/clone-watch/campaign-summary";
import { asnLabel, canonicalAsn, isFrontingAsn } from "@/lib/clone-watch/asn-canonical";

/** A distribution that always states what it was computed over. */
export interface Mix {
  /** Descending by n. Capped by the caller's TOP_N. */
  top: Array<{ key: string; n: number }>;
  /** Everything past the cap. */
  other: number;
  /** Rows the field was missing on — never folded into `other`. */
  unknown: number;
  /** Rows the distribution was computed over, INCLUDING unknown. */
  total: number;
}

const TOP_N = 10;


function toMix(counts: Map<string, number>, unknown: number, total: number): Mix {
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => ({ key, n }));
  const top = sorted.slice(0, TOP_N);
  const other = sorted.slice(TOP_N).reduce((sum, r) => sum + r.n, 0);
  return { top, other, unknown, total };
}

/**
 * How the lookalike NAMES are built.
 *
 * Denominator is rows the classifier judged deliberate (`is_clone === true`),
 * because a tactic label on a coincidental match describes nothing. The 14% it
 * rejects (144 of 1,032 in August) land in neither `top` nor `unknown` — they
 * are outside the question, and `total` reflects that.
 */
export function tacticMix(rows: CloneAlertRow[]): Mix {
  const deliberate = dedupeByCandidate(rows).filter(
    (r) => r.clone_watch_classifications?.is_clone === true,
  );
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const r of deliberate) {
    const t = r.clone_watch_classifications?.clone_tactic ?? null;
    if (!t) unknown++;
    else counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return toMix(counts, unknown, deliberate.length);
}

/**
 * What the SCANNED clones were doing.
 *
 * Restricted to rows a real urlscan graded `likely_phishing` — the classifier's
 * intent label is a guess from a domain string and cannot carry this claim on
 * its own. `total` is therefore the corroborated subset (n≈52 cohort-wide in
 * August, and near zero for an individual brand), which is small enough that
 * the n must be published beside any percentage.
 */
export function intentMix(rows: CloneAlertRow[]): Mix {
  const corroborated = dedupeByCandidate(rows).filter(
    (r) => r.urlscan_classification === "likely_phishing",
  );
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const r of corroborated) {
    const intent = r.clone_watch_classifications?.attack_intent ?? null;
    if (!intent || intent === "unknown") unknown++;
    else counts.set(intent, (counts.get(intent) ?? 0) + 1);
  }
  return toMix(counts, unknown, corroborated.length);
}

/**
 * Which TLDs the lookalikes were registered on.
 *
 * The most defensible family here: derived from the domain string itself, so
 * coverage is 100% and no model or vendor is involved. Also the most directly
 * actionable — a brand whose lookalikes cluster on .shop/.online can ask its
 * domain-monitoring vendor whether those zones are watched.
 */
export function tldConcentration(rows: CloneAlertRow[]): Mix {
  const unique = dedupeByCandidate(rows);
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const r of unique) {
    const tld = r.candidate_domain ? tldOf(r.candidate_domain) : "";
    if (!tld) unknown++;
    else counts.set(tld, (counts.get(tld) ?? 0) + 1);
  }
  return toMix(counts, unknown, unique.length);
}

export interface HostingSummary {
  /** Origin ASNs only — reverse-proxied rows are excluded, not renamed. */
  asns: Mix;
  /** Origin countries only, same exclusion. */
  countries: Mix;
  /** Rows behind a CDN, where the recorded location is an edge POP. */
  frontedN: number;
  /** Rows with no hosting attribution at all. */
  unattributedN: number;
  /** Rows whose true origin we can actually see — the honest denominator. */
  originVisibleN: number;
  /** Every row considered. */
  total: number;
}

/**
 * Where the clones are really hosted.
 *
 * Reverse-proxied rows are EXCLUDED from the location distributions rather than
 * counted, because their ASN/country is the CDN's edge, not the operator's. On
 * the August cohort that removes 258 of 542 attributed rows (Cloudflare alone
 * is 183, 133 of them with no country at all), leaving 284 of 1,032 — so any
 * published location claim must quote `originVisibleN` against `total`.
 */
export function hostingConcentration(rows: CloneAlertRow[]): HostingSummary {
  const unique = dedupeByCandidate(rows);
  const asnCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();
  let fronted = 0;
  let unattributed = 0;
  let originVisible = 0;
  let countryRows = 0;
  let asnUnknown = 0;

  for (const r of unique) {
    const asn =
      canonicalAsn(r.attribution?.hosting?.asn) ??
      canonicalAsn(r.urlscan_evidence?.server?.asn);
    const country =
      r.attribution?.hosting?.country ?? r.urlscan_evidence?.server?.country ?? null;

    if (!asn && !country) {
      unattributed++;
      continue;
    }
    if (isFrontingAsn(asn)) {
      fronted++;
      continue;
    }
    originVisible++;
    // F5: a row with a country but NO asn cannot be fronting-checked at all —
    // a CDN-fronted domain whose ASN we failed to capture would be counted as
    // an origin location. It also must not enter asnCounts, where asnLabel(null)
    // would publish a network literally named "Unknown" as a top ASN.
    if (asn) asnCounts.set(asnLabel(asn), (asnCounts.get(asnLabel(asn)) ?? 0) + 1);
    else asnUnknown++;
    if (country) {
      countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      countryRows++;
    }
  }

  return {
    asns: toMix(asnCounts, asnUnknown, originVisible),
    // countryCounts.size is the number of DISTINCT countries; the unknown
    // bucket needs the number of ROWS without one. Using .size reported ~254
    // unknown of 284 on the real August cohort and broke this module's own
    // stated invariant (top + other + unknown === total).
    countries: toMix(countryCounts, originVisible - countryRows, originVisible),
    frontedN: fronted,
    unattributedN: unattributed,
    originVisibleN: originVisible,
    total: unique.length,
  };
}

export interface InfrastructureCluster {
  key: string;
  domains: number;
  registrar: string | null;
}

export interface ClusterSummary {
  clusters: InfrastructureCluster[];
  /** Rows carrying a usable fingerprint — the denominator for any share. */
  fingerprintedN: number;
  /** Rows whose fingerprint could not be computed (`insufficient` or null). */
  unfingerprintedN: number;
  largestClusterN: number;
  total: number;
}

/**
 * Lookalikes of THIS brand that share one hosting/registrar fingerprint.
 *
 * NOT "one actor", and the copy layer must never say so. `campaign_key` hashes
 * registrar + nameserver roots + ASN + certificate issuer — nothing
 * brand-specific and nothing actor-specific. The largest cohort-wide cluster is
 * 169 domains, which is almost certainly the default stack of a large slice of
 * the internet (a mainstream registrar behind Cloudflare with a Let's Encrypt
 * cert), not a coordinated operator.
 *
 * Scoping WITHIN a brand is what makes it meaningful: "9 of your 34 lookalikes
 * were built on one stack" is a defensible observation about your attackers.
 * The same key across unrelated brands is an infrastructure bucket. Callers
 * pass one brand's rows; passing the whole cohort measures the internet.
 */
export function infrastructureClusters(rows: CloneAlertRow[]): ClusterSummary {
  const unique = dedupeByCandidate(rows);

  // Delegate the grouping AND the registrar choice to summariseCampaigns —
  // it already skips the `insufficient` sentinel, already requires >=2 domains,
  // already caps at 5, and picks the MODAL registrar across the cluster. An
  // earlier version of this function reimplemented all of that and took
  // members[0]'s registrar instead, so the two would have answered "which
  // registrar is behind this cluster" differently for the same rows — on a
  // surface that gets emailed to brands (v222: one formula, one home).
  const summary = summariseCampaigns(unique);

  // What summariseCampaigns does not carry: the denominators. A cluster share
  // is meaningless without knowing how many rows could have been fingerprinted
  // at all (~56% after dedupe; the rest are the `insufficient` sentinel).
  const unfingerprinted = unique.filter(
    (r) => !r.campaign_key || r.campaign_key === "insufficient",
  ).length;

  return {
    clusters: summary.top.map((c) => ({
      key: c.key,
      domains: c.domainCount,
      registrar: c.registrar,
    })),
    fingerprintedN: unique.length - unfingerprinted,
    unfingerprintedN: unfingerprinted,
    largestClusterN: summary.largestCampaign,
    total: unique.length,
  };
}

/**
 * Rows the classifier actively judged COINCIDENTAL (`is_clone === false`).
 *
 * Deliberately not `total - deliberate`: the classifications embed is a
 * non-inner join and `is_clone` is nullable, so that subtraction also counts
 * every row the classifier never saw (flag off, cost brake, backlog) as a
 * rejection. The published caveat quotes this number, so it has to mean what
 * it says — see buildClassifierCaveat.
 */
export function rejectedCount(rows: CloneAlertRow[]): number {
  return dedupeByCandidate(rows).filter(
    (r) => r.clone_watch_classifications?.is_clone === false,
  ).length;
}

export interface TargetingIntel {
  tactics: Mix;
  intents: Mix;
  tlds: Mix;
  hosting: HostingSummary;
  clusters: ClusterSummary;
  /** Judged coincidental. NOT `tlds.total - tactics.total` — see rejectedCount. */
  rejectedN: number;
}

export function computeTargetingIntel(rows: CloneAlertRow[]): TargetingIntel {
  return {
    tactics: tacticMix(rows),
    intents: intentMix(rows),
    tlds: tldConcentration(rows),
    hosting: hostingConcentration(rows),
    clusters: infrastructureClusters(rows),
    rejectedN: rejectedCount(rows),
  };
}

/**
 * Per-brand intel, keyed by `inferred_target_domain` — the SAME key
 * `clone_watch_monthly_brand_stats.brand` uses (it flows from the watchlist's
 * legitimate_domains[0] through the ingest). Keying on the normalised brand
 * name instead joins to nothing; see brand-coverage.ts and migration v295.
 */
export function computeTargetingIntelByBrand(
  rows: CloneAlertRow[],
): Map<string, TargetingIntel> {
  const byBrand = new Map<string, CloneAlertRow[]>();
  for (const r of rows) {
    const key = r.inferred_target_domain;
    if (!key) continue;
    const bucket = byBrand.get(key);
    if (bucket) bucket.push(r);
    else byBrand.set(key, [r]);
  }
  return new Map(
    [...byBrand.entries()].map(([brand, brandRows]) => [
      brand,
      computeTargetingIntel(brandRows),
    ]),
  );
}
