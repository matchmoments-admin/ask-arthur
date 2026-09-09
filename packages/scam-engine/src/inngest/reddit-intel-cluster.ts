// Reddit Intelligence — greedy pgvector clustering + theme naming.
//
// Triggered by reddit.intel.embedded.v1. For each newly-embedded post in
// the cohort, finds the nearest existing theme by cosine similarity. If
// similarity ≥ COSINE_THRESHOLD, joins the theme (updates centroid via
// online mean update). Otherwise creates a new theme. Then, in a final
// step, batch-names any themes that have crossed the member_count ≥ 3
// threshold and still lack a real title.
//
// Why greedy + JS-side cosine instead of a SQL RPC:
//   * At ~270 posts/week and ≤50 active themes the compute is trivial
//     (~2M flops per batch).
//   * Stays out of Postgres-stored-procedure-debugging hell.
//   * pgvector strings (`[1.2,3.4,...]`) are easy to parse / serialise.
//
// Threshold history (empirical, BACKLOG.md tracks this as priority watch):
//   * 0.78 (initial) — TOO STRICT. First two prod batches produced 77 themes
//     for 77 clustered posts, biggest theme = 1 member. Naming never fired
//     because no theme reached the ≥3-member threshold.
//   * 0.62 (current, 2026-05-02) — empirical compromise. The composite embed
//     text we use (`category:X | brands:Y | tactic:Z | narrative:...`)
//     varies per-post even when narratives are similar; 0.78 was capturing
//     "near-duplicate" rather than "same scam family". Revisit if either
//     (a) themes start ballooning (member_count >50 each — too loose) or
//     (b) themes still don't form (still 1-1 ratio — try 0.55 or simplify
//         embed text to narrative-only).
//
// Reference points on Voyage 3's distribution:
//   ~0.85+ = near-duplicate text
//   ~0.78  = same scam, possibly different brand
//   ~0.62  = same scam family / category
//   ~0.50  = loosely topical
//   ~0.30  = unrelated
//
// Idempotency: a post is only assigned if reddit_post_intel.theme_id IS
// NULL. Re-firing the same event for the same cohort assigns nothing new.

import { z } from "zod";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  DB_WRITE_CONCURRENCY,
  groupBy,
  mapWithConcurrency,
  type WriteOutcome,
} from "@askarthur/utils/concurrency";
import { featureFlags } from "@askarthur/utils/feature-flags";

import { inngest } from "./client";
import {
  REDDIT_INTEL_EMBEDDED_EVENT,
  REDDIT_INTEL_THEMES_RECOMPUTED_EVENT,
  resolveRedditIntelEmbeddedData,
} from "./events";
import { callClaudeJson } from "../anthropic";
import {
  logFunctionError,
  isRedditIntelBraked,
} from "./reddit-intel-error-log";
import { budgetedStep, type BudgetClock } from "./step-budget";
import { withAxiomLogging } from "./with-axiom-logging";

const COSINE_THRESHOLD = 0.62;

/**
 * Resolve the join threshold, overridable via REDDIT_INTEL_CLUSTER_THRESHOLD.
 *
 * The default is deliberately UNCHANGED at 0.62. A threshold sweep against
 * prod (2026-09-04, 2,193 posts replayed from zero themes at 0.62 / 0.82 /
 * 0.85 / 0.88 / 0.90) shows this number has no setting that is simply
 * "correct" — it trades one failure mode for the other:
 *
 *     thr    themes   largest theme   singletons   nameable (>=3)
 *     0.62        9           11.4%         0.0%         9
 *     0.82      135           11.4%        68.9%        29
 *     0.85      355           11.4%        77.7%        55
 *     0.88      944            4.9%        81.9%        84
 *     0.90    1,446            2.6%        88.2%        81
 *
 * At today's 0.62 a fresh run produces NINE themes for two months of posts,
 * which is why nothing has been born since July — the collapse is inherent to
 * the number, not a legacy artefact. But every raised value trades that for a
 * majority-singleton corpus, which is the 1:1 theme:post failure that caused
 * the 0.78 -> 0.62 lowering in May 2026 in the first place.
 *
 * Raising it is therefore a product decision (are singletons noise, or are
 * they the "nobody has reported this before" signal?), not a bug fix, and it
 * wants the offline rebuild that goes with it. Making it an env var means that
 * decision can be trialled on a preview deployment without a code change.
 */
export function resolveClusterThreshold(): number {
  const raw = (process.env["REDDIT_INTEL_CLUSTER_THRESHOLD"] ?? "").trim();
  if (!raw) return COSINE_THRESHOLD;
  const parsed = Number(raw);
  // Reject anything outside the range where cosine on this embedding space
  // means anything: the observed floor for a genuine match is ~0.75 and 1.0
  // would seed a new theme for every post. A typo must not silently disable
  // clustering, so fall back rather than trust it.
  if (!Number.isFinite(parsed) || parsed <= 0.5 || parsed >= 0.99) {
    return COSINE_THRESHOLD;
  }
  return parsed;
}
const MIN_MEMBERS_FOR_NAMING = 3;
const NAMING_PROMPT_VERSION = "reddit-cluster-naming-v1@2026-05-01";

// ── Anti-runaway guards (2026-07-12 fleet review — the mega-theme collapse) ─
// Failure mode caught by the operational review: greedy assignment + an
// unbounded online-mean centroid degenerates into ONE runaway attractor.
// A theme's centroid is the mean of its members; as it absorbs hundreds of
// heterogeneous posts that mean converges on the *global* embedding mean, which
// nearly every new post scores >COSINE_THRESHOLD against — so one theme ate
// 2263 posts (89% of the corpus) and no new themes formed for 70 days, while
// the Sonnet naming call silently stopped firing (no cost signal → invisible).
//
// Two independent structural guards prevent recurrence:
//   * CENTROID_FREEZE_AT — stop updating a theme's centroid past this many
//     members. The centroid stays representative of the theme's cohesive core
//     instead of drifting toward the global mean. This kills the *formation*
//     of an attractor.
//   * MAX_THEME_MEMBERS_FOR_JOIN — a theme this large is no longer a valid
//     match target; a post that would have joined it re-seeds instead. This
//     contains an *already-drifted* theme (e.g. the existing 2263-member blob)
//     so it can't keep absorbing before the historical rebuild runs.
const CENTROID_FREEZE_AT = 50;
const MAX_THEME_MEMBERS_FOR_JOIN = 250;

