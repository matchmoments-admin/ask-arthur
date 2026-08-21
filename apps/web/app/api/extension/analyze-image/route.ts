import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { checkHiveAI } from "@askarthur/scam-engine/hive-ai";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { assertSafeURL } from "@askarthur/scam-engine/ssrf-guard";
import { fetchImageBytes } from "@askarthur/scam-engine/image-fetch";
import { readImageOrigin } from "@askarthur/scam-engine/image-origin";
import { generatorBreakdown } from "@askarthur/scam-engine/hive-ai";
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { EXTENSION_TIER_LIMITS } from "@askarthur/types/billing";
import {
  ExtensionImageCheckRequestSchema,
  type ExtensionImageCheckResponse,
} from "@askarthur/types";
import { validateExtensionRequest } from "../_lib/auth";
import { checkImageCheckRateLimit } from "../_lib/image-rate-limit";
import { logCost, claudeHaikuCostUsd, PRICING } from "@/lib/cost-telemetry";
import { generateCheckRef } from "@/lib/check-ref";

// Right-click "Check this image" — user-driven AI-generation/deepfake scan of
// an arbitrary image URL. Unlike analyze-ad (Facebook-CDN allowlist, ad-text
// triggered), this accepts any public http(s) image URL, so the SSRF guard is
// assertSafeURL (private-IP/metadata-host blocklist) rather than a CDN
// allowlist. Hive fetches the URL from its own infra; our servers only touch
// image bytes when the FF_IMAGE_CHECK_VISION context pass is on.

const DISCLAIMER =
  "AI-detection classifiers are probabilistic. A high score means the image shares characteristics with AI-generated content, not certainty either way.";

// Confidence-only response; `likely` mirrors Hive's 0.9 thresholds.
function signal(likely: boolean, confidence: number) {
  return { likely, confidence };
}

// Byte fetch (SSRF-safe, 5 MB cap, magic-byte validated) is the shared
// fetchImageBytes from @askarthur/scam-engine/image-fetch — same helper as
// the public /api/image-check route.

