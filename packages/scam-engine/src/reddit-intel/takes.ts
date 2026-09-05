/**
 * Arthur's Take — the module that owns "produce a take for these posts".
 *
 * Before this existed, three modules did — `writeTakes` (the Claude adapter),
 * `validateTake` (the publishability gate) and the column projection — and no
 * caller could use them without holding five steps of knowledge: project a
 * `reddit_post_intel` row into writer input, call the writer, re-shape each
 * result into a validator candidate plus context, validate, then map the
 * verdict onto eight columns. Three interfaces about as complex as the
 * implementations behind them.
 *
 * That arrangement caused the defects an architecture review found: the writer
 * input was a hand-copied row projection (so `is_emerging` could be wired in
 * as a permanently-false field unnoticed), `sourceLength` was ambiguous
 * because no caller existed to settle it, and the validator — which
 * migration-v301 makes load-bearing by giving `take_status` a column — had
 * never been called at all.
 *
 * One function now hides all of it. Callers do `load → generate → upsert`.
 *
 * DELETION TEST: removing this module puts that five-step assembly back into
 * the Inngest step, the backfill script and any future regeneration path.
 * Complexity concentrates here rather than moving, and two adapters are
 * already known — so this is a real seam, not a hypothetical one.
 *
 * WHAT THIS MODULE DOES NOT DO: any IO. It takes rows and returns rows. That
 * is what makes the whole decision path testable without a database, and it
 * follows `rollupBrandRegister` (brand-register-refresh.ts:61), the house
 * shape for separating a decision from the step that performs it.
 */
import type { IntentLabel } from "@askarthur/types";

import {
  validateTake,
  type SuppressionReason,
} from "./take-validator";
import {
  writeTakes,
  TAKE_EXCERPT_CHARS,
  TAKE_PROMPT_VERSION,
  type TakeWriterInput,
} from "./take-writer";

/**
 * One `reddit_post_intel` row plus the source text, as this module needs it.
 *
 * The single home for this projection — the backfill script and the Inngest
 * step both build it, and neither re-derives the shape. Deliberately plain
 * data: no Supabase types, no client, so a test can write one as a literal.
 */
export interface IntelRowForTake {
  intelId: string;
  feedItemId: number;
  intentLabel: IntentLabel;
  confidence: number;
  modusOperandi: string | null;
  narrativeSummary: string | null;
  tacticTags: string[];
  brandsImpersonated: string[];
  countryHints: string[];
  isEmerging: boolean;
  /**
   * `reddit_post_intel.is_scam_report` (v301). NULL on every row today: the
   * classifier prompt that produces it has not shipped, so the validator's
   * not-a-scam rule is dormant rather than absent. Wired through now so it
   * starts working the moment the classifier writes the column — and NULL is
   * read as "assume it is a scam report", because declining to publish a take
   * on that basis is a claim we cannot currently support.
   */
  isScamReport: boolean | null;
  /**
   * The post text, already resolved by the caller from
   * `coalesce(body_md, description)`. Passed whole: this module decides how
   * much of it to send and what "source length" means, because those are the
   * same decision and splitting them across caller and module is what made
   * `sourceLength` ambiguous in the first place.
   */
  sourceText: string;
}

/** The eight `reddit_post_intel` take columns, ready to upsert. */
export interface TakeResult {
  intelId: string;
  feedItemId: number;
  takeStatus: "ready" | "suppressed" | "failed";
  takeSuppressedReason: SuppressionReason | "generation_missing" | null;
  takeTells: string[];
  takeWhere: string | null;
  takeAuLine: string | null;
  takeModelVersion: string;
  takePromptVersion: string;
}

export interface GenerateTakesResult {
  results: TakeResult[];
  /** Cost telemetry inputs. The caller owns the sink — see cost-log.ts. */
  modelId: string;
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
  /** Counts for the run summary. */
  readyCount: number;
  suppressedCount: number;
  /**
   * Fields published looking cut off. Logged to cost_telemetry beside ready
   * and suppressed so the length cap can be tuned from production instead of
   * from a dry run — the old 140-char tell cap silently clipped one take in
   * seven for the whole first month, and the only way to find it was an
   * ad-hoc SQL query for a trailing ellipsis. A fail-soft path that nobody
   * counts is a fail-soft path nobody knows is firing.
   */
  truncatedFieldCount: number;
}

