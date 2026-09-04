/**
 * Clone metrics — the per-brand rollup every reporting surface folds to.
 *
 * `CloneBrandMetrics` and `aggregateClonesByDomain` are the domain's central
 * rollup, and until now they lived inside report-brand-stewardship.ts — a
 * 1,000-line Inngest cron whose actual job is sending an email. Four `lib/`
 * Modules imported their core types from a background job, and that inversion
 * was not academic: it is why clone-watch-report-summary.ts exists as its own
 * Inngest function rather than folding into the internal digest (report-card-data
 * imported `buildRegistrarRollup` FROM the digest, so importing the card back
 * into the digest closed a value cycle). Moving the folds here dissolves it.
 *
 * Everything in this Module is PURE — no Supabase, no Inngest, no Next. The
 * cohort's row shape lives next door in clone-cohort.ts; this file is what you
 * fold those rows INTO.
 */
import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import { urlscanEvidenceFromJsonb } from "@/lib/clone-watch/urlscan-evidence";

// Per-brand detail rows stored in metrics.clones.domains. Sized so the public
// share page (/clone-report/[token]) is effectively the FULL list for all
// real-world volumes (observed max ~30/brand); the email renders a much smaller
// slice (EMAIL_CLONE_DISPLAY_CAP in BrandStewardshipReport) and links here for
// the rest. by_country/registrar/asn + `detected` always reflect the true total.
const CLONE_DETAIL_CAP = 100;

export interface CloneDetail {
  domain: string;
  classification: string | null;
  ip: string | null;
  asn: string | null;
  country: string | null;
  registrar: string | null;
  abuse_email: string | null;
  /** F2 watch-list fields — persist verbatim (snake_case) into the metrics
   *  ledger; rows written before F2 simply lack the keys. */
  lifecycle_state: string | null;
  first_seen_at: string | null;
  screenshot_url: string | null;
  result_url: string | null;
  /** Honest "observed live" timestamp: weaponised→weaponised_at,
   *  declined→netcraft_declined_at (the vendor observed the live site when
   *  grading), else null. last_rechecked_at is NOT used — it stamps when a
   *  rescan is TRIGGERED, not when the site was seen live. */
  still_live_as_of: string | null;
  /** F3 weaponisation-risk score (0-100) — a point-in-time ledger snapshot of
   *  the ONE formula in lib/clone-watch/weaponisation-risk.ts (null when the
   *  caller didn't compute risk, e.g. the LinkedIn report card path). */
  risk_score: number | null;
}

export interface CloneBrandMetrics {
  detected: number;
  /** Distinct clone domains we submitted to Netcraft (browser/blocklist). */
  netcraftReported: number;
  /** Netcraft actioned it (lifecycle taken_down). */
  takenDown: number;
  /** Netcraft graded it non-malicious (lifecycle declined) — still live/parked. */
  declined: number;
  /** We filed a report_issue to force a re-review (netcraft_issue.issue_reported_at). */
  escalated: number;
  /** Flipped to active phishing (lifecycle weaponised) — "declined ≠ safe". */
  weaponised: number;
  /** Weaponised AND previously Netcraft-declined (netcraft_declined_at set) —
   *  the only subset for which the "graded no-threat, later flipped" story is
   *  provable. Most weaponised clones were phishing at FIRST scan (32/33 in
   *  prod, 2026-07-11) and were never graded by the vendor at all. */
  weaponisedAfterDecline: number;
  /** Escalated AND now taken_down — the "we forced it through" win. */
  reTakenDown: number;
  byClassification: Record<string, number>;
  /** Consumable analytics — counts across ALL deduped clones (not just the
   *  capped detail list), so the email's breakdown bars reflect the full set. */
  byCountry: Record<string, number>;
  byRegistrar: Record<string, number>;
  byAsn: Record<string, number>;
  domains: CloneDetail[];
  alertIds: number[];
}

/**
 * Bucket a nullable dimension value, folding empties into "Unknown".
 * Coerces with String() because the values come from the clone attribution
 * JSONB (asn / country / registrar), where a value can be a NUMBER at runtime
 * (e.g. an ASN stored as an integer) despite the typed shape — calling .trim()
 * on a number threw `TypeError: t.trim is not a function` and aborted the whole
 * monthly prepare run (2026-06-15).
 */