export async function POST(req: NextRequest) {
  try {
    // 0. Payload cap — the body is just two URLs.
    const contentLength = parseInt(req.headers.get("content-length") || "0");
    if (contentLength > 8_000) {
      return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    }

    // 0b. Server-side feature gate (double-gate partner of WXT_IMAGE_CHECK).
    // Even a forged valid-signature request gets a 503 until
    // NEXT_PUBLIC_FF_IMAGE_CHECK=true — keeps Hive spend at zero while dark.
    if (!featureFlags.imageCheck) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Image checking is not currently enabled." },
        { status: 503 },
      );
    }

    // 1. Auth + standard rate limit.
    const auth = await validateExtensionRequest(req);
    if (!auth.valid) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          ...(auth.retryAfter && { headers: { "Retry-After": auth.retryAfter } }),
        },
      );
    }

    // 2. Validate input.
    const body = await req.json();
    const parsed = ExtensionImageCheckRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }
    const { imageUrl, pageUrl } = parsed.data;

    // 3. Scheme + SSRF guards. data:/blob: srcUrls are rejected client-side
    // too, but a friendly 422 here covers direct callers.
    for (const [field, url] of [["imageUrl", imageUrl], ["pageUrl", pageUrl]] as const) {
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json(
          {
            error: "unsupported_image_url",
            message:
              "We can't check this image directly — try saving it and checking at askarthur.au.",
          },
          { status: 422 },
        );
      }
      try {
        assertSafeURL(url);
      } catch {
        return NextResponse.json(
          { error: "unsafe_url", message: `The ${field} points somewhere we won't fetch.` },
          { status: 422 },
        );
      }
    }

    // 4. Tiered daily image cap. Tier is resolved once in
    // validateExtensionRequest (Redis-cached, fail-open free).
    const supabase = createServiceClient();
    const tier = auth.tier;
    const cap = EXTENSION_TIER_LIMITS[tier].imageChecksPerDay;
    const imageLimit = await checkImageCheckRateLimit(auth.installId, cap);
    if (!imageLimit.allowed) {
      return NextResponse.json(
        {
          error: "image_limit_reached",
          message:
            tier === "free"
              ? `You've used your ${cap} free image checks for today. Upgrade to Ask Arthur Pro for ${EXTENSION_TIER_LIMITS.pro.imageChecksPerDay}/day.`
              : `You've reached today's ${cap} image checks.`,
          tier,
        },
        { status: 429 },
      );
    }

    // 5. Vendor cost brake (shared hive_ai brake — cost-daily-check cron).
    if (await isFeatureBraked("hive_ai")) {
      return NextResponse.json(
        { error: "feature_paused", message: "Image checking is briefly paused. Try again later." },
        { status: 503 },
      );
    }

    // 6. Hive scan (24h Redis cache inside checkHiveAI).
    const hive = await checkHiveAI(imageUrl);
    logCost({
      feature: "hive_ai",
      provider: "hive",
      operation: "sync-task",
      units: 1,
      unitCostUsd: PRICING.HIVE_AI_USD_PER_IMAGE,
      metadata: {
        surface: "image_check",
        has_result: hive !== null,
        is_ai_generated: hive?.isAiGenerated ?? false,
        is_deepfake: hive?.isDeepfake ?? false,
        ai_confidence: hive?.aiConfidence ?? null,
        deepfake_confidence: hive?.deepfakeConfidence ?? null,
        generator_source: hive?.generatorSource ?? null,
        install_id: auth.installId,
        tier,
      },
      requestId: auth.requestId,
    });

    if (!hive) {
      const unavailable: ExtensionImageCheckResponse = {
        checked: false,
        reason: "scan_unavailable",
        aiGenerated: null,
        deepfake: null,
        generatorSource: null,
        generatorBreakdown: null,
        contentCredentials: null,
        metadataOrigin: null,
        imageChecksRemaining: imageLimit.remaining,
        disclaimer: DISCLAIMER,
      };
      return NextResponse.json(unavailable, {
        headers: { "X-RateLimit-Remaining": String(auth.remaining) },
      });
    }

    // 7. Optional Claude-vision context pass (server-only sub-flag). Adds
    // "what is this image" context + celebrity matching into
    // deepfake_detections, exactly like analyze-ad's phase 6.
    // The extension_image_check brake (cost-daily-check) gates ONLY the
    // Claude call: bytes are still fetched while braked so the free
    // byte-derived signals (C2PA presence, sha256 — image-check v2 PR 3+)
    // keep working. A brake stops spend, not the free fetch.
    let context: ExtensionImageCheckResponse["context"] = null;
    let contentCredentials: ExtensionImageCheckResponse["contentCredentials"] = null;
    let metadataOrigin: ExtensionImageCheckResponse["metadataOrigin"] = null;
    let imageSha256: string | null = null;
    if (featureFlags.imageCheckVision) {
      const bytes = await fetchImageBytes(imageUrl);
      // The AI-origin ladder (C2PA sniff → flag-gated validation →
      // claimed-origin metadata) — free, deterministic, runs even while
      // the vision brake is engaged. null (bytes unavailable) means
      // "unknown", never fabricated (asymmetry rule).
      if (bytes) {
        ({ contentCredentials, metadataOrigin } = await readImageOrigin(
          bytes.buffer,
          { validateC2pa: featureFlags.imageCheckC2paValidate },
        ));
      }
      imageSha256 = bytes?.sha256 ?? null;
      const visionBraked = await isFeatureBraked("extension_image_check");
      if (bytes && !visionBraked) {
        try {
          const analysis = await analyzeWithClaude(undefined, [bytes.base64]);
          if (analysis.usage) {
            logCost({
              feature: "extension_image_check",
              provider: "anthropic",
              operation: "claude-haiku-4-5-20251001",
              units: analysis.usage.inputTokens + analysis.usage.outputTokens,
              estimatedCostUsd: claudeHaikuCostUsd(
                analysis.usage.inputTokens,
                analysis.usage.outputTokens,
              ),
              metadata: { surface: "image_check_vision", install_id: auth.installId },
              requestId: auth.requestId,
            });
          }

          let impersonatedCelebrity: string | null = null;
          if (hive.isDeepfake && analysis.impersonatedBrand && supabase) {
            const { data: celebrity } = await supabase
              .from("monitored_celebrities")
              .select("id, name")
              .or(
                `name.ilike.%${analysis.impersonatedBrand}%,aliases.cs.{${analysis.impersonatedBrand}}`,
              )
              .limit(1)
              .single();
            if (celebrity) {
              impersonatedCelebrity = celebrity.name;
              waitUntil(
                (async () => {
                  const { error: insertErr } = await supabase
                    .from("deepfake_detections")
                    .insert({
                      celebrity_id: celebrity.id,
                      celebrity_name: celebrity.name,
                      image_url: imageUrl,
                      hive_result: hive,
                      ai_confidence: hive.aiConfidence,
                      deepfake_confidence: hive.deepfakeConfidence,
                      generator_source: hive.generatorSource,
                      landing_url: pageUrl ?? null,
                    });
                  if (insertErr) {
                    logger.error("Failed to store image-check deepfake detection", {
                      error: String(insertErr),
                    });
                  }
                })(),
              );
            }
          }

          context = {
            summary: analysis.summary,
            impersonatedBrand: analysis.impersonatedBrand ?? null,
            impersonatedCelebrity,
          };
        } catch (err) {
          logger.warn("image-check vision pass failed", { error: String(err) });
        }
      }
    }

    // 8. Evidence record (ADR-0022: metadata only, FLAGGED checks only,
    // never bytes, install id only as its hash). Fire-and-forget — a
    // persistence failure must never fail the user's check; they just
    // don't get a ref. Clean checks stay fully ephemeral.
    let checkRef: string | null = null;
    if (
      featureFlags.imageCheckRecords &&
      (hive.isAiGenerated || hive.isDeepfake) &&
      supabase
    ) {
      checkRef = generateCheckRef();
      const record = {
        check_ref: checkRef,
        install_id_hash: auth.installIdHash,
        image_url: imageUrl,
        page_url: pageUrl ?? null,
        image_sha256: imageSha256,
        ai_confidence: hive.aiConfidence,
        deepfake_confidence: hive.deepfakeConfidence,
        generator_source: hive.generatorSource,
        generator_breakdown: generatorBreakdown(hive.classes),
        content_credentials: contentCredentials,
        origin_metadata: metadataOrigin,
        vision_summary: context?.summary ?? null,
        impersonated_brand: context?.impersonatedBrand ?? null,
        impersonated_celebrity: context?.impersonatedCelebrity ?? null,
        hive_result: hive,
      };
      waitUntil(
        (async () => {
          const { error: recordErr } = await supabase
            .from("image_check_records")
            .insert(record);
          if (recordErr) {
            logger.error("Failed to store image check record", {
              error: recordErr.message,
              check_ref: checkRef,
            });
          }
        })(),
      );
    }

    const response: ExtensionImageCheckResponse = {
      checked: true,
      aiGenerated: signal(hive.isAiGenerated, hive.aiConfidence),
      deepfake: signal(hive.isDeepfake, hive.deepfakeConfidence),
      generatorSource: hive.generatorSource,
      generatorBreakdown: generatorBreakdown(hive.classes),
      contentCredentials,
      metadataOrigin,
      context,
      checkRef,
      imageChecksRemaining: imageLimit.remaining,
      disclaimer: DISCLAIMER,
    };
    return NextResponse.json(response, {
      headers: { "X-RateLimit-Remaining": String(auth.remaining) },
    });
  } catch (err) {
    logger.error("Image check error", { error: String(err) });
    return NextResponse.json(
      { error: "image_check_failed", message: "Something went wrong checking this image." },
      { status: 500 },
    );
  }
}
