import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrandCloneSample,
  CloneSampleRow,
} from "@/emails/BrandOutreachPilot";

/**
 * Live clone-detection sample for the brand-outreach pilot email.
 *
 * The founder's cold pilot email (Surface 1, docs/policy/brand-comms-legal-
 * review-pack.md) has to *prove* the value: alongside the offer it shows a real
 * sample of the lookalike domains Ask Arthur has already detected + reported for
 * that brand in the last 30 days. This module reads `shopfront_clone_alerts`
 * (the same table the monthly Brand Stewardship report aggregates — single
 * source of truth for "what we consider a clone detection") and shapes it into
 * the lean `BrandCloneSample` the template renders.
 *
 * "Reported on your behalf" is deliberate, honest wording (Axis A): a clone
 * counts as *reported* when we forwarded it to Netcraft (browser/blocklist), or
 * when it reached `weaponised` / `taken_down` (states that only follow a report).
 * We never claim a takedown we didn't cause, and never characterise a registrant.
 */

/** Window the sample is drawn over (matches the founder's "last 30 days" copy). */
export const CLONE_SAMPLE_WINDOW_DAYS = 30;
/** Rows shown in the email (the rest are "+ N more, comes with the pilot"). */
export const CLONE_SAMPLE_SIZE = 5;
/**
 * Founder's rule: only pitch brands we have *lots* of data on. Below this many
 * recent reported clones the composer shows a "not a strong target" warning
 * (a nudge — NOT a hard block; the founder can still send).
 */
export const MIN_REPORTED_CLONES_FOR_OUTREACH = 3;

/** Columns we read — kept in one place so the select + tests stay in sync. */
export const CLONE_SAMPLE_SELECT =
  "candidate_domain, inferred_target_domain, urlscan_classification, urlscan_evidence, urlscan_uuid, attribution, submitted_to, lifecycle_state, first_seen_at";

/** Raw `shopfront_clone_alerts` row shape for the columns we select. */
export interface RawCloneAlert {
  candidate_domain: string | null;
  inferred_target_domain: string | null;
  urlscan_classification: string | null;
  urlscan_evidence: {
    server?: { ip?: string; asn?: string; country?: string };
    uuid?: string;
  } | null;
  urlscan_uuid: string | null;
  attribution: {
    whois?: { registrar?: string | null };
    hosting?: { ip?: string; asn?: string; country?: string };
  } | null;
  submitted_to: Record<string, unknown> | null;
  lifecycle_state: string | null;
  first_seen_at: string | null;
}

