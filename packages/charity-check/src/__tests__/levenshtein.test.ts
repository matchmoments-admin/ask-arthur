import { describe, expect, it } from "vitest";

import { levenshtein } from "../providers/acnc";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  it("returns length(b) when a is empty", () => {
    expect(levenshtein("", "abcd")).toBe(4);
  });

  it("returns length(a) when b is empty", () => {
    expect(levenshtein("abcd", "")).toBe(4);
  });

  it("counts a single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("counts a single insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  it("counts a single deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  it("handles transpositions as 2 edits (substitute both chars)", () => {
    // Standard Levenshtein doesn't have a single-edit "transposition"
    // operation — that's Damerau-Levenshtein. We use plain Levenshtein
    // because typo-style transpositions ("austraian"/"australian") are
    // rare on charity names; substitutions and insertions dominate.
    expect(levenshtein("ab", "ba")).toBe(2);
  });

  it("real typosquat: 'austraian red cross' → 'australian red cross society' (≤ 9 edits)", () => {
    // "austraian" → "australian" is 1 edit (insert 'l').
    // " society" suffix is 8 more edits (insertion).
    // Total 9 edits — far above our 3-edit typosquat gate, which is
    // intentional: this much divergence shouldn't auto-flag as typosquat.
    const edits = levenshtein("austraian red cross", "australian red cross society");
    expect(edits).toBe(9);
  });

  it("classic typosquat: 1-letter swap stays under the 3-edit gate", () => {
    expect(levenshtein("astralian red cross", "australian red cross")).toBeLessThanOrEqual(3);
  });

  it("symmetric — order doesn't matter", () => {
    expect(levenshtein("kitten", "sitting")).toBe(levenshtein("sitting", "kitten"));
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});
