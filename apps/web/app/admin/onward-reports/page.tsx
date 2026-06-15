import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import OnwardReportsDashboard from "./OnwardReportsDashboard";

interface ReviewRow {
  id: string;
  scam_report_id: number | null;
  destination: string;
  destination_key: string | null;
  status: string;
  status_reason: string | null;
  queued_at: string;
  scam_type: string | null;
  impersonated_brand: string | null;
  channel: string | null;
  brand_name: string | null;
  brand_security_email: string | null;
  sent_so_far_for_brand: number;
}

interface SentStats {
  total: number;
  last30d: number;
  byDestination: Record<string, number>;
}

/**
 * Proof / SPF-pitch stat: reports we've actually SENT on brands' behalf
 * (status='sent' only — never claims a takedown). Date math lives here, not in
 * the component render. 0 today until the onward flags are flipped.
 */
async function loadSentStats(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
): Promise<SentStats> {
  const stats: SentStats = { total: 0, last30d: 0, byDestination: {} };
  const { data: sentRows } = await supabase
    .from("onward_report_log")
    .select("destination, sent_at")
    .eq("status", "sent")
    .limit(5000);
  const cutoff = Date.now() - 30 * 86400000;
  for (const r of sentRows ?? []) {
    stats.total += 1;
    if (r.sent_at && new Date(r.sent_at as string).getTime() > cutoff) {
      stats.last30d += 1;
    }
    const d = r.destination as string;
    stats.byDestination[d] = (stats.byDestination[d] ?? 0) + 1;
  }
  return stats;
}

export default async function OnwardReportsPage() {
  await requireAdmin();
  const supabase = createServiceClient();
  let manualReview: ReviewRow[] = [];
  let recent: ReviewRow[] = [];
  const sentStats = supabase
    ? await loadSentStats(supabase)
    : { total: 0, last30d: 0, byDestination: {} as Record<string, number> };

  if (supabase) {

    // Manual-review queue (held pending admin approval)
    const { data: pending } = await supabase
      .from("onward_report_log")
      .select(
        `id, scam_report_id, destination, destination_key, status,
         status_reason, queued_at,
         scam_reports ( scam_type, impersonated_brand, channel )`
      )
      .eq("status", "manual_review")
      .order("queued_at", { ascending: true })
      .limit(50);

    // Recent activity for context (sent / failed / skipped, last 50)
    const { data: recentRows } = await supabase
      .from("onward_report_log")
      .select(
        `id, scam_report_id, destination, destination_key, status,
         status_reason, queued_at,
         scam_reports ( scam_type, impersonated_brand, channel )`
      )
      .neq("status", "manual_review")
      .order("queued_at", { ascending: false })
      .limit(50);

    // Resolve brand contact + send count for each manual_review row
    const brandKeys = Array.from(
      new Set(
        (pending ?? [])
          .filter((r) => r.destination === "brand_abuse" && r.destination_key)
          .map((r) => r.destination_key as string)
      )
    );

    const brandLookup = new Map<
      string,
      { name: string; email: string | null; sent: number }
    >();
    if (brandKeys.length > 0) {
      const { data: brandRows } = await supabase
        .from("known_brands")
        .select("brand_key, brand_name, security_contact_email")
        .in("brand_key", brandKeys);
      for (const b of brandRows ?? []) {
        brandLookup.set(b.brand_key, {
          name: b.brand_name,
          email: b.security_contact_email,
          sent: 0,
        });
      }
      // Count prior 'sent' rows per brand_key
      for (const k of brandKeys) {
        const { count } = await supabase
          .from("onward_report_log")
          .select("id", { head: true, count: "exact" })
          .eq("destination", "brand_abuse")
          .eq("destination_key", k)
          .eq("status", "sent");
        const cur = brandLookup.get(k);
        if (cur) cur.sent = count ?? 0;
      }
    }

    const shape = (rows: typeof pending): ReviewRow[] =>
      (rows ?? []).map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sr: any = (r as any).scam_reports ?? null;
        const brand =
          r.destination_key && brandLookup.has(r.destination_key)
            ? brandLookup.get(r.destination_key)!
            : null;
        return {
          id: r.id as string,
          scam_report_id: r.scam_report_id as number | null,
          destination: r.destination as string,
          destination_key: r.destination_key as string | null,
          status: r.status as string,
          status_reason: r.status_reason as string | null,
          queued_at: r.queued_at as string,
          scam_type: sr?.scam_type ?? null,
          impersonated_brand: sr?.impersonated_brand ?? null,
          channel: sr?.channel ?? null,
          brand_name: brand?.name ?? null,
          brand_security_email: brand?.email ?? null,
          sent_so_far_for_brand: brand?.sent ?? 0,
        };
      });

    manualReview = shape(pending);
    recent = shape(recentRows);
  }

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-2xl font-extrabold mb-1">
        Onward reports — manual review
      </h1>
      <p className="text-gov-slate text-sm mb-6 leading-relaxed">
        First {10} sends to any new brand are held here for human review before
        the email goes out. Approving fires the Inngest worker with the
        threshold bypassed; rejecting marks the row skipped with your reason.
      </p>

      {/* Proof stat — reports actually SENT on brands' behalf (the SPF number). */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span>
            <span className="text-2xl font-bold text-deep-navy">
              {sentStats.total.toLocaleString()}
            </span>{" "}
            <span className="text-sm text-gov-slate">
              reports sent on brands&apos; behalf (all time)
            </span>
          </span>
          <span className="text-sm text-gov-slate">
            <strong className="text-deep-navy">{sentStats.last30d}</strong> in
            the last 30 days
          </span>
        </div>
        {Object.keys(sentStats.byDestination).length > 0 ? (
          <p className="mt-2 text-xs text-gov-slate">
            {Object.entries(sentStats.byDestination)
              .sort((a, b) => b[1] - a[1])
              .map(([d, n]) => `${d}: ${n}`)
              .join(" · ")}
          </p>
        ) : (
          <p className="mt-2 text-xs text-gov-slate">
            None yet — the onward pipeline is gated off (FF_ONWARD_AUTO_REPORT /
            FF_ONWARD_OPENPHISH). Counts only <code>status=&apos;sent&apos;</code>;
            never claims a takedown.
          </p>
        )}
      </section>

      <OnwardReportsDashboard manualReview={manualReview} recent={recent} />
    </div>
  );
}
