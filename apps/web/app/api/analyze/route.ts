import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil } from "@vercel/functions";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { analyzeWithClaude, detectInjectionAttempt, type Verdict } from "@askarthur/scam-engine/claude";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { extractContactsFromText } from "@askarthur/scam-engine/phone-normalize";
import { extractURLs, checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
import { geolocateIP } from "@askarthur/scam-engine/geolocate";
import { storeVerifiedScam, incrementStats } from "@askarthur/scam-engine/pipeline";
import { getCachedAnalysis, setCachedAnalysis } from "@askarthur/scam-engine/analysis-cache";
import { uploadScreenshot } from "@/lib/r2";
import { logger } from "@askarthur/utils/logger";

const RequestSchema = z.object({
  text: z.string().max(10000).optional(),
  image: z.string().max(5_000_000).optional(), // backward compat: single image
  images: z.array(z.string().max(5_000_000)).max(10).optional(), // multi-image
  mode: z.enum(["text", "image", "qrcode"]).optional(),
}).refine((data) => data.text || data.image || (data.images && data.images.length > 0), {
  message: "Either text or image(s) is required",
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

    const { text, image, images: rawImages, mode } = parsed.data;
    // Normalize: merge legacy single `image` into `images` array
    const images: string[] = rawImages && rawImages.length > 0
      ? rawImages
      : image ? [image] : [];

    // 2b. Pre-filter for prompt injection attempts
    const injectionCheck = text ? detectInjectionAttempt(text) : { detected: false, patterns: [] };

    // 3. Check cache for text-only requests (skip for images — content-addressable hashing is complex)
    const isTextOnly = text && images.length === 0;
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
      analyzeWithClaude(text, images.length > 0 ? images : undefined, mode),
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
        storeVerifiedScam(aiResult, region, images.length > 0 ? images : undefined, uploadScreenshot).catch((err) =>
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
