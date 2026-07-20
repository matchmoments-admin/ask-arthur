import { runAnalysisCore } from "@askarthur/scam-engine/analyze-core";
import { logCost, isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { MODELS } from "@askarthur/scam-engine/anthropic";
import { storeScamReport, buildEntities } from "@askarthur/scam-engine/report-store";
import { hashIdentifier } from "@askarthur/utils/hash";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import type { AnalysisResult, ReportSource, InputMode } from "@askarthur/types";

/**
 * Where a bot check came from — used to attribute the `scam_reports` row so
 * we can classify and report scam types per platform (Messenger vs WhatsApp
 * vs Telegram vs Slack). Optional on analyzeForBot: callers that omit it
 * skip the report write (back-compatible with the pre-attribution callers).
 */
export interface BotReportContext {
  /** bot_messenger | bot_whatsapp | bot_telegram | bot_slack */
  source: ReportSource;
  /** Raw platform user id — hashed internally, never stored raw. */
  userId: string;
  /** "text" | "image" */
  inputMode: InputMode;
}

/**
 * Thrown by analyzeForBot when the `bot_analyze` cost brake is engaged
 * (cost-daily-check tripped the daily cap). Today every bot handler's
 * existing catch sends the generic "try again in a moment" reply, and the
 * queue path swallows it without retrying. The dedicated type is the seam
 * for a future tailored "high demand — use the web checker at askarthur.au"
 * message (planned to land with the Messenger Phase A handler).
 */
export class BotAnalysisPausedError extends Error {
  constructor() {
    super("bot_analyze cost brake engaged");
    this.name = "BotAnalysisPausedError";
  }
}

/**
 * Run the full scam analysis pipeline for a bot message.
 *
 * Thin wrapper around runAnalysisCore with the bot-specific defaults:
 *   - surface: "bot" — namespaces the analyze-cache (so the same text
 *     pasted in the web app and via Telegram don't collide)
 *   - backgroundMode: "fire-and-forget" — bots run outside Vercel's
 *     waitUntil envelope, so we kick off storeVerifiedScam +
 *     incrementStats inline with .catch() guards
 *   - skipCacheRead/Write are NOT set: bots benefit from the same
 *     cache hit rate as web — duplicate scam pastes are common in chat
 *
 * Behavioural change vs. the pre-Phase-5 implementation: the
 * confidence-bumping (Math.max(0.9) on URL escalation, Math.max(0.6)
 * on injection floor) is gone — runAnalysisCore preserves the AI's
 * raw confidence after merging signals. Other surfaces never had the
 * bump; bots are now consistent. Red-flag phrasing also moves to the
 * canonical "URL flagged by X and Y: <url>" / "manipulation patterns"
 * strings shared across all surfaces.
 */
/**
 * Result of {@link analyzeForBotDetailed}: the analysis plus the id of the
 * `scam_reports` row it persisted (null when no report context was passed or
 * the intelligence-core flag is off). Handlers stash `scamReportId` so a later
 * "Report scam" tap can drive the real onward-reporting pipeline against it.
 */
export interface BotAnalysis {
  result: AnalysisResult;
  scamReportId: number | null;
}

/**
 * Back-compatible wrapper: run the bot analysis and return only the
 * `AnalysisResult`. Existing callers that don't need the persisted report id
 * (inbound-scan, slack shortcuts, the queue processor) keep this signature.
 */
export async function analyzeForBot(
  text: string,
  region?: string,
  images?: string[],
  report?: BotReportContext,
): Promise<AnalysisResult> {
  return (await analyzeForBotDetailed(text, region, images, report)).result;
}

export async function analyzeForBotDetailed(
  text: string,
  region?: string,
  images?: string[],
  report?: BotReportContext,
): Promise<BotAnalysis> {
  // Circuit-breaker: if today's bot AI spend tripped its cap, stop here.
  // Throwing lets handlers send a graceful fallback instead of silently
  // burning more budget. Best-effort check — a DB error fails open.
  if (await isFeatureBraked("bot_analyze")) {
    throw new BotAnalysisPausedError();
  }

  const out = await runAnalysisCore({
    text,
    surface: "bot",
    region: region ?? null,
    images,
    ragThemesEnabled: featureFlags.ragThemes,
    // The bot's primary use case is Facebook Marketplace checks, so when the
    // flag is on every bot analysis gets the Marketplace-context block. It's
    // additive/harmless for non-marketplace content, and the profile-screenshot
    // reasoning only activates when an image is present.
    marketplace: featureFlags.botMarketplaceMode,
    backgroundMode: "fire-and-forget",
  });

  // Cost telemetry. Mirror the extension route's pattern: log ONLY on a
  // real billable call (cache MISS with usage present) so cached replies
  // don't inflate spend. Without this, bot AI spend is invisible to
  // /admin/costs and the weekly Telegram digest. Bots run Haiku 4.5.
  if (!out.cached && out.result.usage) {
    const u = out.result.usage;
    const spec = MODELS.HAIKU_4_5;
    const cacheReadTokens = u.cacheReadInputTokens ?? 0;
    const estimatedCostUsd =
      u.inputTokens * spec.inputUsdPerToken +
      u.outputTokens * spec.outputUsdPerToken +
      cacheReadTokens * spec.cacheReadUsdPerToken;
    void logCost({
      feature: "bot_analyze",
      provider: "anthropic",
      operation: spec.id,
      units: u.inputTokens + u.outputTokens,
      estimatedCostUsd,
      metadata: {
        mode: images?.length ? "image" : "text",
        verdict: out.result.verdict,
        cacheReadTokens,
      },
    });
  }

  // Attribution: record the submission in scam_reports so we can classify
  // and report scam types per platform alongside web/extension rows. Gated
  // on intelligenceCore to match the web path (which only writes scam_reports
  // when that flag is on — keeps bots and web consistent). Runs on cache hits
  // too: every forward is a real submission worth counting in the funnel.
  //
  // AWAITED (was fire-and-forget): we need the persisted row id so a later
  // "Report scam" tap can drive the onward-reporting pipeline against a real
  // scam_report_id. Awaiting is also more correct — bots run outside Vercel's
  // waitUntil envelope, so a `void`-ed insert could be killed when the handler
  // returns. storeScamReport scrubs PII and never throws (returns null on
  // error); the hashIdentifier await is still guarded so an attribution
  // failure can't break the user's reply.
  let scamReportId: number | null = null;
  if (report && featureFlags.intelligenceCore) {
    try {
      const reporterHash = await hashIdentifier(report.userId, `bot:${report.source}`);
      scamReportId = await storeScamReport({
        reporterHash,
        source: report.source,
        inputMode: report.inputMode,
        analysis: out.result,
        text, // scrubbed inside storeScamReport
        region: region ?? null,
        countryCode: null,
        // Link scammer phone/email entities so bot-sourced scams join the
        // cross-channel correlation graph (a scam number seen via WhatsApp +
        // web links up). These ride on out.result already. URL entities stay
        // deferred: runAnalysisCore doesn't surface the URL-reputation results
        // to the bot path, only redirects on the result.
        entities: buildEntities({
          phones: out.result.scammerContacts?.phoneNumbers,
          emails: out.result.scammerContacts?.emailAddresses,
          extractionMethod: images?.length ? "claude" : "regex",
        }),
      });
    } catch (err) {
      logger.error("bot attribution storeScamReport failed", {
        error: String(err),
        source: report.source,
      });
    }
  }

  return { result: out.result, scamReportId };
}
