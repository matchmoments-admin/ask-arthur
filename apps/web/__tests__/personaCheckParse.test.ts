/**
 * parsePersonaResponse — the persona-check route had the same blind spot as
 * analyzeWithClaude before #1168: no stop_reason check and a first-`{`-to-
 * last-`}` extraction that reports a max_tokens cut as "invalid JSON".
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@askarthur/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { parsePersonaResponse } from "@/lib/persona-check-parse";

const COMPLETE = `{
  "verdict": "SUSPICIOUS",
  "confidence": 0.7,
  "riskLevel": "Medium",
  "summary": "The profile has several inconsistencies worth checking.",
  "redFlags": ["Account created last week", "Stock photo as avatar"],
  "greenFlags": [],
  "recommendations": [
    { "step": "Ask for a live video call", "why": "Scammers avoid live video" },
    { "step": "Reverse-image search the photo", "why": "Stock photos are reused" }
  ],
  "inferredType": "dating"
}`;

// Cut inside the second recommendation object — the shape a cap produces.
const TRUNCATED = COMPLETE.slice(0, COMPLETE.indexOf('"why": "Stock') + 12);

describe("parsePersonaResponse", () => {
  it("parses a normal completion", () => {
    const r = parsePersonaResponse(COMPLETE, "end_turn");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.verdict).toBe("SUSPICIOUS");
      expect(r.truncated).toBe(false);
    }
  });

  it("recovers verdict + summary when the cut lands in the trailing array", () => {
    const r = parsePersonaResponse(TRUNCATED, "max_tokens");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.truncated).toBe(true);
      expect(r.result.verdict).toBe("SUSPICIOUS");
      expect(r.result.summary).toMatch(/inconsistencies/);
      expect(r.result.redFlags).toHaveLength(2);
      // The half-written recommendation is dropped, the complete one kept.
      expect(r.result.recommendations).toHaveLength(1);
    }
  });

  it("without the stop_reason signal the same text was reported as invalid JSON (the pre-fix diagnosis)", () => {
    const r = parsePersonaResponse(TRUNCATED, "end_turn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid JSON");
  });

  it("names truncation when the cut precedes the verdict", () => {
    const r = parsePersonaResponse('{\n  "verdict": "SUSP', "max_tokens");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/truncated/);
      expect(r.userMessage).toMatch(/cut short/);
    }
  });
});
