import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brand-stewardship/[id]/outreach-done — toggle the manual-
 * outreach "done" tick for a no_contact worklist row. Body: { done: boolean }.
 * Sets/clears outreach_done_at so the dashboard can move the row to Done (and
 * back, for an undo).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await params;

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  let done = true;
  try {
    const body = await req.json();
    done = body?.done !== false;
  } catch {
    // default: mark done
  }

  const { error } = await sb
    .from("brand_stewardship_reports")
    .update({
      outreach_done_at: done ? new Date().toISOString() : null,
      outreach_done_by: done ? "hmac_admin" : null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, done });
}
