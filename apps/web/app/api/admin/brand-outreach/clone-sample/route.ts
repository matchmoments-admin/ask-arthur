import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { getBrandCloneSample } from "@/lib/email/brand-outreach-pilot";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brand-outreach/clone-sample?brandKey=<legit-domain>
 *
 * The compose-time PREVIEW of the real clone-detection sample that the pilot
 * email will embed for a brand. Read-only + admin-gated. Returns the same
 * `BrandCloneSample` the send route renders (single source of truth via
 * getBrandCloneSample), including `insufficientData` — which the composer turns
 * into the founder's "not a strong outreach target" warning when we have fewer
 * than MIN_REPORTED_CLONES_FOR_OUTREACH recent reported clones.
 */
export async function GET(req: NextRequest) {
  await requireAdmin();

  const brandKey = req.nextUrl.searchParams.get("brandKey");
  if (!brandKey) {
    return NextResponse.json({ error: "brand_key_required" }, { status: 400 });
  }

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  try {
    const sample = await getBrandCloneSample(sb, brandKey);
    return NextResponse.json({ ok: true, sample });
  } catch (err) {
    logger.error("brand-outreach clone-sample: fetch failed", {
      error: String(err),
    });
    return NextResponse.json({ error: "sample_failed" }, { status: 502 });
  }
}
