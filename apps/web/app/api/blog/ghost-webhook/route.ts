import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  deleteGhostPost,
  parseGhostWebhookEvent,
  syncGhostPost,
  verifyGhostSignature,
  type GhostWebhookPayload,
} from "@/lib/ghost-sync";

// Runs on Node so we have access to node:crypto for HMAC verification.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const secret = process.env.GHOST_WEBHOOK_SECRET;
  if (!secret) {
    logger.error("Ghost webhook secret not configured");
    return NextResponse.json(
      { error: "Ghost webhook not configured" },
      { status: 500 }
    );
  }

  // Raw body needed both for signature verification and for JSON.parse.
  // Reading req.text() then JSON.parse keeps the byte sequence we hashed
  // identical to what we validate against — req.json() reformats internally.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-ghost-signature");

  if (!verifyGhostSignature(rawBody, signatureHeader, secret)) {
    logger.warn("Ghost webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: GhostWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseGhostWebhookEvent(payload);
  if (event.kind === "ignore") {
    return NextResponse.json({ ok: true, ignored: event.reason });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    // Return 500 so Ghost retries — this is a real misconfiguration, not a
    // permanent reject like a bad signature.
    logger.error("Ghost webhook: Supabase service client unavailable");
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 500 }
    );
  }

  try {
    if (event.kind === "delete") {
      await deleteGhostPost(supabase, event.ghost_post_id);
      return NextResponse.json({ ok: true, action: "delete" });
    }
    await syncGhostPost(supabase, event.post, event.status);
    return NextResponse.json({
      ok: true,
      action: "upsert",
      slug: event.post.slug,
      status: event.status,
    });
  } catch (err) {
    // Sync helpers already log; surface 500 so Ghost retries the webhook.
    return NextResponse.json(
      { error: "Mirror write failed", detail: String(err) },
      { status: 500 }
    );
  }
}