function bump(map: Record<string, number>, value: unknown): void {
  const s = value == null ? "" : String(value).trim();
  const key = s || "Unknown";
  map[key] = (map[key] ?? 0) + 1;
}

export function toCloneDetail(
  row: CloneAlertRow,
  riskScore: number | null = null,
): CloneDetail {
  const server = row.urlscan_evidence?.server ?? {};
  // Fall back to the attribution dossier's hosting block when the live urlscan
  // render didn't capture server info (e.g. a clone enriched before its scan
  // completed). Belt-and-suspenders so a clone shows whatever hosting we have.
  const attrHosting = row.attribution?.hosting ?? {};
  const whois = row.attribution?.whois ?? {};
  const stillLiveAsOf =
    row.lifecycle_state === "weaponised"
      ? (row.weaponised_at ?? null)
      : row.lifecycle_state === "declined"
        ? (row.netcraft_declined_at ?? null)
        : null;
  return {
    domain: row.candidate_domain,
    classification: row.urlscan_classification ?? null,
    ip: server.ip ?? attrHosting.ip ?? null,
    asn: server.asn ?? attrHosting.asn ?? null,
    country: server.country ?? attrHosting.country ?? null,
    registrar: whois.registrar ?? null,
    abuse_email: whois.registrarAbuseEmail ?? null,
    lifecycle_state: row.lifecycle_state ?? null,
    first_seen_at: row.first_seen_at ?? null,
    // ONE decoder for the urlscan_evidence jsonb shape (uuid → result page,
    // screenshot_url) — shared with the brand-alert prepare cron.
    screenshot_url:
      urlscanEvidenceFromJsonb(row.urlscan_evidence)?.screenshotUrl ?? null,
    result_url:
      urlscanEvidenceFromJsonb(row.urlscan_evidence)?.resultUrl ?? null,
    still_live_as_of: stillLiveAsOf,
    risk_score: riskScore,
  };
}

/** F3: the brand's highest-risk STILL-UNACTIONED lookalikes (declined/
 *  monitoring — weaponised rows already headline). Pure; exported for tests. */
export function topRiskUnactioned(
  domains: CloneDetail[],
  n = 5,
): Array<{ domain: string; risk_score: number }> {
  return domains
    .filter(
      (d) =>
        (d.lifecycle_state === "declined" ||
          d.lifecycle_state === "monitoring") &&
        typeof d.risk_score === "number",
    )
    .sort(
      (a, b) =>
        (b.risk_score ?? 0) - (a.risk_score ?? 0) ||
        a.domain.localeCompare(b.domain),
    )
    .slice(0, n)
    .map((d) => ({ domain: d.domain, risk_score: d.risk_score as number }));
}

// Order detail rows so the most actionable (likely_phishing) surface first.
const CLONE_CLASS_RANK: Record<string, number> = {
  likely_phishing: 0,
  parked_for_sale: 1,
  unresolved: 2,
  neutral: 3,
};

// F2 watch-list ordering: still-live rows lead the list — the unactioned
// exposure IS the deliverable; actioned/dormant rows sink to the tail.
const LIFECYCLE_LIVE_RANK: Record<string, number> = {
  weaponised: 0,
  declined: 1,
  monitoring: 2,
  taken_down: 4,
  dormant: 5,
};
const LIFECYCLE_LIVE_RANK_DEFAULT = 3; // detected / null / unknown

/**
 * Group clone-watch alerts by the impersonated brand's domain
 * (inferred_target_domain). Dedupes by candidate_domain, counts by
 * classification, and caps the per-brand detail list. Pure + unit-tested.
 */
