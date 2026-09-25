import { logger } from "@askarthur/utils/logger";
import { safeFetch } from "@askarthur/scam-engine/safe-fetch";

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
    // but this is the only bot path that fetches a payload-supplied URL. safeFetch
    // blocks internal/metadata hosts, checks every connect and redirect hop, and
    // streams the body with a hard cap.
    const res = await safeFetch(url, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxBytes: MAX_FILE_SIZE,
      as: "bytes",
    });
    if (!res.ok) {
      if (res.reason === "http") {
        logger.error("Messenger attachment download failed", { status: res.status });
      } else {
        logger.warn("Messenger attachment: download refused or failed", {
          reason: res.reason,
          detail: res.detail,
        });
      }
      return null;
    }

    // Validate mime type from the response (webhook doesn't declare it).
    // Media types are case-insensitive (RFC 9110) — normalise before matching.
    const contentType =
      res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!SUPPORTED_MIME_TYPES.has(contentType)) {
      logger.warn("Messenger attachment: unsupported mime type", { mimeType: contentType });
      return null;
    }
    if (res.body.byteLength === 0) return null;

    return Buffer.from(res.body).toString("base64");
  } catch (err) {
    logger.error("Messenger attachment download error", { error: String(err) });
    return null;
  }
}
