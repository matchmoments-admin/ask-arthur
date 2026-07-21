// runAnalysisCore — single entry point for the orchestration that every
// analyze surface previously open-coded:
//
//   detectInjection(text)
//     ├── analyzeWithClaude(text, images, mode, redirectChains?)   ─┐
//     └── extractURLs(text) → checkURLReputation(urls)               ├─ parallel
//   → mergeVerdict({ ai, urlResults, redirectChains, injection })    ┘
//   → background fan-out: storeVerifiedScam (HIGH_RISK only),
//                          incrementStats, setCachedAnalysis
//
// Before this file, that pipeline lived in 4 routes (web /api/analyze,
// extension /api/extension/analyze + analyze-ad, bot-core analyzeForBot)
// with subtly different inlining of the URL-escalation + injection-floor
// rules. The canonical mergeVerdict in @askarthur/core-analysis was
// already in place; this is the orchestrator that wires it up.
//
// Surface-specific concerns stay OUTSIDE this function:
//   - auth (extension install_id, web IP, bot platform-tokens)
//   - rate limiting
//   - schema validation (input shapes diverge)
//   - HTTP response shaping (headers, statuses, idempotency keys)
//   - cost telemetry (tagged with the route's "feature" name)
//
// Background tasks are returned to the caller rather than fired here,
// so a Vercel-function caller can pass them to waitUntil() while a
// non-Vercel caller (bot worker) can resolve them inline. The
// `backgroundMode` knob picks the strategy.

import {
  analyzeWithClaude,
  detectInjectionAttempt,
  MARKETPLACE_PROMPT_BLOCK,
  type Verdict,
} from "./claude";
import { extractURLs, checkURLReputation } from "./safebrowsing";
import { resolveRedirects, extractFinalUrls } from "./redirect-resolver";
import { storeVerifiedScam, incrementStats } from "./pipeline";
import {
  getCachedAnalysis,
  setCachedAnalysis,
  type AnalyzeCacheSurface,
} from "./analysis-cache";
import { mergeVerdict } from "@askarthur/core-analysis";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import type {
  AnalysisResult,
  RedirectChain,
  ReferrerSource,
} from "@askarthur/types";
import { applyShopSignal } from "./shop-signal";
import { applyAsicCitation } from "./asic-lookup";
import { getRelevantThemes, renderThemesForPrompt } from "./retrieval/themes";

export type AnalyzeSurface = AnalyzeCacheSurface;

export interface AnalyzeCoreInput {
  text: string;
  surface: AnalyzeSurface;
  /** Region tag passed to storeVerifiedScam + incrementStats. */
  region?: string | null;
  /** Base64 image strings for vision-mode AI analysis. */
  images?: string[];
  /** When true, run resolveRedirects → extractFinalUrls before URL reputation. */
  resolveRedirectsEnabled?: boolean;
  /**
   * Skip the cache lookup at the top of the pipeline. Use when the caller
   * has already done its own bespoke cache (e.g. /api/analyze with
   * idempotency-key tracking).
   */
  skipCacheRead?: boolean;
  /** Skip the cache write fan-out task. */
  skipCacheWrite?: boolean;
  /**
   * How background tasks are surfaced:
   *   "waitUntil"        — return the Promise[] for the caller to pass to
   *                        Vercel's waitUntil() (default — Vercel routes).
   *   "fire-and-forget"  — start them inline with .catch(), return [].
   *                        For non-Vercel callers (bot worker, tests).
   *   "skip"             — don't enqueue any background tasks. Pure
   *                        functional path, useful for replay tests.
   */
  backgroundMode?: "waitUntil" | "fire-and-forget" | "skip";
  /** Correlation ID for log traces. */
  requestId?: string;
  /**
   * In-app-browser the user arrived from when the request came through the
   * Web Share Target redirect. Wired in Stage 0.5 of Shop Guard so the
   * Stage-0 measurement window can count mobile-share share of
   * commerce-flagged volume; surfaces as `shopSignal.referrerSource` on
   * the response when shop-signal also fires.
   */
  referrerSource?: ReferrerSource;
  /**
   * When true, inject the top Reddit-intel themes (community-reported AU scam
   * patterns) into the Claude prompt — the same RAG augmentation the web
   * /api/analyze route already applies. Extends it to bot + extension surfaces
   * (both route through here). Caller passes featureFlags.ragThemes. Adds one
   * cached Voyage embed (~$0.000003) per text submission; decorative — a
   * failure degrades to no themes, never an analyze error.
   */
  ragThemesEnabled?: boolean;
  /**
   * When true, append the Marketplace-context block (MARKETPLACE_PROMPT_BLOCK)
   * as a second system block. Set by the bot surface under
   * FF_BOT_MARKETPLACE_MODE. Additive + harmless for non-marketplace content;
   * the profile-screenshot instructions only fire when an image is present.
   * Not part of the cache key — a Stage-1 hit serves the base verdict.
   */
  marketplace?: boolean;
}

