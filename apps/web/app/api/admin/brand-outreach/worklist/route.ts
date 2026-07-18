import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { WorklistRow } from "@/lib/email/brand-outreach-worklist";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brand-outreach/worklist — the ranked "next brand to email"
 * candidates, computed live by the get_brand_outreach_worklist() RPC (v241).
 * Read-only + admin-gated. The RPC does the ranking + already-contacted flag;
 * the UI splits the buckets.
 */
export async function GET() {
  await requireAdmin();

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const { data, error } = await sb.rpc("get_brand_outreach_worklist");
  if (error) {
    logger.error("brand-outreach worklist: rpc failed", { error: String(error) });
    return NextResponse.json({ error: "worklist_failed" }, { status: 502 });
  }

  const rows = (data ?? []) as WorklistRow[];
  return NextResponse.json({ ok: true, rows });
}
