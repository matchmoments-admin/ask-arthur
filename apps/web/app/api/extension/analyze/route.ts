import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { analyzeWithClaude, detectInjectionAttempt, type Verdict } from "@askarthur/scam-engine/claude";
import { extractURLs, checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
import { resolveRedirects, extractFinalUrls } from "@askarthur/scam-engine/redirect-resolver";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getCachedAnalysis, setCachedAnalysis } from "@askarthur/scam-engine/analysis-cache";
import type { RedirectChain } from "@askarthur/types";
import { storeVerifiedScam, incrementStats } from "@askarthur/scam-engine/pipeline";
import { stripEmailHtml } from "@askarthur/scam-engine/html-sanitize";
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

    const { text: rawText } = parsed.data;

    // 2b. Strip HTML artifacts from email content (defense-in-depth)
    const text = stripEmailHtml(rawText);

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

    // 5. Extract URLs + resolve redirects
    const urls = extractURLs(text);

    let redirectChains: RedirectChain[] = [];
    let allUrls = urls;
    if (featureFlags.redirectResolve && urls.length > 0) {
      redirectChains = await resolveRedirects(urls);
      const finalUrls = extractFinalUrls(redirectChains);
      allUrls = [...new Set([...urls, ...finalUrls])];
    }

    // 5b. Run AI analysis + URL reputation checks in parallel
    const [aiResult, urlResults] = await Promise.all([
      analyzeWithClaude(text, undefined, undefined, redirectChains.length > 0 ? redirectChains : undefined),
      checkURLReputation(allUrls),
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
