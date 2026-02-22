import { logger } from "@askarthur/utils/logger";

const GRAPH_API_VERSION = "v22.0";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface MediaInfo {
  url: string;
  mime_type: string;
  file_size?: number;
}

/**
 * Download a WhatsApp media file by its media ID and return as base64.
 *
 * Two-step process:
 * 1. GET the media URL from Graph API
 * 2. Download the binary content
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<string | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    logger.error("WhatsApp media download: WHATSAPP_ACCESS_TOKEN not configured");
    return null;
  }

  try {
    // Step 1: Get media URL
    const metaResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!metaResponse.ok) {
      logger.error("WhatsApp media metadata fetch failed", {
        status: metaResponse.status,
      });
      return null;
    }

    const mediaInfo: MediaInfo = await metaResponse.json();

    // Validate mime type
    if (!SUPPORTED_MIME_TYPES.has(mediaInfo.mime_type)) {
      logger.warn("WhatsApp media: unsupported mime type", {
        mimeType: mediaInfo.mime_type,
      });
      return null;
    }

    // Validate file size
    if (mediaInfo.file_size && mediaInfo.file_size > MAX_FILE_SIZE) {
      logger.warn("WhatsApp media: file too large", {
        size: mediaInfo.file_size,
      });
      return null;
    }

    // Step 2: Download binary content
    const downloadResponse = await fetch(mediaInfo.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!downloadResponse.ok) {
      logger.error("WhatsApp media download failed", {
        status: downloadResponse.status,
      });
      return null;
    }

    const buffer = Buffer.from(await downloadResponse.arrayBuffer());

    // Double-check size after download
    if (buffer.length > MAX_FILE_SIZE) {
      logger.warn("WhatsApp media: downloaded file too large", {
        size: buffer.length,
      });
      return null;
    }

    return buffer.toString("base64");
  } catch (err) {
    logger.error("WhatsApp media download error", { error: String(err) });
    return null;
  }
}
