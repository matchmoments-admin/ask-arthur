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
import { callClaudeJson } from "../anthropic";
import { logFunctionError } from "./reddit-intel-error-log";

// ── Versioning ────────────────────────────────────────────────────────────
// Bump PROMPT_VERSION whenever the system prompt or output schema changes.
// reddit_post_intel.prompt_version stores this so we can ignore stale rows
// when the prompt has materially evolved.

const PROMPT_VERSION = "reddit-intel-v1@2026-05-01";
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
  quotes             — array of up to 3 PII-scrubbed verbatim quotes from the post. Each quote ≤140 characters. Pick quotes that are characteristic of the scam tactic (e.g. exact pressure phrases used by the scammer). NEVER include the victim's name, location, employer, or other identifying info. Each quote object: { text, speakerRole: 'victim'|'scammer'|'witness'|'unknown', themeTag, confidence }.

DAILY AGGREGATE OUTPUT
After all per-post entries, produce ONE aggregate covering the batch:
  leadNarrative      — 200-300 words. Three paragraphs. Para 1: what scam types dominated. Para 2: notable shifts (new brands impersonated, new tactics, geographic patterns). Para 3: one piece of practical guidance for Australians.
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
  text: z.string().min(1).max(140),
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
  quotes: z.array(QuoteSchema).max(3).default([]),
});

const DailySummarySchema = z.object({
  leadNarrative: z.string().min(50).max(3_000),
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

const SonnetOutputSchema = z.object({
  perPost: z.array(PerPostSchema),
  dailySummary: DailySummarySchema,
});

type SonnetOutput = z.infer<typeof SonnetOutputSchema>;

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
  async ({ event, step }) => {
    if (!featureFlags.redditIntelIngest) {
      return { skipped: true, reason: "redditIntelIngest flag off" };
    }

    const data = await step.run("parse-event", () =>
      parseRedditIntelBatchReadyData(event.data),
    );

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
        const response = await callClaudeJson<SonnetOutput>({
          model: "SONNET_4_6",
          system: SYSTEM_PROMPT,
          user: JSON.stringify(envelope),
          schema: SonnetOutputSchema,
          // Per-post output ~150 tokens × 40 max + summary ~600 = 6,600.
          // Cap at 12k for ~80% headroom — Sonnet billing is on actual
          // usage so over-allocating costs nothing.
          maxTokens: 12_000,
          // 240s = 4 min. Sonnet 4.6 outputs at ~50-100 tokens/sec, so 12k
          // worst-case output finishes in ~4 min. Inngest function-level
          // limit is 15 min so retries still have headroom.
          timeoutMs: 240_000,
          // No assistant prefill in the wrapper anymore (Sonnet 4.6 rejects
          // it). cacheSystem stays on — wrapper still requests cache, just
          // without the prefill scaffolding.
          cacheSystem: true,
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
      const cohortDate = new Date(data.triggeredAt).toISOString().slice(0, 10);
      const summary = classification.result.dailySummary;

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

      return {
        intelInserted: intelRows.length,
        quotesInserted,
        cohortDate,
      };
    });

    // ── Step 5: cost telemetry + downstream event ────────────────────────
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
  },
);
