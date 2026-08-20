// Canonical user-facing copy for the image-check AI-origin ladder:
//   signed  — C2PA / Content Credentials manifest (cryptographic, but
//             presence-only until FF_IMAGE_CHECK_C2PA_VALIDATE ships)
//   claimed — XMP/EXIF metadata tag (forgeable, a hint)
//   none    — nothing found (says NOTHING about how the image was made)
//
// Every surface (extension card, evidence page, evidence PDF) imports these
// strings instead of writing its own, so the asymmetry guardrail can be
// enforced in one test: none-tier copy must never read as "human-made" /
// "no AI" — absence of provenance is not evidence of anything, because most
// platforms strip metadata on upload. Guard test:
// apps/web/__tests__/imageCheckOriginCopy.test.ts.

export const IMAGE_CHECK_ORIGIN_COPY = {
  /** Extension card — C2PA manifest present (short form). */
  ccPresentShort: "Content Credentials present (issuer unverified)",
  /** Evidence page/PDF — C2PA manifest present, with container detail. */
  ccPresent: (format?: string): string =>
    `C2PA manifest present in ${format ?? "image"} container (issuer not cryptographically verified)`,
  /** C2PA manifest absent — MUST stay neutral (asymmetry rule). */
  ccAbsent:
    "no C2PA manifest detected — most platforms strip metadata on upload, so absence says nothing about how the image was made",
  /** Bytes unavailable — unknown, distinct from absent. */
  ccUnknown: "not assessed (image bytes unavailable)",

  /** Extension card — manifest signature VERIFIED (FF_IMAGE_CHECK_C2PA_VALIDATE). */
  ccSignedShort: (name?: string | null): string =>
    name
      ? `Content Credentials verified — signed by ${name}`
      : "Content Credentials verified (signed manifest)",
  /** Evidence page/PDF — manifest signature verified, with detail.
   *  validationState "valid" (vs "trusted") = signature holds but the
   *  issuer isn't on the C2PA trust list — say so. */
  ccSigned: (opts: {
    generator?: string | null;
    issuer?: string | null;
    validationState?: string;
  }): string =>
    `C2PA manifest signature verified — file records creation or editing with ${
      opts.generator ?? "an unidentified tool"
    }${opts.issuer ? `, certificate issued to ${opts.issuer}` : ""}${
      opts.validationState === "valid" ? " (issuer not on the C2PA trust list)" : ""
    }`,
  /** Manifest present but signature FAILED — altered-since-signing, never
   *  "fake" (asymmetry rule cuts both ways). */
  ccInvalidShort:
    "Content Credentials manifest invalid — the file may have been altered since it was signed",
  ccInvalid:
    "C2PA manifest present but its signature does not validate — the file may have been altered since signing (or the manifest is malformed). This shows tampering with the provenance record, not what the image is",

  /** Extension card — claimed AI-origin tag found (short form). */
  originClaimedShort: (generator?: string | null): string =>
    generator
      ? `File metadata claims AI origin (${generator}) — editable tag, treat as a hint`
      : "File metadata claims AI origin — editable tag, treat as a hint",
  /** Evidence page/PDF — claimed AI-origin tag found. */
  originClaimed: (generator?: string | null): string =>
    `metadata claims AI origin${generator ? ` — generator recorded as ${generator}` : ""} (tags like this can be edited, so treat this as a hint, not proof)`,
  /** No origin tag — MUST stay neutral (asymmetry rule). */
  originAbsent:
    "no machine-readable origin tag found (such tags are routinely stripped on upload)",
  /** Bytes unavailable — unknown, distinct from absent. */
  originUnknown: "not assessed (image bytes unavailable)",
} as const;
