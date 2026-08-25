import { describe, it, expect } from "vitest";
import {
  generateCheckRef,
  CHECK_REF_PATTERN,
  DOCUMENT_CHECK_REF_PATTERN,
} from "@/lib/check-ref";

describe("generateCheckRef", () => {
  it("produces IC- + 12 Crockford-base32 chars (no ambiguous letters)", () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateCheckRef();
      expect(ref).toMatch(CHECK_REF_PATTERN);
      // Crockford excludes I, L, O, U — quotable over the phone.
      expect(ref.slice(3)).not.toMatch(/[ILOU]/);
    }
  });

  it("produces DC- refs for document checks; patterns don't cross-match", () => {
    const ref = generateCheckRef("DC");
    expect(ref).toMatch(DOCUMENT_CHECK_REF_PATTERN);
    expect(ref).not.toMatch(CHECK_REF_PATTERN);
    expect(generateCheckRef()).not.toMatch(DOCUMENT_CHECK_REF_PATTERN);
  });

  it("does not collide across a reasonable sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      seen.add(generateCheckRef());
    }
    expect(seen.size).toBe(5000);
  });
});
