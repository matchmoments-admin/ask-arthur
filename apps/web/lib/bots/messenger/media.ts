import { logger } from "@askarthur/utils/logger";
import { assertSafeURL } from "@askarthur/scam-engine/ssrf-guard";
import { ssrfSafeDispatcher } from "@askarthur/scam-engine/ssrf-dispatcher";
import { readBodyCapped } from "@askarthur/utils/read-body-capped";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DOWNLOAD_TIMEOUT_MS = 10_000;

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * Download a Messenger image attachment and return it as base64.
 *
 * Unlike WhatsApp (media-ID → metadata → download two-step), Messenger
 * delivers a pre-signed CDN URL directly in the webhook payload
 * (`message.attachments[].payload.url`), so a single authenticated-free
 * fetch is enough. MIME type and size are validated from the response
 * itself since the webhook doesn't declare them up front.
 */
export async function downloadMessengerAttachment(url: string): Promise<string | null> {
  try {
    // Defence-in-depth: the webhook is HMAC-verified so the URL is Meta-attested,
    // but this is the only bot path that fetches a payload-supplied URL — block
    // internal/metadata hosts at zero cost in case the trust posture ever changes.
    assertSafeURL(url);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      ...({ dispatcher: ssrfSafeDispatcher } as Record<string, unknown>),
    });
    if (!response.ok) {
      logger.error("Messenger attachment download failed", { status: response.status });
      return null;
    }

    // Validate mime type from the response (webhook doesn't declare it).
    // Media types are case-insensitive (RFC 9110) — normalise before matching.
    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!SUPPORTED_MIME_TYPES.has(contentType)) {
      logger.warn("Messenger attachment: unsupported mime type", { mimeType: contentType });
      return null;
    }

    // Streamed with a hard cap — a declared Content-Length is advisory.
    const body = await readBodyCapped(response, MAX_FILE_SIZE);
    if (!body.ok) {
      logger.warn("Messenger attachment: file too large or empty", { reason: body.reason });
      return null;
    }

    return Buffer.from(body.bytes).toString("base64");
  } catch (err) {
    logger.error("Messenger attachment download error", { error: String(err) });
    return null;
  }
}
