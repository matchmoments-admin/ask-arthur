import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Redis } from "@upstash/redis";
import { waitUntil } from "@vercel/functions";
import { analyzeWithClaude, type Verdict } from "@askarthur/scam-engine/claude";
import { extractURLs, checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
import { checkHiveAI } from "@askarthur/scam-engine/hive-ai";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { validateExtensionRequest } from "../_lib/auth";
import { logCost, claudeHaikuCostUsd } from "@/lib/cost-telemetry";

function isFacebookCDN(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname.endsWith(".fbcdn.net") || hostname.endsWith(".facebook.com") || hostname.endsWith(".cdninstagram.com");
  } catch {
    return false;
  }
}

const AnalyzeAdSchema = z.object({
  adText: z.string().min(1).max(10000),
  landingUrl: z.string().url().nullish(),
  imageUrl: z.string().url().nullish(),
  advertiserName: z.string().min(1).max(200),
  adTextHash: z.string().min(1).max(128),
});

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

/**
 * Rate limit image checks: 10/day per installId.
 * Returns true if allowed.
 */
async function checkImageRateLimit(installId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    // Fail-open in dev, fail-closed in prod
    return process.env.NODE_ENV !== "production";
  }

  const data = new TextEncoder().encode(installId);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const idHash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const today = new Date().toISOString().slice(0, 10);
  const key = `askarthur:ext:img:${idHash}:${today}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 48 * 60 * 60); // 48h TTL
  }

  return count <= 10;
}

export async function POST(req: NextRequest) {
  try {
    // 0. Reject oversized payloads
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > 15_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // 0b. Server-side feature gate. Even if an unpacked extension bundle
    // is used to forge a valid signed request, this endpoint returns 503
    // until NEXT_PUBLIC_FF_FACEBOOK_ADS=true in Vercel. Keeps Claude + Hive
    // spend at zero while Facebook Ads scanning is still being launched.
    if (!featureFlags.facebookAds) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Facebook ad scanning is not currently enabled." },
        { status: 503 },
      );
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
    const parsed = AnalyzeAdSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { adText, landingUrl, imageUrl, advertiserName, adTextHash } = parsed.data;
    const safeImageUrl = imageUrl && isFacebookCDN(imageUrl) ? imageUrl : null;

    // 3. Check image rate limit if image provided
    let imageAllowed = false;
    if (safeImageUrl) {
      imageAllowed = await checkImageRateLimit(auth.installId);
    }

    // 4. Phase 1: text (Claude) + URL reputation in parallel (always run)
    const [textResult, urlResult] = await Promise.allSettled([
      analyzeWithClaude(adText),
      landingUrl ? checkURLReputation(extractURLs(landingUrl)) : Promise.resolve([]),
    ]);

    const analysis = textResult.status === "fulfilled" ? textResult.value : null;
    const urlChecks = urlResult.status === "fulfilled" ? urlResult.value : [];

    // 4b. Cost telemetry — Claude analyse for ad text.
    if (analysis?.usage) {
      logCost({
        feature: "extension_analyze_ad",
        provider: "anthropic",
        operation: "claude-haiku-4-5-20251001",
        units: analysis.usage.inputTokens + analysis.usage.outputTokens,
        estimatedCostUsd: claudeHaikuCostUsd(
          analysis.usage.inputTokens,
          analysis.usage.outputTokens,
        ),
        metadata: {
          input_tokens: analysis.usage.inputTokens,
          output_tokens: analysis.usage.outputTokens,
          cache_read: analysis.usage.cacheReadInputTokens ?? 0,
          install_id: auth.installId,
          advertiser_name: advertiserName,
          has_image: !!safeImageUrl,
          has_landing_url: !!landingUrl,
        },
        requestId: auth.requestId,
      });
    }

    // Phase 2: Hive AI only if text verdict is not SAFE and image is available
    let hive: Awaited<ReturnType<typeof checkHiveAI>> | null = null;
    if (analysis?.verdict !== "SAFE" && safeImageUrl && imageAllowed) {
      try {
        hive = await checkHiveAI(safeImageUrl);
        // Cost telemetry — Hive AI image scan. unitCostUsd=0 is a deliberate
        // placeholder: Hive's per-image rate is not documented in the repo
        // and must be set once the pricing contract is signed (see Tier 3
        // feature-flag-flip playbook). The row still captures that a scan
        // happened, tagged by installId + result shape.
        logCost({
          feature: "hive_ai",
          provider: "hive",
          operation: "sync-task",
          units: 1,
          unitCostUsd: 0,
          metadata: {
            has_result: hive !== null,
            is_ai_generated: hive?.isAiGenerated ?? false,
            is_deepfake: hive?.isDeepfake ?? false,
            ai_confidence: hive?.aiConfidence ?? null,
            deepfake_confidence: hive?.deepfakeConfidence ?? null,
            generator_source: hive?.generatorSource ?? null,
            install_id: auth.installId,
          },
          requestId: auth.requestId,
        });
      } catch {
        hive = null;
      }
    }

    // 5. Merge verdicts
    let verdict: Verdict = analysis?.verdict ?? "SAFE";
    const redFlags: string[] = analysis?.redFlags ?? [];
    let urlMalicious = false;

    // URL malicious → escalate to HIGH_RISK
    const maliciousURLs = Array.isArray(urlChecks) ? urlChecks.filter((r) => r.isMalicious) : [];
    if (maliciousURLs.length > 0) {
      verdict = "HIGH_RISK";
      urlMalicious = true;
      for (const mal of maliciousURLs) {
        redFlags.push(`URL flagged by ${mal.sources.join(" and ")}: ${mal.url}`);
      }
    }

    // Hive deepfake → escalate to HIGH_RISK
    let aiGeneratedImage = false;
    let deepfakeDetected = false;
    let impersonatedCelebrity: string | null = null;
    let generatorSource: string | null = null;

    if (hive) {
      generatorSource = hive.generatorSource;

      if (hive.isDeepfake) {
        deepfakeDetected = true;
        verdict = "HIGH_RISK";
        redFlags.push("Deepfake image detected by AI analysis");
      }

      if (hive.isAiGenerated) {
        aiGeneratedImage = true;
        redFlags.push("Image appears to be AI-generated");
      }
    }

    // 6. Celebrity matching (if deepfake detected)
    if (deepfakeDetected && analysis?.impersonatedBrand) {
      const supabase = createServiceClient();
      if (supabase) {
        // Try exact match first, then similarity
        const { data: celebrity } = await supabase
          .from("monitored_celebrities")
          .select("id, name")
          .or(`name.ilike.%${analysis.impersonatedBrand}%,aliases.cs.{${analysis.impersonatedBrand}}`)
          .limit(1)
          .single();

        if (celebrity) {
          impersonatedCelebrity = celebrity.name;

          // Insert deepfake detection record (fire-and-forget)
          waitUntil(
            (async () => {
              const { error: insertErr } = await supabase
                .from("deepfake_detections")
                .insert({
                  celebrity_id: celebrity.id,
                  celebrity_name: celebrity.name,
                  image_url: safeImageUrl!,
                  hive_result: hive,
                  ai_confidence: hive!.aiConfidence,
                  deepfake_confidence: hive!.deepfakeConfidence,
                  generator_source: generatorSource,
                  ad_text_excerpt: adText.slice(0, 500),
                  landing_url: landingUrl ?? null,
                  advertiser_name: advertiserName,
                });
              if (insertErr) logger.error("Failed to store deepfake detection", { error: String(insertErr) });
            })()
          );
        }
      }
    }

    // 7. Upsert flagged_ads with Hive results (fire-and-forget)
    if (verdict !== "SAFE") {
      const supabase = createServiceClient();
      if (supabase) {
        waitUntil(
          (async () => {
            const { error: upsertErr } = await supabase
              .from("flagged_ads")
              .upsert(
                {
                  ad_text_hash: adTextHash,
                  advertiser_name: advertiserName,
                  landing_url: landingUrl ?? null,
                  verdict,
                  ai_generated_image: aiGeneratedImage,
                  deepfake_detected: deepfakeDetected,
                  hive_result: hive,
                  impersonated_celebrity: impersonatedCelebrity,
                },
                { onConflict: "ad_text_hash" }
              );
            if (upsertErr) logger.error("Failed to upsert flagged_ad", { error: String(upsertErr) });
          })()
        );
      }
    }

    // 8. Return merged result
    return NextResponse.json(
      {
        verdict,
        confidence: analysis?.confidence ?? 0.5,
        summary: analysis?.summary ?? "Unable to analyze this ad.",
        redFlags,
        urlMalicious,
        communityFlagCount: 0,
        aiGeneratedImage,
        deepfakeDetected,
        impersonatedCelebrity,
        generatorSource,
      },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } }
    );
  } catch (err) {
    logger.error("Ad analysis error", { error: String(err) });
    return NextResponse.json(
      {
        error: "analysis_failed",
        message: "Something went wrong analyzing this ad. Please try again.",
      },
      { status: 500 }
    );
  }
}
