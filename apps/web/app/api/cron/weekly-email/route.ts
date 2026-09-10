import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { prepareNewsletter } from "@/lib/newsletter/prepare";
import { logger } from "@askarthur/utils/logger";

// Retains the existing weekly schedule, but prepares a draft only. Sending is
// an explicit admin POST against an approved, frozen issue revision.
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;
  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  try {
    const cleanup = await sb.rpc("prune_newsletter_confirmation_requests");
    if (cleanup.error) throw new Error("subscription_cleanup_failed");
    const issue = await prepareNewsletter(sb);
    return NextResponse.json({ message: "Newsletter draft prepared; editor approval and manual send required", issueId: issue.id });
  } catch {
    logger.warn("newsletter_preparation_failed");
    return NextResponse.json({ error: "newsletter_preparation_failed" }, { status: 503 });
  }
}
