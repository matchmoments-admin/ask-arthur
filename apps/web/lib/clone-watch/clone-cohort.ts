/**
 * The Clone Cohort — "which lookalike alerts count for this period".
 *
 * This is one question, and before this Module existed it was answered in five
 * places: the report card, the brand-stewardship digest, the weekly digest, the
 * outreach pilot, and the weekly clone-watch summary. Each restated the same
 * four rules — source is the NRD sweep, drop rows triaged `fp`, drop the
 * generic-dictionary FP brands, and count a candidate domain once — and each
 * could drift from the others without anything failing. Two surfaces reporting
 * different totals for the same month is a reporting bug that looks like a data
 * disagreement.
 *
 * It had already drifted three ways when this Module was written:
 *   - the SELECT lists disagreed, so `clone_tactic` and `campaign_key` reached
 *     one consumer and not the other, and the missing columns read as thin
 *     classifier coverage rather than a missing column;
 *   - dedupe-by-candidate_domain existed three times over, and after a review
 *     fix the copies disagreed on whether a row with no candidate domain is
 *     dropped (losing it from every denominator) or kept as unknown;
 *   - the two fetches used different row caps and different error policies.
 *
 * DEPTH: the row shape, the SELECT list that fills it, and the rules that decide
 * membership are one thing with one home. A surface reads the cohort by pairing
 * `CLONE_COHORT_SELECT` + `CLONE_COHORT_SOURCE` with `applyCohortRules`, so a
 * column added here reaches every consumer at once and the FP judgement cannot
 * drift between them.
 *
 * This Module owns `CloneAlertRow` because the row shape IS the cohort's
 * Interface. It previously lived in the brand-stewardship Inngest function,
 * which meant pure library Modules imported their core type from a background
 * job — and that inverted dependency is why the two SELECT lists could drift in
 * the first place: the shape had two owners and no home.
 */
import { MATCHER_V5_FROM, candidateLabelKey } from "@askarthur/shopfront-glue";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";

/**
 * A clone alert as every reporting surface reads it.
 *
 * Adding a field here is not enough — it must also be added to
 * `CLONE_COHORT_SELECT` below, or it arrives `undefined` at runtime while
 * typechecking perfectly.
 */
export interface CloneAlertRow {
  id: number;
  candidate_domain: string;
  /** Full URL. The internal digest lists these verbatim for Scamwatch. */
  candidate_url?: string | null;
  inferred_target_domain: string | null;
  /** Canonical Brand key (v197). Read by the monthly brand store to key its
   *  domain-grain rows to a brand (v319, monthly-brand-store.ts). */
  target_brand_normalized?: string | null;
  urlscan_classification: string | null;
  urlscan_evidence: {
    server?: { ip?: string; asn?: string; country?: string };
    /** Present when the urlscan retrieval succeeded (see urlscan-classify.ts). */
    screenshot_url?: string;
    /** Submission uuid — the public result page is derived from it. */
    uuid?: string;
  } | null;
  /** attribution jsonb — read ONLY through lib/clone-watch/attribution.ts
   *  (`readAttribution`). Typed unknown so a hand-rolled reader can't compile. */
  attribution: unknown;
  /**
   * Coarse INFRASTRUCTURE fingerprint (v235): registrar + nameserver roots +
   * ASN + cert issuer. Clones sharing a key share a stack — NOT necessarily an
   * actor; see targeting-intelligence.ts `infrastructureClusters`.
   */
  campaign_key?: string | null;
  /** signals jsonb — weaponisation-risk input (F3). */
  signals?: unknown;
  /** 1:1 Haiku classification embed (PostgREST to-one via alert_id PK). */
  clone_watch_classifications?: {
    is_clone: boolean | null;
    confidence: number | null;
    attack_intent: string | null;
    /**
     * How the NAME is built. Publishable, unlike attack_intent, because the
     * classifier's whole input is {brand, candidate_domain, candidate_url}.
     */
    clone_tactic?: string | null;
    /** Which pre-classifier produced this row (e.g. jev-1.13.0, a Haiku id) —
     *  the monthly store's classifier_version (v325). */
    model_id?: string | null;
  } | null;
  submitted_to: Record<string, unknown> | null;
  lifecycle_state?: string | null;
  netcraft_declined_at?: string | null;
  weaponised_at?: string | null;
  first_seen_at?: string | null;
  triage_status?: string | null;
  /**
   * The not-a-clone audit ledger row (v330), a PostgREST to-one embed via its
   * `alert_id` PK — null when the alert was never sampled. Read ONLY through
   * `isAuditWithheld` / `withholdAuditVerdict` below.
   */
  clone_watch_not_a_clone_samples?: AuditSampleEmbed;
}