// ── Vector helpers ────────────────────────────────────────────────────────

/**
 * Parse pgvector's `[1.234,5.678,...]` wire form.
 *
 * Returns null for anything that is not a usable vector, INCLUDING a string
 * that parses to the right shape but the wrong numbers. The previous version
 * was `inner.split(",").map(Number)` with no validation, and every malformed
 * input survived it as a non-empty array:
 *
 *   "[abc,def]"  -> [NaN, NaN]   length 2, passes a `.length > 0` filter
 *   "[]"         -> [0]          Number("") is 0, not NaN
 *
 * Both then poison the caller silently rather than failing. A NaN embedding
 * makes every `sim > bestSim` comparison false — NaN compares false against
 * everything — so the post matches no theme, takes the seed branch, and writes
 * a centroid of `[NaN,NaN,...]` that pgvector rejects on insert. The insert
 * error is caught, warned, and `continue`d, so the post is skipped on that run
 * and on every run after it. The failure presents as an unexplained orphan,
 * three steps from its cause.
 */
function parsePgVector(s: string | null): number[] | null {
  if (!s) return null;
  const inner = s.startsWith("[") ? s.slice(1, -1) : s;
  if (inner.trim() === "") return null;
  const parsed = inner.split(",").map(Number);
  // Reject rather than propagate: a wrong vector is worse than a missing one,
  // because the caller counts a missing one.
  if (!parsed.every(Number.isFinite)) return null;
  return parsed;
}

function vectorToPgString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Online centroid update: keeps a running mean as members are added one by
// one without storing every member vector. Bounded floating-point drift
// — at most ~1e-10 over thousands of additions, well below the 0.78 cosine
// threshold's noise floor.
function updateCentroid(
  oldCentroid: number[],
  oldMemberCount: number,
  newVector: number[],
): number[] {
  const next = new Array(oldCentroid.length);
  for (let i = 0; i < oldCentroid.length; i++) {
    next[i] =
      (oldCentroid[i] * oldMemberCount + newVector[i]) / (oldMemberCount + 1);
  }
  return next;
}

// ── Slug generation ───────────────────────────────────────────────────────
//
// Slugs are stable URL handles. Title comes from Sonnet later; until naming
// runs, we use a placeholder slug `auto-<random>` that the naming step
// rewrites to the kebab-cased title + 4-char random suffix.

function randomSuffix(len = 4): string {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len);
}

function kebabSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    randomSuffix(4)
  );
}

// ── Naming via Sonnet (only fires when ≥1 theme needs naming) ────────────

const NAMING_SYSTEM_PROMPT = `You are an Australian scam intelligence editor. You are given a batch of newly formed scam-narrative theme clusters from Reddit posts. For each cluster, produce:
  - title: a 4-8 word headline that captures the unifying scam pattern. Concrete and noun-led (e.g. "Booking.com lookalike domains targeting AU travellers"). NOT alarmist or all-caps.
  - narrative: 1-2 sentences (≤60 words total) describing what the scam does and how victims are caught.
  - modusOperandi: a one-line technical summary of the mechanism (e.g. "Search-ad clones with payment-page credential capture").
  - representativeBrands: array of up to 3 canonical brand names that recur across the cluster's posts. Empty array if no brand impersonation.

Australian English. Anti-FUD register — describe rather than dramatise. Match the tone of ACCC's Targeting Scams report.

Return a JSON object: { themes: [{ themeId, title, narrative, modusOperandi, representativeBrands }] }. Match the input themeIds exactly — do not invent or omit any.`;

const NamedThemeSchema = z.object({
  themeId: z.string().uuid(),
  title: z.string().min(4).max(120),
  narrative: z.string().min(10).max(400),
  modusOperandi: z.string().max(200).nullish(),
  representativeBrands: z.array(z.string().max(80)).max(3).default([]),
});

const NamingOutputSchema = z.object({
  themes: z.array(NamedThemeSchema),
});

// ── Cost telemetry ────────────────────────────────────────────────────────

async function logNamingCost(args: {
  estimatedCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  themeCount: number;
}) {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase.from("cost_telemetry").insert({
    feature: "reddit-intel-name-themes",
    provider: "anthropic",
    operation: "messages.create",
    units: args.inputTokens + args.outputTokens,
    estimated_cost_usd: args.estimatedCostUsd,
    metadata: {
      model: args.modelId,
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
      theme_count: args.themeCount,
      prompt_version: NAMING_PROMPT_VERSION,
    },
  });
}

// ── The function ──────────────────────────────────────────────────────────

interface NewPost {
  id: string;
  embedding: number[];
  /** The model that produced `embedding` (e.g. 'voyage-3.5'). Becomes the
   *  centroid_embedding_model_version on the theme this post lands in. May
   *  be null for legacy rows embedded before migration v86; treat as 'voyage-3'
   *  by convention but don't blindly tag — leave null so the next post in the
   *  theme can stamp it correctly. */
  embeddingModelVersion: string | null;
}

interface ActiveTheme {
  id: string;
  centroid: number[];
  memberCount: number;
}

export interface Assignment {
  postId: string;
  themeId: string;
  similarity: number;
  newCentroid: number[];
  newMemberCount: number;
  isNewTheme: boolean;
  /** Model version that produced the post's embedding. Tagged onto the
   *  centroid via centroid_embedding_model_version so a future model rollout
   *  can detect mixed-model centroids and trigger re-embed. */
  embeddingModelVersion: string | null;
}

export interface AssignOptions {
  threshold?: number;
  /** Themes at/above this member_count stop being valid match targets. */
  joinCeiling?: number;
  /** Centroid stops updating once a theme reaches this many members. */
  freezeAt?: number;
}

/**
 * Greedy nearest-centroid assignment of a cohort's posts to existing themes,
 * pure and side-effect-free so it can be unit-tested against the collapse.
 *
 * Guards (see CENTROID_FREEZE_AT / MAX_THEME_MEMBERS_FOR_JOIN above):
 *   1. A theme whose member_count ≥ joinCeiling is skipped as a match target,
 *      so an over-large (already-drifted) theme cannot keep absorbing.
 *   2. A matched theme's centroid is frozen once member_count ≥ freezeAt, so
 *      the running mean cannot drift toward the global mean and become an
 *      attractor.
 *
 * Does NOT mutate the caller's `themes` array (works on a shallow copy).
 * Returns the assignments plus `oversizedThemeCount` (themes at/over the join
 * ceiling encountered this run) as a health signal for the caller's alarm.
 */
