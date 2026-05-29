import {
  verifyWhatsAppSignature,
  safeStrEqual,
} from "@askarthur/bot-core/webhook-verify";
import { logger } from "@askarthur/utils/logger";
import { handleWhatsAppWebhook } from "@/lib/bots/whatsapp/handler";

// node:crypto (via bot-core) is unavailable on Edge; pin Node + dynamic so the
// HMAC verifier always has its runtime and the handler isn't statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: WhatsApp webhook verification (Meta sends this when subscribing).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expectedToken && safeStrEqual(token, expectedToken)) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * POST: Inbound WhatsApp messages.
 * Must return 200 quickly — WhatsApp retries if response is slow.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // Verify HMAC-SHA256 signature
  const isValid = await verifyWhatsAppSignature(req, rawBody);
  if (!isValid) {
    logger.warn("WhatsApp webhook: invalid signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Process in background — return 200 immediately (fire-and-forget; the route
  // runs on the Node runtime, see the runtime pin at the top of this file).
  const processPromise = handleWhatsAppWebhook(payload as Parameters<typeof handleWhatsAppWebhook>[0]);
  processPromise.catch((err) =>
    logger.error("WhatsApp webhook processing failed", { error: String(err) })
  );

  return new Response("OK", { status: 200 });
}
