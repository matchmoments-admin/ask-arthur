import { z } from "zod";

// Shared image-check shapes — the AI-origin ladder results used by BOTH the
// extension analyze-image contract (extension.ts) and the public
// /api/image-check web checker. Copy for these lives in image-check-copy.ts.

/** C2PA / Content Credentials. `present` is the structural container sniff
 *  (c2pa-detect); the validation fields are set only when
 *  FF_IMAGE_CHECK_C2PA_VALIDATE ran cryptographic validation (c2pa-verify).
 *  "invalid" means altered-since-signing, NEVER "fake" (asymmetry rule). */
export interface ContentCredentialsResult {
  present: boolean;
  format?: string;
  validationState?: "trusted" | "valid" | "invalid";
  signatureValid?: boolean;
  issuer?: string | null;
  generator?: string | null;
}

/** CLAIMED AI-origin metadata (XMP DigitalSourceType / CreatorTool, EXIF
 *  Software) — forgeable tags. {claimed: false} means "no tag found",
 *  NEVER "not AI". */
export interface MetadataOriginResult {
  claimed: boolean;
  source?: "xmp" | "exif";
  generator?: string | null;
  digitalSourceType?: string | null;
}

/** One classifier signal. Confidence is the vendor's raw 0-1 score; `likely`
 *  applies our threshold. UI renders the confidence, never binary FAKE/REAL. */
export interface ImageCheckSignal {
  likely: boolean;
  confidence: number;
}

/** URL-mode request body of the public POST /api/image-check. Upload mode
 *  uses multipart/form-data with a `file` field instead. */
export const WebImageCheckUrlRequestSchema = z.object({
  imageUrl: z.url().max(2048),
});

export type WebImageCheckUrlRequest = z.infer<typeof WebImageCheckUrlRequestSchema>;

/** Response of the public POST /api/image-check (both modes).
 *  - "url" mode: Hive classifier signals + byte-derived AI-origin ladder.
 *  - "upload" mode: deterministic AI-origin ladder ONLY (no classifier —
 *    aiGenerated/deepfake stay null; null = "did not run", never "clean"). */
export interface WebImageCheckResponse {
  /** false when nothing could be assessed at all. */
  checked: boolean;
  reason?: "scan_unavailable";
  mode: "url" | "upload";
  aiGenerated: ImageCheckSignal | null;
  deepfake: ImageCheckSignal | null;
  generatorSource: string | null;
  generatorBreakdown: Array<{ class: string; score: number }> | null;
  contentCredentials: ContentCredentialsResult | null;
  metadataOrigin: MetadataOriginResult | null;
  /** SHA-256 of the assessed bytes — lets the user corroborate later. */
  imageSha256: string | null;
  disclaimer: string;
}
