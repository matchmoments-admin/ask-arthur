// Parse step for /api/persona-check, split out so it has a test seam.
//
// The route file cannot export anything but HTTP handlers (Next.js validates
// route module exports at build time), and the route itself is too tangled
// (rate limit, SSRF guard, WHOIS, Claude) to exercise in a unit test — so the
// one piece with a real failure history lives here.
import { closeTruncatedJson } from "@askarthur/scam-engine/truncated-json";
import { logger } from "@askarthur/utils/logger";

export const PERSONA_MAX_TOKENS = 800;

export type PersonaParse =
  | { ok: true; result: Record<string, unknown>; truncated: boolean }
  | { ok: false; reason: string; userMessage: string };

/**
 * Turn the model's text into the result object, or say precisely why not.
 *
 * Mirrors analyzeWithClaude (#1168): a `max_tokens` stop means the JSON was
 * cut mid-write. The fields this route needs (verdict, summary) are written
 * first, so closing the open structures usually recovers a usable result;
 * the naive first-`{`-to-last-`}` extraction would instead hand JSON.parse
 * an object ending at some array element's brace and report "invalid JSON"
 * — a diagnosis that sends the next engineer looking at the prompt instead
 * of the cap.
 */
export function parsePersonaResponse(
  responseText: string,
  stopReason: string | null,
): PersonaParse {
  const truncated = stopReason === "max_tokens";
  let jsonText: string | null;
  if (truncated) {
    // warn, not info: info is sampled at 10% and this is the rare event
    // the sampling would hide.
    logger.warn("Persona check: Claude output truncated at max_tokens", {
      maxTokens: PERSONA_MAX_TOKENS,
      text_chars: responseText.length,
    });
    const start = responseText.indexOf("{");
    jsonText = start === -1 ? null : closeTruncatedJson(responseText.slice(start));
  } else {
    jsonText = responseText.match(/\{[\s\S]*\}/)?.[0] ?? null;
  }
  if (jsonText === null) {
    return {
      ok: false,
      reason: truncated ? "output truncated before any JSON" : "no JSON in response",
      userMessage: truncated
        ? "Analysis was cut short — please try again."
        : "Analysis failed — please try again.",
    };
  }

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: "invalid JSON", userMessage: "Analysis failed — please try again." };
  }

  if (!result.verdict || !result.summary) {
    return {
      ok: false,
      reason: truncated ? "output truncated before verdict/summary" : "missing verdict/summary",
      userMessage: truncated
        ? "Analysis was cut short — please try again."
        : "Analysis incomplete — please try again.",
    };
  }
  return { ok: true, result, truncated };
}
