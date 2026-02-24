import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { analyzeWithClaude, detectInjectionAttempt, type Verdict } from "@askarthur/scam-engine/claude";
import { extractURLs, checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
import { getCachedAnalysis, setCachedAnalysis } from "@askarthur/scam-engine/analysis-cache";
import { storeVerifiedScam, incrementStats } from "@askarthur/scam-engine/pipeline";
import { logger } from "@askarthur/utils/logger";
import { validateExtensionRequest } from "../_lib/auth";

const AnalyzeSchema = z.object({
  text: z.string().min(1).max(10000),
});

export async function POST(req: NextRequest) {
  try {
    // 0. Reject oversized payloads
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > 10_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // 1. Auth + rate limit
    const auth = await validateExtensionRequest(req);
    if (!auth.valid) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          ...(auth.retryAfter && {
            headers: { "Retry-After": auth.retryAfter },
          }),
        }
      );
    }

    // 2. Validate input
    const body = await req.json();
    const parsed = AnalyzeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { text } = parsed.data;

    // 3. Pre-filter for injection attempts
    const injectionCheck = detectInjectionAttempt(text);

    // 4. Cache check
    const cached = await getCachedAnalysis(text);
    if (cached) {
      waitUntil(incrementStats(cached.verdict, "extension"));
      return NextResponse.json(
        {
          verdict: cached.verdict,
          confidence: cached.confidence,
          summary: cached.summary,
          redFlags: cached.redFlags,
          nextSteps: cached.nextSteps,
          cached: true,
        },
        { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
      );
    }

    // 5. Extract URLs + run AI analysis in parallel
    const urls = extractURLs(text);
    const [aiResult, urlResults] = await Promise.all([
      analyzeWithClaude(text),
      checkURLReputation(urls),
    ]);

    // 6. Merge verdicts — URL threats escalate AI verdict
    let finalVerdict: Verdict = aiResult.verdict;
    const maliciousURLs = urlResults.filter((r) => r.isMalicious);

    if (maliciousURLs.length > 0) {
      finalVerdict = "HIGH_RISK";
      for (const mal of maliciousURLs) {
        aiResult.redFlags.push(
          `URL flagged by ${mal.sources.join(" and ")}: ${mal.url}`
        );
      }
      if (!aiResult.nextSteps.includes("Do not click any links in this message.")) {
        aiResult.nextSteps.unshift("Do not click any links in this message.");
      }
    }

    aiResult.verdict = finalVerdict;

    // 6b. Injection floor
    if (injectionCheck.detected) {
      if (finalVerdict === "SAFE") {
        aiResult.verdict = "SUSPICIOUS";
      }
      aiResult.redFlags.push(
        "This message contains manipulation patterns that attempt to influence the analysis"
      );
    }

    // 7. Background work
    if (finalVerdict === "HIGH_RISK") {
      waitUntil(
        storeVerifiedScam(aiResult, "extension").catch((err) =>
          logger.error("storeVerifiedScam failed", { error: String(err) })
        )
      );
    }
    waitUntil(
      incrementStats(finalVerdict, "extension").catch((err) =>
        logger.error("incrementStats failed", { error: String(err) })
      )
    );
    waitUntil(setCachedAnalysis(text, aiResult));

    // 8. Return result
    return NextResponse.json(
      {
        verdict: aiResult.verdict,
        confidence: aiResult.confidence,
        summary: aiResult.summary,
        redFlags: aiResult.redFlags,
        nextSteps: aiResult.nextSteps,
      },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
    );
  } catch (err) {
    logger.error("Extension analysis error", { error: String(err) });
    return NextResponse.json(
      {
        error: "analysis_failed",
        message: "Something went wrong analyzing your message. Please try again.",
      },
      { status: 500 }
    );
  }
}