/**
 * The embed's shape. PostgREST resolves it to-one (alert_id is the PK) and
 * returns `null` for an unsampled alert — verified against prod 2026-09-27. An
 * array is tolerated anyway: a to-many resolution would return `[]` for every
 * unsampled row, and reading `[]` as "sampled" would withhold the whole month.
 */
export type AuditSampleEmbed =
  | { miss_at: string | null }
  | Array<{ miss_at: string | null }>
  | null
  | undefined;

/**
 * The embed a cohort-shaped read carries so `withholdAuditVerdict` can see
 * whether an alert is a not-a-clone audit sample. Exported for the reads that
 * select their own column list (brand-outreach-pilot.ts, month-end-stock.ts).
 */
export const AUDIT_SAMPLE_EMBED = "clone_watch_not_a_clone_samples(miss_at)";

/**
 * The one SELECT every cohort read uses.
 *
 * A superset of what any single caller needs, deliberately: the cost of an
 * extra column on ~1,000 rows a month is nil, and the cost of a caller quietly
 * missing one is a distribution that reads as 100% unknown.
 */
export const CLONE_COHORT_SELECT =
  "id, candidate_domain, candidate_url, inferred_target_domain, target_brand_normalized, urlscan_classification, urlscan_evidence, attribution, submitted_to, lifecycle_state, netcraft_declined_at, weaponised_at, first_seen_at, triage_status, signals, campaign_key, clone_watch_classifications(is_clone, confidence, attack_intent, clone_tactic, model_id), " +
  AUDIT_SAMPLE_EMBED;

/** The NRD daily sweep — the only source these reporting surfaces count. */
export const CLONE_COHORT_SOURCE = "nrd";

/**
 * Count each candidate domain once.
 *
 * A row with NO candidate domain is KEPT, not dropped. Dropping it removed it
 * from every denominator, so totals under-reported and a distribution could
 * renormalise until it looked complete — the failure the `Mix` denominators
 * exist to prevent. It cannot be deduped (there is nothing to dedupe on) and
 * lands in the unknown bucket of whichever distribution reads the domain.
 */
export function dedupeByCandidate<T extends { candidate_domain?: string | null }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (!row.candidate_domain) {
      out.push(row);
      continue;
    }
    if (seen.has(row.candidate_domain)) continue;
    seen.add(row.candidate_domain);
    out.push(row);
  }
  return out;
}

/**
 * NOT-A-CLONE AUDIT SAMPLES (#1256) — measurement, never a brand fact.
 *
 * The audit (v330, #1249) urlscans a random sample of alerts the pre-classifier
 * judged is_clone=false. Before it existed those alerts were never scanned, so
 * they reached every brand count as `unclassified`. Once scanned, their verdict
 * — and the evidence and lifecycle move that come with it — would land in the
 * brand's `likely_phishing` / `parked_for_sale` / hosting / squat-status
 * numbers under the very brand the classifier REJECTED (prod example:
 * threesbrewingdirect.shop → ing.com.au). A miss is routed to `monitoring` and
 * never weaponised precisely so it is not acted on under that brand label;
 * publishing it under that label would undo the point.
 *
 * So a sample still judged not-a-clone keeps its LEXICAL membership (it stays in
 * `clones` / `detected` — it was a lexical match) and contributes nothing the
 * audit scan produced:
 *   - urlscan_classification → null. It counts as `unclassified`, exactly as
 *     every unsampled is_clone=false alert does.
 *   - urlscan_evidence and urlscan_uuid → null: hosting, screenshot, result
 *     link and squat status.
 *   - lifecycle_state `monitoring` → `detected`. The v330 draw takes only
 *     `detected` alerts, and the only thing that moves a sample to
 *     `monitoring` is the audit scan. Left alone, it would put the sample on
 *     the brand's unactioned watch-list (`topRiskUnactioned`).
 *
 * "Still judged not-a-clone" means `is_clone IS NOT TRUE`. That is the same
 * predicate v330 uses for `nac_audit` in list_clone_alerts_for_recheck and for
 * the weaponise gate in apply_clone_urlscan_verdict. A re-classification to
 * is_clone=true releases the sample in both places; an operator confirmation
 * (tp_confirmed / tp_actioned) releases it from the brand counts here. The rule covers misses
 * (miss_at set) and benign or parked samples alike, because a parked verdict
 * from the audit says no more about the brand than a phishing one does.
 *
 * The miss is counted per cohort key rather than per brand, by
 * clone_watch_not_a_clone_audit_summary() (v330). The submit lane also logs
 * each miss for review.
 */
