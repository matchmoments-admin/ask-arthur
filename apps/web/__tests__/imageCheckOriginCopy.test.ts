import { describe, it, expect } from "vitest";
import { IMAGE_CHECK_ORIGIN_COPY } from "@askarthur/types";

// The asymmetry guardrail (plan: AI Origin ladder / ADR-0024-to-be): absence
// of provenance is NEVER evidence of human origin — most platforms strip
// metadata on upload. Any none/unknown-tier string that reads as "human" /
// "no AI" turns a technically-correct result into a misleading claim, so
// this test fails the build on the banned substrings.
//
// Scope: the none-tier and unknown-tier strings. Claimed/signed-tier strings
// legitimately mention AI ("claims AI origin") and are exempt.

const BANNED = [/human/i, /not ai\b/i, /no ai\b/i, /real photo/i, /authentic/i];

const NONE_TIER_STRINGS: Array<[string, string]> = [
  ["ccAbsent", IMAGE_CHECK_ORIGIN_COPY.ccAbsent],
  ["ccUnknown", IMAGE_CHECK_ORIGIN_COPY.ccUnknown],
  ["originAbsent", IMAGE_CHECK_ORIGIN_COPY.originAbsent],
  ["originUnknown", IMAGE_CHECK_ORIGIN_COPY.originUnknown],
];

describe("image-check origin copy — asymmetry rule", () => {
  it.each(NONE_TIER_STRINGS)(
    "%s never claims human origin or 'no AI'",
    (_name, copy) => {
      for (const re of BANNED) {
        expect(copy).not.toMatch(re);
      }
    },
  );

  it("none-tier copy explains that absence is normal (stripping), not a verdict", () => {
    expect(IMAGE_CHECK_ORIGIN_COPY.ccAbsent).toMatch(/strip/i);
    expect(IMAGE_CHECK_ORIGIN_COPY.originAbsent).toMatch(/strip/i);
  });

  it("claimed-tier copy always hedges (editable / hint), with and without a generator", () => {
    for (const s of [
      IMAGE_CHECK_ORIGIN_COPY.originClaimedShort("Midjourney"),
      IMAGE_CHECK_ORIGIN_COPY.originClaimedShort(null),
      IMAGE_CHECK_ORIGIN_COPY.originClaimed("Midjourney"),
      IMAGE_CHECK_ORIGIN_COPY.originClaimed(null),
    ]) {
      expect(s).toMatch(/hint/i);
      expect(s).toMatch(/edit/i);
    }
  });

  it("signed-tier copy never overclaims verification while validation is presence-only", () => {
    expect(IMAGE_CHECK_ORIGIN_COPY.ccPresentShort).toMatch(/unverified/i);
    expect(IMAGE_CHECK_ORIGIN_COPY.ccPresent("jpeg")).toMatch(/not cryptographically verified/i);
  });

  it("invalid-signature copy blames the provenance record, never calls the image fake", () => {
    for (const s of [IMAGE_CHECK_ORIGIN_COPY.ccInvalidShort, IMAGE_CHECK_ORIGIN_COPY.ccInvalid]) {
      expect(s).not.toMatch(/fake|forged|scam/i);
      expect(s).toMatch(/altered|tamper/i);
    }
  });

  it("valid-but-untrusted signatures disclose the trust-list gap", () => {
    expect(
      IMAGE_CHECK_ORIGIN_COPY.ccSigned({ generator: "Adobe Firefly", validationState: "valid" }),
    ).toMatch(/not on the C2PA trust list/i);
    expect(
      IMAGE_CHECK_ORIGIN_COPY.ccSigned({ generator: "Adobe Firefly", validationState: "trusted" }),
    ).not.toMatch(/not on the C2PA trust list/i);
  });
});
