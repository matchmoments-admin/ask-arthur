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
  /** Top generator-attribution classes with raw scores (excludes the
   *  verdict classes ai_generated/not_ai_generated/deepfake). Null when the
   *  detector didn't return a class list (e.g. pre-v2 cached results). */
  generatorBreakdown: Array<{ class: string; score: number }> | null;
  /** C2PA / Content Credentials. `present` is the structural container
   *  sniff; the validation fields are set only when
   *  FF_IMAGE_CHECK_C2PA_VALIDATE ran cryptographic validation — when
   *  absent, copy must say "issuer unverified". Null when the image bytes
   *  weren't available to inspect (unknown), which is different from
   *  {present: false}. An "invalid" state means altered-since-signing,
   *  NEVER "fake" (asymmetry rule — copy from IMAGE_CHECK_ORIGIN_COPY). */
  contentCredentials: {
    present: boolean;
    format?: string;
    validationState?: "trusted" | "valid" | "invalid";
    signatureValid?: boolean;
    issuer?: string | null;
    generator?: string | null;
  } | null;
  /** CLAIMED AI-origin metadata (XMP DigitalSourceType / CreatorTool, EXIF
   *  Software) — the forgeable tier below Content Credentials. Null when the
   *  image bytes weren't available to inspect (unknown); {claimed: false}
   *  means "no tag found", NEVER "not AI" (asymmetry rule — copy must come
   *  from IMAGE_CHECK_ORIGIN_COPY). */
  metadataOrigin: {
    claimed: boolean;
    source?: "xmp" | "exif";
    generator?: string | null;
    digitalSourceType?: string | null;
  } | null;
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