/** Compact "IP · ASN · CC" hosting line, or null when nothing was captured. */
function hostingLine(raw: RawCloneAlert): string | null {
  const server = raw.urlscan_evidence?.server ?? {};
  const attr = raw.attribution?.hosting ?? {};
  const parts = [
    server.ip ?? attr.ip,
    server.asn ?? attr.asn,
    server.country ?? attr.country,
  ].filter((p): p is string => Boolean(p) && typeof p === "string");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** True when we forwarded this clone to Netcraft on the brand's behalf. */
export function isReportedToNetcraft(raw: RawCloneAlert): boolean {
  return Boolean(raw.submitted_to && "netcraft" in raw.submitted_to);
}

/**
 * A clone counts as "reported on their behalf" when we forwarded it to Netcraft,
 * OR it reached weaponised / taken_down (both only occur after a report). This
 * is the number the founder's "enough data to pitch" rule keys on.
 */
export function isReportedRow(row: CloneSampleRow): boolean {
  return (
    row.reportedToNetcraft ||
    row.lifecycleState === "weaponised" ||
    row.lifecycleState === "taken_down"
  );
}

/** Map a raw alert row → the presentation-ready sample row. Pure. */
export function shapeCloneAlert(raw: RawCloneAlert): CloneSampleRow {
  const uuid = raw.urlscan_uuid ?? raw.urlscan_evidence?.uuid ?? null;
  return {
    domain: raw.candidate_domain ?? "",
    lifecycleState: raw.lifecycle_state ?? null,
    classification: raw.urlscan_classification ?? null,
    detectedAt: raw.first_seen_at ?? null,
    reportedToNetcraft: isReportedToNetcraft(raw),
    registrar: raw.attribution?.whois?.registrar ?? null,
    host: hostingLine(raw),
    resultUrl: uuid ? `https://urlscan.io/result/${uuid}/` : null,
  };
}

/**
 * Priority tier for the sample — the most compelling, provably-actioned rows
 * first (weaponised → taken down → reported), then the merely-detected tail.
 * Lower = shown first.
 */
function rankTier(row: CloneSampleRow): number {
  if (row.lifecycleState === "weaponised") return 0; // active phishing — sharpest
  if (row.lifecycleState === "taken_down") return 1; // a clear win
  if (row.reportedToNetcraft) return 2; // reported on their behalf
  if (row.lifecycleState === "declined") return 3; // reported, vendor said no-threat
  if (row.lifecycleState === "monitoring") return 4;
  return 5; // detected / null
}

/** Sort by priority tier, then newest-detected first. Pure/stable-ish. */
export function compareSampleRows(a: CloneSampleRow, b: CloneSampleRow): number {
  const ta = rankTier(a);
  const tb = rankTier(b);
  if (ta !== tb) return ta - tb;
  const da = a.detectedAt ? Date.parse(a.detectedAt) : 0;
  const db = b.detectedAt ? Date.parse(b.detectedAt) : 0;
  if (db !== da) return db - da;
  return a.domain.localeCompare(b.domain);
}

/**
 * Build the `BrandCloneSample` from raw rows: dedupe by candidate_domain, count
 * the true totals, rank, and slice to the display size. Pure + unit-tested — the
 * fetch (getBrandCloneSample) is the only impure wrapper.
 */
export function buildBrandCloneSample(
  rawRows: RawCloneAlert[],
  brandDomain: string,
): BrandCloneSample {
  const byDomain = new Map<string, CloneSampleRow>();
  for (const raw of rawRows) {
    if (!raw.candidate_domain) continue;
    const shaped = shapeCloneAlert(raw);
    // Dedupe: keep the highest-priority row for a repeated clone domain.
    const existing = byDomain.get(shaped.domain);
    if (!existing || compareSampleRows(shaped, existing) < 0) {
      byDomain.set(shaped.domain, shaped);
    }
  }
  const all = [...byDomain.values()];
  const reportedCount = all.filter(isReportedRow).length;
  const weaponisedCount = all.filter(
    (r) => r.lifecycleState === "weaponised",
  ).length;
  const takenDownCount = all.filter(
    (r) => r.lifecycleState === "taken_down",
  ).length;

  const rows = [...all].sort(compareSampleRows).slice(0, CLONE_SAMPLE_SIZE);

  return {
    brandDomain,
    windowDays: CLONE_SAMPLE_WINDOW_DAYS,
    totalCount: all.length,
    reportedCount,
    weaponisedCount,
    takenDownCount,
    rows,
    insufficientData: reportedCount < MIN_REPORTED_CLONES_FOR_OUTREACH,
  };
}

/**
 * Fetch + shape the clone sample for a brand's legit domain (the worklist's
 * brand_key == shopfront_clone_alerts.inferred_target_domain). Returns null when
 * no domain is supplied (ad-hoc sends) or the query fails — callers then render
 * the email without a sample section. Mirrors the Brand Stewardship clone fetch
 * filters (source='nrd', not-FP, first_seen_at window) so the sample is always a
 * subset of what the monthly report would show.
 */
export async function getBrandCloneSample(
  sb: SupabaseClient,
  brandDomain: string | null | undefined,
): Promise<BrandCloneSample | null> {
  const domain = brandDomain?.trim().toLowerCase();
  if (!domain) return null;

  const since = new Date(
    Date.now() - CLONE_SAMPLE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Over-fetch (dedupe + ranking happen in-memory); a month of one brand's
  // clones is small (observed max ~80/brand). Newest first as a sensible cap.
  const { data, error } = await sb
    .from("shopfront_clone_alerts")
    .select(CLONE_SAMPLE_SELECT)
    .eq("inferred_target_domain", domain)
    .eq("source", "nrd")
    .gte("first_seen_at", since)
    .or("triage_status.is.null,triage_status.neq.fp")
    .order("first_seen_at", { ascending: false })
    .limit(200);

  if (error) return null;
  return buildBrandCloneSample((data ?? []) as unknown as RawCloneAlert[], domain);
}
