import { logger } from "@askarthur/utils/logger";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

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
    const response = await fetch(url);
    if (!response.ok) {
      logger.error("Messenger attachment download failed", { status: response.status });
      return null;
    }

    // Validate mime type from the response (webhook doesn't declare it)
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!SUPPORTED_MIME_TYPES.has(contentType)) {
      logger.warn("Messenger attachment: unsupported mime type", { mimeType: contentType });
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FILE_SIZE) {
      logger.warn("Messenger attachment: file too large", { size: buffer.length });
      return null;
    }

    return buffer.toString("base64");
  } catch (err) {
    logger.error("Messenger attachment download error", { error: String(err) });
    return null;
  }
}
