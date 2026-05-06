// Weekly regulator-alerts pull for the Mon weekly email.
//
// Surfaces feed_items where source IN ('scamwatch_alert', 'acsc',
// 'asic_investor') with published_at in the last 7 days. Distinct from
// the Reddit-intel digest which builds on classifier output —
// regulator alerts are first-party narratives we ingest verbatim.
//
// Returns null when there's nothing to show, letting the cron skip the
// section entirely rather than printing an empty placeholder.

import { createServiceClient } from "@askarthur/supabase/server";

export interface RegulatorAlertEntry {
  source: "scamwatch_alert" | "acsc" | "asic_investor";
  /** Friendly source label for the email render. */
  sourceLabel: string;
  title: string;
  /** Article URL — rendered as a link. */
  url: string | null;
  /** ISO date — already formatted "DD Mon" by the email template if needed. */
  publishedAt: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  scamwatch_alert: "ACCC Scamwatch",
  acsc: "ASD ACSC",
  asic_investor: "ASIC",
};

const DAYS = 7;
const MAX_ENTRIES = 6;

export async function getWeeklyRegulatorAlerts(): Promise<RegulatorAlertEntry[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("feed_items")
    .select("source, title, url, published_at")
    .in("source", ["scamwatch_alert", "acsc", "asic_investor"])
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(MAX_ENTRIES);

  if (error || !data) return [];

  return data.map((row) => ({
    source: row.source as RegulatorAlertEntry["source"],
    sourceLabel: SOURCE_LABEL[row.source as string] ?? (row.source as string),
    title: (row.title as string) ?? "",
    url: (row.url as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
  }));
}
