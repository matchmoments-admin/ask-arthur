/**
 * closeTruncatedJson — property check against a real model output.
 *
 * The fixture is a genuine Haiku analysis for the 2026-09-17 incident email
 * (PII placeholders as the scrubber left them; the sender's name and site
 * replaced). Cutting it at every offset simulates every place max_tokens
 * could land. Three properties must hold at every cut:
 *   1. the repair parses (or returns null — never throws),
 *   2. every string value in the repaired object appears verbatim in the
 *      complete original (nothing invented, no half-strings shipped),
 *   3. once the cut is past the end of `nextSteps`, the verdict, summary,
 *      redFlags and nextSteps are recovered exactly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { closeTruncatedJson } from "../truncated-json";

const ORIGINAL = readFileSync(
  join(__dirname, "fixtures", "haiku-analysis-2026-09-17.json"),
  "utf8",
).trim();
const PARSED = JSON.parse(ORIGINAL);

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => stringLeaves(v, out));
  return out;
}

describe("closeTruncatedJson", () => {
  it("returns the input unchanged when it already parses", () => {
    expect(closeTruncatedJson(ORIGINAL)).toBe(ORIGINAL);
  });

  it("never throws and never invents content, at every cut offset", () => {
    const originalLeaves = new Set(stringLeaves(PARSED));
    let repaired = 0;
    for (let cut = 1; cut < ORIGINAL.length; cut++) {
      const result = closeTruncatedJson(ORIGINAL.slice(0, cut));
      if (result === null) continue;
      repaired++;
      const obj = JSON.parse(result);
      for (const leaf of stringLeaves(obj)) {
        expect(originalLeaves.has(leaf), `cut ${cut}: "${leaf}"`).toBe(true);
      }
    }
    // Sanity: the repair works for the overwhelming majority of offsets.
    expect(repaired).toBeGreaterThan(ORIGINAL.length * 0.95);
  });

  it("recovers the verdict fields exactly once the cut is past nextSteps", () => {
    const afterNextSteps =
      ORIGINAL.indexOf('"scamType"') || ORIGINAL.indexOf('"nextSteps"');
    for (let cut = afterNextSteps; cut < ORIGINAL.length; cut += 7) {
      const result = closeTruncatedJson(ORIGINAL.slice(0, cut));
      expect(result, `cut ${cut}`).not.toBeNull();
      const obj = JSON.parse(result!);
      expect(obj.verdict).toBe(PARSED.verdict);
      expect(obj.confidence).toBe(PARSED.confidence);
      expect(obj.summary).toBe(PARSED.summary);
      expect(obj.redFlags).toEqual(PARSED.redFlags);
      expect(obj.nextSteps).toEqual(PARSED.nextSteps);
    }
  });

  it("collapses to an empty object when no field survived — the caller decides if that is enough", () => {
    expect(closeTruncatedJson("{")).toBe("{}");
    expect(closeTruncatedJson('{"ver')).toBe("{}");
    expect(closeTruncatedJson('{"verdict": "HIGH_')).toBe("{}");
  });
});
