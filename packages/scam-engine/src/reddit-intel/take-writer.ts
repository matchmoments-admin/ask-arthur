/**
 * Arthur's Take — stage 2 of the Reddit intel pipeline.
 *
 * Stage 1 (reddit-intel-daily) reads the raw post and produces structured
 * intelligence. This stage reads THAT — the label, modus operandi, tactics and
 * brands — plus the excerpt, and writes the reader-facing half: the tells, a
 * line on where the pattern shows up, and an Australian line when there is a
 * genuine local analogue.
 *
 * Why a second call rather than three more fields on the classifier prompt
 * (docs/arthurs-take/DECISIONS.md X1):
 *
 *   - Independence. Reader-facing wording will be tuned far more often than
 *     the intel schema. Folding it in would mean every tone edit invalidates
 *     the classifier's prompt cache key and re-opens its golden set.
 *   - Regeneration. The classifier's upsert uses ignoreDuplicates, so it never
 *     rewrites an existing row; re-running it cannot refresh a take. A
 *     separately-versioned second stage can be re-run over the 4,313 rows that
 *     already exist for a few dollars on Haiku.
 *   - Failure isolation. A malformed take must not fail the intel batch.
 *   - Truncation headroom. The classify call has already hit its output cap in
 *     production; adding prose per post pushes it back toward that edge.
 *
 * The model is Haiku: turning structured fields into plain language is not the
 * reasoning-heavy step, and it is a fifth of Sonnet's output price.
 */
import { z } from "zod";

import type { IntentLabel } from "@askarthur/types";

import { callClaudeJson } from "../anthropic";

export const TAKE_PROMPT_VERSION = "arthurs-take-v1@2026-09-04";

/**
 * One batched call per cohort, matching the classifier's shape. Per-post calls
 * would pay the system prompt 40 times over for the same work.
 */
export const TAKE_MAX_TOKENS = 8_000;

/**
 * Haiku sustains well above 50 tok/s, but the budget is sized on the same
 * worst case the classifier uses so the two constants stay comparable. 8,000
 * at 50 tok/s is 160s; 240s carries the margin. Raising TAKE_MAX_TOKENS
 * REQUIRES raising this — a timeout returns nothing at all, which is strictly
 * worse than a truncation that still yields most of the batch.
 */
export const TAKE_TIMEOUT_MS = 240_000;

/** Cost telemetry tag. Must also appear in cost-daily-check's brake allowlist. */
export const TAKE_COST_FEATURE = "reddit-intel-take";

const SYSTEM_PROMPT = `You write "Arthur's Take" for Ask Arthur, a consumer scam-protection service. You are given structured analysis of scam reports that people posted publicly, and you turn each one into a short, plain-language read of THE PATTERN.

WHO YOU ARE WRITING FOR
A reader who has just encountered something similar and wants to know what to look for. They are not the person who wrote the post.

THE SINGLE MOST IMPORTANT RULE
You are describing a pattern, never judging a person. The post you are given was written by a real identifiable person and your words appear on a public page directly beside a link to it. Never address the reader as the victim ("you were scammed", "you should have"). Never speculate about anyone's intelligence, attentiveness or motivation.

NEVER INCLUDE
- Money amounts of any kind. Not "$95", not "around 500 dollars", not "a four-figure sum". This is the most common failure — the source analysis often contains amounts, and you must not carry them through.
- Names, usernames, handles, email addresses, phone numbers, employers, or locations more specific than a country.
- Anything you were not given. Do not invent statistics, losses, or details to fill a field.

TONE
Plain, specific, calm. Australian English spelling (organise, recognise, behaviour). The register of a Scamwatch or IDCARE explainer: describe rather than dramatise, quantify before adjective. No alarmism — it reduces reporting, it does not increase caution.

WHAT TO PRODUCE FOR EACH ITEM
  feedItemId  — the integer id given in the input. MUST match exactly.
  tells       — 1 to 3 short strings, each under 120 characters. The observable signs that identify THIS pattern, phrased so a reader could recognise it in a different message. Prefer the mechanism ("payment is requested before any service is delivered") over the story ("she paid for a photoshoot"). If only one genuine tell is present, return one; padding to three produces filler.
  where       — ONE sentence on where and how this pattern is showing up: the channels, the kinds of brand or platform impersonated, who it targets. Global, not Australia-specific.
  auLine      — ONE sentence on how the same pattern presents in Australia: local brands, local payment methods (PayID, BPAY, Osko), local agencies commonly impersonated. Return null if you would have to invent an Australian angle. A missing line is much better than a made-up one.

OUTPUT FORMAT
Return a single JSON object with one key, "takes", an array with one entry per input item, in the same order. The output is validated against a strict schema; extra, missing or misnamed fields cause the whole batch to fail.`;

