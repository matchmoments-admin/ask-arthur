import { waitUntil } from "@vercel/functions";
import { logger } from "@askarthur/utils/logger";
import { handleMessengerWebhook } from "@/lib/bots/messenger/handler";
import {
  verifyMessengerSignature,
  safeStrEqual,
} from "@askarthur/bot-core/webhook-verify";

// node:crypto (via bot-core) is unavailable on Edge; pin Node + dynamic so the
// HMAC verifier always has its runtime and the handler isn't statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Messenger webhook verification (Meta sends this when subscribing).
 * Same pattern as WhatsApp — both use Meta's platform.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env.MESSENGER_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expectedToken && safeStrEqual(token, expectedToken)) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * POST: Inbound Messenger messages.
 * Uses HMAC-SHA256 signature verification (same Meta infrastructure as WhatsApp).
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // Verify HMAC-SHA256 signature
  if (!verifyMessengerSignature(req, rawBody)) {
    logger.warn("Messenger webhook: invalid signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Return 200 immediately (Meta retries on any slow/non-2xx response), but the
  // analysis + reply take ~9s of Claude latency. waitUntil keeps the function
  // alive until that background work finishes — WITHOUT it, Vercel freezes the
  // function once the response is sent and the fire-and-forget promise is
  // suspended mid-Claude-call, so the user gets no reply (or a "couldn't
  // analyse" if it happened to throw fast). Telegram avoids this by awaiting;
  // Meta needs the fast 200, so waitUntil is the right tool.
  waitUntil(
    handleMessengerWebhook(
      payload as Parameters<typeof handleMessengerWebhook>[0],
    ).catch((err) =>
      logger.error("Messenger webhook processing failed", {
        error: String(err),
      }),
    ),
  );

  return new Response("EVENT_RECEIVED", { status: 200 });
}
