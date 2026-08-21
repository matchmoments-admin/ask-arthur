// AI-origin red-flag corroborator (ADR-0024) — the post-merge applier for
// image-bearing surfaces (currently analyze-ad; the applyShopSignal /
// applyAsicCitation pattern).
//
// Doctrine (ADR-0015 + the isAiGenerated precedent in core-analysis):
// these strings join an Analysis Result's red-flag list and NEVER escalate
// the Verdict — provenance is corroboration, not a score input. Absence of
// provenance produces NO flag at all (asymmetry rule: most platforms strip
// metadata, so absence is not evidence). Only two situations flag:
//  1. metadata CLAIMS AI origin and no signed manifest backs the image, or
//  2. a C2PA manifest is present but its signature FAILS validation
//     (altered since signing — a provenance-tampering signal, not "fake").
// A validly-signed AI image is transparent, properly-credentialed content —
// deliberately NOT a red flag.
//
// Cost: one SSRF-guarded byte fetch (free, ≤5 MB, 5 s timeout) — callers
// should invoke this only on checks that already flagged, keeping clean-ad
// latency untouched.

import { fetchImageBytes } from "./image-fetch";
import { readImageOrigin } from "./image-origin";
import { IMAGE_CHECK_ORIGIN_COPY } from "@askarthur/types";

export interface ImageOriginFlagOptions {
  /** Run cryptographic C2PA validation (FF_IMAGE_CHECK_C2PA_VALIDATE). */
  validateC2pa: boolean;
}

/**
 * Fetch the image and return AI-origin red-flag strings (possibly empty).
 * Never throws; unreachable bytes return [] — "could not check" is not a
 * red flag. Caller must have SSRF-vetted the URL (assertSafeURL / CDN
 * allowlist); fetchImageBytes adds the DNS-rebinding defence.
 */
export async function collectImageOriginRedFlags(
  imageUrl: string,
  opts: ImageOriginFlagOptions,
): Promise<string[]> {
  try {
    const bytes = await fetchImageBytes(imageUrl);
    if (!bytes) return [];

    const { contentCredentials: cc, metadataOrigin: origin } =
      await readImageOrigin(bytes.buffer, { validateC2pa: opts.validateC2pa });

    const flags: string[] = [];
    if (cc.validationState === "invalid") {
      flags.push(IMAGE_CHECK_ORIGIN_COPY.redFlagInvalidCredentials);
    }
    if (origin.claimed && !cc.present) {
      flags.push(IMAGE_CHECK_ORIGIN_COPY.redFlagClaimedAiOrigin(origin.generator));
    }
    return flags;
  } catch {
    return [];
  }
}
