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
 * The cap on a tell, as a BACKSTOP. The prompt asks for 120; this exists so a
 * model that overshoots produces a long tell rather than a lost batch.
 *
 * It was 140, chosen from a 10-post dry run that reported "140 fits the
 * observed distribution with headroom". At 870 takes the distribution turned
 * out to be heavier than that sample could show:
 *
 *   100-120 chars   683 tells
 *   120-140 chars   459 tells      <- pressed against the old ceiling
 *   cut at the cap  145 tells      = 125 of 870 takes (14%) with a visible "…"
 *
 * Meanwhile `where` and `auLine` at 280 never truncated once across 1,193
 * strings. The prose cap had headroom the tell cap did not, and the tell cap
 * was the one set from ten samples.
 *
 * 240 is twice what the prompt asks for, and the schema-shape test parses the
 * number out of the prompt itself to enforce that ratio, so the two cannot
 * drift apart again in the direction that bit us.
 *
 * Measured after regenerating all 125 affected takes at the new cap: 2,435
 * tells, longest 221, mean 99, none truncated — and 109 of them longer than
 * the old 140, so the headroom is being used rather than merely granted. 221
 * against 240 is not a large margin, which is exactly why the count below
 * exists: if the tail moves, `truncatedFieldCount` in cost_telemetry says so
 * within a day. Revisit this number from that, never from another dry run.
 */
const TELL_MAX_CHARS = 240;

/** One-sentence prose fields (`where`, `auLine`). Same truncate-not-reject rule. */
const PROSE_MAX_CHARS = 280;

/**
 * How many fields on this take were cut short.
 *
 * This is a POST-HOC detector, not a counter incremented during truncation,
 * and the reason is concurrency: the truncation happens inside a Zod
 * transform that runs deep inside an awaited `callClaudeJson`, so a
 * module-scoped counter reset around that await could be corrupted by a
 * second batch running in parallel. A detector over the returned value has no
 * such window.
 *
 * It is exact in practice. `truncateOnWord` is the only thing in this module
 * that appends "…", and across 870 live takes all 145 ellipsis-terminated
 * tells measured 126-139 characters — every one a word-boundary cut just
 * under the old 140 cap, with no model-authored ellipsis at any other length.
 *
 * And where it is ever wrong, it is wrong in the useful direction: a tell the
 * model chose to end in "…" is a formatting miss worth counting too. What is
 * being measured is "fields that reach a reader looking cut off", which is
 * the thing we actually care about.
 */
export function countTruncatedFields(take: GeneratedTake): number {
  const cut = (s: string | null | undefined) => (s?.endsWith("…") ? 1 : 0);
  return (
    take.tells.reduce((n, t) => n + cut(t), 0) +
    cut(take.where) +
    cut(take.auLine)
  );
}

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
  // NOT .min(1). Measured on a 25-row batch: the model returned an empty
  // tells array for 2 rows, and requiring one discarded all 25 — the same
  // reject-vs-truncate trade as the length cap, one field over. Whether a
  // take with no tells is publishable is the VALIDATOR's call, per row, and
  // it already has an `empty_take` reason for exactly this. The schema's job
  // is to accept what the model plausibly returns.
  tells: z
    .array(
      z
        .string()
        .transform((t) =>
          t.length <= TELL_MAX_CHARS ? t : truncateOnWord(t, TELL_MAX_CHARS),
        ),
    )
    .transform((a) => a.slice(0, 3)),
  // Nullish AND truncating, for the same reason as `tells` above. A hard
  // .max() on a model-written string rejects the entire batch when the model
  // overshoots by a word — which it did, on auLine, at 241 characters, losing
  // 24 good takes. This is the third field where the same trade came up, so
  // the rule is now uniform: EVERY model-generated string here truncates, and
  // publishability stays the validator's decision.
  where: z
    .string()
    .transform((t) =>
      t.length <= PROSE_MAX_CHARS ? t : truncateOnWord(t, PROSE_MAX_CHARS),
    )
    .nullish(),
  auLine: z
    .string()
    .transform((t) =>
      t.length <= PROSE_MAX_CHARS ? t : truncateOnWord(t, PROSE_MAX_CHARS),
    )
    .nullish(),
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
  /** Fields that reach a reader looking cut off. See countTruncatedFields. */
  truncatedFieldCount: number;
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
  // Drop anything the model invented an id for. A take written against a post
  // that was not in the batch would be attached to the wrong row.
  const takes = response.result.takes.filter((t) => requested.has(t.feedItemId));
  return {
    takes,
    modelId: response.modelId,
    estimatedCostUsd: response.estimatedCostUsd,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    truncated: response.truncated,
    truncatedFieldCount: takes.reduce((n, t) => n + countTruncatedFields(t), 0),
  };
}

export const TAKE_SYSTEM_PROMPT = SYSTEM_PROMPT;

/** The tell length the prompt asks the model for. Read by the schema-shape
 *  test so the cap and the instruction cannot drift apart silently. */
export const TELL_PROMPT_TARGET_CHARS = 120;
export const TELL_CAP_CHARS = TELL_MAX_CHARS;