/**
 * Rows that already carry a decision are never regenerated.
 *
 * This is a SPEND guard as much as a correctness one: without it an Inngest
 * retry, a re-fired event or a re-run backfill pays Claude again for content
 * that already exists. `failed` is deliberately absent — a failure is worth
 * one more attempt; a decision is not.
 */
export function needsTake(row: { takeStatus?: string | null }): boolean {
  return row.takeStatus !== "ready" && row.takeStatus !== "suppressed";
}

function toWriterInput(row: IntelRowForTake): TakeWriterInput {
  return {
    feedItemId: row.feedItemId,
    intentLabel: row.intentLabel,
    confidence: row.confidence,
    modusOperandi: row.modusOperandi,
    narrativeSummary: row.narrativeSummary,
    tacticTags: row.tacticTags,
    brandsImpersonated: row.brandsImpersonated,
    countryHints: row.countryHints,
    isEmerging: row.isEmerging,
    excerpt: row.sourceText,
  };
}

/**
 * Generate and gate takes for a batch.
 *
 * Every row in `rows` gets exactly one `TakeResult`, in the same order,
 * whatever the model returns. A row the model skipped comes back `failed`
 * rather than silently absent — an absent row would look identical to one
 * that was never attempted, and the retry logic would never find it again.
 *
 * `callFn` is the injection seam for tests; production passes nothing.
 */
export async function generateTakesForPosts(
  rows: IntelRowForTake[],
  callFn?: Parameters<typeof writeTakes>[1],
): Promise<GenerateTakesResult> {
  if (rows.length === 0) {
    return {
      results: [],
      modelId: "",
      estimatedCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      truncated: false,
      readyCount: 0,
      suppressedCount: 0,
      truncatedFieldCount: 0,
    };
  }

  const written = await writeTakes(rows.map(toWriterInput), callFn);
  const byFeedItem = new Map(written.takes.map((t) => [t.feedItemId, t]));

  const results: TakeResult[] = rows.map((row) => {
    const base = {
      intelId: row.intelId,
      feedItemId: row.feedItemId,
      takeModelVersion: written.modelId,
      takePromptVersion: TAKE_PROMPT_VERSION,
    };

    const generated = byFeedItem.get(row.feedItemId);
    if (!generated) {
      return {
        ...base,
        takeStatus: "failed" as const,
        takeSuppressedReason: "generation_missing" as const,
        takeTells: [],
        takeWhere: null,
        takeAuLine: null,
      };
    }

    const verdict = validateTake(
      {
        tells: generated.tells,
        where: generated.where ?? null,
        auLine: generated.auLine ?? null,
        isScamReport: row.isScamReport ?? true,
      },
      {
        intentLabel: row.intentLabel,
        confidence: row.confidence,
        // "Source length" is the length of the text the take was DERIVED
        // from, which is what the writer was actually shown — not the length
        // of the row in the database. A post whose body is long but whose
        // excerpt was truncated to nothing should fail the too-thin rule.
        sourceLength: Math.min(row.sourceText.length, TAKE_EXCERPT_CHARS),
      },
    );

    // A suppressed take keeps its text OUT of the row entirely rather than
    // storing it against a status that hides it. Storing text we have already
    // judged unpublishable, in a column the retention job clears at 180 days,
    // is a liability with no reader.
    if (verdict.status === "suppressed") {
      return {
        ...base,
        takeStatus: "suppressed" as const,
        takeSuppressedReason: verdict.reason,
        takeTells: [],
        takeWhere: null,
        takeAuLine: null,
      };
    }

    return {
      ...base,
      takeStatus: "ready" as const,
      takeSuppressedReason: null,
      takeTells: generated.tells,
      takeWhere: generated.where ?? null,
      takeAuLine: generated.auLine ?? null,
    };
  });

  return {
    results,
    modelId: written.modelId,
    estimatedCostUsd: written.estimatedCostUsd,
    inputTokens: written.inputTokens,
    outputTokens: written.outputTokens,
    truncated: written.truncated,
    readyCount: results.filter((r) => r.takeStatus === "ready").length,
    suppressedCount: results.filter((r) => r.takeStatus === "suppressed").length,
    truncatedFieldCount: written.truncatedFieldCount,
  };
}
