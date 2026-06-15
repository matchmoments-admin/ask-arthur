import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";

// Node runtime for node:crypto HMAC (Svix-signed Resend webhooks).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend event webhook — the deliverability feedback loop.
 *
 * On a hard bounce or spam complaint we suppress the address so we never email
 * it again: it lands in brand_report_unsubscribes (the same list the
 * brand-stewardship send route already checks) AND flips email_subscribers
 * .is_active=false (protects the consumer streams). Without this, a cold-stream
 * complaint silently rots sender reputation — the #1 spam-folder driver.
 *
 * Resend signs webhooks with Svix (headers svix-id / svix-timestamp /
 * svix-signature; secret "whsec_<base64>"). We verify manually (no svix dep),
 * mirroring the manual-HMAC pattern in app/api/blog/ghost-webhook/route.ts.
 *
 * Ops: set RESEND_WEBHOOK_SECRET and point a Resend webhook (email.bounced +
 * email.complained) at https://askarthur.au/api/webhooks/resend.
 */
const TOLERANCE_SECONDS = 300;

export function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  // "whsec_" prefix is optional; the rest is base64 key material.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  // Header is a space-separated list of "v1,<sig>" entries.
  for (const part of signatureHeader.split(" ")) {
    const sig = part.split(",")[1];
    if (!sig) continue;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

async function suppress(emails: string[], source: string): Promise<void> {
  const sb = createServiceClient();
  if (!sb) return;
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    await sb
      .from("brand_report_unsubscribes")
      .upsert({ email, source }, { onConflict: "email", ignoreDuplicates: true });
    await sb
      .from("email_subscribers")
      .update({ is_active: false })
      .eq("email", email);
  }
}

interface ResendEvent {
  type?: string;
  data?: {
    to?: string[] | string;
    email?: string;
    bounce?: { type?: string };
  };
}

function recipients(data: ResendEvent["data"]): string[] {
  if (!data) return [];
  if (Array.isArray(data.to)) return data.to;
  if (typeof data.to === "string") return [data.to];
  if (data.email) return [data.email];
  return [];
}

export async function POST(req: NextRequest) {
  const secret = readStringEnv("RESEND_WEBHOOK_SECRET");
  if (!secret) {
    logger.error("Resend webhook secret not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signature = req.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }
  // Replay window.
  const ts = Number(timestamp);
  if (
    !Number.isFinite(ts) ||
    Math.abs(Math.floor(Date.now() / 1000) - ts) > TOLERANCE_SECONDS
  ) {
    return NextResponse.json({ error: "stale_timestamp" }, { status: 400 });
  }
  if (!verifySvix(secret, id, timestamp, rawBody, signature)) {
    logger.warn("Resend webhook signature verification failed");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const to = recipients(event.data);
  if (event.type === "email.complained" && to.length) {
    await suppress(to, "resend_complaint");
    logger.warn("Resend webhook: spam complaint — suppressed", { count: to.length });
  } else if (event.type === "email.bounced" && to.length) {
    // Soft/transient bounces shouldn't permanently suppress; only hard bounces.
    const bounceType = event.data?.bounce?.type?.toLowerCase() ?? "";
    const transient = bounceType.includes("transient") || bounceType.includes("soft");
    if (!transient) {
      await suppress(to, "resend_bounce");
      logger.warn("Resend webhook: hard bounce — suppressed", { count: to.length });
    }
  }

  return NextResponse.json({ ok: true });
}
