import { createServiceClient } from "@askarthur/supabase/server";
import type {
  CloneWatchReportCard,
  CloneWatchTrendRows,
} from "@/lib/clone-watch/report-card-data";

/**
 * Shared writer/reader for clone_watch_report_summary (v189) — the single column
 * mapping used by BOTH the monthly Inngest snapshot and the LinkedIn publish
 * write-back, so the two can't drift.
 */

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

/**
 * Build the summary-table row from a report card. `published_post_urn` is set
 * ONLY when provided: the monthly snapshot omits it (so a re-snapshot preserves
 * an already-recorded LinkedIn post URN), while the publish write-back passes it.
 */
export function summaryRow(
  card: CloneWatchReportCard,
  publishedPostUrn?: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    period_month: card.periodMonth, // "YYYY-MM-01"
    total_domains: card.total,
    brand_count: card.brands,
    reported_to_netcraft: card.kpis.reportedToNetcraft,
    likely_phishing: card.kpis.likelyPhishing,
    parked_for_sale: card.kpis.parkedForSale,
    unknown_registrar_count: card.unknownRegistrarCount,
    top_au_brands: card.topAuBrands,
    global_brands: card.globalBrands,
    top_registrars: card.topRegistrars,
    super_fund: card.superFund,
    mom: card.mom,
    updated_at: new Date().toISOString(),
  };
  if (publishedPostUrn) row.published_post_urn = publishedPostUrn;
  return row;
}

/** UPSERT the monthly summary snapshot (onConflict period_month). Preserves the
 *  recorded post URN unless one is explicitly passed. */
export async function upsertSummary(
  sb: ServiceClient,
  card: CloneWatchReportCard,
  publishedPostUrn?: string,
): Promise<void> {
  const { error } = await sb
    .from("clone_watch_report_summary")
    .upsert(summaryRow(card, publishedPostUrn), { onConflict: "period_month" });
  if (error) throw new Error(`summary upsert failed: ${error.message}`);
}

/**
 * Persist the FULL per-brand + per-registrar trend rows for a month (v193).
 * Delete-then-insert so a re-snapshot/backfill is idempotent. Small row counts
 * (a few hundred/month) — not a hot table, no chunking needed.
 */
export async function writeTrendRows(
  sb: ServiceClient,
  rows: CloneWatchTrendRows,
): Promise<void> {
  const pm = rows.periodMonth;

  await sb.from("clone_watch_monthly_brand_stats").delete().eq("period_month", pm);
  if (rows.brandRows.length > 0) {
    const { error } = await sb
      .from("clone_watch_monthly_brand_stats")
      .insert(rows.brandRows.map((r) => ({ period_month: pm, ...r })));
    if (error) throw new Error(`brand trend insert failed: ${error.message}`);
  }

  await sb
    .from("clone_watch_monthly_registrar_stats")
    .delete()
    .eq("period_month", pm);
  if (rows.registrarRows.length > 0) {
    const { error } = await sb
      .from("clone_watch_monthly_registrar_stats")
      .insert(rows.registrarRows.map((r) => ({ period_month: pm, ...r })));
    if (error) throw new Error(`registrar trend insert failed: ${error.message}`);
  }
}

/**
 * The recorded LinkedIn post URN for a report month, or null when the row is
 * absent or not yet published — the duplicate guard's read side.
 */
export async function getPublishedUrn(
  sb: ServiceClient,
  periodMonth: string, // "YYYY-MM-01"
): Promise<string | null> {
  const { data, error } = await sb
    .from("clone_watch_report_summary")
    .select("published_post_urn")
    .eq("period_month", periodMonth)
    .maybeSingle();
  if (error) throw new Error(`summary read failed: ${error.message}`);
  return (data?.published_post_urn as string | null | undefined) ?? null;
}
