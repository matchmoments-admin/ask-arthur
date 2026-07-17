import { z } from "zod";

export interface ExtensionURLCheckResponse {
  found: boolean;
  threatLevel?: "LOW" | "MEDIUM" | "HIGH";
  reportCount?: number;
  domain?: string;
  safeBrowsing?: { isMalicious: boolean; sources: string[] };
  redirect?: { finalUrl: string; hopCount: number; isShortened: boolean };
}

/** Request body of POST /api/extension/analyze-image. Produced by the
 *  extension client, validated by the web route — cross-package contract, so
 *  the schema lives here per the package rule. */
export const ExtensionImageCheckRequestSchema = z.object({
  imageUrl: z.url().max(2048),
  pageUrl: z.url().max(2048).nullish(),
});

export type ExtensionImageCheckRequest = z.infer<typeof ExtensionImageCheckRequestSchema>;

/** One classifier signal from the right-click image check. Confidence is the
 *  vendor's raw 0-1 score; `likely` applies our threshold. The UI must render
 *  the confidence, never a binary FAKE/REAL verdict (honesty guardrail). */
export interface ImageCheckSignal {
  likely: boolean;
  confidence: number;
}

/** Response shape of POST /api/extension/analyze-image (shared contract
 *  between the web route and the extension client). */
export interface ExtensionImageCheckResponse {
  /** false when the scan could not run (vendor unavailable) — distinct from
   *  a clean scan with low confidences. */
  checked: boolean;
  reason?: "scan_unavailable";
  aiGenerated: ImageCheckSignal | null;
  deepfake: ImageCheckSignal | null;
  generatorSource: string | null;
  /** Present only when the server-side Claude-vision context pass is enabled
   *  (FF_IMAGE_CHECK_VISION). */
  context?: {
    summary: string;
    impersonatedBrand: string | null;
    impersonatedCelebrity: string | null;
  } | null;
  /** Image checks remaining today for this install's tier. */
  imageChecksRemaining: number;
  disclaimer: string;
}
