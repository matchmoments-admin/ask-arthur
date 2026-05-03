import { z } from "zod";
import {
  VerdictSchema,
  AnalysisModeSchema,
  ScammerContactsSchema,
  UsageSchema,
} from "@askarthur/types";

// ── analyze.completed.v1 ─────────────────────────────────────────────────
//
// Emitted by the analyze route (web, extension, bot, mobile) once the
// verdict is merged and the response has been shaped. Triggers durable
// fan-out consumers: report persistence, cost telemetry, brand alerts,
// phone enrichment, failure subscribers.
//
// The event carries METADATA only — never raw images. Images are handled
// separately in Phase 2b (R2-staged). Text IS included but pre-scrubbed
// for PII; treat the event as untrusted-by-default downstream anyway.
//
// Idempotency layers on this event:
//   1. `id: requestId` — Inngest dedups events with the same id in a 24h
//      window; same requestId → single event ingestion.
//   2. Consumer functions set `idempotency: "event.data.requestId"` so
//      even if the event arrives multiple times, each consumer runs once.
//   3. DB writes (scam_reports) use the same requestId as
//      `idempotency_key`, backed by a partial unique index (v73). This is
//      the last line of defence.

export const AnalyzeSourceSchema = z.enum([
  "web",
  "extension",
  "bot_telegram",
  "bot_whatsapp",
  "bot_slack",
  "bot_messenger",
  "mobile",
  "api",
]);
export type AnalyzeSource = z.infer<typeof AnalyzeSourceSchema>;

export const UrlResultSchema = z.object({
  url: z.string(),
  isMalicious: z.boolean(),
  sources: z.array(z.string()),
});
export type UrlResult = z.infer<typeof UrlResultSchema>;

export const AnalyzeCompletedDataSchema = z.object({
  // Correlation
  requestId: z.string().min(8).max(255),
  source: AnalyzeSourceSchema,

  // Verdict (post-merge, scrubbed)
  verdict: VerdictSchema,
  confidence: z.number(),
  summary: z.string(),
  redFlags: z.array(z.string()),
  nextSteps: z.array(z.string()),
  scamType: z.string().optional(),
  channel: z.string().optional(),
  impersonatedBrand: z.string().optional(),

  // Context
  reporterHash: z.string(),
  inputMode: AnalysisModeSchema.nullable().optional(),
  region: z.string().nullable(),
  countryCode: z.string().nullable(),

  // Payload summary — `text` is pre-scrubbed; images are handled by the
  // Phase 2b verify consumer via R2 staging, only their count lives here.
  text: z.string().optional(),
  imageCount: z.number().int().nonnegative(),

  // Extracted signals for entity linkage (scammer-side only — victim PII
  // never enters this payload).
  scammerContacts: ScammerContactsSchema.optional(),
  urlResults: z.array(UrlResultSchema).optional(),

  // Enrichment triggers
  phoneToLookup: z.string().optional(),

  // Cost telemetry
  usage: UsageSchema.optional(),
  cacheHit: z.boolean(),

  // Flags that gate consumer behaviour — captured at emission time so
  // consumers don't race a flag flip mid-flight.
  consumerFlags: z.object({
    intelligenceCore: z.boolean(),
    scamContactReporting: z.boolean(),
    scamUrlReporting: z.boolean(),
    phoneIntelligence: z.boolean(),
  }),
});
export type AnalyzeCompletedData = z.infer<typeof AnalyzeCompletedDataSchema>;

export const ANALYZE_COMPLETED_EVENT = "analyze.completed.v1" as const;

export interface AnalyzeCompletedEvent {
  name: typeof ANALYZE_COMPLETED_EVENT;
  id: string;
  data: AnalyzeCompletedData;
}

/**
 * Validate an event's data payload. Consumers call this at the top of
 * `step.run` so a malformed event fails fast with a clear message rather
 * than throwing deep inside storage code.
 */
export function parseAnalyzeCompletedData(raw: unknown): AnalyzeCompletedData {
  return AnalyzeCompletedDataSchema.parse(raw);
}

// ── scam-report.stored.v1 ────────────────────────────────────────────────
//
// Emitted by analyze-report.ts after storeScamReport succeeds. Carries the
// reportId so the embed consumer can look up the row's scrubbed_content
// and structured fields without forwarding the full text via Inngest.
// Splitting embed into a separate function (rather than chaining inside
// analyze-report.ts) lets the embed call fail and retry independently of
// the row-write step — same pattern as the Reddit Intel pipeline.

export const ScamReportStoredDataSchema = z.object({
  reportId: z.number().int().positive(),
  verdict: VerdictSchema,
  scamType: z.string().nullable(),
  // The composite content length, used by the embed consumer to skip
  // trivially-short reports (<= 40 chars) that have no useful retrieval
  // signal. Avoids a Supabase round-trip just to check length.
  contentLength: z.number().int().min(0),
});
export type ScamReportStoredData = z.infer<typeof ScamReportStoredDataSchema>;

export const SCAM_REPORT_STORED_EVENT = "scam-report.stored.v1" as const;

export interface ScamReportStoredEvent {
  name: typeof SCAM_REPORT_STORED_EVENT;
  id: string;
  data: ScamReportStoredData;
}

export function parseScamReportStoredData(raw: unknown): ScamReportStoredData {
  return ScamReportStoredDataSchema.parse(raw);
}

// ── scam-reports.backfill-embed.v1 ───────────────────────────────────────
//
// Manual-trigger event for the historical scam_reports + verified_scams
// embedding backfill. Each invocation of the backfill function embeds up
// to 5000 rows — operator fires the event repeatedly until the unembedded
// counts hit zero. See packages/scam-engine/src/inngest/scam-reports-
// backfill-embed.ts for the consumer.

