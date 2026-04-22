import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { waitUntil, ipAddress } from "@vercel/functions";
import { checkRateLimit, checkImageUploadRateLimit } from "@askarthur/utils/rate-limit";
import { analyzeWithClaude, detectInjectionAttempt, type Verdict } from "@askarthur/scam-engine/claude";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { extractContactsFromText, normalizePhoneE164 } from "@askarthur/scam-engine/phone-normalize";
import { extractURLs, checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
import { resolveRedirects, extractFinalUrls } from "@askarthur/scam-engine/redirect-resolver";
import { geolocateFromHeaders } from "@askarthur/scam-engine/geolocate";
import type { RedirectChain } from "@askarthur/types";
import { storeVerifiedScam, incrementStats } from "@askarthur/scam-engine/pipeline";
import { storeScamReport, buildEntities } from "@askarthur/scam-engine/report-store";
import { hashIdentifier } from "@askarthur/utils/hash";
import { getCachedAnalysis, setCachedAnalysis } from "@askarthur/scam-engine/analysis-cache";
import type { PhoneLookupResult } from "@askarthur/types";
import { lookupPhoneNumber, extractPhoneNumbers } from "@/lib/twilioLookup";
import { uploadScreenshot } from "@/lib/r2";
import { logger, maskE164 } from "@askarthur/utils/logger";
import { logCost, claudeHaikuCostUsd } from "@/lib/cost-telemetry";

const RequestSchema = z.object({
  text: z.string().max(10000).optional(),
  image: z.string().max(5_000_000).optional(), // backward compat: single image
  images: z.array(z.string().max(5_000_000)).max(10).optional(), // multi-image
  mode: z.enum(["text", "image", "qrcode"]).optional(),
}).refine((data) => data.text || data.image || (data.images && data.images.length > 0), {
  message: "Either text or image(s) is required",
});

/**
 * Resolve the client IP from request headers.
 * Priority: Vercel-trusted header → standard proxy header → legacy x-real-ip.
 * Returns null when none are present (prod: reject; dev: fall through to loopback).
 */
function extractClientIp(req: NextRequest): string | null {
  const vercelIp = ipAddress(req);
  if (vercelIp) return vercelIp;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp;

  return null;
}

export async function POST(req: NextRequest) {
  try {
    // 0. Reject oversized payloads (defense against oversized base64)
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > 10_000_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // 1. Rate limit check
    //
    // Prefer Vercel's trusted `x-vercel-forwarded-for` via ipAddress() — it
    // cannot be spoofed by origin traffic. Fall back to the standard proxy
    // headers for non-Vercel environments (dev, tests). NEVER use a literal
    // "unknown" bucket: that would let any client strip their IP headers and
    // share a fate-bucket with every other unidentifiable request, DoSing
    // legit users off the rate limiter.
    const ip = extractClientIp(req);
    if (!ip) {
      if (process.env.NODE_ENV === "production") {
        logger.error("analyze.ip_extraction_failed");
        return NextResponse.json(
          { error: "bad_request", message: "Could not identify client." },
          { status: 400 }
        );
      }
      // Dev: allow the request with a loopback identity
    }
    const clientIp = ip ?? "127.0.0.1";
    const ua = req.headers.get("user-agent") || "unknown";

    const rateCheck = await checkRateLimit(clientIp, ua);
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

    // 2a. Image-upload specific rate limit (5 per IP per hour, sliding window).
    // Vision calls are ~$0.002-$0.01 each — this is defence-in-depth on top of
    // the UA+IP hash limit applied above.
    if (images.length > 0) {
      const imgRl = await checkImageUploadRateLimit(clientIp);
      if (!imgRl.allowed) {
        return NextResponse.json(
          { error: "rate_limited", message: imgRl.message, resetAt: imgRl.resetAt?.toISOString() },
          {
            status: 429,
            headers: {
              "X-RateLimit-Remaining": "0",
              "Retry-After": imgRl.resetAt
                ? String(Math.max(1, Math.ceil((imgRl.resetAt.getTime() - Date.now()) / 1000)))
                : "3600",
            },
          }
        );
      }
    }

    // 2b. Validate image magic bytes (prevent disguised file uploads)
    if (images.length > 0) {
      const { validateImageMagicBytes } = await import("@askarthur/scam-engine/image-validate");
      for (const img of images) {
        const { valid } = validateImageMagicBytes(img);
        if (!valid) {
          return NextResponse.json(
            { error: "validation_error", message: "Invalid image format. Supported: JPEG, PNG, GIF, WebP." },
            { status: 400 }
          );
        }
      }
    }

    // 2c. Pre-filter for prompt injection attempts
    const injectionCheck = text ? detectInjectionAttempt(text) : { detected: false, patterns: [] };

    // 3. Check cache for text-only requests (skip for images — content-addressable hashing is complex)
    const isTextOnly = text && images.length === 0;
    if (isTextOnly) {
      const cached = await getCachedAnalysis(text);
      if (cached) {
        const geo = geolocateFromHeaders(req.headers);
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

    // 4b. Resolve redirect chains when feature flag is on
    let redirectChains: RedirectChain[] = [];
    let allUrls = urls;
    if (featureFlags.redirectResolve && urls.length > 0) {
      redirectChains = await resolveRedirects(urls);
      const finalUrls = extractFinalUrls(redirectChains);
      // Deduplicate: originals + final destinations
      allUrls = [...new Set([...urls, ...finalUrls])];
    }

    // 5. Run AI analysis + URL reputation checks in parallel.
    // Geolocation is now synchronous (Vercel edge headers), so it no longer
    // belongs in Promise.all — resolve it inline above the fan-out.
    const geo = geolocateFromHeaders(req.headers);
    const { region, countryCode } = geo;
    const [aiResult, urlResults] = await Promise.all([
      analyzeWithClaude(text, images.length > 0 ? images : undefined, mode, redirectChains.length > 0 ? redirectChains : undefined),
      checkURLReputation(allUrls),
    ]);

    // 5b. Cost telemetry — fire-and-forget, wrapped in waitUntil internally.
    if (aiResult.usage) {
      logCost({
        feature: "web_analyze",
        provider: "anthropic",
        operation: "claude-haiku-4-5-20251001",
        units: aiResult.usage.inputTokens + aiResult.usage.outputTokens,
        estimatedCostUsd: claudeHaikuCostUsd(
          aiResult.usage.inputTokens,
          aiResult.usage.outputTokens,
        ),
        metadata: {
          input_tokens: aiResult.usage.inputTokens,
          output_tokens: aiResult.usage.outputTokens,
          cache_read: aiResult.usage.cacheReadInputTokens ?? 0,
          has_images: images.length > 0,
          image_count: images.length,
          mode: mode ?? "text",
        },
      });
    }

    logger.info("analyze.claude_result", {
      verdict: aiResult.verdict,
      hasText: !!text,
      imageCount: images.length,
      hasScammerContacts: !!aiResult.scammerContacts,
      contactPhones: aiResult.scammerContacts?.phoneNumbers?.length ?? 0,
      contactEmails: aiResult.scammerContacts?.emailAddresses?.length ?? 0,
    });

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

    // 6b. Redirect-specific red flags
    for (const chain of redirectChains) {
      if (chain.isShortened) {
        aiResult.redFlags.push(
          `Shortened URL detected: ${chain.originalUrl} redirects to ${chain.finalUrl}`
        );
      }
      if (chain.hasOpenRedirect) {
        aiResult.redFlags.push(
          `Open redirect detected in chain from ${chain.originalUrl}`
        );
      }
      if (chain.truncated) {
        aiResult.redFlags.push(
          `Excessive redirect chain (${chain.hopCount}+ hops) from ${chain.originalUrl}`
        );
      }
    }

    // 6c. Injection floor — if injection detected, floor verdict at SUSPICIOUS minimum
    if (injectionCheck.detected) {
      if (finalVerdict === "SAFE") {
        aiResult.verdict = "SUSPICIOUS";
      }
      aiResult.redFlags.push(
        "This message contains manipulation patterns that attempt to influence the analysis"
      );
    }

    // 7. Background work via waitUntil (survives after response is sent)
    // When intelligenceCore is OFF, use the existing storeVerifiedScam path.
    // When ON, defer report storage until after entity extraction (step 8d).
    if (!featureFlags.intelligenceCore && finalVerdict === "HIGH_RISK") {
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

    // 8. Extract scammer contacts when feature is on
    // Text path: extract from original (unscrubbed) text (preferred — has raw values)
    // Vision fallback: use contacts Claude extracted from screenshot (when text has none)
    let scammerContacts: { phoneNumbers: Array<{ value: string; context: string }>; emailAddresses: Array<{ value: string; context: string }> } | undefined;
    if (
      featureFlags.scamContactReporting &&
      (aiResult.verdict === "HIGH_RISK" || aiResult.verdict === "SUSPICIOUS")
    ) {
      // Try text extraction first
      if (text) {
        const extracted = extractContactsFromText(text);
        if (extracted.phoneNumbers.length > 0 || extracted.emailAddresses.length > 0) {
          scammerContacts = extracted;
          logger.info("analyze.contacts_from_text", {
            phones: extracted.phoneNumbers.length,
            emails: extracted.emailAddresses.length,
          });
        }
      }
      // Fall through to vision if text extraction found nothing (or no text)
      if (!scammerContacts && aiResult.scammerContacts) {
        try {
          const ai = aiResult.scammerContacts;
          if (ai.phoneNumbers.length > 0 || ai.emailAddresses.length > 0) {
            scammerContacts = {
              phoneNumbers: ai.phoneNumbers.map((p) => ({
                ...p,
                value: normalizePhoneE164(p.value) ?? p.value,
              })),
              emailAddresses: ai.emailAddresses,
            };
            logger.info("analyze.contacts_from_vision", {
              phones: ai.phoneNumbers.length,
              emails: ai.emailAddresses.length,
            });
          }
        } catch (err) {
          logger.warn("analyze.vision_contact_extract_failed", { error: String(err) });
        }
      }
    }

    // 8b. Phone intelligence enrichment (Twilio Lookup v2 + CNAM)
    // Text path: extract phones from raw text
    // Vision fallback: normalize phones from Claude's scammerContacts
    let phoneIntelligence: PhoneLookupResult | undefined;
    let phoneRiskFlags: string[] | undefined;   // backward compat
    let isVoipCaller: boolean | undefined;       // backward compat
    if (
      featureFlags.phoneIntelligence &&
      (aiResult.verdict === "HIGH_RISK" || aiResult.verdict === "SUSPICIOUS")
    ) {
      let phones: Array<{ original: string; e164: string | null }> = [];

      // Try text extraction first
      if (text) {
        phones = extractPhoneNumbers(text);
        logger.info("analyze.phones_from_text", { count: phones.length });
      }
      // Fall through to vision if text extraction found nothing (or no text)
      if (phones.length === 0 && aiResult.scammerContacts?.phoneNumbers?.length) {
        try {
          for (const p of aiResult.scammerContacts.phoneNumbers) {
            const normalized = extractPhoneNumbers(p.value);
            phones.push(...normalized);
          }
          logger.info("analyze.phones_from_vision", { count: phones.length });
        } catch (err) {
          logger.warn("analyze.vision_phone_normalize_failed", { error: String(err) });
        }
      }

      // Only run Twilio on mobile numbers (04xx/05xx) — landlines and toll-free
      // return the same data as free libphonenumber. VoIP detection on mobiles
      // is the only signal Twilio adds that we can't get for free.
      const lookupTarget = phones.find((p) => p.e164 && /^\+61[45]/.test(p.e164));
      if (lookupTarget?.e164) {
        try {
          logger.info("analyze.twilio_lookup", { masked: maskE164(lookupTarget.e164) });
          const lookup = await lookupPhoneNumber(lookupTarget.e164);
          phoneIntelligence = lookup;

          // Cost telemetry — Twilio Lookup v2 bills ~$0.018 per mobile lookup
          // (line-type + carrier + CNAM). Caching happens upstream in
          // twilio-lookup.ts so this fires once per unique E.164 per 24h.
          logCost({
            feature: "twilio_lookup",
            provider: "twilio",
            operation: "lookup-v2",
            units: 1,
            unitCostUsd: 0.018,
            metadata: {
              line_type: lookup.lineType,
              country: lookup.countryCode,
              is_voip: lookup.isVoip,
              risk_level: lookup.riskLevel,
            },
          });

          // Inject key findings as red flags
          if (lookup.isVoip) {
            aiResult.redFlags.push(
              `Phone ${lookup.nationalFormat || "detected"} uses VoIP — commonly used by scam operations`
            );
          }
          if (lookup.countryCode && lookup.countryCode !== "AU") {
            aiResult.redFlags.push(
              `Phone ${lookup.nationalFormat || "detected"} originates outside Australia (${lookup.countryCode})`
            );
          }

          // Backward compat
          phoneRiskFlags = lookup.riskFlags.length > 0 ? lookup.riskFlags : undefined;
          isVoipCaller = lookup.isVoip || undefined;
        } catch (err) {
          logger.error("Phone intelligence lookup failed", { error: String(err) });
        }
      }
    }

    // 8c. Extract scammer URLs when URL reporting feature is on
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

    // 8d. Intelligence Core: store unified report + entity linkage (behind feature flag)
    if (featureFlags.intelligenceCore) {
      const reporterHash = await hashIdentifier(clientIp, ua);
      const entitiesToLink = buildEntities({
        phones: scammerContacts?.phoneNumbers,
        emails: scammerContacts?.emailAddresses,
        urls: urlResults.length > 0 ? urlResults : undefined,
        extractionMethod: images.length > 0 ? "claude" : "regex",
      });

      if (finalVerdict === "HIGH_RISK") {
        // Chain: store verified scam first to get ID, then store report with link
        waitUntil(
          (async () => {
            const verifiedScamId = await storeVerifiedScam(aiResult, region, images.length > 0 ? images : undefined, uploadScreenshot);
            await storeScamReport({
              reporterHash, source: "web", inputMode: mode || (images.length > 0 ? "image" : "text"),
              analysis: aiResult, text, region, countryCode, verifiedScamId, entities: entitiesToLink,
            });
          })().catch(err => logger.error("Report pipeline failed", { error: String(err) }))
        );
      } else {
        waitUntil(
          storeScamReport({
            reporterHash, source: "web", inputMode: mode || (images.length > 0 ? "image" : "text"),
            analysis: aiResult, text, region, countryCode, entities: entitiesToLink,
          }).catch(err => logger.error("storeScamReport failed", { error: String(err) }))
        );
      }
    }

    // 8e. Brand impersonation alert (fire-and-forget)
    if (aiResult.impersonatedBrand && finalVerdict !== "SAFE") {
      import("@askarthur/scam-engine/brand-alerts").then(({ createBrandAlert }) => {
        waitUntil(
          createBrandAlert({
            brandName: aiResult.impersonatedBrand!,
            scamType: aiResult.scamType,
            channel: aiResult.channel,
            confidence: aiResult.confidence,
            scammerPhones: scammerContacts?.phoneNumbers?.map(p => p.value) || [],
            scammerUrls: allUrls.slice(0, 10),
            scammerEmails: scammerContacts?.emailAddresses?.map(e => e.value) || [],
            summary: aiResult.summary,
          }).catch(err => logger.error("Brand alert failed", { error: String(err) }))
        );
      });
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
        ...(aiResult.scamType && { scamType: aiResult.scamType }),
        ...(aiResult.impersonatedBrand && { impersonatedBrand: aiResult.impersonatedBrand }),
        ...(aiResult.channel && { channel: aiResult.channel }),
        ...(scammerContacts && { scammerContacts }),
        ...(scammerUrls && { scammerUrls }),
        ...(scammerUrls && mode && { inputMode: mode }),
        ...(redirectChains.length > 0 && { redirects: redirectChains }),
        ...(phoneIntelligence && { phoneIntelligence }),
        ...(phoneRiskFlags && { phoneRiskFlags }),          // backward compat
        ...(isVoipCaller != null && { isVoipCaller }),       // backward compat
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
