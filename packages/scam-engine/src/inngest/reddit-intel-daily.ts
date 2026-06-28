// Reddit Intelligence — daily batched classifier + summariser.
//
// Triggered by `reddit.intel.batch_ready.v1`. One Sonnet 4.6 call per fired
// event handles:
//   * per-post classification (intent label, modus operandi, brands, tactics,
//     novelty signals, country hints, narrative summary, confidence)
//   * extracted PII-scrubbed quotes (≤3 per post, ≤140 chars each)
//   * daily aggregate (lead narrative 200-300 words, emerging threats,
//     brand watchlist, top-categories stats)
//
// Why one call instead of per-post fan-out: at ~38 posts/day, per-post
// Inngest invocations would burn cache 38 times for the same system prompt
// and produce no cohort-level summary. A single batched call costs ~$0.20/day
// vs ~$0.30/day fanned out, AND yields the daily digest for free as part of
// the same structured response.
//
// Idempotency: feed_item_id is UNIQUE on reddit_post_intel and the upsert
// uses ON CONFLICT DO NOTHING. Re-firing the same event is a no-op for any
// post already classified. The daily_summary upsert keys on
// (cohort_date, audience, country_code) and DOES overwrite — re-running on
// the same day refreshes the summary with the latest classifications.

import { z } from "zod";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

import { inngest } from "./client";
import {
  REDDIT_INTEL_BATCH_READY_EVENT,
  REDDIT_INTEL_SUMMARISED_EVENT,
  parseRedditIntelBatchReadyData,
} from "./events";
import { callClaudeJson, type ClaudeModelKey } from "../anthropic";
import { readStringEnv } from "@askarthur/utils/env";
import { logFunctionError, isRedditIntelBraked } from "./reddit-intel-error-log";
import { withAxiomLogging } from "./with-axiom-logging";

// ── Versioning ────────────────────────────────────────────────────────────
// Bump PROMPT_VERSION whenever the system prompt or output schema changes.
// reddit_post_intel.prompt_version stores this so we can ignore stale rows
// when the prompt has materially evolved.

// v2 (2026-06-28): output-cost trim — the classify call is output-bound
// (~85% of spend; avg ~11.5k output tokens, ~half hitting the 12k cap). Capped
// quotes at 1/post (was 3) and shortened leadNarrative (~120 words, was 200-300)
// to cut output ~25-30% AND free output budget so 40-post batches stop hitting
// the cap (which silently truncated the tail of perPost). Sonnet 4.6 retained —
// the cost is post-volume × verbosity, not model tier, and Haiku's higher
// malformed-output rate isn't worth it here. System-prompt caching was already
// on and is irrelevant (input is ~11% of cost).
const PROMPT_VERSION = "reddit-intel-v2@2026-06-28";

/**
 * Resolve the Claude model for the daily classify call. Defaults to Sonnet 4.6
 * (the historical model), overridable to Haiku 4.5 via the
 * `REDDIT_INTEL_CLASSIFY_MODEL` env var for the cost pilot. Unknown/unset values
 * fall back to Sonnet so a typo can never break the cron. Read at call time
 * (not module load) via the build-safe `readStringEnv`, so a Vercel env flip +
 * redeploy takes effect without a code change. Classify is the dominant
 * reddit-intel AI cost; Haiku is 3×/15× cheaper. The call keeps `useToolUse`
 * (forced strict JSON) + one retry-with-feedback, which is the defense Haiku's
 * higher malformed-output rate wants — so the pilot is low-risk + reversible.
 */
export function resolveClassifyModel(): ClaudeModelKey {
  const raw = readStringEnv("REDDIT_INTEL_CLASSIFY_MODEL");
  if (raw === "HAIKU_4_5" || raw === "SONNET_4_6") return raw;
  return "SONNET_4_6";
}
const ALLOWED_INTENT_LABELS = [
  "phishing",
  "romance_scam",
  "investment_fraud",
  "tech_support",
  "impersonation",
  "shopping_scam",
  "phone_scam",
  "email_scam",
  "sms_scam",
  "employment_scam",
  "advance_fee",
  "rental_scam",
  "sextortion",
  "informational",
  "other",
] as const;

