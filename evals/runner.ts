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

// promptfoo's file:// custom-provider contract (verified against 0.122 on the
// first-ever real run, 2026-08-07): the default export must be a CLASS whose
// instances expose `id()` and `callApi()`. The original default-exported
// async function threw "(intermediate value) is not a constructor" — another
// defect the exit-0 era never let surface.
export default class AskArthurAnalyzeProvider {
  id(): string {
    return "askarthur-analyze";
  }

  async callApi(
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
}
