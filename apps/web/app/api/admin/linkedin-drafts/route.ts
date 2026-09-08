import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { ASK_ARTHUR_ORG } from "@/lib/linkedin/drafts";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();
  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  const { data, error } = await sb.from("linkedin_drafts").select("id,title,commentary,version,status,post_urn,updated_at").order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "drafts_unavailable" }, { status: 503 });
  const tokenConfigured = !!readStringEnv("LINKEDIN_ACCESS_TOKEN") || !!(readStringEnv("LINKEDIN_REFRESH_TOKEN") && readStringEnv("LINKEDIN_CLIENT_ID") && readStringEnv("LINKEDIN_CLIENT_SECRET"));
  const canPublish = tokenConfigured && readStringEnv("LINKEDIN_ORG_URN") === ASK_ARTHUR_ORG && readStringEnv("LINKEDIN_STUDIO_PUBLISH_ENABLED") === "true" && readStringEnv("VERCEL_ENV") === "production";
  return NextResponse.json({ drafts: data, canPublish, destination: "Ask Arthur company page" }, { headers: { "Cache-Control": "no-store" } });
}
const Body = z.object({ id: z.uuid().optional(), version: z.number().int().positive().optional(), title: z.string().trim().min(1).max(120), commentary: z.string().trim().min(1).max(3000) });
export async function POST(req: NextRequest) {
  await requireAdmin();
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (parsed.data.id && !parsed.data.version)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { id, version, title, commentary } = parsed.data;
  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  const values = { title, commentary, updated_by: await getAdminUserId(), updated_at: new Date().toISOString() };
  const query = id
    ? sb.from("linkedin_drafts").update({ ...values, version: version! + 1 }).eq("id", id).eq("version", version!).eq("status", "draft")
    : sb.from("linkedin_drafts").insert(values);
  const { data, error } = await query.select("id,title,commentary,version,status,post_urn,updated_at").maybeSingle();
  if (error) return NextResponse.json({ error: "save_failed" }, { status: 503 });
  if (!data) return NextResponse.json({ error: "draft_changed_reload" }, { status: 409 });
  return NextResponse.json({ draft: data });
}