// ── System prompt ─────────────────────────────────────────────────────────
// Cached via cache_control: ephemeral. Cache key changes whenever the text
// below changes — keep it stable to maximise hit rate.

const SYSTEM_PROMPT = `You are an Australian scam intelligence analyst for Ask Arthur, a consumer protection platform. You read scam reports posted by victims to Reddit and produce structured intelligence that helps Australians spot the next iteration of the scam.

YOUR TASK
You will receive a JSON array of Reddit posts. For EACH post, produce structured analysis. Then produce ONE daily aggregate covering all the posts together.

TONE AND ANTI-FUD GUIDANCE
- Describe rather than dramatise. Quantify before adjective.
- Australian English spelling (organise, recognise, behaviour).
- Do not invent statistics or losses. Only reference numbers explicitly stated in the post.
- Avoid alarmist language — the ACCC's own Targeting Scams report uses neutral, factual framing because alarmism reduces reporting compliance. Match that register.
- Treat victim quotes with respect. Never speculate about a victim's intelligence, attentiveness, or motivation.

INTENT LABEL TAXONOMY
Use exactly one of these 15 labels (lower_snake_case) — they match Ask Arthur's existing scam-type enum and the ACCC's published categories:
  phishing, romance_scam, investment_fraud, tech_support, impersonation,
  shopping_scam, phone_scam, email_scam, sms_scam, employment_scam,
  advance_fee, rental_scam, sextortion, informational, other

Use 'informational' for posts that are not themselves scam reports but discuss scam awareness. Use 'other' only when no listed label fits.

PER-POST OUTPUT
For each post, return:
  feedItemId         — the integer ID provided in input. MUST match input.
  intentLabel        — one of the 15 enum values above.
  confidence         — float 0.0-1.0. <0.5 = uncertain, treat with care.
  modusOperandi      — one short sentence describing HOW the scam works (e.g. "Crypto pig-butchering via Telegram trading group with fake withdrawal-tax demand").
  brandsImpersonated — array of brand names mentioned as being impersonated. Empty array if none. Use canonical brand names (e.g. "Booking.com" not "booking dot com").
  victimEmotion      — single keyword: shame, fear, anger, confusion, hope, urgency, grief, none. Inferred from the victim's framing.
  noveltySignals     — array of newly observed indicators (e.g. ["new_app:CoinPro Pro", "new_keyword:liquidation lock"]). Empty array if nothing novel.
  tacticTags         — array of social-engineering tactics: urgency_window, authority_appeal, celebrity_endorsement, reciprocity, scarcity, fear_of_missing_out, isolation, time_pressure, fake_legitimacy, account_takeover_threat, romance_grooming.
  countryHints       — array of ISO 3166-1 alpha-2 country codes inferred from the post (e.g. ["AU"], ["AU", "NZ"]). Empty if not inferrable.
  narrativeSummary   — one neutral sentence (≤30 words) describing what happened.
  quotes             — array containing AT MOST 1 quote: the single most characteristic PII-scrubbed verbatim quote from the post (an empty array is fine if none stands out). **HARD LIMIT: the quote MUST be ≤140 characters. Count carefully — quotes longer than 140 chars will be truncated. Trim aggressively if needed.** Pick the quote most characteristic of the scam tactic (e.g. an exact pressure phrase used by the scammer). NEVER include the victim's name, location, employer, or other identifying info. Each quote object: { text, speakerRole: 'victim'|'scammer'|'witness'|'unknown', themeTag, confidence }.

DAILY AGGREGATE OUTPUT
After all per-post entries, produce ONE aggregate covering the batch:
  leadNarrative      — ~120 words, two short paragraphs. Para 1: the dominant scam types AND notable shifts (new brands impersonated, new tactics, geographic patterns). Para 2: one piece of practical guidance for Australians. Be concise — quantify before adjective.
  emergingThreats    — array of up to 5 objects { title, summary, samplePostId, indicatorCount }. Pick threats that appeared multiple times or in novel forms.
  brandWatchlist     — array of up to 5 objects { brand, mentionCount } for brands impersonated in this batch.
  stats              — object: { totalPosts, topCategories: {label: count}, topBrands: {brand: count} }

OUTPUT FORMAT
Return a single JSON object with two keys: "perPost" (array, one entry per input post) and "dailySummary" (one object). The output WILL be validated against a Zod schema and any extra/missing/wrong-shape fields will cause failure. Match the field names exactly.

CRITICAL — FORMATTING RULES
- Output ONLY the JSON object. Start your response with the opening "{" character.
- NO markdown code fences (do not wrap in \`\`\`json or \`\`\`).
- NO leading or trailing prose, explanation, apology, or commentary.
- NO trailing comments after the closing "}".
- camelCase field names exactly as listed (e.g. "feedItemId" not "feed_item_id").`;

