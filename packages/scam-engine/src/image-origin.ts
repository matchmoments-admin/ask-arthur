// The AI-origin ladder over image bytes — ONE implementation of
// "sniff C2PA presence → validate only when present and flagged → read
// claimed-origin metadata", consumed by the extension analyze-image route,
// the public /api/image-check route, and the analyze-ad red-flag applier
// (image-origin-flags.ts). Consolidated 2026-08-21: the three call sites
// each restated this sequence, so the verify-only-when-present
// parser-surface rule and the format→MIME mapping had no locality.
//
// Contract: bytes in, ladder out. Callers own fetching (and therefore the
// null-when-bytes-unavailable tier — never pass a synthesized empty
// buffer). verifyC2PA returning null (could-not-validate) leaves the
// presence-only result standing — never "invalid".

import { detectC2PA } from "./c2pa-detect";
import { verifyC2PA } from "./c2pa-verify";
import { detectMetadataOrigin } from "./metadata-origin";
import type {
  ContentCredentialsResult,
  MetadataOriginResult,
} from "@askarthur/types";

export interface ImageOrigin {
  contentCredentials: ContentCredentialsResult;
  metadataOrigin: MetadataOriginResult;
}

export async function readImageOrigin(
  buffer: Buffer,
  opts: { validateC2pa: boolean },
): Promise<ImageOrigin> {
  let contentCredentials: ContentCredentialsResult = detectC2PA(buffer);
  const metadataOrigin = detectMetadataOrigin(buffer);

  if (contentCredentials.present && opts.validateC2pa) {
    const verification = await verifyC2PA(
      buffer,
      `image/${contentCredentials.format ?? "jpeg"}`,
    );
    if (verification) {
      contentCredentials = { ...contentCredentials, ...verification };
    }
  }

  return { contentCredentials, metadataOrigin };
}
