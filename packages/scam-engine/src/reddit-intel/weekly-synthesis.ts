// Reddit Intelligence — weekly narrative synthesis (Track B).
//
// Problem this solves (full write-up: docs/plans/weekly-intel-dynamic.md):
//   The Monday intel email used to rank "emerging this week" off
//   reddit_intel_themes by CUMULATIVE member_count. The greedy clusterer
//   collapsed into one 2000+ member attractor sink, so the email surfaced the
//   same single theme every week forever ("[1 emerging scam this week]" was
//   literally always the same scam).
//
// The fix, encoded here: compute "emerging this week" as a pure function of
// THIS WEEK's classified posts. We deterministically aggregate the 7-day
// cohort (category + brand counts, and a first-seen-this-week novelty diff
// against a trailing baseline), hand those code-derived facts to Sonnet, and
// ask it to write the 3-5 most significant stories — ranked by volume x
// novelty. Because the input is this week's content, the output cannot be
// stale, and it bypasses the broken clustering entirely.
//
// All numbers the email shows are code-derived (category counts, novelty
// flags). Sonnet writes prose and ranks; it never invents a statistic —
// matching the daily classifier's anti-FUD register ("quantify before
// adjective").
//
// Persisted to reddit_intel_weekly_digest (one row per week, get-or-create)
// so the email render is a pure idempotent read and the dashboard / B2B can
// consume the same canonical object.
//
// Cost: one Sonnet 4.6 call/week over ~260 short narrative rows ≈ a few cents.
// Logged to cost_telemetry feature='reddit-intel-weekly-synthesis'; shares the
// existing feature_brakes.reddit_intel kill-switch.

import { z } from "zod";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { callClaudeJson } from "../anthropic";
import { isRedditIntelBraked } from "../inngest/reddit-intel-error-log";

// Bump when the prompt or output schema changes materially.
const PROMPT_VERSION = "reddit-intel-weekly-synth-v1@2026-07-07";
const MODEL_KEY = "SONNET_4_6" as const;

const COHORT_DAYS = 7;
// Trailing baseline for the novelty diff: brands/tactics that appeared in the
// 28 days BEFORE this week's window but not within it are "ongoing"; ones that
// appear this week and were absent from the baseline are "new this week".
const BASELINE_DAYS = 28;
const MAX_COHORT_ROWS = 500;
// Below this classifier confidence a post is too uncertain to shape a story.
const MIN_CONFIDENCE = 0.4;
const MAX_NARRATIVES_IN_PROMPT = 260;

// ── Public shapes ───────────────────────────────────────────────────────────

export interface WeeklyIntelStory {
  rank: number;
  title: string;
  narrative: string;
  /** One of the 15 intent labels — maps to a deterministic weekly count. */
  category: string;
  representativeBrands: string[];
  noveltySignal: "new" | "rising" | "ongoing";
  /** Code-derived count of this week's posts in `category`. Never model-invented. */
  weeklyReportCount: number;
}

export interface WeeklyIntelDigest {
  weekStart: string;
  weekEnd: string;
  cohortPostCount: number;
  stories: WeeklyIntelStory[];
  topBrands: Array<{ brand: string; mentionCount: number }>;
  topCategories: Array<{ label: string; count: number }>;
  novelty: { brands: string[]; tactics: string[] };
  scamOfTheWeek: { text: string; speakerRole: string } | null;
  modelVersion: string;
  promptVersion: string;
  generatedAt: string;
}

export interface SynthesizeOptions {
  /** Regenerate even when a row for this week already exists. Default false. */
  force?: boolean;
}

// ── Sonnet output schema (stories only — all counts attached in code) ───────

const StorySchema = z.object({
  title: z.string().min(4).max(120),
  narrative: z.string().min(10).max(400),
  category: z.string().min(2).max(40),
  representativeBrands: z.array(z.string().max(80)).max(3).default([]),
  noveltySignal: z.enum(["new", "rising", "ongoing"]).default("ongoing"),
});

