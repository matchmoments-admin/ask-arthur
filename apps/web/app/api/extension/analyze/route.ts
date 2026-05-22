import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runAnalysisCore } from "@askarthur/scam-engine/analyze-core";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { ExtensionAnalyzeInputSchema } from "@askarthur/types";
import { stripEmailHtml } from "@askarthur/scam-engine/html-sanitize";
import { logger } from "@askarthur/utils/logger";
import { logCost, claudeHaikuCostUsd } from "@/lib/cost-telemetry";
import { validateExtensionRequest } from "../_lib/auth";

export async function POST(req: NextRequest) {
  try {
    // 0. Reject oversized payloads.
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > 10_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // 1. Auth + per-install rate limit (extension-specific concern).
    const auth = await validateExtensionRequest(req);
    if (!auth.valid) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          ...(auth.retryAfter && {
            headers: { "Retry-After": auth.retryAfter },
          }),
        },
      );
    }

    // 2. Validate input.
    const body = await req.json();
    const parsed = ExtensionAnalyzeInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    // 2b. Strip HTML artefacts from email content (defence-in-depth before
    //     the analyzer sees the text — runAnalysisCore expects clean input).
    const text = stripEmailHtml(parsed.data.text);

    // 3. Hand off to the canonical analyze pipeline. Cache, AI, URL
    //    reputation, redirect resolution, mergeVerdict, and the background
    //    fan-out (storeVerifiedScam / incrementStats / setCachedAnalysis)
    //    all live in runAnalysisCore now — see packages/scam-engine/src/
    //    analyze-core.ts.
    const out = await runAnalysisCore({
      text,
      surface: "extension",
      resolveRedirectsEnabled: featureFlags.redirectResolve,
      backgroundMode: "waitUntil",
      requestId: auth.requestId ?? undefined,
    });

    // 4. Cost telemetry — only on cache miss (cached hits are free; logging
    //    a usage row from a different submission would double-bill).
    if (!out.cached && out.result.usage) {
      logCost({
        feature: "extension_analyze",
        provider: "anthropic",
        operation: "claude-haiku-4-5-20251001",
        units: out.result.usage.inputTokens + out.result.usage.outputTokens,
        estimatedCostUsd: claudeHaikuCostUsd(
          out.result.usage.inputTokens,
          out.result.usage.outputTokens,
        ),
        metadata: {
          input_tokens: out.result.usage.inputTokens,
          output_tokens: out.result.usage.outputTokens,
          cache_read: out.result.usage.cacheReadInputTokens ?? 0,
          install_id: auth.installId,
        },
        requestId: auth.requestId,
      });
    }

    // 5. Hand background work to Vercel — runAnalysisCore returned the
    //    Promise[] so the user response isn't gated on persistence.
    for (const task of out.backgroundTasks) {
      waitUntil(task);
    }

    return NextResponse.json(
      {
        verdict: out.result.verdict,
        confidence: out.result.confidence,
        summary: out.result.summary,
        redFlags: out.result.redFlags,
        nextSteps: out.result.nextSteps,
        // Shop Signal — runAnalysisCore stamps this when the input looked
        // commerce-shaped. The extension popup (#323) reads it to render
        // the verdict + commerce-flag chips; omitted for non-commerce input.
        ...(out.result.shopSignal ? { shopSignal: out.result.shopSignal } : {}),
        ...(out.cached ? { cached: true } : {}),
      },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } },
    );
  } catch (err) {
    logger.error("Extension analysis error", { error: String(err) });
    return NextResponse.json(
      {
        error: "analysis_failed",
        message:
          "Something went wrong analyzing your message. Please try again.",
      },
      { status: 500 },
    );
  }
}
