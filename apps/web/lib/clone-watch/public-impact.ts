/**
 * The public clone-watch impact numbers and their words — one home for the two
 * surfaces that publish them: the /clone-watch impact panel and the /hub
 * clone-watch chapter. Both read `clone_watch_public_impact` (v340).
 *
 * WHY THIS FILE EXISTS. The two surfaces each typed their own row and their own
 * sentences, and both carried the same false claim — "We never publish which
 * specific domains we report" — on a page that lists them. The page's panel also
 * promised reports "to the affected brand's security team" while
 * `brand_notifications_total` was 0 (that lane has never fired; the hub had
 * already dropped the claim, the page had not). One wording, read by both,
 * keeps a correction from landing on one surface only.
 *
 * Founder decision 2026-09-28: say it plainly. The listed domains are confirmed
 * lookalikes, and we report confirmed lookalikes to Netcraft. Enforcement of
 * "every listed domain was reported": the /clone-watch list query requires
 * `submitted_to->netcraft` (app/clone-watch/page.tsx getAlerts).
 *
 * Zero imports, so a server page, the hub and tests share it.
 */

/** One `clone_watch_public_impact` row (v340 semantics). */
export interface PublicImpactSnapshot {
  window_days: number;
  /** NRD brand-name matches in the window, excluding rows cleared as false
   *  positives (v340). NOT confirmed lookalikes — most are never confirmed. */
  candidates_total: number;
  tp_confirmed_total: number;
  /** Of those matches, how many we reported to Netcraft (a subset, v340). */
  netcraft_submits_total: number;
  brand_notifications_total: number;
  brands_protected: number;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The RPC's single row, or null when there is none or a count is missing. A
 * failed RPC returns no rows AND no error, and a confident "0 matches" on a
 * page whose proposition is "we measure this" is worse than showing nothing.
 */
export function parsePublicImpact(data: unknown): PublicImpactSnapshot | null {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row || typeof row !== "object") return null;
  const candidates = num(row.candidates_total);
  const netcraft = num(row.netcraft_submits_total);
  const brands = num(row.brands_protected);
  if (candidates === null || netcraft === null || brands === null) return null;
  return {
    window_days: num(row.window_days) ?? 30,
    candidates_total: candidates,
    tp_confirmed_total: num(row.tp_confirmed_total) ?? 0,
    netcraft_submits_total: netcraft,
    brand_notifications_total: num(row.brand_notifications_total) ?? 0,
    brands_protected: brands,
  };
}

/** The tile label for `candidates_total`. "Candidates surfaced" read as a
 *  count of suspects; it is a count of name matches (v340 excludes the ones
 *  cleared as false positives, nothing more). */
export const MATCHES_LABEL = "Brand-name matches";

export const REPORTED_LABEL = "Reported to Netcraft";

/**
 * THE sentence about what we publish and whom we report to. Used under the
 * impact panel and as the hub chapter's note.
 */
export const REPORTING_STATEMENT =
  "Every domain listed on this page is a confirmed lookalike that we have reported to Netcraft, whose verdicts feed the blocklists browsers use. Brand-name matches that are not confirmed are counted here but never listed.";

/** The hub's variant: it has no list of its own, so it points at the page's. */
export const REPORTING_STATEMENT_ELSEWHERE =
  "Clone-watch lists confirmed lookalikes, and we report confirmed lookalikes to Netcraft, whose verdicts feed the blocklists browsers use.";