export function assignPostsToThemes(
  posts: NewPost[],
  themes: ActiveTheme[],
  opts: AssignOptions = {},
): { assignments: Assignment[]; oversizedThemeCount: number } {
  // resolveClusterThreshold(), not the raw constant: otherwise the env
  // override is honoured only on the one path that happens to pass it
  // explicitly, and every other caller — including every test — silently
  // clusters at 0.62 while the operator believes they changed it. One number,
  // one resolver.
  const threshold = opts.threshold ?? resolveClusterThreshold();
  const joinCeiling = opts.joinCeiling ?? MAX_THEME_MEMBERS_FOR_JOIN;
  const freezeAt = opts.freezeAt ?? CENTROID_FREEZE_AT;

  const working: ActiveTheme[] = themes.map((t) => ({ ...t }));
  const oversized = new Set<string>();
  const assignments: Assignment[] = [];

  for (const post of posts) {
    let bestThemeIdx = -1;
    let bestSim = threshold; // only similarities strictly above threshold count

    for (let i = 0; i < working.length; i++) {
      if (working[i].memberCount >= joinCeiling) {
        oversized.add(working[i].id); // anti-runaway: not a valid target
        continue;
      }
      const sim = cosineSimilarity(post.embedding, working[i].centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestThemeIdx = i;
      }
    }

    if (bestThemeIdx >= 0) {
      const t = working[bestThemeIdx];
      // Freeze the centroid past freezeAt so it stays representative of the
      // theme's cohesive core rather than drifting toward the global mean.
      const newCentroid =
        t.memberCount >= freezeAt
          ? t.centroid
          : updateCentroid(t.centroid, t.memberCount, post.embedding);
      const newMemberCount = t.memberCount + 1;
      working[bestThemeIdx] = {
        ...t,
        centroid: newCentroid,
        memberCount: newMemberCount,
      };
      assignments.push({
        postId: post.id,
        themeId: t.id,
        similarity: bestSim,
        newCentroid,
        newMemberCount,
        isNewTheme: false,
        embeddingModelVersion: post.embeddingModelVersion,
      });
    } else {
      // No match → seed a new theme with this post as the centroid. themeId is
      // filled in during the persist step. (We intentionally do NOT push the
      // seed into `working` for in-batch matching — see the #520 H5 note in the
      // handler: a "<pending>" id could be written as a bogus FK target.)
      assignments.push({
        postId: post.id,
        themeId: "",
        similarity: 1.0,
        newCentroid: post.embedding.slice(),
        newMemberCount: 1,
        isNewTheme: true,
        embeddingModelVersion: post.embeddingModelVersion,
      });
    }
  }

  return { assignments, oversizedThemeCount: oversized.size };
}

/**
 * Posts considered per run.
 *
 * Unlike the embed stage there is no provider call here — clustering is
 * greedy cosine matching in memory — so the ceiling is the step's own
 * runtime and the Inngest slot it holds, not an API quota. 500 was the
 * existing value and stays: it comfortably covers the ~40 posts/day steady
 * state, and a larger backlog now drains across runs instead of being
 * invisible forever.
 */
const CLUSTER_POSTS_PER_RUN = 500;

/**
 * Internals exposed for tests only. parsePgVector's rejection behaviour is the
 * difference between a dropped row and a poisoned centroid, and it had no test.
 */
export const __testing = { parsePgVector, vectorToPgString, cosineSimilarity };

/**
 * In-step wall-clock budgets, in milliseconds. Both are bounded by the route's
 * `maxDuration`, NOT by `timeouts.finish` — see ./step-budget.ts for the two
 * bounds and why an in-step budget can only be obtained from budgetedStep.
 *
 * CLUSTER_BATCH covers load + match + write as ONE step (#1117: vectors must
 * not cross a step boundary — 4 MB output cap). Exceeding maxDuration is not a
 * slow run: Vercel kills the request and the retry redoes identical work and
 * dies identically (2026-09-07: at 0.87 s/post a 500-post batch needed ~435 s
 * against 300 s). The write phase checks the budget per item and stops; the
 * worklist is self-healing (theme_id stays NULL, #1105), so stopping early is
 * partial progress, not loss.
 *
 * Until this constant existed the 240 s clock started INSIDE
 * persistAssignments — after the load and the match — so the real headroom
 * was 300 − (load + match) − 240, which can be negative. It now starts at step
 * entry, by construction, and the summary reports how much was left.
 *
 * NAMING covers the sample selects, the Sonnet call and the title updates,
 * which were unbudgeted: sequential per-row awaits inside a step convert row
 * count directly into slot-seconds (ADR-0019). The model call is dispatched
 * only with NAMING_MODEL_TIMEOUT_MS still in hand.
 *
 * The 0.8 share is enforced at runtime by budgetedStep (throws above the
 * ceiling) and at test time by apps/web/__tests__/inngestMaxDurationDrift,
 * which reads the route's literal. inngestFinishBudgets.test.ts sums these
 * into the finish-timeout floor, which is why they carry the _WALL_CLOCK_MS
 * suffix and live in this file rather than in the Module.
 */
export const CLUSTER_BATCH_WALL_CLOCK_MS = 240_000;
export const NAMING_WALL_CLOCK_MS = 240_000;
const NAMING_MODEL_TIMEOUT_MS = 60_000;

/**
 * A Write Outcome (per-POST units) plus what the clustering write phase knows
 * about WHY. `failed` is the sum of the three named partitions below; the
 * invariant `attempted − written − failed = posts never reached` holds, and is
 * non-zero only when `deadlineHit`.
 */
export interface PersistResult extends WriteOutcome {
  newThemeCount: number;
  joinedThemeCount: number;
  /** Posts dropped because their seed theme could not be created OR adopted. */
  seedFailures: number;
  /** Posts dropped because the matched theme's centroid update failed. */
  joinFailures: number;
  /** Posts whose theme was written but whose own theme_id update failed. */
  linkFailures: number;
  /**
   * Milliseconds left on the step's budget when the write phase returned — how
   * close the run came. A run that finishes with 2 s to spare is one slow
   * query away from the 504, and nothing else in the summary would say so.
   */
  budgetRemainingMs: number;
}

