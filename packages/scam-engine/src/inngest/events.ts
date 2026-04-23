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
