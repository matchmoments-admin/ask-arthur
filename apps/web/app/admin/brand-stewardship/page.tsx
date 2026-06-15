import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import BrandStewardshipDashboard, {
  type StewardshipRow,
} from "./BrandStewardshipDashboard";

export const dynamic = "force-dynamic";

interface MetricsShape {
  detected?: number;
  reported_by_destination?: Record<string, number>;
  reports_sent?: number;
  clones?: { detected?: number };
}

export default async function BrandStewardshipPage() {
  await requireAdmin();
  const supabase = createServiceClient();
  let rows: StewardshipRow[] = [];

  if (supabase) {
    // Most recent 100 ledger rows across periods; the dashboard groups by month.
    const { data } = await supabase
      .from("brand_stewardship_reports")
      .select(
        "id, brand_key, brand_name, period_month, metrics, recipient_email, status, status_reason, prepared_at, sent_at",
      )
      .order("period_month", { ascending: false })
      .order("prepared_at", { ascending: false })
      .limit(100);

    rows = (data ?? []).map((r) => {
      const m = (r.metrics ?? {}) as MetricsShape;
      return {
        id: r.id as string,
        brandKey: r.brand_key as string,
        brandName: r.brand_name as string,
        periodMonth: String(r.period_month).slice(0, 10),
        detected: m.detected ?? 0,
        clonesDetected: m.clones?.detected ?? 0,
        reportsSent: m.reports_sent ?? 0,
        recipientEmail: (r.recipient_email as string | null) ?? null,
        status: r.status as string,
        statusReason: (r.status_reason as string | null) ?? null,
        preparedAt: (r.prepared_at as string | null) ?? null,
        sentAt: (r.sent_at as string | null) ?? null,
      };
    });
  }

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-2xl font-extrabold mb-1">
        Brand stewardship — monthly summaries
      </h1>
      <p className="text-gov-slate text-sm mb-6 leading-relaxed">
        One row per brand per month: what Ask Arthur detected and reported on
        that brand&apos;s behalf. Rows are prepared by the monthly cron (1st of
        each month) for brands with a known security contact. Preview the
        brand-facing email here before it&apos;s sent.
      </p>
      <BrandStewardshipDashboard
        rows={rows}
        shadowRecipient={readStringEnv("BRAND_STEWARDSHIP_SHADOW_RECIPIENT") || null}
      />
    </div>
  );
}
