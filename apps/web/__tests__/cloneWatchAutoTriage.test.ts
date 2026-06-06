import { describe, expect, it } from "vitest";
import {
  primarySignalType,
  passesStrictSignal,
} from "@/app/api/inngest/functions/clone-watch-auto-triage";

describe("primarySignalType", () => {
  it("reads signal_type from the first signal", () => {
    expect(
      primarySignalType([{ signal_type: "confusable", score: 0.9 }]),
    ).toBe("confusable");
  });

  it("returns null for empty / malformed signals", () => {
    expect(primarySignalType([])).toBeNull();
    expect(primarySignalType(null)).toBeNull();
    expect(primarySignalType("nope")).toBeNull();
    expect(primarySignalType([{ score: 1 }])).toBeNull();
  });
});

describe("passesStrictSignal", () => {
  it("accepts confusable and levenshtein primary signals", () => {
    expect(passesStrictSignal([{ signal_type: "confusable" }])).toBe(true);
    expect(passesStrictSignal([{ signal_type: "levenshtein" }])).toBe(true);
  });

  it("rejects the high-FP substring class and unknowns", () => {
    // 'substring' is the ~70%-raw-FP class the strict bar deliberately excludes.
    expect(passesStrictSignal([{ signal_type: "substring" }])).toBe(false);
    expect(passesStrictSignal([{ signal_type: "au_token" }])).toBe(false);
    expect(passesStrictSignal([])).toBe(false);
  });

  it("only considers the PRIMARY (first) signal", () => {
    // confusable buried behind a substring primary must NOT auto-qualify.
    expect(
      passesStrictSignal([
        { signal_type: "substring" },
        { signal_type: "confusable" },
      ]),
    ).toBe(false);
  });
});
