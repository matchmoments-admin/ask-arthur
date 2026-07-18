// Live clone-sample fetch for the pilot-outreach email.
//
// The founder-composed pilot email (/admin/brand-outreach) proves its value by
// showing a SAMPLE of the lookalike domains Ask Arthur has actually detected +
// reported for the target brand in the last 30 days. This module owns that
// read: given the brand's legit domain (the worklist's brand_key ==
// inferred_target_domain, already lowercased), it returns the 30-day totals
// plus a small, actioned-first display sample.
//
// It is deliberately a COMPACT taste, not the full Brand Stewardship breakdown
// (no BreakdownBars / top-risk / self-serve takedown links) — a cold pitch
// shows the problem and lets the note sell the solution. The hosting/registrar
// fallback mirrors toCloneDetail (report-brand-stewardship.ts) so the two
// surfaces read a clone the same way.

import type { SupabaseClient } from "@supabase/supabase-js";

/** One clone row shown in the outreach sample — a subset of CloneDetail. */
export interface OutreachCloneRow {
  domain: string;
  classification: string | null;
  lifecycleState: string | null;
  firstSeenAt: string | null;
  ip: string | null;
  asn: string | null;
  country: string | null;
  registrar: string | null;
}

export interface OutreachCloneSample {
  /** The brand's legit domain the sample was keyed on. */
  brandDomain: string;
  /** Distinct lookalike domains detected for the brand in the window. */
  total: number;
  /** …of which we submitted to a takedown vendor (Netcraft submit OR issue). */
  reported: number;
  /** The display slice, actioned-/live-first, capped. */
  rows: OutreachCloneRow[];
}

/** Rows fetched from shopfront_clone_alerts (the columns we map). */
interface RawAlertRow {
  candidate_domain: string | null;
  urlscan_classification: string | null;
  urlscan_evidence: {
    server?: { ip?: string; asn?: string; country?: string };
  } | null;
  attribution: {
    whois?: { registrar?: string };
    hosting?: { ip?: string; asn?: string; country?: string };
  } | null;
  submitted_to: Record<string, unknown> | null;
  lifecycle_state: string | null;
  first_seen_at: string | null;
}

// A brand's 30-day clone volume is small (prod avg ~6, campaign spikes to a few
// dozen), so a bounded read is exact for every real case; the cap is a runaway
// guard, not a paging boundary.
const FETCH_CAP = 500;
const DEFAULT_WINDOW_DAYS = 30;

// Lead the sample with the scariest LIVE evidence — active phishing first, then
// graded-but-live, then still-unscanned; already-actioned/dormant sink last.
const DISPLAY_RANK: Record<string, number> = {
  weaponised: 0,
  declined: 1,
  monitoring: 2,
  detected: 3,
  taken_down: 4,
  dormant: 5,
};
const DISPLAY_RANK_DEFAULT = 3;

/** True when we submitted this clone to Netcraft (initial submit or a filed
 *  re-review issue) — the honest basis for "reported on your behalf". */
function wasReported(submittedTo: Record<string, unknown> | null): boolean {
  if (!submittedTo) return false;
  return "netcraft" in submittedTo || "netcraft_issue" in submittedTo;
}

/** Map a raw alert row to the compact sample shape. Hosting falls back from the
 *  live urlscan render to the attribution dossier, matching toCloneDetail. */
function toOutreachRow(r: RawAlertRow): OutreachCloneRow {
  const server = r.urlscan_evidence?.server ?? {};
  const attrHosting = r.attribution?.hosting ?? {};
  return {
    domain: r.candidate_domain ?? "",
    classification: r.urlscan_classification ?? null,
    lifecycleState: r.lifecycle_state ?? null,
    firstSeenAt: r.first_seen_at ?? null,
    ip: server.ip ?? attrHosting.ip ?? null,
    asn: server.asn ?? attrHosting.asn ?? null,
    country: server.country ?? attrHosting.country ?? null,
    registrar: r.attribution?.whois?.registrar ?? null,
  };
}

/**
 * Fetch the outreach clone sample for a brand. Never throws — on any error (no
 * service client, query failure, unexpected mock in tests) it resolves to an
 * empty sample so the email simply omits the data section. `brandDomain` must
 * be the lowercased legit domain (the worklist's brand_key).
 */
export async function fetchOutreachCloneSample(
  sb: SupabaseClient | null,
  brandDomain: string,
  opts: { displayLimit?: number; windowDays?: number } = {},
): Promise<OutreachCloneSample> {
  const displayLimit = opts.displayLimit ?? 5;
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const empty: OutreachCloneSample = {
    brandDomain,
    total: 0,
    reported: 0,
    rows: [],
  };
  if (!sb || !brandDomain) return empty;

  try {
    const sinceIso = new Date(
      Date.now() - windowDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await sb
      .from("shopfront_clone_alerts")
      .select(
        "candidate_domain, urlscan_classification, urlscan_evidence, attribution, submitted_to, lifecycle_state, first_seen_at",
      )
      .eq("source", "nrd")
      .eq("inferred_target_domain", brandDomain)
      .or("triage_status.is.null,triage_status.neq.fp")
      .gte("first_seen_at", sinceIso)
      .order("first_seen_at", { ascending: false })
      .limit(FETCH_CAP);
    if (error || !data) return empty;

    const raw = data as unknown as RawAlertRow[];
    // Dedupe by candidate_domain (a clone can be re-detected across scans).
    const seen = new Set<string>();
    const rows: RawAlertRow[] = [];
    for (const r of raw) {
      const d = r.candidate_domain?.trim().toLowerCase();
      if (!d || seen.has(d)) continue;
      seen.add(d);
      rows.push(r);
    }

    const total = rows.length;
    const reported = rows.filter((r) => wasReported(r.submitted_to)).length;

    const sample = rows
      .map(toOutreachRow)
      .sort((a, b) => {
        const ra = DISPLAY_RANK[a.lifecycleState ?? ""] ?? DISPLAY_RANK_DEFAULT;
        const rb = DISPLAY_RANK[b.lifecycleState ?? ""] ?? DISPLAY_RANK_DEFAULT;
        if (ra !== rb) return ra - rb;
        return (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? "");
      })
      .slice(0, displayLimit);

    return { brandDomain, total, reported, rows: sample };
  } catch {
    return empty;
  }
}
