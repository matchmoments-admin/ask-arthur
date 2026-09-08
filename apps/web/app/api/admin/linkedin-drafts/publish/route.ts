import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { ASK_ARTHUR_ORG, plainLinkedInText } from "@/lib/linkedin/drafts";
import { resolveAccessToken, createTextPost, postUrl } from "@/lib/linkedin/client";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const Body = z.object({ id: z.uuid(), version: z.number().int().positive(), publishNow: z.literal(true) });

export async function POST(req: NextRequest) {
  await requireAdmin();
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "explicit_confirmation_required" }, { status: 400 });
  if (readStringEnv("LINKEDIN_STUDIO_PUBLISH_ENABLED") !== "true" || readStringEnv("VERCEL_ENV") !== "production" || readStringEnv("LINKEDIN_ORG_URN") !== ASK_ARTHUR_ORG) {
    return NextResponse.json({ error: "publishing_not_enabled" }, { status: 503 });
  }
  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  // Resolve credentials before claiming: failed auth setup cannot strand a draft.
  let accessToken: string;
  try { accessToken = await resolveAccessToken(); }
  catch { return NextResponse.json({ error: "linkedin_connection_unavailable" }, { status: 503 }); }
  const { id, version } = parsed.data;
  const now = new Date().toISOString();
  // Atomic conditional UPDATE locks the saved revision against edits/repeat clicks.
  const { data: draft, error } = await sb.from("linkedin_drafts")
    .update({ status: "publishing", version: version + 1, author_urn: ASK_ARTHUR_ORG, attempted_at: now, updated_at: now, updated_by: await getAdminUserId() })
    .eq("id", id).eq("version", version).eq("status", "draft").select("commentary").maybeSingle();
  if (error) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  if (!draft) return NextResponse.json({ error: "draft_changed_or_already_attempted" }, { status: 409 });
  let postUrn: string;
  try {
    postUrn = await createTextPost({ commentary: plainLinkedInText(draft.commentary), accessToken, authorUrn: ASK_ARTHUR_ORG });
  } catch {
    await sb.from("linkedin_drafts").update({ status: "uncertain", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "publishing");
    return NextResponse.json({ error: "publication_uncertain_check_linkedin" }, { status: 502 });
  }
  const { error: receiptError } = await sb.from("linkedin_drafts").update({ status: "published", post_urn: postUrn, published_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "publishing");
  // A provider receipt is not proof of feed visibility. Never repeat this send.
  return NextResponse.json({ url: postUrl(postUrn), receiptSaved: !receiptError, message: "Open LinkedIn to verify the post is visible." });
}
