import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { publishToSocial } from "@/lib/social-publish";
import { logger } from "@askarthur/utils/logger";

export async function POST(req: NextRequest) {
  // Admin auth check via cookie
  const adminCookie = req.cookies.get("__aa_admin")?.value;
  if (!adminCookie) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { alertId, shortText, longText } = await req.json();

  if (!alertId || !shortText) {
    return NextResponse.json({ error: "Missing alertId or shortText" }, { status: 400 });
  }

  // Publish to social platforms
  const result = await publishToSocial(shortText, longText || shortText);

  // Update alert in database
  const supabase = createServiceClient();
  if (supabase) {
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

  logger.info("Brand alert published to social", {
    alertId,
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
