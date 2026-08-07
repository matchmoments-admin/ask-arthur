import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequest } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { publishToSocial } from "@/lib/social-publish";
import { logger } from "@askarthur/utils/logger";

// Hardened per map #939 / #942 gap 2: dual-mode auth (isAdminRequest — the
// old raw verifyAdminToken check had no Supabase-admin path), Zod body,
// replay guard on outreach_status, and an always-ship warn log (the old
// info line was 10%-sampled, so most publishes left no Axiom trace).

const PublishSchema = z.object({
  // 0 = freeform draft post not tied to an alert row (BrandAlertsDashboard's
  // compose flow) — publishes without a record, guarded by the UI confirm.
  alertId: z.number().int().min(0),
  shortText: z.string().min(1).max(2000),
  longText: z.string().max(10000).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = PublishSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const { alertId, shortText, longText } = parsed.data;

  const supabase = createServiceClient();

  if (alertId > 0) {
    // Refuse to publish when the outcome can't be recorded — an unrecorded
    // social post is invisible to this replay guard on the next click.
    if (!supabase) {
      return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
    }
    const { data: existing } = await supabase
      .from("brand_impersonation_alerts")
      .select("outreach_status")
      .eq("id", alertId)
      .single();
    if (!existing) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    // Replay guard: a published alert stays published. A small TOCTOU window
    // remains for two truly simultaneous clicks — acceptable on a
    // single-operator console with the UI confirm in front of this.
    if (existing.outreach_status === "sent") {
      return NextResponse.json({ error: "already_published" }, { status: 409 });
    }
  }

  const result = await publishToSocial(shortText, longText || shortText);

  if (supabase && alertId > 0) {
    await supabase
      .from("brand_impersonation_alerts")
      .update({
        outreach_status: "sent",
        draft_post_short: shortText,
        draft_post_long: longText,
        twitter_post_id: result.twitter?.id || null,
        linkedin_post_id: result.linkedin?.id || null,
        facebook_post_id: result.facebook?.id || null,
        published_at: new Date().toISOString(),
      })
      .eq("id", alertId);
  }

  // warn, not info: rare high-value outbound event — always ships to Axiom.
  logger.warn("brand_alert_published", {
    alertId,
    freeform: alertId === 0,
    twitter: !!result.twitter,
    linkedin: !!result.linkedin,
    facebook: !!result.facebook,
  });

  return NextResponse.json({
    twitter_post_id: result.twitter?.id,
    linkedin_post_id: result.linkedin?.id,
    facebook_post_id: result.facebook?.id,
  });
}