/**
 * Measured on a real 10-post dry run: asking for 90 characters produced tells
 * of 95-130, so 6 of 10 were cut — several mid-word ("account compromise or
 * fun…"). The model writes at a natural length and clipping it reads as a
 * bug to a reader. 140 fits the observed distribution with headroom, and the
 * prompt now asks for 120 so the cap is a backstop rather than the norm.
 */
const TELL_MAX_CHARS = 140;

/** Truncate at a word boundary — a mid-word cut looks like a rendering fault. */
function truncateOnWord(text: string, max: number): string {
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

const TakeSchema = z.object({
  feedItemId: z.number().int().positive(),
  // Required, not optional: a truncated response must fail loudly. An
  // optional trailing field parses clean and silently loses content — the
  // exact defect that cost 24 days of daily summaries on the classify call.
  // Transform-truncate rather than reject, matching the classifier's quote
  // handling: a 91-character tell is a formatting miss, and failing the whole
  // batch over it throws away 39 good takes and the money spent on them.
  tells: z
    .array(
      z
        .string()
        .transform((t) =>
          t.length <= TELL_MAX_CHARS ? t : truncateOnWord(t, TELL_MAX_CHARS),
        ),
    )
    .min(1)
    .transform((a) => a.slice(0, 3)),
  // Nullish for the same reason: the prompt asks for one sentence, but a
  // single null must not cost the batch. A take with no tells and no `where`
  // is caught downstream by the validator's empty_take rule.
  where: z.string().max(240).nullish(),
  auLine: z.string().max(240).nullish(),
});

export const TakeBatchSchema = z.object({
  takes: z.array(TakeSchema),
});

export type GeneratedTake = z.infer<typeof TakeSchema>;

/**
 * The stage-1 fields handed to the writer. Deliberately the STRUCTURED row
 * plus a short excerpt rather than the full post: the classifier has already
 * done the reading, and a second full-text pass would pay for it twice.
 */
export interface TakeWriterInput {
  feedItemId: number;
  intentLabel: IntentLabel;
  confidence: number;
  modusOperandi: string | null;
  narrativeSummary: string | null;
  tacticTags: string[];
  brandsImpersonated: string[];
  countryHints: string[];
  isEmerging: boolean;
  /** Short excerpt for grounding. Capped by the caller. */
  excerpt: string;
}

/** Excerpt budget per item. The structured fields carry the analysis; this is
 * only there so the writer can ground a tell in the poster's own framing. */
export const TAKE_EXCERPT_CHARS = 600;

export function buildTakeUserPayload(items: TakeWriterInput[]): string {
  return JSON.stringify({
    instruction:
      "Write one take per item, in the same order. Match the schema exactly.",
    items: items.map((i) => ({
      feedItemId: i.feedItemId,
      scamType: i.intentLabel,
      howItWorks: i.modusOperandi,
      summary: i.narrativeSummary,
      tactics: i.tacticTags,
      brandsImpersonated: i.brandsImpersonated,
      countryHints: i.countryHints,
      // Reads FALSE on every row today: reddit_post_intel.is_emerging has no
      // writer yet (see migration-v301). Wired now so the hint works the
      // moment the novelty computation lands — but a take's silence about
      // novelty is not evidence the pattern is old.
      isEmergingPattern: i.isEmerging,
      excerpt: i.excerpt.slice(0, TAKE_EXCERPT_CHARS),
    })),
  });
}

export interface WriteTakesResult {
  takes: GeneratedTake[];
  modelId: string;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
}

/**
 * Generate takes for one batch. Throws on transport or schema failure so the
 * caller decides whether that is fatal — for Arthur's Take it is not: the
 * intel rows are already written and a take is additive.
 */
export async function writeTakes(
  items: TakeWriterInput[],
  callFn = callClaudeJson,
): Promise<WriteTakesResult> {
  const response = await callFn({
    model: "HAIKU_4_5",
    system: SYSTEM_PROMPT,
    user: buildTakeUserPayload(items),
    schema: TakeBatchSchema,
    maxTokens: TAKE_MAX_TOKENS,
    timeoutMs: TAKE_TIMEOUT_MS,
    cacheSystem: true,
    useToolUse: true,
    toolName: "submit_takes",
  });

  const requested = new Set(items.map((i) => i.feedItemId));
  return {
    // Drop anything the model invented an id for. A take written against a
    // post that was not in the batch would be attached to the wrong row.
    takes: response.result.takes.filter((t) => requested.has(t.feedItemId)),
    modelId: response.modelId,
    estimatedCostUsd: response.estimatedCostUsd,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    truncated: response.truncated,
  };
}

export const TAKE_SYSTEM_PROMPT = SYSTEM_PROMPT;