/**
 * Write one run's assignments: seed or adopt themes, link posts, record
 * membership.
 *
 * SET-BASED ON PURPOSE. The first version did roughly three sequential round
 * trips per post — at 500 posts that is ~1,500 serialised queries, 30-45s of
 * wall time. Since #1117 all of that happens inside ONE step, and an Inngest
 * step holds a concurrency slot for its whole duration. The production account
 * runs on a 5-slot free pool and was measured at 5/5 in use on 2026-09-07
 * (ADR-0019), so slot-SECONDS, not query count, is the scarce resource. A long
 * inline step is the documented cause of the earlier fleet-wide slot crunch.
 *
 * Round trips are now bounded by the number of distinct THEMES touched, not by
 * the number of posts:
 *
 *     1  read back already-linked posts (retry guard)
 *     2  bulk-upsert seed themes, then resolve their ids by slug
 *     N  centroid/member_count updates  (N = distinct themes joined)
 *     M  post->theme links, grouped     (M = distinct themes assigned)
 *     1  bulk membership insert
 *
 * N and M are typically one to two orders of magnitude below the post count,
 * and the update waves run with bounded parallelism.
 *
 * The INTERFACE is deliberately unchanged from the per-row version — same
 * arguments, same PersistResult, same counters — so callers, the run summary
 * and the existing tests all still hold. That is the point of having extracted
 * it in #1115: the round-trip strategy is an implementation detail with one
 * home.
 *
 * It also no longer mutates the caller's assignments. The old version wrote
 * `a.themeId = created.id` back into the input array without saying so, while
 * its sibling assignPostsToThemes has an explicit no-mutation test. Resolved
 * ids are held in a local map instead.
 */
