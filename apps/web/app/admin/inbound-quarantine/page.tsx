import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { SOURCE_CONFIG, humanizeSource } from "@/lib/feed";
import QuarantineTable from "./QuarantineTable";

export const dynamic = "force-dynamic";

// Admin viewer for the inbound-email quarantine queue.
//
// Every row that arrives via the Cloudflare Email Routing →
// intel-inbound-email pipeline is inserted with published=false (P0 of
// the 2026-05-16 feed-quality recovery plan). This page is how an
// operator inspects the queue and decides what — if anything — should
// be promoted to the public /scam-feed.
//
// Promotion vs deletion:
//   - Promote: sets published=true. Row is instantly visible at /scam-feed.
//              Reversible by re-quarantining via SQL.
//   - Delete:  hard-deletes the row. Use for subscription-confirm /
//              welcome / pipeline test emails that should never have
//              landed on the feed. Idempotency keys mean the same
//              external_id won't re-arrive even if the upstream
//              re-sends.
//
// Future: P3 (newsletter classifier) will auto-promote real article
// content + auto-mark subscription-admin emails for deletion via a
// background Inngest function. Until that ships, this page is the
// only path to the public feed for any inbound_* row.

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
// the P3 classifier will use as its hard pre-filter; landing it here
// first means the operator can eyeball the calibration before the
// classifier auto-acts on it.
const SUBSCRIPTION_ADMIN_PATTERNS = [
  /^\s*confirm\s+your\b/i,
  /^\s*please confirm\b/i,
  /^\s*thank you for subscribing/i,
  /^\s*welcome to\b/i,
  /^\s*verify (your )?(email|subscription)/i,
  /subscription/i, // includes "SANS Newsletter Subscription"
  /pipeline smoke test/i,
];

function isSubscriptionAdmin(title: string): boolean {
  return SUBSCRIPTION_ADMIN_PATTERNS.some((re) => re.test(title));
}

async function getQuarantineRows(): Promise<QuarantineRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("feed_items")
    .select("id, source, title, body_md, url, country_code, source_created_at, created_at")
    .eq("published", false)
    .or("source.like.inbound_%,and(source.eq.reddit,title.eq.Pipeline smoke test from Claude)")
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
      received_at: (row.source_created_at as string | null) ?? (row.created_at as string | null),
      is_subscription_admin: isSubscriptionAdmin((row.title as string) ?? ""),
    };
  });
}

export default async function InboundQuarantinePage() {
  await requireAdmin();
  const rows = await getQuarantineRows();
  const adminCount = rows.filter((r) => r.is_subscription_admin).length;
  const realCount = rows.length - adminCount;

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-deep-navy text-3xl font-bold">Inbound-email quarantine</h1>
          <p className="mt-2 text-sm text-gov-slate leading-relaxed max-w-3xl">
            Every inbound-email row lands here with <code className="font-mono text-xs">published=false</code>.
            Promote a row to publish it to the public <a href="/scam-feed" className="text-action-teal underline">/scam-feed</a>;
            delete a row for subscription confirmations, welcome emails, and pipeline test traffic that
            should never have arrived. The newsletter-classifier (P3) will eventually automate both
            decisions; until then this is the only path to the public feed for inbound rows.
          </p>
          <div className="mt-4 flex gap-3 text-xs">
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-amber-900">
              {realCount} candidate{realCount === 1 ? "" : "s"} (real content)
            </span>
            <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-slate-700">
              {adminCount} subscription-admin (delete)
            </span>
            <span className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-slate-700">
              {rows.length} total
            </span>
          </div>
        </header>

        <QuarantineTable rows={rows} />
      </div>
    </div>
  );
}
