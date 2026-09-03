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
 * DEPTH: one call returns the rows a period's figures may be computed from,
 * with pagination, the cohort rules, the FP denylist and truncation reporting
 * behind it. Callers keep the policy that is genuinely theirs — whether a
 * failed fetch should degrade or fail the run — and nothing else.
 *
 * This Module owns `CloneAlertRow` because the row shape IS the cohort's
 * Interface. It previously lived in the brand-stewardship Inngest function,
 * which meant pure library Modules imported their core type from a background
 * job — and that inverted dependency is why the two SELECT lists could drift in
 * the first place: the shape had two owners and no home.
 */
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
  inferred_target_domain: string | null;
  urlscan_classification: string | null;
  urlscan_evidence: {
    server?: { ip?: string; asn?: string; country?: string };
    /** Present when the urlscan retrieval succeeded (see urlscan-classify.ts). */
    screenshot_url?: string;
    /** Submission uuid — the public result page is derived from it. */
    uuid?: string;
  } | null;
  attribution: {
    whois?: {
      registrar?: string;
      registrarAbuseEmail?: string;
      createdDate?: string;
      nameServers?: string[];
      registrantCountry?: string;
    };
    hosting?: { ip?: string; asn?: string; country?: string };
    ip_rep?: { abuseConfidenceScore?: number };
    au_registrant?: { abnStatus?: string; nameMatchesAbn?: boolean | null };
  } | null;
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
  } | null;
  submitted_to: Record<string, unknown> | null;
  lifecycle_state?: string | null;
  netcraft_declined_at?: string | null;
  weaponised_at?: string | null;
  first_seen_at?: string | null;
  triage_status?: string | null;
}

/**
 * The one SELECT every cohort read uses.
 *
 * A superset of what any single caller needs, deliberately: the cost of an
 * extra column on ~1,000 rows a month is nil, and the cost of a caller quietly
 * missing one is a distribution that reads as 100% unknown.
 */
export const CLONE_COHORT_SELECT =
  "id, candidate_domain, inferred_target_domain, urlscan_classification, urlscan_evidence, attribution, submitted_to, lifecycle_state, netcraft_declined_at, weaponised_at, first_seen_at, triage_status, signals, campaign_key, clone_watch_classifications(is_clone, confidence, attack_intent, clone_tactic)";

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
 * Rows that survive the cohort rules, applied to an already-fetched page.
 *
 * Split from the fetch so it is testable without a database — the FP rules are
 * where the judgement lives, and they were previously only reachable through a
 * live query.
 */
export function applyCohortRules(rows: CloneAlertRow[]): CloneAlertRow[] {
  return rows.filter(
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

export interface CohortWindow {
  startIso: string;
  endIso: string;
}

export interface CohortResult {
  rows: CloneAlertRow[];
  /** True when the row cap was hit — the caller decides whether that is fatal. */
  truncated: boolean;
}

/** Minimal client surface, so the cohort is testable without Supabase. */
export interface CohortSource {
  page(
    select: string,
    window: CohortWindow,
    from: number,
    to: number,
  ): Promise<{ data: CloneAlertRow[] | null; error: { message: string } | null }>;
}

const PAGE_SIZE = 1000;
const DEFAULT_MAX_ROWS = 20_000;

/**
 * The period's cohort: paginated, filtered, deduped.
 *
 * THROWS on a read error rather than returning an empty cohort. An empty month
 * and a failed read are different facts, and a Module that conflates them hands
 * every caller a silent zero. Callers that would rather degrade than fail catch
 * it — the brand-stewardship digest does exactly that — but they do so
 * knowingly.
 */
export async function fetchCloneCohort(
  source: CohortSource,
  window: CohortWindow,
  opts: { maxRows?: number } = {},
): Promise<CohortResult> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const raw: CloneAlertRow[] = [];
  let truncated = false;

  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, maxRows) - 1;
    const { data, error } = await source.page(CLONE_COHORT_SELECT, window, from, to);
    if (error) throw new Error(`clone cohort fetch failed: ${error.message}`);
    const page = data ?? [];
    raw.push(...page);
    if (page.length < to - from + 1) break;
    if (raw.length >= maxRows) {
      truncated = true;
      break;
    }
  }

  return { rows: dedupeByCandidate(applyCohortRules(raw)), truncated };
}
