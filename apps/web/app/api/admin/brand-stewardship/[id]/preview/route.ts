import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/components";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import BrandStewardshipReport from "@/emails/BrandStewardshipReport";
import { cloneDetectionsFromMetrics } from "@/lib/email/brand-stewardship-clone-detections";

export const dynamic = "force-dynamic";

interface StewardshipMetrics {
  detected?: number;
  reported_by_destination?: Record<string, number>;
  reports_sent?: number;
  clones?: unknown;
}

/** Human period label from a YYYY-MM-01 date, e.g. "May 2026". */
function periodLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  return d.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * GET /api/admin/brand-stewardship/[id]/preview — render the BrandStewardshipReport
 * email for a prepared row using its REAL metrics, returned as HTML for an admin
 * iframe preview. Read-only; no send. The send route (separate slice) reuses the
 * same render with the same data.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await params;

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const { data: row, error } = await sb
    .from("brand_stewardship_reports")
    .select(
      "id, brand_key, brand_name, period_month, metrics, recipient_email, status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const metrics = (row.metrics ?? {}) as StewardshipMetrics;
  const period = String(row.period_month).slice(0, 10);

  const el = BrandStewardshipReport({
    brandName: row.brand_name as string,
    periodLabel: periodLabel(period),
    detected: metrics.detected ?? 0,
    reportedByDestination: metrics.reported_by_destination ?? {},
    reportsSent: metrics.reports_sent ?? 0,
    cloneDetections: cloneDetectionsFromMetrics(metrics.clones),
    reportRef: `BSR-${row.brand_key}-${period.slice(0, 7)}`,
  });
  const html = await render(el);

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