export function aggregateClonesByDomain(
  rows: CloneAlertRow[],
  riskByAlertId?: Record<number, number>,
): Map<string, CloneBrandMetrics> {
  const out = new Map<string, CloneBrandMetrics>();
  const seenDomain = new Map<string, Set<string>>();

  for (const row of rows) {
    const brandDomain = row.inferred_target_domain?.trim().toLowerCase();
    if (!brandDomain || !row.candidate_domain) continue;

    let m = out.get(brandDomain);
    if (!m) {
      m = {
        detected: 0,
        netcraftReported: 0,
        takenDown: 0,
        declined: 0,
        escalated: 0,
        weaponised: 0,
        weaponisedAfterDecline: 0,
        reTakenDown: 0,
        byClassification: {},
        byCountry: {},
        byRegistrar: {},
        byAsn: {},
        domains: [],
        alertIds: [],
      };
      out.set(brandDomain, m);
      seenDomain.set(brandDomain, new Set());
    }
    const seen = seenDomain.get(brandDomain)!;
    // PER-BRAND dedupe — deliberately NOT the cohort's global
    // dedupeByCandidate (clone-cohort.ts). A clone domain impersonating two
    // brands is one detection for each of them here, because this map is
    // "what did each brand see". Same words, different question; keep them
    // apart rather than sharing an implementation.
    if (seen.has(row.candidate_domain)) continue;
    seen.add(row.candidate_domain);

    m.detected += 1;
    if (row.submitted_to && "netcraft" in row.submitted_to) {
      m.netcraftReported += 1;
    }
    // Lifecycle-transition counts (PR3.2) — the story the reconciler (PR3.1) now
    // populates: taken_down / declined / escalated / weaponised / re-taken-down.
    const escalated = Boolean(
      (
        row.submitted_to?.["netcraft_issue"] as
          | { issue_reported_at?: unknown }
          | undefined
      )?.issue_reported_at,
    );
    if (escalated) m.escalated += 1;
    if (row.lifecycle_state === "taken_down") {
      m.takenDown += 1;
      if (escalated) m.reTakenDown += 1;
    } else if (row.lifecycle_state === "declined") {
      m.declined += 1;
    } else if (row.lifecycle_state === "weaponised") {
      m.weaponised += 1;
      if (row.netcraft_declined_at) m.weaponisedAfterDecline += 1;
    }
    m.alertIds.push(row.id);
    const cls = row.urlscan_classification ?? "unclassified";
    m.byClassification[cls] = (m.byClassification[cls] ?? 0) + 1;
    const detail = toCloneDetail(row, riskByAlertId?.[row.id] ?? null);
    bump(m.byCountry, detail.country);
    bump(m.byRegistrar, detail.registrar);
    bump(m.byAsn, detail.asn);
    m.domains.push(detail);
  }

  // Sort + cap each brand's detail list. F2: still-live rows first (the
  // watch-list is the deliverable), then most-actionable classification.
  for (const m of out.values()) {
    m.domains.sort((a, b) => {
      const la =
        LIFECYCLE_LIVE_RANK[a.lifecycle_state ?? ""] ??
        LIFECYCLE_LIVE_RANK_DEFAULT;
      const lb =
        LIFECYCLE_LIVE_RANK[b.lifecycle_state ?? ""] ??
        LIFECYCLE_LIVE_RANK_DEFAULT;
      if (la !== lb) return la - lb;
      const ra = CLONE_CLASS_RANK[a.classification ?? ""] ?? 9;
      const rb = CLONE_CLASS_RANK[b.classification ?? ""] ?? 9;
      return ra !== rb ? ra - rb : a.domain.localeCompare(b.domain);
    });
    m.domains = m.domains.slice(0, CLONE_DETAIL_CAP);
  }
  return out;
}


/** Aggregate every brand's per-registrar clone counts (uncapped — byRegistrar
 *  is summed before the per-brand 100-cap) into one global rollup, plus a
 *  best-effort registrar→abuse-email map from the (capped) detail rows. The
 *  null/empty-registrar bucket is keyed "Unknown" by the shared aggregator. */
export function buildRegistrarRollup(byBrand: Map<string, CloneBrandMetrics>): {
  rows: Array<{ registrar: string; clones: number; abuseEmail: string | null }>;
  unknownCount: number;
} {
  const counts = new Map<string, number>();
  const abuse = new Map<string, string>();
  for (const [, m] of byBrand) {
    for (const [reg, n] of Object.entries(m.byRegistrar)) {
      counts.set(reg, (counts.get(reg) ?? 0) + n);
    }
    for (const d of m.domains) {
      if (d.registrar && d.abuse_email && !abuse.has(d.registrar)) {
        abuse.set(d.registrar, d.abuse_email);
      }
    }
  }
  const unknownCount = counts.get("Unknown") ?? 0;
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([registrar, clones]) => ({
      registrar,
      clones,
      abuseEmail: abuse.get(registrar) ?? null,
    }));
  return { rows, unknownCount };
}

