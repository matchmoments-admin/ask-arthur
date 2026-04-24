// GET /api/phone-footprint/monitors/[id]/alerts — full alerts history
// for one monitor, with pagination.
//
// Default page size 50; max 200 per request. Order: newest first.
// Caller must own the monitor (user_id match) — RLS would also enforce
// this server-side but we double-check at the route layer for clarity.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const monitorId = Number.parseInt(id, 10);
  if (!Number.isInteger(monitorId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  let q: z.infer<typeof Query>;
  try {
    q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  } catch {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const supa = createServiceClient();
  if (!supa) return NextResponse.json({ error: "supabase_unavailable" }, { status: 500 });

  // Ownership check.
  const { data: monitor } = await supa
    .from("phone_footprint_monitors")
    .select("user_id, soft_deleted_at")
    .eq("id", monitorId)
    .maybeSingle();
  if (!monitor || monitor.soft_deleted_at || monitor.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let query = supa
    .from("phone_footprint_alerts")
    .select(
      "id, alert_type, severity, details, delivered_at, delivered_channels, created_at",
    )
    .eq("monitor_id", monitorId)
    .order("created_at", { ascending: false })
    .limit(q.limit);

  if (q.before) {
    query = query.lt("created_at", q.before);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 });

  return NextResponse.json({
    alerts: data ?? [],
    next_cursor: data && data.length === q.limit ? data[data.length - 1].created_at : null,
  });
}
