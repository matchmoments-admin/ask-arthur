import { logger } from "@askarthur/utils/logger";
import { handleMessengerWebhook } from "@/lib/bots/messenger/handler";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * GET: Messenger webhook verification (Meta sends this when subscribing).
 * Same pattern as WhatsApp — both use Meta's platform.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.MESSENGER_VERIFY_TOKEN) {
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

  // Process in background — return 200 immediately
  const processPromise = handleMessengerWebhook(
    payload as Parameters<typeof handleMessengerWebhook>[0],
  );
  processPromise.catch((err) =>
    logger.error("Messenger webhook processing failed", { error: String(err) }),
  );

  return new Response("EVENT_RECEIVED", { status: 200 });
}

function verifyMessengerSignature(req: Request, rawBody: string): boolean {
  const appSecret = process.env.MESSENGER_APP_SECRET;
  if (!appSecret) return false;

  const signature = req.headers.get("x-hub-signature-256");
  if (!signature) return false;

  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}
