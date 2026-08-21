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

  // ---- tier SELECTORS (consolidated 2026-08-21) --------------------------
  // Every surface previously re-implemented the (null | absent | signed |
  // invalid | present-unverified) selection as its own ternary tree — four
  // copies of the same decision, invisible to the asymmetry test. These
  // selectors ARE the decision; surfaces call them and the test exercises
  // the selection paths, so a mis-wired branch (e.g. "verified" copy for an
  // invalid signature) fails the build.

  /** Long-form C2PA line for the evidence page / PDF / web checker. */
  ccLine(cc: {
    present: boolean;
    format?: string;
    validationState?: string;
    issuer?: string | null;
    generator?: string | null;
  } | null): string {
    if (cc === null) return IMAGE_CHECK_ORIGIN_COPY.ccUnknown;
    if (!cc.present) return IMAGE_CHECK_ORIGIN_COPY.ccAbsent;
    if (cc.validationState) {
      return cc.validationState === "invalid"
        ? IMAGE_CHECK_ORIGIN_COPY.ccInvalid
        : IMAGE_CHECK_ORIGIN_COPY.ccSigned(cc);
    }
    return IMAGE_CHECK_ORIGIN_COPY.ccPresent(cc.format);
  },

  /** Short-form C2PA line for the extension card — undefined means "render
   *  no line" (absent/unknown tiers get no card row; asymmetry rule). */
  ccCardLine(cc: {
    present: boolean;
    validationState?: string;
    issuer?: string | null;
    generator?: string | null;
  } | null): string | undefined {
    if (!cc?.present) return undefined;
    if (cc.validationState) {
      return cc.validationState === "invalid"
        ? IMAGE_CHECK_ORIGIN_COPY.ccInvalidShort
        : IMAGE_CHECK_ORIGIN_COPY.ccSignedShort(cc.generator ?? cc.issuer);
    }
    return IMAGE_CHECK_ORIGIN_COPY.ccPresentShort;
  },

  /** Long-form metadata-origin line for the evidence page / PDF / web checker. */
  originLine(origin: { claimed: boolean; generator?: string | null } | null): string {
    if (origin === null) return IMAGE_CHECK_ORIGIN_COPY.originUnknown;
    return origin.claimed
      ? IMAGE_CHECK_ORIGIN_COPY.originClaimed(origin.generator)
      : IMAGE_CHECK_ORIGIN_COPY.originAbsent;
  },

  /** Short-form metadata-origin line for the extension card — undefined
   *  means "render no line" (only a FOUND tag earns a card row). */
  originCardLine(
    origin: { claimed: boolean; generator?: string | null } | null,
  ): string | undefined {
    return origin?.claimed
      ? IMAGE_CHECK_ORIGIN_COPY.originClaimedShort(origin.generator)
      : undefined;
  },

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

  // Red-flag lines for the verdict corroborator (ADR-0024): rendered inside
  // an Analysis Result's red-flag list on ad/image surfaces. NON-ESCALATING
  // by doctrine — they follow the isAiGenerated precedent (a red flag never
  // moves the Verdict; ADR-0015: corroboration never mutates a score).
  /** Image metadata claims AI origin and carries no signed manifest. */
  redFlagClaimedAiOrigin: (generator?: string | null): string =>
    `AI-origin metadata: the image carries a tag claiming AI origin${
      generator ? ` (${generator})` : ""
    } with no verified Content Credentials — tags like this are editable, so treat it as a hint`,
  /** Manifest signature failed — altered-since-signing, never "fake". */
  redFlagInvalidCredentials:
    "Content Credentials: the image's C2PA manifest fails signature validation — it may have been altered since it was signed",
} as const;
