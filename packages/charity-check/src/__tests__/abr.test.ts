import { describe, expect, it } from "vitest";

import { wordOverlapRatio } from "../providers/abr";

describe("wordOverlapRatio", () => {
  it("returns 1.0 for identical names", () => {
    expect(wordOverlapRatio("Australian Red Cross", "Australian Red Cross")).toBe(1);
  });

  it("ignores Inc / Ltd / Pty suffixes (stopwords)", () => {
    // Both reduce to {"red", "cross"} after stopword removal — perfect overlap.
    expect(
      wordOverlapRatio("Red Cross Pty Ltd", "Red Cross Inc"),
    ).toBeGreaterThan(0.99);
  });

  it("ignores common org-name stopwords (Australian, Trust, Fund)", () => {
    // {"red", "cross"} for both after stopword removal.
    expect(wordOverlapRatio("Red Cross Trust", "The Red Cross Fund")).toBe(1);
  });

  it("punctuation insensitive", () => {
    expect(wordOverlapRatio("St. John's Ambulance", "St Johns Ambulance")).toBeCloseTo(1, 1);
  });

  it("low overlap on materially different names", () => {
    expect(wordOverlapRatio("Red Cross", "Salvation Army")).toBeLessThan(0.5);
  });

  it("returns 0 when one side is empty after stopword removal", () => {
    // "Australia Inc Ltd" → empty set after stopwords; should not divide by zero.
    expect(wordOverlapRatio("Australia Inc Ltd", "Cancer Foundation")).toBe(0);
  });

  it("case insensitive", () => {
    expect(wordOverlapRatio("RED CROSS", "red cross")).toBe(1);
  });
});
