import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit";
import { analyzeWithClaude, detectInjectionAttempt, type Verdict } from "@/lib/claude";
import { extractURLs, checkURLReputation } from "@/lib/safebrowsing";
import { geolocateIP } from "@/lib/geolocate";
import { storeVerifiedScam, incrementStats } from "@/lib/scamPipeline";

const RequestSchema = z.object({
  text: z.string().max(10000).optional(),
  image: z.string().max(5_000_000).optional(), // base64, ~3.75MB decoded
}).refine((data) => data.text || data.image, {
  message: "Either text or image is required",
});

export async function POST(req: NextRequest) {
  try {
    // 0. Reject oversized payloads (defense against oversized base64)
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > 10_000_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // 1. Rate limit check
    const ip = req.headers.get("x-real-ip")
      || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    const rateCheck = await checkRateLimit(ip, ua);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: rateCheck.message,
          resetAt: rateCheck.resetAt?.toISOString(),
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Remaining": "0",
            "Retry-After": rateCheck.resetAt
              ? String(Math.ceil((rateCheck.resetAt.getTime() - Date.now()) / 1000))
              : "3600",
          },
        }
      );
    }

    // 2. Validate input
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { text, image } = parsed.data;

    // 2b. Pre-filter for prompt injection attempts
    const injectionCheck = text ? detectInjectionAttempt(text) : { detected: false, patterns: [] };

    // 3. Extract URLs from text for reputation checking
    const urls = text ? extractURLs(text) : [];

    // 4. Run AI analysis + URL reputation checks in parallel
    const [aiResult, urlResults, region] = await Promise.all([
      analyzeWithClaude(text, image),
      checkURLReputation(urls),
      geolocateIP(ip),
    ]);

    // 5. Merge verdicts — URL threats escalate AI verdict
    let finalVerdict: Verdict = aiResult.verdict;
    const maliciousURLs = urlResults.filter((r) => r.isMalicious);

    if (maliciousURLs.length > 0) {
      // Escalate to HIGH_RISK if any URL is flagged
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

    // 5b. Injection floor — if injection detected, floor verdict at SUSPICIOUS minimum
    if (injectionCheck.detected) {
      if (finalVerdict === "SAFE") {
        aiResult.verdict = "SUSPICIOUS";
      }
      aiResult.redFlags.push(
        "This message contains manipulation patterns that attempt to influence the analysis"
      );
    }

    // 6. Fire-and-forget: store scam data + increment stats
    if (finalVerdict === "HIGH_RISK") {
      storeVerifiedScam(aiResult, region, image).catch(() => {});
    }
    incrementStats(finalVerdict, region).catch(() => {});

    // 7. Return result
    return NextResponse.json(
      {
        verdict: aiResult.verdict,
        confidence: aiResult.confidence,
        summary: aiResult.summary,
        redFlags: aiResult.redFlags,
        nextSteps: aiResult.nextSteps,
        urlsChecked: urlResults.length,
        maliciousURLs: maliciousURLs.length,
      },
      {
        headers: {
          "X-RateLimit-Remaining": String(rateCheck.remaining),
        },
      }
    );
  } catch (err) {
    console.error("Analysis error:", err);
    return NextResponse.json(
      {
        error: "analysis_failed",
        message: "Something went wrong analyzing your message. Please try again.",
      },
      { status: 500 }
    );
  }
}