export async function persistAssignments(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  assignments: Assignment[],
  /**
   * The enclosing step's budget — obtained from budgetedStep by the caller,
   * never invented here. The previous default parameter started the clock at
   * this function's entry, which is after the load and the match.
   */
  budget: BudgetClock,
): Promise<PersistResult> {
  let deadlineHit = false;
  const outOfTime = () => {
    if (!budget.expired()) return false;
    deadlineHit = true;
    return true;
  };
  let seedFailures = 0;
  let joinFailures = 0;
  let linkFailures = 0;

  if (assignments.length === 0) {
    return {
      attempted: 0,
      written: 0,
      failed: 0,
      newThemeCount: 0,
      joinedThemeCount: 0,
      seedFailures,
      joinFailures,
      linkFailures,
      deadlineHit,
      budgetRemainingMs: budget.remainingMs(),
    };
  }

  // Idempotency guard (#520 H5): Inngest retries the WHOLE step, and the
  // matching above is recomputed deterministically. A prior partial run may
  // already have linked some posts; skip those so a retry does not re-seed.
  const alreadyLinked = await supabase
    .from("reddit_post_intel")
    .select("id, theme_id")
    .in(
      "id",
      assignments.map((a) => a.postId),
    );
  const donePostIds = new Set(
    (alreadyLinked.data ?? [])
      .filter((r) => r.theme_id)
      .map((r) => r.id as string),
  );

  const pending = assignments.filter((a) => !donePostIds.has(a.postId));
  if (pending.length === 0) {
    return {
      attempted: 0,
      written: 0,
      failed: 0,
      newThemeCount: 0,
      joinedThemeCount: 0,
      seedFailures,
      joinFailures,
      linkFailures,
      deadlineHit,
      budgetRemainingMs: budget.remainingMs(),
    };
  }

  const seeds = pending.filter((a) => a.isNewTheme);
  const joins = pending.filter((a) => !a.isNewTheme);

  // ── Seeds ────────────────────────────────────────────────────────────────
  // The slug is deterministic (auto-<postId>) and reddit_intel_themes_slug_key
  // is UNIQUE, so a retry after a partial run WILL collide. ignoreDuplicates
  // means ON CONFLICT DO NOTHING — never overwrite, because by the time a retry
  // lands the theme may have gained members and been named, and resetting a
  // named 50-member theme to "Pending naming"/1 is far worse than the orphan
  // this avoids. The follow-up select then resolves ids for BOTH the rows just
  // inserted and the ones a prior attempt left behind, so adoption needs no
  // special case.
  const themeIdByPost = new Map<string, string>();
  let newThemeCount = 0;

  if (seeds.length > 0) {
    const now = new Date().toISOString();
    const { error: seedErr } = await supabase
      .from("reddit_intel_themes")
      .upsert(
        seeds.map((a) => ({
          slug: `auto-${a.postId}`,
          title: "Pending naming",
          centroid_embedding: vectorToPgString(a.newCentroid),
          centroid_embedding_model_version: a.embeddingModelVersion,
          member_count: 1,
          first_seen_at: now,
          last_seen_at: now,
          signal_strength: "weak",
          is_active: true,
        })),
        { onConflict: "slug", ignoreDuplicates: true },
      );
    if (seedErr) {
      logger.warn("cluster: seed theme bulk upsert failed", {
        error: seedErr.message,
        seeds: seeds.length,
      });
    }

    const slugs = seeds.map((a) => `auto-${a.postId}`);
    const { data: resolved, error: resolveErr } = await supabase
      .from("reddit_intel_themes")
      .select("id, slug")
      .in("slug", slugs);
    if (resolveErr) {
      logger.warn("cluster: seed theme id resolution failed", {
        error: resolveErr.message,
      });
    }
    const idBySlug = new Map(
      (resolved ?? []).map((r) => [r.slug as string, r.id as string]),
    );
    for (const a of seeds) {
      const id = idBySlug.get(`auto-${a.postId}`);
      // Unresolved means the row is neither newly inserted nor already there:
      // count it rather than letting the post vanish from the tallies.
      if (!id) {
        seedFailures++;
        continue;
      }
      themeIdByPost.set(a.postId, id);
      newThemeCount++;
    }
  }

  // ── Joins: one centroid update per distinct theme ────────────────────────
  // assignPostsToThemes walks posts in order and carries newMemberCount
  // forward, so for a theme joined k times in this batch the LAST assignment
  // holds the final centroid and count. Applying only that one is both correct
  // and k-1 fewer round trips.
  const joinsByTheme = groupBy(joins, (a) => a.themeId);

  let joinedThemeCount = 0;
  await mapWithConcurrency(
    [...joinsByTheme.entries()],
    DB_WRITE_CONCURRENCY,
    async ([themeId, themeJoins]) => {
      // Checked per item rather than per wave: a wave is only as short as its
      // slowest member, and abandoning work already in flight would waste it.
      // Items skipped here keep theme_id NULL and return in the next run.
      if (outOfTime()) return;
      const last = themeJoins[themeJoins.length - 1]!;
      const { error } = await supabase
        .from("reddit_intel_themes")
        .update({
          centroid_embedding: vectorToPgString(last.newCentroid),
          centroid_embedding_model_version: last.embeddingModelVersion,
          member_count: last.newMemberCount,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", themeId);
      if (error) {
        logger.warn("cluster: theme update failed", {
          themeId,
          posts: themeJoins.length,
          error: error.message,
        });
        // Per POST, like the other two counters. This was `joinFailures++` —
        // one per theme — so a theme absorbing 40 posts that failed its
        // centroid update read as a single dropped post in the run summary.
        joinFailures += themeJoins.length;
        return;
      }
      for (const j of themeJoins) themeIdByPost.set(j.postId, themeId);
      joinedThemeCount++;
    },
  );

  // ── Post -> theme links, grouped by theme ────────────────────────────────
  const postsByTheme = groupBy(
    [...themeIdByPost.keys()],
    (postId) => themeIdByPost.get(postId)!,
  );

  const linkedPostIds: string[] = [];
  await mapWithConcurrency(
    [...postsByTheme.entries()],
    DB_WRITE_CONCURRENCY,
    async ([themeId, postIds]) => {
      if (outOfTime()) return;
      const { error } = await supabase
        .from("reddit_post_intel")
        .update({ theme_id: themeId })
        .in("id", postIds);
      if (error) {
        logger.warn("cluster: post theme_id update failed", {
          themeId,
          posts: postIds.length,
          error: error.message,
        });
        linkFailures += postIds.length;
        return;
      }
      linkedPostIds.push(...postIds);
    },
  );

  // ── Membership rows, one bulk insert ─────────────────────────────────────
  // Only for posts whose link actually landed, so membership never claims a
  // relationship the post row does not carry. PK is (intel_id, theme_id), so a
  // retry collides harmlessly — ignoreDuplicates rather than a failed batch.
  if (linkedPostIds.length > 0) {
    const linked = new Set(linkedPostIds);
    const simByPost = new Map(pending.map((a) => [a.postId, a.similarity]));
    const rows = linkedPostIds.map((postId) => ({
      intel_id: postId,
      theme_id: themeIdByPost.get(postId)!,
      similarity: Math.min(1, Math.max(0, simByPost.get(postId) ?? 0)),
      is_primary: true,
    }));
    const { error: memErr } = await supabase
      .from("reddit_post_intel_themes")
      .upsert(rows, {
        onConflict: "intel_id,theme_id",
        ignoreDuplicates: true,
      });
    if (memErr) {
      logger.warn("cluster: membership bulk insert failed", {
        error: memErr.message,
        rows: rows.length,
        linked: linked.size,
      });
    }
  }

  return {
    attempted: pending.length,
    written: linkedPostIds.length,
    failed: seedFailures + joinFailures + linkFailures,
    newThemeCount,
    joinedThemeCount,
    seedFailures,
    joinFailures,
    linkFailures,
    deadlineHit,
    budgetRemainingMs: budget.remainingMs(),
  };
}

export const redditIntelCluster = inngest.createFunction(
  {
    id: "reddit-intel-cluster",
    name: "Reddit Intel: Greedy theme clustering + naming",
    retries: 3,
    // Greedy assignment is STATEFUL and order-dependent — each run reads the
    // theme table, assigns in-memory, then writes centroids/member_counts back.
    // Two overlapping runs would read the same pre-write theme state and race
    // (double-seeding themes, clobbering centroids). Normal operation fires one
    // cohort/day so overlap never happens; this ceiling makes a *replay* — the
    // historical rebuild (docs/ops/reddit-intel-theme-rebuild.md) firing many
    // cohort events — serialize correctly instead of racing. Cluster runs are
    // infrequent, so limit:1 costs nothing in the steady state.
    concurrency: { limit: 1 },
    // ADR-0019's circuit breaker. Until #1130 this function had none, so with
    // retries: 3 a hung run could hold its slot for three attempts.
    //
    // inngest-finish-budget: 7 boundaries — 7 static step.run sites × 30 s
    // queue wait = 210 s; inline 240 s cluster-batch + 240 s
    // name-pending-themes = 480 s; 60 s slack = 750 s. Declared 13m (780 s).
    // Raising either _WALL_CLOCK_MS without raising this goes red in
    // inngestFinishBudgets.test.ts. retries: 3 sits outside the formula —
    // acceptable because cluster-batch is idempotent (#520 H5) and the
    // worklist self-heals, so a cancelled run's remainder is picked up next
    // tick.
    timeouts: { finish: "13m" },
  },
  // Dual trigger, same reasoning as reddit-intel-embed: the event keeps the
  // chain responsive, the cron guarantees the backlog drains even when no
  // upstream stage produced anything. Safe at any cadence because the worklist
  // (`theme_id IS NULL AND embedding IS NOT NULL`) reads back over no time
  // window — ADR-0019's condition for widening a cron freely.
  //
  // 20 minutes after the embed sweep so anything that sweep writes is
  // clusterable on the same cycle rather than waiting six hours.
  [{ cron: "45 2,8,14,20 * * *" }, { event: REDDIT_INTEL_EMBEDDED_EVENT }],
  withAxiomLogging(
    { fnId: "reddit-intel-cluster" },
    async ({ event, step }) => {
      if (!featureFlags.redditIntelIngest) {
        return { skipped: true, reason: "redditIntelIngest flag off" };
      }

      const braked = await step.run("check-cost-brake", isRedditIntelBraked);
      if (braked) {
        return { paused: true, reason: "feature_brakes.reddit_intel is set" };
      }

      // Inline (not a step.run): pure deterministic Zod parse, free to re-run on
      // retry — memoising it as a durable step only cost an Inngest execution.
      //
      // Shape-discriminated, NOT truthiness-discriminated: a cron tick arrives
      // with Inngest's own `data: { cron: "..." }`, which is truthy. See the
      // resolver's docblock in events.ts.
      const data = resolveRedditIntelEmbeddedData(event?.data);

      // ── Step 1: load unassigned embedded posts + themes ──────────────────
      const batch = await budgetedStep(
        step,
        "cluster-batch",
        CLUSTER_BATCH_WALL_CLOCK_MS,
        async (budget) => {
          const supabase = createServiceClient();
          if (!supabase) throw new Error("Supabase service client unavailable");

          // NOT scoped to this event's cohort — the same correction made one
          // stage upstream in reddit-intel-embed, for the same reason.
          //
          // `theme_id IS NULL AND embedding IS NOT NULL` IS the worklist: it
          // describes rows that need clustering. Adding a processed_at window
          // made it describe rows belonging to whichever event fired, and no
          // other job anywhere looks for unclustered posts — so a row that
          // missed its window was orphaned permanently.
          //
          // Measured: after the embedding backlog was drained, 976 rows had a
          // valid 1024-dim vector and still no theme, and no future run would
          // ever have considered them. Fixing the embed stage alone produced a
          // pipeline that looked healthier than it was.
          //
          // Third instance of one pattern in this pipeline — classify, embed,
          // cluster each keyed on the triggering event rather than the work
          // outstanding. CLAUDE.md's clone-watch v224 lesson, one stage at a
          // time.
          //
          // Oldest first so a backlog drains in arrival order rather than
          // starving behind new posts.
          const { data: postRows, error: postErr } = await supabase
            .from("reddit_post_intel")
            .select("id, embedding, embedding_model_version")
            .is("theme_id", null)
            .not("embedding", "is", null)
            .order("processed_at", { ascending: true })
            .limit(CLUSTER_POSTS_PER_RUN);

          if (postErr) throw new Error(`load posts: ${postErr.message}`);

          // Deliberately NOT filtered on is_active. v300 ages a theme out after
          // 90 quiet days, and is_active gates the B2B API and the RAG
          // retrieval — it is a VISIBILITY state. Using it here too would make
          // deactivation one-way and self-fulfilling: a dormant theme could
          // never be matched, so its last_seen_at could never advance, so
          // v300's reactivation branch could never fire. A campaign resurging
          // in month four would seed a duplicate theme from scratch and orphan
          // its own history, and the corpus would accumulate duplicates
          // indefinitely. Matching against a dormant theme and reviving it is
          // the entire point of tracking themes over time.
          const { data: themeRows, error: themeErr } = await supabase
            .from("reddit_intel_themes")
            .select("id, centroid_embedding, member_count")
            .not("centroid_embedding", "is", null)
            .limit(500);

          if (themeErr) throw new Error(`load themes: ${themeErr.message}`);

          const posts: NewPost[] = (postRows ?? [])
            .map((r) => ({
              id: r.id as string,
              embedding: parsePgVector(r.embedding as string | null) ?? [],
              embeddingModelVersion:
                (r.embedding_model_version as string | null) ?? null,
            }))
            .filter((p) => p.embedding.length > 0);

          // A row the DB worklist counted (embedding IS NOT NULL) but that did
          // not survive parsing is invisible everywhere else: it stays in the
          // worklist forever and is silently absent from this run. Count it so
          // the summary can say so — see the run summary at the end of the fn.
          const droppedPosts = (postRows ?? []).length - posts.length;

          const themes: ActiveTheme[] = (themeRows ?? [])
            .map((r) => ({
              id: r.id as string,
              centroid:
                parsePgVector(r.centroid_embedding as string | null) ?? [],
              memberCount: (r.member_count as number) ?? 0,
            }))
            .filter((t) => t.centroid.length > 0);
          const droppedThemes = (themeRows ?? []).length - themes.length;

          if (droppedPosts > 0 || droppedThemes > 0) {
            // warn, not info: INFO is sampled at 10% in Axiom, and this is a
            // rare high-value event that must not be sampled away.
            logger.warn("cluster: rows dropped as unparseable", {
              droppedPosts,
              droppedThemes,
            });
          }

          // ── Assign + persist, INSIDE this step ───────────────────────────
          //
          // The load, the match and the write are one step ON PURPOSE. Each post
          // and each theme carries a 1024-dimension vector, and a step's return
          // value is serialised and durably stored by Inngest — so returning
          // `{ posts, themes }` across the boundary meant ~19.5 MB against a 4 MB
          // step-output limit, and the function failed `output_too_large` on
          // every run (prod, 2026-09-06/07), growing the backlog it exists to
          // drain.
          //
          // Note the ceiling this hit is NOT a function of the batch size alone:
          // 200 themes x 1024 dims is already ~3.9 MB, so the split-step shape
          // could never have survived theme growth regardless. Vectors are an
          // implementation detail of clustering and must not cross a step
          // boundary. Only scalars are returned below.
          //
          // Merging also cuts three step-runs per invocation to one, which
          // matters against the Inngest step-run budget (ADR-0019).
          if (posts.length === 0) {
            return {
              postsConsidered: 0,
              droppedPosts,
              droppedThemes,
              threshold: resolveClusterThreshold(),
              oversizedThemeCount: 0,
              newThemeSeeds: 0,
              distinctJoinedThemes: 0,
              newThemeCount: 0,
              joinedThemeCount: 0,
              attempted: 0,
              written: 0,
              failed: 0,
              seedFailures: 0,
              joinFailures: 0,
              linkFailures: 0,
              deadlineHit: false,
              budgetRemainingMs: budget.remainingMs(),
            };
          }

          // Pure and unit-tested (reddit-intel-cluster.assign.test.ts); the
          // anti-runaway guards live inside it so the collapse is reproducible
          // without a DB. It resolves the threshold itself — read here only to
          // report it in the run summary.
          const { assignments, oversizedThemeCount } = assignPostsToThemes(
            posts,
            themes,
          );
          const persisted = await persistAssignments(
            supabase,
            assignments,
            budget,
          );

          return {
            postsConsidered: posts.length,
            droppedPosts,
            droppedThemes,
            threshold: resolveClusterThreshold(),
            oversizedThemeCount,
            newThemeSeeds: assignments.filter((a) => a.isNewTheme).length,
            distinctJoinedThemes: new Set(
              assignments.filter((a) => !a.isNewTheme).map((a) => a.themeId),
            ).size,
            ...persisted,
          };
        },
      );

      if (batch.postsConsidered === 0) {
        logger.info("reddit-intel-cluster: nothing to cluster", {
          cohortDate: data.cohortDate,
        });
        return { skipped: true, reason: "no_unassigned_posts" };
      }

      // Health alarms (always-ship .warn, bypasses INFO sampling). These read
      // scalars off the batch rather than the assignment array, because the
      // array holds vectors and never leaves the step.
      //
      // Collapse signature: a cohort of real size that produced no new themes
      // AND landed every joined post in a SINGLE theme (the 2026-07-12
      // fleet-review lesson) — page rather than silently persist.
      if (
        batch.postsConsidered >= 10 &&
        batch.newThemeSeeds === 0 &&
        batch.distinctJoinedThemes <= 1
      ) {
        logger.warn(
          "reddit-intel-cluster: single-attractor collapse signature",
          {
            cohortDate: data.cohortDate,
            postsConsidered: batch.postsConsidered,
            distinctJoinedThemes: batch.distinctJoinedThemes,
            newThemeSeeds: batch.newThemeSeeds,
            hint: "all posts joined one theme and none re-seeded — check centroid drift / rebuild the runaway theme",
          },
        );
      }
      if (batch.oversizedThemeCount > 0) {
        logger.warn(
          "reddit-intel-cluster: themes over member ceiling contained",
          {
            cohortDate: data.cohortDate,
            oversizedThemeCount: batch.oversizedThemeCount,
            ceiling: MAX_THEME_MEMBERS_FOR_JOIN,
            hint: "an over-large theme was skipped as a match target — historical rebuild recommended",
          },
        );
      }

      // ── Step 4: name themes that have just crossed MIN_MEMBERS_FOR_NAMING ─
      // Only themes where member_count ≥ 3 AND title still 'Pending naming'.
      // Skipping naming when there are no candidates avoids a wasted Sonnet call.

      const namingResult = await budgetedStep(
        step,
        "name-pending-themes",
        NAMING_WALL_CLOCK_MS,
        async (budget) => {
          const supabase = createServiceClient();
          if (!supabase) throw new Error("Supabase service client unavailable");

          const { data: pending, error: pendErr } = await supabase
            .from("reddit_intel_themes")
            .select("id, member_count")
            .eq("title", "Pending naming")
            .gte("member_count", MIN_MEMBERS_FOR_NAMING)
            // Ordered, because .limit() without .order() lets PostgREST return
            // an arbitrary 20. Harmless while the eligible set is smaller than
            // the limit; undefined drain order the moment it is not. Largest
            // first: the themes most worth naming are the ones with most members.
            .order("member_count", { ascending: false })
            .limit(20);

          if (pendErr) throw new Error(`pending themes: ${pendErr.message}`);
          if (!pending || pending.length === 0) {
            return { named: 0, deadlineHit: false };
          }

          const themeIds = pending.map((t) => t.id as string);

          // For each pending theme, fetch up to 5 sample post intel rows so
          // Sonnet has rich context to write the title from.
          const samples: Record<
            string,
            Array<{
              intentLabel: string;
              brands: string[];
              modusOperandi: string | null;
              narrativeSummary: string | null;
              tactics: string[];
            }>
          > = {};

          // Bounded parallelism, budget checked per item (this was twenty
          // sequential selects with no budget). A theme whose samples were
          // skipped is NOT sent for naming — Sonnet would title it from nothing;
          // it stays "Pending naming" and is selected again next run.
          await mapWithConcurrency(
            themeIds,
            DB_WRITE_CONCURRENCY,
            async (tid) => {
              if (budget.expired()) return;
              const { data: members } = await supabase
                .from("reddit_post_intel")
                .select(
                  "intent_label, brands_impersonated, modus_operandi, narrative_summary, tactic_tags",
                )
                .eq("theme_id", tid)
                .limit(5);
              samples[tid] = (members ?? []).map((m) => ({
                intentLabel: m.intent_label as string,
                brands: (m.brands_impersonated as string[]) ?? [],
                modusOperandi: (m.modus_operandi as string | null) ?? null,
                narrativeSummary:
                  (m.narrative_summary as string | null) ?? null,
                tactics: (m.tactic_tags as string[] | null) ?? [],
              }));
            },
          );
          const sampled = themeIds.filter((tid) => tid in samples);

          // The model call gets its own timeout; dispatching it with less than
          // that in hand is a call that cannot finish inside the step. Skip and
          // say so — the themes are still pending next run.
          if (
            sampled.length === 0 ||
            budget.remainingMs() <= NAMING_MODEL_TIMEOUT_MS
          ) {
            return { named: 0, deadlineHit: true };
          }

          // Wrap Sonnet naming so any failure (model rejecting prefill, schema
          // validation fail, JSON parse fail, rate-limit) lands in cost_telemetry
          // feature='reddit-intel-error' for SQL-queryable triage. Inngest still
          // retries via the function-level retries: 3 — the catch is additive.
          let namingResponse;
          try {
            namingResponse = await callClaudeJson<
              z.infer<typeof NamingOutputSchema>
            >({
              model: "SONNET_4_6",
              system: NAMING_SYSTEM_PROMPT,
              user: JSON.stringify({
                instruction:
                  "Name each theme cluster. Match the input themeIds exactly.",
                themes: sampled.map((tid) => ({
                  themeId: tid,
                  samples: samples[tid],
                })),
              }),
              schema: NamingOutputSchema,
              maxTokens: 4_000,
              timeoutMs: NAMING_MODEL_TIMEOUT_MS,
              cacheSystem: true,
            });
          } catch (err) {
            await logFunctionError({
              step: "name-pending-themes",
              cohortDate: data.cohortDate,
              postCount: sampled.length,
              error: err,
              promptVersion: NAMING_PROMPT_VERSION,
              extra: { theme_count: sampled.length },
            });
            throw err;
          }

          let named = 0;
          const validInputIds = new Set(sampled);
          // Bounded parallelism again (was twenty sequential updates). A title
          // skipped for time costs one more Sonnet call next run, which is
          // cheaper than a 504 that loses all twenty.
          await mapWithConcurrency(
            namingResponse.result.themes,
            DB_WRITE_CONCURRENCY,
            async (named_theme) => {
              if (!validInputIds.has(named_theme.themeId)) {
                logger.warn("cluster: Sonnet returned themeId not in input", {
                  themeId: named_theme.themeId,
                });
                return;
              }
              if (budget.expired()) return;
              const slug = kebabSlug(named_theme.title);
              // Aggregate the most frequent social-engineering tactics across the
              // theme's sampled posts (v186) so the RAG prompt can surface them.
              // Sample-based (the same ≤5 members fetched for naming context) — it
              // self-heals on the next naming pass as a cluster grows.
              const tacticCounts = new Map<string, number>();
              for (const s of samples[named_theme.themeId] ?? []) {
                for (const tag of s.tactics) {
                  tacticCounts.set(tag, (tacticCounts.get(tag) ?? 0) + 1);
                }
              }
              const topTactics = [...tacticCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([tag]) => tag);
              const { error } = await supabase
                .from("reddit_intel_themes")
                .update({
                  title: named_theme.title,
                  slug,
                  narrative: named_theme.narrative,
                  modus_operandi: named_theme.modusOperandi ?? null,
                  representative_brands: named_theme.representativeBrands,
                  top_tactic_tags: topTactics.length > 0 ? topTactics : null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", named_theme.themeId);
              if (error) {
                logger.warn("cluster: theme rename update failed", {
                  themeId: named_theme.themeId,
                  error: error.message,
                });
                return;
              }
              named++;
            },
          );

          // Cost log
          await logNamingCost({
            estimatedCostUsd: namingResponse.estimatedCostUsd,
            inputTokens: namingResponse.usage.inputTokens,
            outputTokens: namingResponse.usage.outputTokens,
            modelId: namingResponse.modelId,
            themeCount: sampled.length,
          });

          return { named, deadlineHit: budget.expired() };
        },
      );

      // ── Step 5: recompute theme health ───────────────────────────────────
      // signal_strength / wow_delta_pct / is_active had no writer until v300:
      // 200 of 200 themes read 'weak', 0 had a week-on-week delta, and no
      // theme was ever aged out, so "active themes" meant "all themes ever".
      const health = await step.run("refresh-theme-health", async () => {
        const supabase = createServiceClient();
        if (!supabase) return null;
        const { data: result, error } = await supabase.rpc(
          "refresh_reddit_theme_health",
          {},
        );
        if (error) {
          logger.warn("cluster: theme health refresh failed", {
            error: error.message,
          });
          return null;
        }
        return result as {
          strong_themes: number;
          inactive_themes: number;
          theme_births_7d: number;
          active_themes: number;
        } | null;
      });

      // ── Step 6: count active themes for downstream event ─────────────────
      const activeCount = await step.run("count-active-themes", async () => {
        const supabase = createServiceClient();
        if (!supabase) return null;
        const { count, error } = await supabase
          .from("reddit_intel_themes")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true);
        // A failed head-count returns count=null AND error=null: there is no
        // body to parse on a 204, so `if (error)` is blind and `count ?? 0`
        // would emit a confident zero into the downstream event. `count ===
        // null` is the only signal that the read did not happen.
        if (error || count === null) {
          logger.warn("cluster: active theme count unavailable", {
            error:
              error?.message ?? "null count (head request returned no body)",
          });
          return null;
        }
        return count;
      });

      await step.run("emit-themes-recomputed", () =>
        inngest.send({
          name: REDDIT_INTEL_THEMES_RECOMPUTED_EVENT,
          data: {
            weekStart: data.cohortDate,
            // Falls back to the health RPC's own count rather than 0 — an
            // unavailable count must not read as "no active themes".
            activeThemeCount: activeCount ?? health?.active_themes ?? null,
            newThemeCount: batch.newThemeCount,
            computedAt: new Date().toISOString(),
          },
        }),
      );

      // ── Step 6b: how much work is left ───────────────────────────────────
      //
      // postsConsidered is capped at CLUSTER_POSTS_PER_RUN, so it says how much
      // this run did and NOTHING about how much remains. The backlog reached
      // 1,662 posts in September while every summary looked ordinary — the
      // number that would have shown it was never emitted.
      const backlogRemaining = await step.run("count-backlog", async () => {
        const supabase = createServiceClient();
        if (!supabase) return null;
        const { count } = await supabase
          .from("reddit_post_intel")
          .select("id", { count: "exact", head: true })
          .is("theme_id", null)
          .not("embedding", "is", null);
        // Same 204/head-count trap as count-active-themes above: a failed
        // head-count returns count=null AND error=null, so `count ?? 0` would
        // print a confident "backlog cleared". null means "not measured".
        return count;
      });

      // One always-ship warn per run. fn.complete is INFO and prod samples
      // INFO at 10% with the keep/drop decision taken once per run, so the
      // question this answers — "is the cluster still birthing themes, or has
      // it collapsed again?" — was not answerable from Axiom at all. Zero
      // births over consecutive weeks is the collapse signature.
      logger.warn("reddit-intel-cluster.summary", {
        cohortDate: data.cohortDate,
        postsConsidered: batch.postsConsidered,
        threshold: batch.threshold,
        newThemes: batch.newThemeCount,
        joinedThemes: batch.joinedThemeCount,
        themesNamed: namingResult.named,
        // Work left AFTER this run. postsConsidered is capped, so without this
        // a saturated run and an idle one produce the same-shaped summary.
        backlogRemaining,
        // Non-zero here means posts were considered and then dropped on the
        // floor — they will re-present at the head of the oldest-first
        // worklist next run and fail again. Zero-vs-null matters: null is
        // "not measured", zero is "measured, none".
        // A partial run must not read as a quiet one: the budget stopped it,
        // and the remainder is waiting in the worklist for the next tick.
        deadlineHit: batch.deadlineHit,
        // Write Outcome: attempted − written − failed = posts never reached.
        postsAttempted: batch.attempted,
        postsWritten: batch.written,
        postsFailed: batch.failed,
        budgetRemainingMs: batch.budgetRemainingMs,
        namingDeadlineHit: namingResult.deadlineHit,
        seedFailures: batch.seedFailures,
        joinFailures: batch.joinFailures,
        linkFailures: batch.linkFailures,
        activeThemes: activeCount ?? health?.active_themes ?? null,
        themeBirths7d: health?.theme_births_7d ?? null,
        strongThemes: health?.strong_themes ?? null,
        inactiveThemes: health?.inactive_themes ?? null,
        oversizedThemes: batch.oversizedThemeCount,
        degraded: activeCount === null || health === null,
      });

      return {
        cohortDate: data.cohortDate,
        newThemes: batch.newThemeCount,
        joinedThemes: batch.joinedThemeCount,
        themesNamed: namingResult.named,
        themeBirths7d: health?.theme_births_7d ?? null,
      };
    },
  ),
);