export const SCAM_REPORTS_BACKFILL_EMBED_EVENT =
  "scam-reports.backfill-embed.v1" as const;

// ── reddit.intel.batch_ready.v1 ──────────────────────────────────────────
//
// Emitted by the Reddit-intel trigger cron (apps/web/app/api/cron/reddit-
// intel-trigger/route.ts) every 6h when feed_items contains Reddit rows
// without a corresponding reddit_post_intel row. The cron does the polling
// because the Python scraper (pipeline/scrapers/reddit_scams.py) writes
// directly to feed_items via psycopg and has no Inngest client.
//
// Payload carries feed_item IDs only — the consumer joins back to feed_items
// to read the (already PII-scrubbed) title/description before classifying.
// Keeps the event small and stops stale text from being processed if the
// row is updated between trigger and consume.

export const RedditIntelBatchReadyDataSchema = z.object({
  // feed_items.id is bigint; pass as JS numbers. Schema-level guardrail at 60
  // sits just above the cron's BATCH_SIZE=40 — refuses oversized batches
  // even if the cron is mis-tuned, but allows the backfill script's manual
  // dispatches small headroom. The original max(200) caused a prod timeout;
  // see apps/web/app/api/cron/reddit-intel-trigger/route.ts for details.
  feedItemIds: z.array(z.number().int().positive()).min(1).max(60),
  triggeredAt: z.string().datetime(),
});
export type RedditIntelBatchReadyData = z.infer<
  typeof RedditIntelBatchReadyDataSchema
>;

export const REDDIT_INTEL_BATCH_READY_EVENT =
  "reddit.intel.batch_ready.v1" as const;

export interface RedditIntelBatchReadyEvent {
  name: typeof REDDIT_INTEL_BATCH_READY_EVENT;
  id: string;
  data: RedditIntelBatchReadyData;
}

export function parseRedditIntelBatchReadyData(
  raw: unknown,
): RedditIntelBatchReadyData {
  return RedditIntelBatchReadyDataSchema.parse(raw);
}

// ── reddit.intel.summarised.v1 ───────────────────────────────────────────
//
// Emitted by the daily classifier function after a successful upsert into
// reddit_intel_daily_summary. Downstream consumers: theme clustering (Wave
// 2), weekly-email pre-computation, dashboard cache invalidation.

export const RedditIntelSummarisedDataSchema = z.object({
  cohortDate: z.string().date(),
  postsClassified: z.number().int().nonnegative(),
  newQuotesCount: z.number().int().nonnegative(),
  modelVersion: z.string(),
});
export type RedditIntelSummarisedData = z.infer<
  typeof RedditIntelSummarisedDataSchema
>;

export const REDDIT_INTEL_SUMMARISED_EVENT =
  "reddit.intel.summarised.v1" as const;

export interface RedditIntelSummarisedEvent {
  name: typeof REDDIT_INTEL_SUMMARISED_EVENT;
  id: string;
  data: RedditIntelSummarisedData;
}

export function parseRedditIntelSummarisedData(
  raw: unknown,
): RedditIntelSummarisedData {
  return RedditIntelSummarisedDataSchema.parse(raw);
}

// ── reddit.intel.embedded.v1 ─────────────────────────────────────────────
//
// Emitted by the embed function after writing Voyage 3 (or OpenAI fallback)
// vectors back to reddit_post_intel.embedding for a cohort of newly
// classified posts. The cluster function listens to this and runs greedy
// theme assignment.

export const RedditIntelEmbeddedDataSchema = z.object({
  cohortDate: z.string().date(),
  postsEmbedded: z.number().int().nonnegative(),
  embeddingProvider: z.enum(["voyage", "openai"]),
  modelId: z.string(),
});
export type RedditIntelEmbeddedData = z.infer<
  typeof RedditIntelEmbeddedDataSchema
>;

export const REDDIT_INTEL_EMBEDDED_EVENT =
  "reddit.intel.embedded.v1" as const;

export interface RedditIntelEmbeddedEvent {
  name: typeof REDDIT_INTEL_EMBEDDED_EVENT;
  id: string;
  data: RedditIntelEmbeddedData;
}

export function parseRedditIntelEmbeddedData(
  raw: unknown,
): RedditIntelEmbeddedData {
  return RedditIntelEmbeddedDataSchema.parse(raw);
}

// ── reddit.intel.themes_recomputed.v1 ────────────────────────────────────
//
// Emitted by the weekly clustering function after refreshing
// reddit_intel_themes member counts and WoW deltas. Consumers: weekly-email
// digest builder, B2B API cache invalidation.

export const RedditIntelThemesRecomputedDataSchema = z.object({
  weekStart: z.string().date(),
  activeThemeCount: z.number().int().nonnegative(),
  newThemeCount: z.number().int().nonnegative(),
  computedAt: z.string().datetime(),
});
export type RedditIntelThemesRecomputedData = z.infer<
  typeof RedditIntelThemesRecomputedDataSchema
>;

export const REDDIT_INTEL_THEMES_RECOMPUTED_EVENT =
  "reddit.intel.themes_recomputed.v1" as const;

export interface RedditIntelThemesRecomputedEvent {
  name: typeof REDDIT_INTEL_THEMES_RECOMPUTED_EVENT;
  id: string;
  data: RedditIntelThemesRecomputedData;
}

export function parseRedditIntelThemesRecomputedData(
  raw: unknown,
): RedditIntelThemesRecomputedData {
  return RedditIntelThemesRecomputedDataSchema.parse(raw);
}
