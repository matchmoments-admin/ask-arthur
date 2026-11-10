import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { getBrandCloneSample } from "@/lib/email/brand-outreach-pilot";
import {
  lastClosedAndCurrentMonths,
  readBrandMonthFacts,
  type BrandMonthFacts,
} from "@/lib/clone-watch/month-facts";

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
 *
 * Also returns the brand's MONTH FACTS (month-facts.ts, #1296): the last
 * published month exactly as the store froze it — the number the brand's own
 * monthly report prints — and the open month so far, labelled provisional. The
 * composer shows them beside the 30-day sample so the founder never quotes a
 * number that disagrees with the report the brand will receive.
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
    const now = new Date();
    const { lastClosed, current } = lastClosedAndCurrentMonths(now);
    // Month facts DEGRADE to null: the sample is the email's content, the facts
    // are a composer aid — a failed facts read must not cost the preview.
    const facts = (month: string): Promise<BrandMonthFacts | null> =>
      readBrandMonthFacts(sb, brandKey, month, now).catch((err: unknown) => {
        logger.warn("brand-outreach clone-sample: month facts unavailable", {
          month,
          error: String(err),
        });
        return null;
      });
    const [sample, lastClosedFacts, currentFacts] = await Promise.all([
      getBrandCloneSample(sb, brandKey),
      facts(lastClosed),
      facts(current),
    ]);
    return NextResponse.json({
      ok: true,
      sample,
      monthFacts: { lastClosed: lastClosedFacts, current: currentFacts },
    });
  } catch (err) {
    logger.error("brand-outreach clone-sample: fetch failed", {
      error: String(err),
    });
    return NextResponse.json({ error: "sample_failed" }, { status: 502 });
  }
}