const SynthOutputSchema = z.object({
  stories: z.array(StorySchema).min(1).max(5),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface CohortRow {
  intent_label: string | null;
  brands_impersonated: string[] | null;
  tactic_tags: string[] | null;
  narrative_summary: string | null;
  confidence: number | null;
}

export interface CohortAggregate {
  catTotals: Record<string, number>;
  topBrands: Array<{ brand: string; mentionCount: number }>;
  topCategories: Array<{ label: string; count: number }>;
  /** Brands/tactics present this week but ABSENT from the baseline window,
   *  original-cased for display, deduped case-insensitively. */
  novelBrands: string[];
  novelTactics: string[];
}

/**
 * Pure deterministic aggregation over a week's cohort vs a trailing baseline.
 * Extracted from the engine so the counting + novelty-diff logic is unit-
 * testable without a DB or Claude. `baseline` supplies the brands/tactics seen
 * in the weeks BEFORE this window; anything in the cohort that isn't in the
 * baseline is "new this week".
 */
export function aggregateWeeklyCohort(
  cohort: Array<Pick<CohortRow, "intent_label" | "brands_impersonated" | "tactic_tags">>,
  baseline: Array<Pick<CohortRow, "brands_impersonated" | "tactic_tags">>,
): CohortAggregate {
  const catTotals: Record<string, number> = {};
  const brandTotals: Record<string, number> = {};
  // lower-cased key → first-seen original casing, for display.
  const weekBrands = new Map<string, string>();
  const weekTactics = new Map<string, string>();

  for (const r of cohort) {
    if (r.intent_label) catTotals[r.intent_label] = (catTotals[r.intent_label] ?? 0) + 1;
    for (const b of r.brands_impersonated ?? []) {
      brandTotals[b] = (brandTotals[b] ?? 0) + 1;
      const k = b.toLowerCase();
      if (!weekBrands.has(k)) weekBrands.set(k, b);
    }
    for (const t of r.tactic_tags ?? []) {
      const k = t.toLowerCase();
      if (!weekTactics.has(k)) weekTactics.set(k, t);
    }
  }

  const baseBrands = new Set<string>();
  const baseTactics = new Set<string>();
  for (const r of baseline) {
    for (const b of r.brands_impersonated ?? []) baseBrands.add(b.toLowerCase());
    for (const t of r.tactic_tags ?? []) baseTactics.add(t.toLowerCase());
  }

  const novelBrands = [...weekBrands.entries()]
    .filter(([k]) => !baseBrands.has(k))
    .map(([, orig]) => orig);
  const novelTactics = [...weekTactics.entries()]
    .filter(([k]) => !baseTactics.has(k))
    .map(([, orig]) => orig);

  const topCategories = Object.entries(catTotals)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const topBrands = Object.entries(brandTotals)
    .map(([brand, mentionCount]) => ({ brand, mentionCount }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 5);

  return { catTotals, topBrands, topCategories, novelBrands, novelTactics };
}

// ── The engine ──────────────────────────────────────────────────────────────

/**
 * Get-or-create this week's synthesised digest. Returns null when there is no
 * cohort to summarise, when the cost brake is engaged, or when the DB is
 * unavailable — callers must fall back (the weekly-email cron falls back to the
 * theme-table path). Never throws for expected-empty conditions; a genuine
 * Claude/DB error propagates so the cron surfaces it.
 */
export async function synthesizeWeeklyIntel(
  opts: SynthesizeOptions = {},
): Promise<WeeklyIntelDigest | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const now = new Date();
  const weekEnd = isoDate(now);
  // Rolling 7-day window ending at run time. `weekStart` doubles as the row PK,
  // so get-or-create dedupes re-runs on the SAME calendar date (the realistic
  // case: the Monday cron + its safety-sweeper both fire the same day). A run
  // on a *different* weekday (manual trigger, cross-midnight retry) computes a
  // different weekStart and mints a fresh row + Sonnet call — an accepted ~cents
  // tradeoff, not an ISO-week guarantee. The cron schedule (Mon 14:00 UTC) is
  // what keeps these landing on Mondays.
  const weekStart = isoDate(new Date(now.getTime() - COHORT_DAYS * 86_400_000));

  // 1. Get-or-create: reuse an existing row for this window unless forced.
  if (!opts.force) {
    const { data: existing } = await supabase
      .from("reddit_intel_weekly_digest")
      .select("*")
      .eq("week_start", weekStart)
      .maybeSingle();
    if (existing) return rowToDigest(existing);
  }

  // 2. Respect the shared reddit-intel cost brake.
  if (await isRedditIntelBraked()) {
    logger.warn("weekly-synthesis: reddit_intel brake engaged — skipping generation");
    return null;
  }

  // 3. This week's cohort. Filter confidence in SQL (not JS after .limit) so
  //    the MAX_COHORT_ROWS cap applies to already-qualified rows — otherwise a
  //    busy week would cap at 500 raw rows then drop low-confidence ones,
  //    shrinking and recency-biasing the sample.
  const { data: cohort, error: cohortErr } = await supabase
    .from("reddit_post_intel")
    .select("intent_label, brands_impersonated, tactic_tags, narrative_summary, confidence")
    .gte("processed_at", `${weekStart}T00:00:00Z`)
    .gte("confidence", MIN_CONFIDENCE)
    .order("processed_at", { ascending: false })
    .limit(MAX_COHORT_ROWS);

  if (cohortErr) throw new Error(`weekly-synthesis cohort fetch: ${cohortErr.message}`);
  const rows = (cohort ?? []) as CohortRow[];
  if (rows.length === 0) {
    logger.info("weekly-synthesis: empty cohort in window — nothing to synthesise", {
      weekStart,
      weekEnd,
    });
    return null;
  }

  // 4-5. Deterministic aggregation + novelty diff against the trailing
  //      baseline (brands/tactics seen in the weeks before this window).
  const baselineStart = isoDate(
    new Date(now.getTime() - (COHORT_DAYS + BASELINE_DAYS) * 86_400_000),
  );
  // Deterministic order so the 5000-row cap (if ever hit) samples the most
  // recent baseline rather than an arbitrary Postgres page order — otherwise a
  // perennial brand could fall outside an unordered sample and be mis-flagged
  // "new this week". At current ~1k rows/28d the cap isn't reached.
  const { data: baseline } = await supabase
    .from("reddit_post_intel")
    .select("brands_impersonated, tactic_tags")
    .gte("processed_at", `${baselineStart}T00:00:00Z`)
    .lt("processed_at", `${weekStart}T00:00:00Z`)
    .order("processed_at", { ascending: false })
    .limit(5000);

  const { catTotals, topBrands, topCategories, novelBrands, novelTactics } =
    aggregateWeeklyCohort(rows, (baseline ?? []) as CohortRow[]);

  // 6. Deterministic scam-of-the-week quote (real extracted quote, never
  //    fabricated). Most recent high-confidence quote in the window.
  const { data: quotes } = await supabase
    .from("reddit_intel_quotes")
    .select("quote_text, speaker_role, confidence")
    .gte("created_at", `${weekStart}T00:00:00Z`)
    .gte("confidence", 0.7)
    .order("created_at", { ascending: false })
    .limit(1);
  const scamOfTheWeek =
    quotes && quotes.length > 0
      ? {
          text: quotes[0].quote_text as string,
          speakerRole: (quotes[0].speaker_role as string) ?? "unknown",
        }
      : null;

  // 7. Synthesis prompt — code-derived facts + this week's narratives.
  const narrativeLines = rows
    .filter((r) => r.narrative_summary)
    .slice(0, MAX_NARRATIVES_IN_PROMPT)
    .map((r, i) => {
      const brands = (r.brands_impersonated ?? []).slice(0, 3).join(", ") || "—";
      return `${i + 1}. [${r.intent_label ?? "other"}] brands:${brands} — ${r.narrative_summary}`;
    })
    .join("\n");

  const userEnvelope = JSON.stringify({
    window: { weekStart, weekEnd, postsAnalysed: rows.length },
    categoryCounts: catTotals,
    topBrandsThisWeek: topBrands,
    firstSeenThisWeek: { brands: novelBrands.slice(0, 20), tactics: novelTactics.slice(0, 20) },
    instructions:
      "Use ONLY the counts and novelty flags provided — do not invent figures. " +
      "Set category to one of the categoryCounts keys. Set noveltySignal='new' " +
      "when the story's brands/tactics are in firstSeenThisWeek, 'rising' when the " +
      "category is prominent and growing, else 'ongoing'.",
  });

  const { result, usage, estimatedCostUsd, modelId } = await callClaudeJson({
    model: MODEL_KEY,
    system: SYSTEM_PROMPT,
    user: `${userEnvelope}\n\nTHIS WEEK'S NARRATIVES:\n${narrativeLines}`,
    schema: SynthOutputSchema,
    // Headroom for a full 5-story tool-use response (~900 tok typical) so a
    // long week can't truncate mid-JSON → schema-parse throw after paying.
    maxTokens: 3000,
    timeoutMs: 60_000,
    useToolUse: true,
    toolName: "submit_weekly_stories",
    userIsTrusted: true, // our own aggregated envelope, not raw external text
    requestId: `weekly-synth-${weekStart}`,
  });

  // 8. Attach the code-derived weekly count. Resolve the model's category to a
  //    real cohort key by a normalised (case/underscore/space-insensitive)
  //    match, so a drifted label like "Romance scam" still maps to the
  //    romance_scam count instead of silently rendering "0 reports this week".
  const normCat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const countByNorm: Record<string, number> = {};
  for (const [label, count] of Object.entries(catTotals)) countByNorm[normCat(label)] = count;

  const stories: WeeklyIntelStory[] = result.stories.map((s, i) => ({
    rank: i + 1,
    title: s.title,
    narrative: s.narrative,
    category: s.category,
    representativeBrands: s.representativeBrands,
    noveltySignal: s.noveltySignal,
    weeklyReportCount: countByNorm[normCat(s.category)] ?? 0,
  }));

  const digest: WeeklyIntelDigest = {
    weekStart,
    weekEnd,
    cohortPostCount: rows.length,
    stories,
    topBrands,
    topCategories,
    novelty: { brands: novelBrands.slice(0, 20), tactics: novelTactics.slice(0, 20) },
    scamOfTheWeek,
    modelVersion: modelId,
    promptVersion: PROMPT_VERSION,
    generatedAt: now.toISOString(),
  };

  // 9. Log cost FIRST (the Claude call already spent money), THEN persist — so a
  //    transient upsert failure can't leave real Sonnet spend invisible to
  //    /admin/costs, the weekly digest, and the reddit_intel brake accounting.
  await supabase.from("cost_telemetry").insert({
    feature: "reddit-intel-weekly-synthesis",
    provider: "anthropic",
    operation: "messages.create",
    units: usage.inputTokens + usage.outputTokens,
    estimated_cost_usd: estimatedCostUsd,
    metadata: {
      model: modelId,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cohort_post_count: rows.length,
      story_count: stories.length,
      novel_brands: novelBrands.length,
      prompt_version: PROMPT_VERSION,
      week_start: weekStart,
    },
  });

  const { error: upsertErr } = await supabase.from("reddit_intel_weekly_digest").upsert(
    {
      week_start: weekStart,
      week_end: weekEnd,
      cohort_post_count: rows.length,
      stories: digest.stories,
      top_brands: topBrands,
      top_categories: topCategories,
      novelty: digest.novelty,
      scam_of_the_week: scamOfTheWeek,
      model_version: modelId,
      prompt_version: PROMPT_VERSION,
      generated_at: now.toISOString(),
    },
    { onConflict: "week_start" },
  );
  if (upsertErr) throw new Error(`weekly-synthesis upsert: ${upsertErr.message}`);

  logger.info("weekly-synthesis: generated digest", {
    weekStart,
    stories: stories.length,
    cohort: rows.length,
    novelBrands: novelBrands.length,
  });

  return digest;
}

// Map a persisted row back to the digest shape (get-or-create reuse path).
function rowToDigest(row: Record<string, unknown>): WeeklyIntelDigest {
  return {
    weekStart: row.week_start as string,
    weekEnd: row.week_end as string,
    cohortPostCount: (row.cohort_post_count as number) ?? 0,
    stories: (row.stories as WeeklyIntelStory[]) ?? [],
    topBrands:
      (row.top_brands as Array<{ brand: string; mentionCount: number }>) ?? [],
    topCategories: (row.top_categories as Array<{ label: string; count: number }>) ?? [],
    novelty: (row.novelty as { brands: string[]; tactics: string[] }) ?? {
      brands: [],
      tactics: [],
    },
    scamOfTheWeek:
      (row.scam_of_the_week as { text: string; speakerRole: string } | null) ?? null,
    modelVersion: (row.model_version as string) ?? "",
    promptVersion: (row.prompt_version as string) ?? "",
    generatedAt: (row.generated_at as string) ?? "",
  };
}

const SYSTEM_PROMPT = `You are an Australian scam intelligence editor for Ask Arthur, a consumer-protection platform. You are given a structured summary of ONE WEEK of scam reports Australians posted to Reddit — deterministic category counts, this week's most-impersonated brands, a "first seen this week" novelty list, and the individual post narratives.

YOUR TASK
Identify the 3-5 most significant scam STORIES that characterise THIS WEEK. Rank them by a blend of volume (how many reports) and novelty (new brands/tactics, or a category clearly rising). Lead with what is genuinely new or accelerating this week — not the perennial background hum.

For each story return:
  title              — a 4-8 word noun-led headline (e.g. "Booking.com lookalike domains target AU travellers"). Concrete, not alarmist, not all-caps.
  narrative          — 1-2 sentences (<=55 words) describing what the scam does and how victims are caught.
  category           — EXACTLY one of the provided categoryCounts keys.
  representativeBrands — up to 3 canonical brand names that recur in this story. Empty array if none.
  noveltySignal      — 'new' if the story's brands/tactics appear in firstSeenThisWeek; 'rising' if its category is prominent and accelerating; otherwise 'ongoing'.

REGISTER
- Australian English (organise, recognise, behaviour).
- Anti-FUD: describe rather than dramatise; quantify before adjective. Match the ACCC Targeting Scams report's neutral tone.
- Use ONLY the counts and novelty flags provided. NEVER invent a statistic, loss figure, or brand not present in the input.
- Prefer stories that are distinct from one another — do not return three variants of the same scam.

Return your response by calling the submit_weekly_stories tool with { stories: [...] }.`;
