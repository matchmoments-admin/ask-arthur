// Persona-check structured output: the tool-use schema the model must satisfy
// and the injection floor applied to its verdict. Kept out of the route file
// (Next.js route modules may only export handlers) so both are unit-testable.

import { z } from "zod";

/** The tool-use schema. Enum values match PersonaChecker's VERDICT_STYLES keys
 *  and risk labels; anything else is rejected by callClaudeJson. */
export const PersonaAssessmentSchema = z.object({
  verdict: z.enum(["SAFE", "UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"]),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["Low Risk", "Some Concerns", "Warning Signs", "High Risk"]),
  summary: z.string().min(1).max(600),
  redFlags: z.array(z.string().max(300)).max(10).default([]),
  greenFlags: z.array(z.string().max(300)).max(5).default([]),
  recommendations: z.array(z.string().max(300)).max(5).default([]),
  inferredType: z.enum(["romance", "employment", "investment", "general"]),
});
export type PersonaAssessment = z.infer<typeof PersonaAssessmentSchema>;

const VERDICT_RANK = { SAFE: 0, UNCERTAIN: 1, SUSPICIOUS: 2, HIGH_RISK: 3 } as const;

/** Instruction-shaped text in the submission never yields less than
 *  SUSPICIOUS — the same floor the main analyze pipeline applies. */
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