// ── Zod schema for Sonnet's output ────────────────────────────────────────

const QuoteSchema = z.object({
  // Truncate to 140 chars rather than reject the whole batch. Sonnet's
  // prompt asks for ≤140 but it occasionally violates (~3/40 in the
  // 2026-05-02 prod batch). Schema rejecting the whole response means
  // re-trying 3× and burning ~$0.50 of Sonnet on the same violation.
  // The DB CHECK constraint stays at 140, so truncated values land
  // cleanly in reddit_intel_quotes.quote_text without further pruning.
  text: z
    .string()
    .min(1)
    .transform((s) => (s.length <= 140 ? s : s.slice(0, 137) + "…")),
  speakerRole: z.enum(["victim", "scammer", "witness", "unknown"]).default("unknown"),
  themeTag: z.string().max(60).nullish(),
  confidence: z.number().min(0).max(1).default(0.7),
});

const PerPostSchema = z.object({
  feedItemId: z.number().int().positive(),
  intentLabel: z.enum(ALLOWED_INTENT_LABELS),
  confidence: z.number().min(0).max(1),
  modusOperandi: z.string().max(280).nullish(),
  brandsImpersonated: z.array(z.string().max(80)).default([]),
  victimEmotion: z.string().max(40).nullish(),
  noveltySignals: z.array(z.string().max(120)).default([]),
  tacticTags: z.array(z.string().max(60)).default([]),
  countryHints: z.array(z.string().length(2)).default([]),
  narrativeSummary: z.string().max(400).nullish(),
  // v2: capped at 1 (was 3) — quotes were a large share of per-post output
  // tokens. Schema stays tolerant: extra quotes are sliced, not rejected.
  quotes: z
    .array(QuoteSchema)
    .transform((q) => q.slice(0, 1))
    .default([]),
});

const DailySummarySchema = z.object({
  // v2: ~120 words target (was 200-300) — the prompt drives the token saving.
  // The schema only truncates (never rejects) so a modest overrun can't fail
  // the whole batch and waste a retry; the cost win comes from the prompt.
  leadNarrative: z
    .string()
    .min(50)
    .transform((s) => (s.length <= 1_800 ? s : s.slice(0, 1_799) + "…")),
  emergingThreats: z
    .array(
      z.object({
        title: z.string().max(120),
        summary: z.string().max(400),
        samplePostId: z.number().int().positive().nullish(),
        indicatorCount: z.number().int().nonnegative().default(0),
      }),
    )
    .max(5)
    .default([]),
  brandWatchlist: z
    .array(
      z.object({
        brand: z.string().max(80),
        mentionCount: z.number().int().nonnegative(),
      }),
    )
    .max(5)
    .default([]),
  stats: z
    .object({
      totalPosts: z.number().int().nonnegative(),
      topCategories: z.record(z.string(), z.number().int().nonnegative()).default({}),
      topBrands: z.record(z.string(), z.number().int().nonnegative()).default({}),
    })
    .default({ totalPosts: 0, topCategories: {}, topBrands: {} }),
});