function auditSampleOf(embed: AuditSampleEmbed): { miss_at: string | null } | null {
  if (Array.isArray(embed)) return embed[0] ?? null;
  return embed ?? null;
}

type AuditJudged = {
  clone_watch_not_a_clone_samples?: AuditSampleEmbed;
  clone_watch_classifications?: { is_clone: boolean | null } | null;
  /** Read when the select carries it; absent = not operator-confirmed. */
  triage_status?: string | null;
};

/** A human confirmed the lookalike is a real clone — the brand attribution is theirs, not the classifier's. */
const OPERATOR_CONFIRMED = new Set(["tp_confirmed", "tp_actioned"]);

/** True when the row's urlscan-derived facts must not be attributed to its brand. */
export function isAuditWithheld(row: AuditJudged): boolean {
  return (
    auditSampleOf(row.clone_watch_not_a_clone_samples) !== null &&
    row.clone_watch_classifications?.is_clone !== true &&
    // Released by a re-classification to is_clone=true (the v330 rule) OR by
    // an operator confirming it (review of #1258: only the classifier writes
    // is_clone, so without this a human-confirmed miss stayed "unclassified").
    !OPERATOR_CONFIRMED.has(row.triage_status ?? "")
  );
}

/** A withheld sample urlscan graded likely_phishing (v330 `miss_at`). */
export function isAuditMiss(row: AuditJudged): boolean {
  return (
    isAuditWithheld(row) &&
    Boolean(auditSampleOf(row.clone_watch_not_a_clone_samples)?.miss_at)
  );
}

/**
 * The row as a brand-attributed count may see it. Identity for every row that
 * is not a withheld sample; for a withheld one, a COPY with the audit scan's
 * facts removed (see above). Generic so reads with their own column list apply
 * the same rule. A key the row does not carry stays absent.
 */
export function withholdAuditVerdict<
  T extends AuditJudged & {
    urlscan_classification?: string | null;
    urlscan_evidence?: unknown;
    urlscan_uuid?: string | null;
    lifecycle_state?: string | null;
  },
>(row: T): T {
  if (!isAuditWithheld(row)) return row;
  const out: T = { ...row, urlscan_classification: null, urlscan_evidence: null };
  if ("urlscan_uuid" in row) out.urlscan_uuid = null;
  if (row.lifecycle_state === "monitoring") out.lifecycle_state = "detected";
  return out;
}

/**
 * A same-name spread across this many distinct TLDs is ONE bulk registration
 * (#1084). Calibrated on the June–September 2026 cohort under matcher v5
 * (per brand, per month, labels compared after IDN decode + confusable fold):
 *
 *   distinct TLDs   groups   domains   groups with a confirmed threat
 *   2               115      230       11
 *   3                27       81        5
 *   4                 7       28        3
 *   5+                6       36        1
 *
 * ≥3 starts folding coincidences of a common word (`eleven.*`, `stan.*`,
 * `target.nz/.tk/.bid`); ≥4 folds 13 groups / 64 domains over four months —
 * `amaz0n.*` × 7, `mc-donalds.*` × 7, `appie.*` × 6, `ubank.*` × 6. Under the
 * v3 matcher `gonds.*` × 9 was one of them and made Bonds August's spotlight
 * (v4's word gate has since killed eight of the nine). Groups are rarely
 * same-day: a bulk drop surfaces over 1–9 days of the feed, so the window is
 * the reporting month, not the ingest day.
 *
 * A burst is NOT benign — `appie.*` × 6 was a real Apple campaign with five
 * confirmed threats. That is why this is a counting unit and never a filter:
 * every domain stays an alert and in every per-domain metric; only the
 * brand's targeting-event count treats the spread as one decision by one
 * registrant.
 */
export const BULK_REGISTRATION_MIN_TLDS = 4;

/**
 * Whether a period's PER-BRAND numbers (ranking, spotlight, brand trend) are
 * targeting events rather than domains. Tied to the matcher cut-over, not to
 * the code in force: a month ingested under v4 keeps domains even when it is
 * re-folded by v5 code (#1262 review, D2).
 */
export function periodCountsTargetingEvents(periodMonth: string): boolean {
  return periodMonth.slice(0, 10) >= MATCHER_V5_FROM;
}

/** The unit printed beside a per-brand number from a targeting-events month. */
export const PER_BRAND_UNIT_EVENTS = "lookalikes (bulk registrations counted once)";

