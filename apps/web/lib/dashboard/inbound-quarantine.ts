// Inbound-email quarantine loader for /admin/inbound-quarantine.
//
// Every row that arrives via the Cloudflare Email Routing pipeline lands
// with published=false; this loader fetches the queue + tags
// subscription-admin rows for the operator UI.

import "server-only";

import { createServiceClient } from "@askarthur/supabase/server";
import { SOURCE_CONFIG, humanizeSource } from "@/lib/feed";

export interface QuarantineRow {
  id: number;
  source: string;
  source_label: string;
  is_regulator: boolean;
  title: string;
  body_preview: string;
  body_chars: number;
  url: string | null;
  country_code: string | null;
  received_at: string | null;
  is_subscription_admin: boolean;
}

// Lightweight heuristic for the subscription-admin badge. Same patterns
// the P3 classifier will use as its hard pre-filter.
const SUBSCRIPTION_ADMIN_PATTERNS = [
  /^\s*confirm\s+your\b/i,
  /^\s*please confirm\b/i,
  /^\s*thank you for subscribing/i,
  /^\s*welcome to\b/i,
  /^\s*verify (your )?(email|subscription)/i,
  /subscription/i,
  /pipeline smoke test/i,
];

function isSubscriptionAdmin(title: string): boolean {
  return SUBSCRIPTION_ADMIN_PATTERNS.some((re) => re.test(title));
}

export async function getQuarantineRows(): Promise<QuarantineRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("feed_items")
    .select(
      "id, source, title, body_md, url, country_code, source_created_at, created_at",
    )
    .eq("published", false)
    .or(
      "source.like.inbound_%,and(source.eq.reddit,title.eq.Pipeline smoke test from Claude)",
    )
    // Hide competitor_intel rows from the promote/delete backlog (M10) — they're
    // ingest-but-never-publish (ADR-0021), so a Promote button on them is a dead
    // affordance (the server action refuses them anyway). NULL-safe: a bare
    // `.neq` would also drop the legitimate NULL-category rows we want to show.
    // (Chained .or() groups AND together in PostgREST.)
    .or("category.is.null,category.neq.competitor_intel")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !data) return [];

  return data.map((row): QuarantineRow => {
    const config = SOURCE_CONFIG[row.source];
    const body = (row.body_md as string | null) ?? "";
    return {
      id: row.id as number,
      source: row.source as string,
      source_label: config?.label ?? humanizeSource(row.source as string),
      is_regulator: Boolean(config?.isRegulator),
      title: (row.title as string) ?? "(no subject)",
      body_preview: body.slice(0, 600),
      body_chars: body.length,
      url: (row.url as string | null) ?? null,
      country_code: (row.country_code as string | null) ?? null,
      received_at:
        (row.source_created_at as string | null) ??
        (row.created_at as string | null),
      is_subscription_admin: isSubscriptionAdmin((row.title as string) ?? ""),
    };
  });
}