// Defensive preprocess for the rare case where Sonnet stringifies an
// array/object inside tool-use input. Root cause for the 2026-05-06 → 10
// outage was fixed in anthropic.ts (io: "input" → "output" so the JSON
// Schema sent to Anthropic is strict, not permissive). This preprocess
// stays as belt-and-braces:
//   - non-string  → passthrough (the expected happy path)
//   - valid JSON  → parse and continue (covers any residual stringify)
//   - malformed   → return the string unchanged so Zod surfaces a clean
//                   "expected array, received string" instead of a raw
//                   SyntaxError from the preprocess itself (which is what
//                   produced the 2026-05-10 errors).
const jsonStringPassthrough = (v: unknown) => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

// dailySummary is .optional() since 2026-05-16 (#228 fix). Sonnet 4.6
// occasionally omits the field entirely — most often on low-volume
// cohorts (≤5 posts) where there's not enough signal to summarise. The
// per-post classifications are the load-bearing artefact; a missing
// summary degrades the dashboard but doesn't justify aborting the
// whole run and losing the per-post intel. Consumer at line ~479
// upserts only when present.
const SonnetOutputSchema = z.object({
  perPost: z.preprocess(jsonStringPassthrough, z.array(PerPostSchema)),
  dailySummary: z.preprocess(jsonStringPassthrough, DailySummarySchema).optional(),
});

type SonnetOutput = z.infer<typeof SonnetOutputSchema>;

// ── Retry-with-feedback (#228) ────────────────────────────────────────────
//
// Sonnet 4.6 occasionally returns the wrong shape for `perPost` (a string
// instead of an array) or omits `dailySummary` entirely. Pre-fix the
// classifier aborted on the first Zod validation failure, abandoning the
// whole cohort. Most failures look like Sonnet "almost" followed the
// schema — one nudge with the validation error injected as feedback
// reliably produces a compliant retry.
//
// Bounded to one retry to avoid runaway cost on a genuinely broken
// prompt. The retry path emits its own `reddit-intel-classify-retry`
// cost_telemetry row so the daily health digest can track "how often
// Sonnet needed re-prompting" as a leading indicator of prompt drift.
//
// Pattern matches the surface area of the existing error in anthropic.ts
// line 290: "Claude output schema mismatch (${spec.id}): ..." and the
// twin "Claude JSON parse failed (${spec.id}): ..." at line 276.

type CallClaudeJsonArgs<TSchema extends z.ZodType<unknown>> = Parameters<
  typeof callClaudeJson<z.infer<TSchema>>
>[0];
type CallClaudeJsonReturn<T> = Awaited<ReturnType<typeof callClaudeJson<T>>>;
type ClassifyResult<T> = CallClaudeJsonReturn<T> & {
  retried: boolean;
  retryError?: string;
  retryEstimatedCostUsd?: number;
};

function isSchemaRetryableError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  return (
    err.message.startsWith("Claude output schema mismatch") ||
    err.message.startsWith("Claude JSON parse failed")
  );
}

function buildCorrectionUser(originalUser: string, errMsg: string): string {
  return (
    `${originalUser}\n\n---\n` +
    `[Validation feedback from previous response]\n${errMsg}\n\n` +
    `Re-emit a single JSON object matching the required shape exactly. ` +
    `Do not include explanatory prose around the JSON. ` +
    `Match every field name and shape as specified in the system prompt.`
  );
}

/**
 * Call callClaudeJson with one retry-with-feedback on schema/parse failure.
 *
 * The second-arg `callFn` lets unit tests inject a mock without touching
 * the real Anthropic SDK. Default flows through to the production
 * `callClaudeJson` from `../anthropic`.
 */
