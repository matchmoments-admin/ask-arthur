// Persona-check structured output: the tool-use schema the model must satisfy
// and the injection floor applied to its verdict. Kept out of the route file
// (Next.js route modules may only export handlers) so both are unit-testable.

import { z } from "zod";

const VERDICTS = ["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"] as const;
const RISK_LEVELS = ["Low Risk", "Some Concerns", "Warning Signs", "High Risk"] as const;
type PersonaVerdict = (typeof VERDICTS)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];

/** The risk label that goes with each verdict — used when the model omits one
 *  or returns a label outside the rendered set. */
const RISK_FOR_VERDICT: Record<PersonaVerdict, RiskLevel> = {
  SAFE: "Low Risk",
  UNCERTAIN: "Some Concerns",
  SUSPICIOUS: "Warning Signs",
  HIGH_RISK: "High Risk",
};

/** Strings: truncated, never rejected for length. */
const text = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.slice(0, max) : v), z.string());

/** Lists: non-string / blank items dropped, count and item length capped, a
 *  missing or malformed list becomes []. */
const list = (maxItems: number, maxLen = 300) =>
  z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .slice(0, maxItems)
            .map((x) => x.slice(0, maxLen))
        : [],
    z.array(z.string()),
  );

/**
 * The tool-use schema (also what callClaudeJson validates against). Enum
 * values match what PersonaChecker renders; they stay enums in the JSON Schema
 * the model sees.
 *
 * Tolerant by design — minor deviations are normalised, not turned into a 503:
 * lists sliced (10/5/5), strings truncated, confidence clamped, inferredType
 * and riskLevel defaulted. The verdict is still enum-validated and NEVER passed
 * through: an unknown or missing verdict becomes SUSPICIOUS, the same default
 * the main analyze pipeline's validateResult applies — it never reassures, and
 * it prompts the user to verify rather than presenting a malfunction as a
 * judgement either way. Only a missing summary still fails the call.
 */
export const PersonaAssessmentSchema = z
  .object({
    verdict: z.enum(VERDICTS).catch("SUSPICIOUS"),
    confidence: z.preprocess((v) => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
    }, z.number()),
    riskLevel: z.enum(RISK_LEVELS).optional().catch(undefined),
    summary: text(500).pipe(z.string().min(1)),
    redFlags: list(10),
    greenFlags: list(5),
    recommendations: list(5),
    inferredType: z
      .enum(["romance", "employment", "investment", "general"])
      .catch("general"),
  })
  .transform((a) => ({
    ...a,
    riskLevel: a.riskLevel ?? RISK_FOR_VERDICT[a.verdict],
  }));
export type PersonaAssessment = z.output<typeof PersonaAssessmentSchema>;

const VERDICT_RANK: Record<PersonaVerdict, number> = { SAFE: 0, UNCERTAIN: 1, SUSPICIOUS: 2, HIGH_RISK: 3 };

/** Instruction-shaped text in the user's own submission never yields less
 *  than SUSPICIOUS — the same floor the main analyze pipeline applies. */
export function applyInjectionFloor(
  a: PersonaAssessment,
  injectionDetected: boolean,
): PersonaAssessment {
  if (!injectionDetected || VERDICT_RANK[a.verdict] >= VERDICT_RANK.SUSPICIOUS) return a;
  return {
    ...a,
    verdict: "SUSPICIOUS",
    riskLevel: "Warning Signs",
    redFlags: [
      "Contains text that tries to instruct an automated checker — a common trait of scam content",
      ...a.redFlags,
    ].slice(0, 10),
  };
}
