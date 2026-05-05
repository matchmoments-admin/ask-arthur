// promptfoo provider — wraps analyzeWithClaude so eval fixtures hit
// the production prompt path verbatim.
//
// promptfoo expects an async `callApi(prompt, context)` that returns
// `{ output: string | object, tokenUsage? }`. We pass the user's
// submission text into analyzeWithClaude and return the parsed
// AnalysisResult so the YAML assertions can drill into specific
// fields (verdict, redFlags, scamType, etc).

import { analyzeWithClaude } from "@askarthur/scam-engine/claude";

interface PromptfooContext {
  vars?: {
    text?: string;
    mode?: "text" | "image" | "qrcode";
  };
}

interface PromptfooResult {
  output: unknown;
  tokenUsage?: {
    total: number;
    prompt: number;
    completion: number;
  };
  error?: string;
}

export default async function callApi(
  _prompt: string,
  context: PromptfooContext,
): Promise<PromptfooResult> {
  const text = context.vars?.text;
  if (!text) {
    return { output: null, error: "No text provided in fixture vars.text" };
  }

  try {
    const result = await analyzeWithClaude(
      text,
      undefined,
      context.vars?.mode ?? "text",
    );
    return {
      output: result,
      tokenUsage: result.usage
        ? {
            total: result.usage.inputTokens + result.usage.outputTokens,
            prompt: result.usage.inputTokens,
            completion: result.usage.outputTokens,
          }
        : undefined,
    };
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
