import type { ShareIntentFile } from "expo-share-intent";

export interface NormalizedSharedContent {
  text?: string;
  images?: string[];
  url?: string;
}

/**
 * Convert an expo-share-intent payload into a normalized shape
 * consumable by the home screen analysis flow.
 */
export function normalizeSharedContent(intent: {
  text?: string;
  files?: ShareIntentFile[];
  weblinkUrl?: string;
  type?: string;
}): NormalizedSharedContent {
  const result: NormalizedSharedContent = {};

  // URL from share sheet
  if (intent.weblinkUrl) {
    result.url = intent.weblinkUrl;
    result.text = intent.weblinkUrl;
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