export async function classifyWithRetry<TSchema extends z.ZodType<unknown>>(
  callArgs: CallClaudeJsonArgs<TSchema>,
  callFn: (args: CallClaudeJsonArgs<TSchema>) => Promise<CallClaudeJsonReturn<z.infer<TSchema>>> = callClaudeJson,
): Promise<ClassifyResult<z.infer<TSchema>>> {
  try {
    const first = await callFn(callArgs);
    return { ...first, retried: false };
  } catch (err) {
    if (!isSchemaRetryableError(err)) throw err;
    const errMsg = err.message;
    logger.warn("classifyWithRetry: first call failed schema validation, retrying once", {
      errorMessage: errMsg,
    });
    const correctedArgs: CallClaudeJsonArgs<TSchema> = {
      ...callArgs,
      user: buildCorrectionUser(callArgs.user, errMsg),
    };
    const second = await callFn(correctedArgs);
    return {
      ...second,
      retried: true,
      retryError: errMsg,
      // Capture the wasted spend on the first call so cost telemetry
      // can attribute it. We don't have the failed call's usage object
      // (the wrapper threw before returning), so estimate the wasted
      // cost as equal to a successful call's estimated cost — that's
      // approximately right since both calls are similar token shapes.
      retryEstimatedCostUsd: second.estimatedCostUsd,
    };
  }
}

// ── Cost telemetry ────────────────────────────────────────────────────────
// Direct insert because logCost lives in apps/web/lib and packages/* must
// not import upward. Same shape as the cost_telemetry table per v62.

async function logCost(args: {
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  modelId: string;
  cohortDate: string;
  postCount: number;
}) {
  const supabase = createServiceClient();
  if (!supabase) return;

  await supabase.from("cost_telemetry").insert({
    feature: "reddit-intel-classify",
    provider: "anthropic",
    operation: "messages.create",
    units: args.inputTokens + args.outputTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    metadata: {
      model: args.modelId,
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
      cache_read_tokens: args.cacheReadTokens,
      cache_write_tokens: args.cacheWriteTokens,
      cohort_date: args.cohortDate,
      post_count: args.postCount,
      prompt_version: PROMPT_VERSION,
    },
  });
}

// logFunctionError is now shared with the embed and cluster functions —
// see ./reddit-intel-error-log.ts. Same cost_telemetry feature tag, same
// SQL-queryable diagnostic format.

// ── The Inngest function ──────────────────────────────────────────────────