/**
 * The label for a per-brand number, by the unit the card says it is in. The
 * ONE place a per-brand count may be called "lookalike domains" — and only for
 * a pre-v5 period, when it was domains. A surface that prints a per-brand
 * number calls this; the only literal "lookalike domains" a surface may print
 * sits beside `total` (pinned by cloneWatchCountLabels.test.ts).
 */
export function perBrandUnitLabel(unit: "targeting_events" | "domains" | undefined): string {
  return unit === "targeting_events" ? PER_BRAND_UNIT_EVENTS : "lookalike domains";
}

/** The counting rule, in reader words — one home for the caption, the public
 *  edition page and the admin slides (#1262 review, D1). */
export const BULK_COUNTING_RULE = `Per brand, one name bulk-registered across ${BULK_REGISTRATION_MIN_TLDS}+ web endings in a month counts once.`;

export interface TargetingEvents {
  /** Distinct candidate domains, with each bulk registration counted once. */
  events: number;
  /** The folded groups, largest first — for the digest / audit, not the count. */
  bulkRegistrations: Array<{ label: string; domains: number }>;
}

/**
 * Fold ONE brand's distinct candidate domains into targeting events.
 *
 * Per brand, because the question is "how many times was THIS brand
 * targeted". The caller passes the brand's deduped domains for one month; the
 * key is `candidateLabelKey`, the matcher's own normalisation, so a label that
 * matched as the same name folds as the same name.
 */
export function countTargetingEvents(
  candidateDomains: Iterable<string>,
): TargetingEvents {
  const byLabel = new Map<string, Set<string>>();
  for (const d of candidateDomains) {
    const domain = d.trim().toLowerCase();
    if (!domain) continue;
    const label = candidateLabelKey(domain);
    const suffix = domain.slice(domain.indexOf(".") + 1);
    const tlds = byLabel.get(label) ?? new Set<string>();
    tlds.add(suffix);
    byLabel.set(label, tlds);
  }
  let events = 0;
  const bulkRegistrations: TargetingEvents["bulkRegistrations"] = [];
  for (const [label, tlds] of byLabel) {
    if (tlds.size >= BULK_REGISTRATION_MIN_TLDS) {
      events += 1;
      bulkRegistrations.push({ label, domains: tlds.size });
    } else {
      events += tlds.size;
    }
  }
  bulkRegistrations.sort((a, b) => b.domains - a.domains || a.label.localeCompare(b.label));
  return { events, bulkRegistrations };
}

/**
 * Rows that survive the cohort rules, applied to an already-fetched page.
 *
 * Split from the fetch so it is testable without a database — the FP rules are
 * where the judgement lives, and they were previously only reachable through a
 * live query.
 *
 * Every surviving row also passes through `withholdAuditVerdict`, so a cohort
 * consumer cannot forget to do it and attribute a not-a-clone audit scan to a
 * brand. The row is kept because membership is lexical. Only the audit's facts
 * are removed.
 */
export function applyCohortRules(rows: CloneAlertRow[]): CloneAlertRow[] {
  return rows.map(withholdAuditVerdict).filter(
    (r) =>
      // Confirmed false positives only. Untriaged (null) rows are the majority
      // and are exactly what these surfaces exist to report.
      r.triage_status !== "fp" &&
      // Generic-dictionary brands (domain.com.au, lendi.com.au, …) that produce
      // matches on ordinary words. Belt-and-braces against a stale detection
      // that was never triaged.
      !isFpBrand(r.inferred_target_domain),
  );
}

/**
 * NO FETCH LIVES HERE, deliberately.
 *
 * An earlier draft of this Module wrapped the read as well, behind a
 * `CohortSource` port. It was never wired, and wiring it would have been a
 * mistake twice over:
 *
 *   - pagination is ALREADY factored out, into `fetchAllRows`
 *     (@askarthur/supabase/paginate), which both callers use and which handles
 *     the short-page end-of-set signal and the `truncated` ceiling more
 *     carefully than the wrapper did; and
 *   - the port only carried `select` + window + range, so each caller still had
 *     to spell out the identical `.eq/.gte/.lt/.not/.or/.order` chain in its
 *     adapter. The duplication would have moved, not gone — which is the
 *     deletion test failing.
 *
 * What genuinely had two owners was the SELECT list and the cohort rules, and
 * those are the constants and pure functions above. Callers keep the two
 * policies that really are theirs — the row ceiling, and whether a failed read
 * degrades or throws — and share everything else.
 */