export interface AnalyzeCoreOutput {
  result: AnalysisResult;
  /** True when the result came from the analysis-cache (Stage 1 hit). */
  cached: boolean;
  /** Telemetry breadcrumbs from mergeVerdict — useful for "why did the verdict change". */
  signals: {
    aiVerdict: Verdict;
    maliciousUrlCount: number;
    injectionDetected: boolean;
    deepfakeDetected: boolean;
  };
  /**
   * Background fire-and-forget work the caller should pass to
   * waitUntil() (or otherwise let resolve). Empty when backgroundMode is
   * "fire-and-forget" or "skip" — the factory has already kicked them
   * off (or skipped them).
   */
  backgroundTasks: Promise<unknown>[];
}

const NO_LINKS_NEXT_STEP = "Do not click any links in this message.";

/**
 * Run the canonical analyze pipeline. See file header for the data-flow
 * diagram. Returns a merged AnalysisResult plus signal telemetry.
 *
 * Throws only if `analyzeWithClaude` itself throws — every other step
 * either is best-effort (URL reputation) or has its own exception
 * boundary (background tasks). The caller's HTTP handler decides how
 * to map a thrown error into a response.
 */
export async function runAnalysisCore(
  input: AnalyzeCoreInput,
): Promise<AnalyzeCoreOutput> {
  const {
    text,
    surface,
    region = null,
    images,
    resolveRedirectsEnabled = false,
    skipCacheRead = false,
    skipCacheWrite = false,
    backgroundMode = "waitUntil",
    requestId,
    referrerSource,
    ragThemesEnabled = false,
    marketplace = false,
  } = input;

  // Vision vs text mode — derived from image presence. Hoisted above the cache
  // read so it can scope the cache key (see below): the same image bytes must
  // not be replayed under a key that omits them or the mode.
  const aiMode: "image" | "text" = images?.length ? "image" : "text";

  // 1. Cache read (unless caller opted out).
  // BUGFIX: previously this passed only { text, surface }, so image submissions
  // were cached under a text-only key — two different images with empty text
  // collided and replayed each other's verdict (and bot/extension image scans
  // shared keys). Pass `images` + `mode` so the key is content-addressable.
  if (!skipCacheRead) {
    const cached = await getCachedAnalysis({
      text,
      surface,
      images,
      mode: aiMode,
      // asicLookup mutates redFlags post-analysis; key on it so flipping the
      // flag off re-keys the cache instead of serving stale ASIC citations.
      outputAffectingFlags: { asicLookup: featureFlags.asicLookup },
    });
    if (cached) {
      const cachedTasks: Promise<unknown>[] =
        backgroundMode === "skip"
          ? []
          : [
              incrementStats(cached.verdict, region).catch((err) =>
                logger.error("incrementStats failed (cache hit path)", {
                  error: String(err),
                  surface,
                  requestId,
                }),
              ),
            ];
      return {
        result: cached,
        cached: true,
        signals: {
          aiVerdict: cached.verdict,
          maliciousUrlCount: 0,
          injectionDetected: false,
          deepfakeDetected: false,
        },
        backgroundTasks: dispatchBackground(cachedTasks, backgroundMode),
      };
    }
  }

  // 2. Injection pre-filter.
  const injection = detectInjectionAttempt(text);

  // 3. URL extraction + optional redirect resolution.
  const urls = extractURLs(text);
  let redirectChains: RedirectChain[] = [];
  let urlsToCheck = urls;
  if (resolveRedirectsEnabled && urls.length > 0) {
    redirectChains = await resolveRedirects(urls);
    const finalUrls = extractFinalUrls(redirectChains);
    urlsToCheck = Array.from(new Set([...urls, ...finalUrls]));
  }

  // 3b. RAG: inject recent community-reported AU scam themes into the prompt
  // (same augmentation the web /api/analyze route applies — extended here so
  // bot + extension surfaces benefit too). Never-throws → "" on any failure;
  // not part of the cache key, so a Stage-1 cache hit serves a themeless
  // verdict (consistent with the web bespoke path + the image-cache).
  const themesPromptBlock =
    ragThemesEnabled && text
      ? await getRelevantThemes(text, { requestId }).then(renderThemesForPrompt)
      : "";

  // 4. Parallel: AI analysis + URL reputation. (aiMode derived above.)
  const [aiResult, urlResults] = await Promise.all([
    analyzeWithClaude(
      text,
      images,
      aiMode,
      redirectChains.length > 0 ? redirectChains : undefined,
      themesPromptBlock || undefined,
      marketplace ? MARKETPLACE_PROMPT_BLOCK : undefined,
    ),
    urlsToCheck.length > 0
      ? checkURLReputation(urlsToCheck)
      : Promise.resolve([]),
  ]);

  // 5. Canonical signal merge.
  const merged = mergeVerdict({
    ai: {
      verdict: aiResult.verdict,
      confidence: aiResult.confidence,
      summary: aiResult.summary,
      redFlags: aiResult.redFlags,
      nextSteps: aiResult.nextSteps,
    },
    urlResults,
    redirectChains,
    injection,
  });

  // mergeVerdict returns the merged consumer-facing fields; preserve any
  // non-merged fields the AI provided (scam type, country code, etc.) by
  // overlaying.
  const result: AnalysisResult = {
    ...aiResult,
    verdict: merged.verdict,
    confidence: merged.confidence,
    summary: merged.summary,
    redFlags: merged.redFlags,
    nextSteps: merged.nextSteps,
  };

  // Shop Signal — Stage 0 of Shop Guard. Shared with the web route via the
  // single applyShopSignal() helper (ADR-0007 anti-drift). Bots + extension
  // reach shop-signal through this Module; the web route calls the same helper
  // directly until the Phase 5 buildAnalyze(variant, deps) factory consolidates
  // the surrounding plumbing. Pass the post-redirect URL list (urlsToCheck).
  // Plan: docs/plans/shop-guard-v2.md §3.
  applyShopSignal(result, text, urlsToCheck, referrerSource);

  // ASIC Investor Alert citation (PR-A2) — flag-gated (FF_ASIC_LOOKUP), default
  // OFF. If the submission mentions a domain on ASIC's regulator Investor Alert
  // List, append a red flag. Shared with the web route via applyAsicCitation
  // (single source of truth); this call covers the extension + bot surfaces.
  // Never throws; one DB read only when the flag is on and there is content.
  await applyAsicCitation(
    result,
    [text, ...urlsToCheck].filter(Boolean).join(" "),
    { requestId },
  );

  // 6. Background fan-out.
  const tasks: Promise<unknown>[] = [];
  if (backgroundMode !== "skip") {
    if (result.verdict === "HIGH_RISK") {
      tasks.push(
        storeVerifiedScam(result, region).catch((err) =>
          logger.error("storeVerifiedScam failed", {
            error: String(err),
            surface,
            requestId,
          }),
        ),
      );
    }
    tasks.push(
      incrementStats(result.verdict, region).catch((err) =>
        logger.error("incrementStats failed", {
          error: String(err),
          surface,
          requestId,
        }),
      ),
    );
    if (!skipCacheWrite) {
      // Match the read key — include images + mode (see cache-read bugfix note).
      tasks.push(
        setCachedAnalysis(
          {
            text,
            surface,
            images,
            mode: aiMode,
            outputAffectingFlags: { asicLookup: featureFlags.asicLookup },
          },
          result,
        ),
      );
    }
  }

  return {
    result,
    cached: false,
    signals: merged.signals,
    backgroundTasks: dispatchBackground(tasks, backgroundMode),
  };
}

function dispatchBackground(
  tasks: Promise<unknown>[],
  mode: "waitUntil" | "fire-and-forget" | "skip",
): Promise<unknown>[] {
  if (mode === "fire-and-forget") {
    for (const t of tasks) {
      void t.catch(() => {});
    }
    return [];
  }
  // "waitUntil" callers receive the array verbatim. "skip" callers can't
  // reach this branch — tasks is [] in that case.
  return tasks;
}

// Re-export NO_LINKS_NEXT_STEP for tests / callers that need to assert
// the canonical phrasing without depending on @askarthur/core-analysis
// directly.
export { NO_LINKS_NEXT_STEP };