export const redditIntelDaily = inngest.createFunction(
  {
    id: "reddit-intel-daily",
    name: "Reddit Intel: Daily batch classifier + summariser",
    retries: 3,
    // No event-level idempotency key here — the cron triggers with a fresh
    // triggeredAt timestamp each run. Idempotency lives at the DB layer
    // (UNIQUE(feed_item_id) on reddit_post_intel + UPSERT on daily_summary).
  },
  { event: REDDIT_INTEL_BATCH_READY_EVENT },
  withAxiomLogging({ fnId: "reddit-intel-daily" }, async ({ event, step }) => {
    if (!featureFlags.redditIntelIngest) {
      return { skipped: true, reason: "redditIntelIngest flag off" };
    }

    // Cost brake — cost-daily-check sets feature_brakes.reddit_intel when
    // the day's reddit-intel-* spend crosses REDDIT_INTEL_CAP_USD (default
    // $10). Returning early here prevents continued Sonnet/Voyage burn
    // until the brake expires (24h later). Operator overrides via DELETE
    // FROM feature_brakes WHERE feature='reddit_intel'.
    const braked = await step.run("check-cost-brake", isRedditIntelBraked);
    if (braked) {
      return { paused: true, reason: "feature_brakes.reddit_intel is set" };
    }

    // Inline (not a step.run): pure deterministic Zod parse, free to re-run on
    // retry — memoising it as a durable step only cost an Inngest execution.
    const data = parseRedditIntelBatchReadyData(event.data);

    // ── Step 1: load post bodies from feed_items ─────────────────────────
    const posts = await step.run("load-posts", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      const { data: rows, error } = await supabase
        .from("feed_items")
        .select(
          "id, title, description, url, country_code, upvotes, source_created_at",
        )
        .in("id", data.feedItemIds)
        .eq("source", "reddit");

      if (error) {
        throw new Error(`load-posts failed: ${error.message}`);
      }

      // Filter posts that are already classified — this is the second
      // idempotency layer. The cron pre-filters but the gap between cron
      // and consumer execution can let other consumers race ahead.
      const { data: existing, error: existErr } = await supabase
        .from("reddit_post_intel")
        .select("feed_item_id")
        .in("feed_item_id", data.feedItemIds);

      if (existErr) {
        throw new Error(`existence check failed: ${existErr.message}`);
      }

      const alreadyClassified = new Set(
        (existing ?? []).map((r) => r.feed_item_id as number),
      );
      return (rows ?? []).filter((r) => !alreadyClassified.has(r.id as number));
    });

    if (posts.length === 0) {
      logger.info("reddit-intel-daily: nothing to classify", {
        requestedIds: data.feedItemIds.length,
      });
      return { skipped: true, reason: "all_already_classified" };
    }

    // ── Step 2: single Sonnet call ───────────────────────────────────────
    const cohortDateForLog = new Date(data.triggeredAt)
      .toISOString()
      .slice(0, 10);
    const classification = await step.run("classify", async () => {
      // Build the user payload as a JSON envelope. The wrapper auto-applies
      // sandwich-defence: even though we trust the envelope structure, the
      // post.title and post.description fields are RAW Reddit content and
      // must not be userIsTrusted'd through.
      const envelope = {
        instruction:
          "Classify each post and produce one daily aggregate. Match the schema in the system prompt exactly.",
        posts: posts.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description ?? "",
          url: p.url ?? null,
          countryCode: p.country_code ?? null,
          upvotes: p.upvotes ?? 0,
          postedAt: p.source_created_at,
        })),
      };

      try {
        // #228: retry-with-feedback on schema/parse failure. classifyWithRetry
        // wraps callClaudeJson; the second call gets the Zod error injected
        // into the user payload as correction feedback. If that fails too,
        // logFunctionError + throw as before — three Inngest retries still
        // get a shot, but each Inngest retry will itself do up to one
        // retry-with-feedback. Total upper-bound: 6 Sonnet calls per cron
        // firing (3 Inngest × 2 schema retries), well under the A$10/day
        // brake.
        const response = await classifyWithRetry<typeof SonnetOutputSchema>({
          // Sonnet 4.6 by default; flip to Haiku 4.5 via REDDIT_INTEL_CLASSIFY_MODEL
          // for the cost pilot (see resolveClassifyModel). Pricing, metadata.model,
          // and reddit_post_intel.model_version all follow the resolved id.
          model: resolveClassifyModel(),
          system: SYSTEM_PROMPT,
          user: JSON.stringify(envelope),
          schema: SonnetOutputSchema,
          // Output budget kept at 12k. Pre-v2 this was the binding constraint:
          // actual output averaged ~11.5k for 40 posts and ~half the runs hit
          // the cap, which truncates the tail of `perPost` (load-bearing). The
          // v2 trim (1 quote/post, ~120-word narrative) frees budget so the
          // per-post classifications fit comfortably under 12k. Billing is on
          // actual usage, so the headroom itself costs nothing.
          maxTokens: 12_000,
          // 240s = 4 min. Sonnet 4.6 outputs at ~50-100 tokens/sec, so 12k
          // worst-case output finishes in ~4 min. Inngest function-level
          // limit is 15 min so retries still have headroom.
          timeoutMs: 240_000,
          // No assistant prefill in the wrapper anymore (Sonnet 4.6 rejects
          // it). cacheSystem stays on — wrapper still requests cache, just
          // without the prefill scaffolding.
          cacheSystem: true,
          // Force strict JSON via Anthropic tool-use. Pre-fix baseline
          // was ~10% of batches failing with "Unterminated string in
          // JSON" or "Expected ',' or '}'" parse errors at ~$0.54
          // wasted per failure (3 retries × ~$0.18). Tool-use makes the
          // model emit a parsed JS object directly — no JSON.parse
          // step, no malformed output class.
          useToolUse: true,
          toolName: "submit_classification",
        });
        return response;
      } catch (err) {
        await logFunctionError({
          step: "classify",
          cohortDate: cohortDateForLog,
          postCount: posts.length,
          error: err,
          promptVersion: PROMPT_VERSION,
        });
        throw err;
      }
    });

    // ── Step 3: filter hallucinated post IDs ─────────────────────────────
    const inputIds = new Set(posts.map((p) => p.id as number));
    const validPerPost = classification.result.perPost.filter((entry) => {
      if (!inputIds.has(entry.feedItemId)) {
        logger.warn("reddit-intel-daily: discarding hallucinated feedItemId", {
          feedItemId: entry.feedItemId,
        });
        return false;
      }
      return true;
    });

    // ── Step 4: upsert intel + quotes + daily summary ────────────────────
    const upsertResult = await step.run("upsert-intel", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      const intelRows = validPerPost.map((entry) => ({
        feed_item_id: entry.feedItemId,
        intent_label: entry.intentLabel,
        confidence: entry.confidence,
        modus_operandi: entry.modusOperandi ?? null,
        brands_impersonated: entry.brandsImpersonated,
        victim_emotion: entry.victimEmotion ?? null,
        novelty_signals: entry.noveltySignals,
        tactic_tags: entry.tacticTags,
        country_hints: entry.countryHints,
        narrative_summary: entry.narrativeSummary ?? null,
        model_version: classification.modelId,
        prompt_version: PROMPT_VERSION,
      }));

      // Insert intel rows. UNIQUE(feed_item_id) means duplicates are
      // ignored; we then re-select to map feed_item_id → intel_id for the
      // quotes insert.
      const { error: intelErr } = await supabase
        .from("reddit_post_intel")
        .upsert(intelRows, { onConflict: "feed_item_id", ignoreDuplicates: true });

      if (intelErr) {
        throw new Error(`upsert reddit_post_intel: ${intelErr.message}`);
      }

      // Re-fetch to get intel_id for quote linkage. This is cheap (≤200 rows).
      const { data: intelMap, error: mapErr } = await supabase
        .from("reddit_post_intel")
        .select("id, feed_item_id")
        .in(
          "feed_item_id",
          validPerPost.map((e) => e.feedItemId),
        );

      if (mapErr) {
        throw new Error(`re-fetch intel ids: ${mapErr.message}`);
      }

      const intelIdByFeed = new Map<number, string>();
      for (const row of intelMap ?? []) {
        intelIdByFeed.set(row.feed_item_id as number, row.id as string);
      }

      // Build quote rows. Skip any whose parent intel row didn't map back
      // (defensive — shouldn't happen given the upsert succeeded).
      const quoteRows = validPerPost.flatMap((entry) => {
        const intelId = intelIdByFeed.get(entry.feedItemId);
        if (!intelId) return [];
        return entry.quotes.map((q) => ({
          feed_item_id: entry.feedItemId,
          intel_id: intelId,
          quote_text: q.text,
          speaker_role: q.speakerRole,
          theme_tag: q.themeTag ?? null,
          confidence: q.confidence,
        }));
      });

      let quotesInserted = 0;
      if (quoteRows.length > 0) {
        const { error: qErr } = await supabase
          .from("reddit_intel_quotes")
          .insert(quoteRows);
        if (qErr) {
          // Quote failure is non-fatal — log and continue. The intel rows
          // are the load-bearing artefact.
          logger.warn("reddit-intel-daily: quote insert failed (non-fatal)", {
            error: qErr.message,
            attempted: quoteRows.length,
          });
        } else {
          quotesInserted = quoteRows.length;
        }
      }

      // Daily summary upsert — overwrites same-day rows, allowing same-day
      // re-runs to refresh as more posts arrive in subsequent batches.
      //
      // #228: dailySummary is now .optional() — Sonnet 4.6 occasionally
      // omits it (especially on low-volume cohorts). When missing we skip
      // the summary upsert entirely rather than fabricating one. The
      // dashboard will show a missing day; the per-post intel still wrote
      // through to reddit_post_intel, which is the load-bearing artefact.
      const cohortDate = new Date(data.triggeredAt).toISOString().slice(0, 10);
      const summary = classification.result.dailySummary;

      if (summary) {
        const { error: summaryErr } = await supabase
          .from("reddit_intel_daily_summary")
          .upsert(
            {
              cohort_date: cohortDate,
              audience: "internal",
              country_code: null,
              lead_narrative: summary.leadNarrative,
              emerging_threats: summary.emergingThreats,
              brand_watchlist: summary.brandWatchlist,
              stats: summary.stats,
              posts_classified: validPerPost.length,
              model_version: classification.modelId,
              prompt_version: PROMPT_VERSION,
            },
            { onConflict: "cohort_date,audience,country_code" },
          );

        if (summaryErr) {
          throw new Error(`upsert daily_summary: ${summaryErr.message}`);
        }
      } else {
        logger.warn("reddit-intel-daily: dailySummary missing from Sonnet output — skipping summary upsert", {
          cohortDate,
          postCount: validPerPost.length,
          retried: classification.retried,
        });
      }

      return {
        intelInserted: intelRows.length,
        quotesInserted,
        cohortDate,
      };
    });

    // ── Step 5: cost telemetry + downstream event ────────────────────────
    //
    // #228: when classifyWithRetry actually retried, we paid for both
    // calls. Log a marker row tagged `reddit-intel-classify-retry` so
    // the daily health digest can track retry frequency as a leading
    // indicator of prompt drift. The wasted-spend amount is approximate
    // (we don't have the failed call's usage object) — see the helper
    // for the rationale.
    if (classification.retried) {
      await step.run("log-cost-retry", async () => {
        const supabase = createServiceClient();
        if (!supabase) return;
        await supabase.from("cost_telemetry").insert({
          feature: "reddit-intel-classify-retry",
          provider: "anthropic",
          operation: "messages.create",
          units: 0,
          estimated_cost_usd: classification.retryEstimatedCostUsd ?? 0,
          metadata: {
            model: classification.modelId,
            cohort_date: upsertResult.cohortDate,
            post_count: posts.length,
            prompt_version: PROMPT_VERSION,
            retry_reason: classification.retryError,
          },
        });
      });
    }

    await step.run("log-cost", () =>
      logCost({
        estimatedCostUsd: classification.estimatedCostUsd,
        inputTokens: classification.usage.inputTokens,
        outputTokens: classification.usage.outputTokens,
        cacheReadTokens: classification.usage.cacheReadTokens,
        cacheWriteTokens: classification.usage.cacheWriteTokens,
        modelId: classification.modelId,
        cohortDate: upsertResult.cohortDate,
        postCount: validPerPost.length,
      }),
    );

    await step.run("emit-summarised", () =>
      inngest.send({
        name: REDDIT_INTEL_SUMMARISED_EVENT,
        data: {
          cohortDate: upsertResult.cohortDate,
          postsClassified: upsertResult.intelInserted,
          newQuotesCount: upsertResult.quotesInserted,
          modelVersion: classification.modelId,
        },
      }),
    );

    logger.info("reddit-intel-daily: complete", {
      requestedIds: data.feedItemIds.length,
      classified: validPerPost.length,
      quotesInserted: upsertResult.quotesInserted,
      cohortDate: upsertResult.cohortDate,
      estimatedCostUsd: classification.estimatedCostUsd.toFixed(6),
      cacheHit: classification.cacheHit,
    });

    return {
      classified: validPerPost.length,
      quotesInserted: upsertResult.quotesInserted,
      cohortDate: upsertResult.cohortDate,
      estimatedCostUsd: classification.estimatedCostUsd,
    };
  }),
);
