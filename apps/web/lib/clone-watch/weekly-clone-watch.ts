// Weekly Clone Watch section for the Monday intel email (Arthur's Watch).
//
// Returns the newest operator-CONFIRMED lookalike/impersonation domains detected
// in the last 7 days by the clone-watch NRD sweep, for a "Clone Watch" section
// in the weekly newsletter. This is a proprietary, un-copyable signal — a
// signature segment.
//
// DEFAMATION SAFETY (critical): the newsletter NAMES brands, so we publish ONLY
// operator-confirmed clones — the exact same filter the public /clone-watch page
// uses (triage_status IN ('tp_confirmed','tp_actioned') + alert_state='open' +
// source='nrd'), plus the isFpBrand() denylist as belt-and-braces. Without this
// we would publicly accuse legitimate businesses of being clones.
//
// Graceful: returns [] on no client / no rows so the email section vanishes.
// The newsletter never depends on this stream (steady-state is ~170 confirmed
// clones/week, but a stalled ingest just yields an empty section).
//
// Service-role read (clone-watch tables are service-role only); the weekly-email
// cron already uses createServiceClient. Reads do NOT consult
// FF_SHOPFRONT_CLONE_WATCH (that flag gates writes only).

import { createServiceClient } from "@askarthur/supabase/server";

import { prettyBrand } from "./brand-display";
import { isFpBrand } from "./fp-brand-denylist";

const DAYS = 7;
const MAX_ITEMS = 5;
// Fetch more than we show so brand-dedup + live-first ordering have material.
const SCAN_LIMIT = 100;

export interface CloneWatchEntry {
  /** The impersonating / cloned domain (no scheme). */
  fakeDomain: string;
  /** Display name of the impersonated brand, or null if unknown. */
  brand: string | null;
  /** The brand's real/official domain, or null. */
  realDomain: string | null;
}

interface AlertRow {
  candidate_domain: string;
  inferred_target_domain: string | null;
  severity: number | null;
  first_seen_at: string;
  urlscan_classification: string | null;
  lifecycle_state: string | null;
}

export async function getWeeklyCloneWatch(): Promise<CloneWatchEntry[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("shopfront_clone_alerts")
    .select(
      "candidate_domain, inferred_target_domain, severity, first_seen_at, urlscan_classification, lifecycle_state",
    )
    .is("target_shop_id", null)
    .eq("source", "nrd")
    .eq("alert_state", "open")
    // Defamation safety — operator-confirmed clones only (mirrors the public
    // /clone-watch page filter). Do NOT relax this: the email names brands.
    .in("triage_status", ["tp_confirmed", "tp_actioned"])
    .gte("first_seen_at", since)
    .order("severity", { ascending: false })
    .order("first_seen_at", { ascending: false })
    .limit(SCAN_LIMIT);

  if (error || !data) return [];

  const rows = (data as AlertRow[]).filter(
    // Belt-and-braces FP denylist (same as the monthly report-card reader).
    (r) => !isFpBrand(r.inferred_target_domain),
  );

  // Lead with "live fake" evidence (weaponised / confirmed phishing) so the
  // section opens with the punchiest examples, then newest. Fall back cleanly
  // when nothing is live yet — a confirmed lookalike is still worth warning on.
  const isLive = (r: AlertRow): boolean =>
    r.lifecycle_state === "weaponised" ||
    r.urlscan_classification === "likely_phishing";

  const sorted = [...rows].sort((a, b) => {
    const liveDelta = (isLive(b) ? 1 : 0) - (isLive(a) ? 1 : 0);
    if (liveDelta !== 0) return liveDelta;
    return (b.first_seen_at ?? "").localeCompare(a.first_seen_at ?? "");
  });

  // One item per brand so 5 rows = 5 distinct brands (more useful than 5 clones
  // of the same brand).
  const seenBrands = new Set<string>();
  const out: CloneWatchEntry[] = [];
  for (const r of sorted) {
    const realDomain = r.inferred_target_domain ?? null;
    const brand = realDomain ? prettyBrand(realDomain) : null;
    const brandKey = (brand ?? r.candidate_domain).toLowerCase();
    if (seenBrands.has(brandKey)) continue;
    seenBrands.add(brandKey);
    out.push({ fakeDomain: r.candidate_domain, brand, realDomain });
    if (out.length >= MAX_ITEMS) break;
  }

  return out;
}
