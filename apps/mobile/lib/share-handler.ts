import type { ShareIntentFile } from "expo-share-intent";

export interface NormalizedSharedContent {
  text?: string;
  images?: string[];
  url?: string;
}

/**
 * Convert an expo-share-intent payload into a normalized shape
 * consumable by the home screen analysis flow.
 *
 * expo-share-intent 4.x ShareIntent shape: text/files/webUrl/type are all
 * `T | null | undefined` (not just `T | undefined`). Accept the wider input
 * type and normalise on the way out.
 */
export function normalizeSharedContent(intent: {
  text?: string | null;
  files?: ShareIntentFile[] | null;
  webUrl?: string | null;
  type?: string | null;
}): NormalizedSharedContent {
  const result: NormalizedSharedContent = {};

  // URL from share sheet
  if (intent.webUrl) {
    result.url = intent.webUrl;
    result.text = intent.webUrl;
  }

  // Plain text
  if (intent.text) {
    result.text = intent.text;
  }

  // Image files — read as file URIs for the image picker to consume
  if (intent.files && intent.files.length > 0) {
    result.images = intent.files
      .filter((f) => f.mimeType?.startsWith("image/"))
      .map((f) => f.path)
      .slice(0, 5);
  }

  return result;
}
