import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { checkRateLimit } from "@/lib/rateLimit";
import { analyzeWithClaude, detectInjectionAttempt, type Verdict } from "@/lib/claude";
import { featureFlags } from "@/lib/featureFlags";
import { extractContactsFromText } from "@/lib/phoneNormalize";
import { extractURLs, checkURLReputation } from "@/lib/safebrowsing";
import { geolocateIP } from "@/lib/geolocate";
import { storeVerifiedScam, incrementStats } from "@/lib/scamPipeline";
import { getCachedAnalysis, setCachedAnalysis } from "@/lib/analysisCache";
import { logger } from "@/lib/logger";

const RequestSchema = z.object({
  text: z.string().max(10000).optional(),
  image: z.string().max(5_000_000).optional(), // base64, ~3.75MB decoded
  mode: z.enum(["text", "image", "qrcode"]).optional(),
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

    const { text, image, mode } = parsed.data;

    // 2b. Pre-filter for prompt injection attempts
    const injectionCheck = text ? detectInjectionAttempt(text) : { detected: false, patterns: [] };

    // 3. Check cache for text-only requests (skip for images — content-addressable hashing is complex)
    const isTextOnly = text && !image;
    if (isTextOnly) {
      const cached = await getCachedAnalysis(text);
      if (cached) {
        const geo = await geolocateIP(ip);
        waitUntil(incrementStats(cached.verdict, geo.region));
        return NextResponse.json(
          {
            verdict: cached.verdict,
            confidence: cached.confidence,
            summary: cached.summary,
            redFlags: cached.redFlags,
            nextSteps: cached.nextSteps,
            urlsChecked: 0,
            maliciousURLs: 0,
            countryCode: geo.countryCode,
            cached: true,
          },
          { headers: { "X-RateLimit-Remaining": String(rateCheck.remaining) } }
        );
      }
    }

    // 4. Extract URLs from text for reputation checking
    const urls = text ? extractURLs(text) : [];

    // 5. Run AI analysis + URL reputation checks in parallel
    const [aiResult, urlResults, geo] = await Promise.all([
      analyzeWithClaude(text, image, mode),
      checkURLReputation(urls),
      geolocateIP(ip),
    ]);
    const { region, countryCode } = geo;

    // 6. Merge verdicts — URL threats escalate AI verdict
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

    // 6b. Injection floor — if injection detected, floor verdict at SUSPICIOUS minimum
    if (injectionCheck.detected) {
      if (finalVerdict === "SAFE") {
        aiResult.verdict = "SUSPICIOUS";
      }
      aiResult.redFlags.push(
        "This message contains manipulation patterns that attempt to influence the analysis"
      );
    }

    // 7. Background work via waitUntil (survives after response is sent)
    if (finalVerdict === "HIGH_RISK") {
      waitUntil(
        storeVerifiedScam(aiResult, region, image).catch((err) =>
          logger.error("storeVerifiedScam failed", { error: String(err) })
        )
      );
    }
    waitUntil(
      incrementStats(finalVerdict, region).catch((err) =>
        logger.error("incrementStats failed", { error: String(err) })
      )
    );

    // Cache text-only analysis results for future requests
    if (isTextOnly) {
      waitUntil(setCachedAnalysis(text, aiResult));
    }

    // 8. Extract scammer contacts from original (unscrubbed) text when feature is on
    // PII scrubbing runs before Claude, so Claude can't see the actual values.
    // We extract from the original text server-side for HIGH_RISK/SUSPICIOUS verdicts.
    let scammerContacts: { phoneNumbers: Array<{ value: string; context: string }>; emailAddresses: Array<{ value: string; context: string }> } | undefined;
    if (
      featureFlags.scamContactReporting &&
      text &&
      (aiResult.verdict === "HIGH_RISK" || aiResult.verdict === "SUSPICIOUS")
    ) {
      const extracted = extractContactsFromText(text);
      if (extracted.phoneNumbers.length > 0 || extracted.emailAddresses.length > 0) {
        scammerContacts = extracted;
      }
    }

    // 8b. Extract scammer URLs when URL reporting feature is on
    let scammerUrls: Array<{ url: string; isMalicious: boolean; sources: string[] }> | undefined;
    if (
      featureFlags.scamUrlReporting &&
      (aiResult.verdict === "HIGH_RISK" || aiResult.verdict === "SUSPICIOUS") &&
      urlResults.length > 0
    ) {
      scammerUrls = urlResults.map((r) => ({
        url: r.url,
        isMalicious: r.isMalicious,
        sources: r.sources,
      }));
    }

    // 9. Return result
    return NextResponse.json(
      {
        verdict: aiResult.verdict,
        confidence: aiResult.confidence,
        summary: aiResult.summary,
        redFlags: aiResult.redFlags,
        nextSteps: aiResult.nextSteps,
        urlsChecked: urlResults.length,
        maliciousURLs: maliciousURLs.length,
        countryCode,
        ...(scammerContacts && { scammerContacts }),
        ...(scammerUrls && { scammerUrls }),
        ...(scammerUrls && mode && { inputMode: mode }),
      },
      {
        headers: {
          "X-RateLimit-Remaining": String(rateCheck.remaining),
        },
      }
    );
  } catch (err) {
    logger.error("Analysis error", { error: String(err) });
    return NextResponse.json(
      {
        error: "analysis_failed",
        message: "Something went wrong analyzing your message. Please try again.",
      },
      { status: 500 }
    );
  }
}
