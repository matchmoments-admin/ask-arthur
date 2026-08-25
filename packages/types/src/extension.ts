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

// Shared image-check shapes (ImageCheckSignal, ContentCredentialsResult,
// MetadataOriginResult) live in ./image-check — reused by the public
// /api/image-check contract.
import type {
  ImageCheckSignal,
  ContentCredentialsResult,
  MetadataOriginResult,
} from "./image-check";

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
  /** Top generator-attribution classes with raw scores (excludes the
   *  verdict classes ai_generated/not_ai_generated/deepfake). Null when the
   *  detector didn't return a class list (e.g. pre-v2 cached results). */
  generatorBreakdown: Array<{ class: string; score: number }> | null;
  /** C2PA / Content Credentials — null when the image bytes weren't
   *  available to inspect (unknown), which is different from
   *  {present: false}. Copy from IMAGE_CHECK_ORIGIN_COPY. */
  contentCredentials: ContentCredentialsResult | null;
  /** CLAIMED AI-origin metadata — null when bytes weren't available
   *  (unknown); {claimed: false} means "no tag found", NEVER "not AI". */
  metadataOrigin: MetadataOriginResult | null;
  /** Present only when the server-side Claude-vision context pass is enabled
   *  (FF_IMAGE_CHECK_VISION). */
  context?: {
    summary: string;
    impersonatedBrand: string | null;
    impersonatedCelebrity: string | null;
  } | null;
  /** Evidence-record reference (IC-XXXXXXXXXXXX) — set only when the check
   *  FLAGGED and FF_IMAGE_CHECK_RECORDS persisted a metadata record
   *  (ADR-0022). Quotable in reports to ReportCyber/eSafety. */
  checkRef?: string | null;
  /** Image checks remaining today for this install's tier. */
  imageChecksRemaining: number;
  disclaimer: string;
}
