import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify Telegram webhook by comparing the secret token header.
 */
export function verifyTelegramSecret(req: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false;

  const header = req.headers.get("x-telegram-bot-api-secret-token");
  if (!header) return false;

  try {
    const a = Buffer.from(header);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verify WhatsApp webhook signature (HMAC-SHA256).
 * WhatsApp sends the signature in the X-Hub-Signature-256 header as "sha256=<hex>".
 */
export async function verifyWhatsAppSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;

  const header = req.headers.get("x-hub-signature-256");
  if (!header) return false;

  const expectedSignature = header.replace("sha256=", "");

  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const computedSignature = hmac.digest("hex");

  try {
    const a = Buffer.from(expectedSignature, "hex");
    const b = Buffer.from(computedSignature, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verify Slack request signature (HMAC-SHA256).
 * Slack sends: X-Slack-Signature = "v0=<hex>" and X-Slack-Request-Timestamp.
 */
export function verifySlackSignature(req: Request, rawBody: string): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");
  if (!signature || !timestamp) return false;

  // Reject requests older than 5 minutes to prevent replay attacks. Guard a
  // non-numeric timestamp: parseInt(...) → NaN and `NaN > 300` is false, which
  // would SILENTLY skip the replay window. Number.isFinite closes that (the
  // HMAC over the basestring still gates either way).
  const now = Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(sigBasestring);
  const computedSignature = `v0=${hmac.digest("hex")}`;

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(computedSignature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Length-checked, timing-safe string equality. Returns false on a length
 * mismatch so timingSafeEqual never throws (it raises RangeError on differing
 * buffer lengths). Use for low-value token / signature string comparisons,
 * e.g. the Meta subscribe verify-token handshake.
 */
export function safeStrEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Verify a Messenger (Meta) webhook signature (HMAC-SHA256). Mirrors
 * verifyWhatsAppSignature — both are Meta platforms using X-Hub-Signature-256.
 * Consolidated here from the inline route verifier, which was the only one that
 * called timingSafeEqual without a length pre-check (it relied on the throw +
 * catch to fail closed).
 */
export function verifyMessengerSignature(req: Request, rawBody: string): boolean {
  const appSecret = process.env.MESSENGER_APP_SECRET;
  if (!appSecret) return false;

  const signature = req.headers.get("x-hub-signature-256");
  if (!signature) return false;

  const expected =
    "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeStrEqual(signature, expected);
}
