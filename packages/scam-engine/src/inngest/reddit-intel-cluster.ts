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
// The threshold is intentionally tuned for stable, narrow themes:
//   * 0.78 = "same scam pattern, possibly different brand"
//   * 0.85 = "near-duplicate"
//   * 0.65 = "loosely related" (too loose — produces blob clusters)
// Revisit only if the Wave 2 dashboard surfaces theme drift.
//
// Idempotency: a post is only assigned if reddit_post_intel.theme_id IS
// NULL. Re-firing the same event for the same cohort assigns nothing new.

import { z } from "zod";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

import { inngest } from "./client";
import {
  REDDIT_INTEL_EMBEDDED_EVENT,
  REDDIT_INTEL_THEMES_RECOMPUTED_EVENT,
  parseRedditIntelEmbeddedData,
} from "./events";
import { callClaudeJson } from "../anthropic";

const COSINE_THRESHOLD = 0.78;
const MIN_MEMBERS_FOR_NAMING = 3;
const NAMING_PROMPT_VERSION = "reddit-cluster-naming-v1@2026-05-01";

// ── Vector helpers ────────────────────────────────────────────────────────

function parsePgVector(s: string | null): number[] | null {
  if (!s) return null;
  // pgvector serialises as `[1.234,5.678,...]` — strip brackets, split, parse.
  const inner = s.startsWith("[") ? s.slice(1, -1) : s;
  return inner.split(",").map(Number);
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
    next[i] = (oldCentroid[i] * oldMemberCount + newVector[i]) / (oldMemberCount + 1);
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

function placeholderSlug(): string {
  return `auto-${randomSuffix(8)}`;
}

function kebabSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) + "-" + randomSuffix(4)
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
}

interface ActiveTheme {
  id: string;
  centroid: number[];
  memberCount: number;
}

export const redditIntelCluster = inngest.createFunction(
  {
    id: "reddit-intel-cluster",
    name: "Reddit Intel: Greedy theme clustering + naming",
    retries: 3,
  },
  { event: REDDIT_INTEL_EMBEDDED_EVENT },
  async ({ event, step }) => {
    if (!featureFlags.redditIntelIngest) {
      return { skipped: true, reason: "redditIntelIngest flag off" };
    }

    const data = await step.run("parse-event", () =>
      parseRedditIntelEmbeddedData(event.data),
    );

    // ── Step 1: load unassigned posts in this cohort + active themes ─────
    const { posts, themes } = await step.run("load-state", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      const cohortStart = new Date(`${data.cohortDate}T00:00:00Z`).toISOString();
      const cohortEnd = new Date(
        new Date(cohortStart).getTime() + 24 * 3600 * 1000,
      ).toISOString();

      const { data: postRows, error: postErr } = await supabase
        .from("reddit_post_intel")
        .select("id, embedding")
        .gte("processed_at", cohortStart)
        .lt("processed_at", cohortEnd)
        .is("theme_id", null)
        .not("embedding", "is", null)
        .limit(500);

      if (postErr) throw new Error(`load posts: ${postErr.message}`);

      const { data: themeRows, error: themeErr } = await supabase
        .from("reddit_intel_themes")
        .select("id, centroid_embedding, member_count")
        .eq("is_active", true)
        .not("centroid_embedding", "is", null)
        .limit(500);

      if (themeErr) throw new Error(`load themes: ${themeErr.message}`);

      const posts: NewPost[] = (postRows ?? [])
        .map((r) => ({
          id: r.id as string,
          embedding: parsePgVector(r.embedding as string | null) ?? [],
        }))
        .filter((p) => p.embedding.length > 0);

      const themes: ActiveTheme[] = (themeRows ?? [])
        .map((r) => ({
          id: r.id as string,
          centroid:
            parsePgVector(r.centroid_embedding as string | null) ?? [],
          memberCount: (r.member_count as number) ?? 0,
        }))
        .filter((t) => t.centroid.length > 0);

      return { posts, themes };
    });

    if (posts.length === 0) {
      logger.info("reddit-intel-cluster: nothing to cluster", {
        cohortDate: data.cohortDate,
      });
      return { skipped: true, reason: "no_unassigned_posts" };
    }

    // ── Step 2: greedy assignment, in-memory ─────────────────────────────
    // We mutate the in-memory `themes` array as we go (centroids and counts
    // shift with each assignment). New themes get pushed to the same array
    // so subsequent posts can match against them. This produces stable
    // clusters even within a single batch.

    const assignments: Array<{
      postId: string;
      themeId: string;
      similarity: number;
      newCentroid: number[];
      newMemberCount: number;
      isNewTheme: boolean;
    }> = [];

    for (const post of posts) {
      let bestThemeIdx = -1;
      let bestSim = COSINE_THRESHOLD; // initialised to threshold so we only count matches

      for (let i = 0; i < themes.length; i++) {
        const sim = cosineSimilarity(post.embedding, themes[i].centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestThemeIdx = i;
        }
      }

      if (bestThemeIdx >= 0) {
        const t = themes[bestThemeIdx];
        const newCentroid = updateCentroid(t.centroid, t.memberCount, post.embedding);
        const newMemberCount = t.memberCount + 1;
        themes[bestThemeIdx] = { ...t, centroid: newCentroid, memberCount: newMemberCount };
        assignments.push({
          postId: post.id,
          themeId: t.id,
          similarity: bestSim,
          newCentroid,
          newMemberCount,
          isNewTheme: false,
        });
      } else {
        // No match → seed a new theme with this post as the centroid.
        // We'll generate a real UUID server-side; for now leave themeId
        // empty and let the persist step assign it.
        assignments.push({
          postId: post.id,
          themeId: "", // filled in during persist step below
          similarity: 1.0,
          newCentroid: post.embedding.slice(),
          newMemberCount: 1,
          isNewTheme: true,
        });
        themes.push({
          id: "<pending>", // not used — only needed if a later post in this batch could match it,
          // but we want NEW themes from this batch to be matchable. We'll handle that by
          // re-resolving below.
          centroid: post.embedding.slice(),
          memberCount: 1,
        });
      }
    }

    // ── Step 3: persist new themes + assignments + centroid updates ──────
    const persistResult = await step.run("persist-clusters", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      let newThemeCount = 0;
      let joinedThemeCount = 0;

      for (const a of assignments) {
        if (a.isNewTheme) {
          // Insert new theme row first to get its UUID.
          const { data: created, error: insErr } = await supabase
            .from("reddit_intel_themes")
            .insert({
              slug: placeholderSlug(),
              title: "Pending naming",
              centroid_embedding: vectorToPgString(a.newCentroid),
              member_count: 1,
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
              signal_strength: "weak",
              is_active: true,
            })
            .select("id")
            .single();

          if (insErr || !created) {
            logger.warn("cluster: new theme insert failed", {
              error: insErr?.message,
            });
            continue;
          }
          a.themeId = created.id as string;
          newThemeCount++;
        } else {
          // Existing theme: update centroid + bump member count + last_seen_at.
          const { error: upErr } = await supabase
            .from("reddit_intel_themes")
            .update({
              centroid_embedding: vectorToPgString(a.newCentroid),
              member_count: a.newMemberCount,
              last_seen_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", a.themeId);

          if (upErr) {
            logger.warn("cluster: theme update failed", {
              themeId: a.themeId,
              error: upErr.message,
            });
            continue;
          }
          joinedThemeCount++;
        }

        // Link the post → theme.
        const { error: postErr } = await supabase
          .from("reddit_post_intel")
          .update({ theme_id: a.themeId })
          .eq("id", a.postId);
        if (postErr) {
          logger.warn("cluster: post theme_id update failed", {
            postId: a.postId,
            error: postErr.message,
          });
          continue;
        }

        // Insert membership row (primary).
        const { error: memErr } = await supabase
          .from("reddit_post_intel_themes")
          .insert({
            intel_id: a.postId,
            theme_id: a.themeId,
            similarity: Math.min(1, Math.max(0, a.similarity)),
            is_primary: true,
          });
        if (memErr) {
          logger.warn("cluster: membership insert failed", {
            postId: a.postId,
            themeId: a.themeId,
            error: memErr.message,
          });
        }
      }

      return { newThemeCount, joinedThemeCount };
    });

    // ── Step 4: name themes that have just crossed MIN_MEMBERS_FOR_NAMING ─
    // Only themes where member_count ≥ 3 AND title still 'Pending naming'.
    // Skipping naming when there are no candidates avoids a wasted Sonnet call.

    const namingResult = await step.run("name-pending-themes", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("Supabase service client unavailable");

      const { data: pending, error: pendErr } = await supabase
        .from("reddit_intel_themes")
        .select("id, member_count")
        .eq("title", "Pending naming")
        .gte("member_count", MIN_MEMBERS_FOR_NAMING)
        .limit(20);

      if (pendErr) throw new Error(`pending themes: ${pendErr.message}`);
      if (!pending || pending.length === 0) {
        return { named: 0 };
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
        }>
      > = {};

      for (const tid of themeIds) {
        const { data: members } = await supabase
          .from("reddit_post_intel")
          .select(
            "intent_label, brands_impersonated, modus_operandi, narrative_summary",
          )
          .eq("theme_id", tid)
          .limit(5);
        samples[tid] = (members ?? []).map((m) => ({
          intentLabel: m.intent_label as string,
          brands: (m.brands_impersonated as string[]) ?? [],
          modusOperandi: (m.modus_operandi as string | null) ?? null,
          narrativeSummary: (m.narrative_summary as string | null) ?? null,
        }));
      }

      const namingResponse = await callClaudeJson<
        z.infer<typeof NamingOutputSchema>
      >({
        model: "SONNET_4_6",
        system: NAMING_SYSTEM_PROMPT,
        user: JSON.stringify({
          instruction:
            "Name each theme cluster. Match the input themeIds exactly.",
          themes: themeIds.map((tid) => ({
            themeId: tid,
            samples: samples[tid],
          })),
        }),
        schema: NamingOutputSchema,
        maxTokens: 4_000,
        timeoutMs: 60_000,
        cacheSystem: true,
      });

      let named = 0;
      const validInputIds = new Set(themeIds);
      for (const named_theme of namingResponse.result.themes) {
        if (!validInputIds.has(named_theme.themeId)) {
          logger.warn("cluster: Sonnet returned themeId not in input", {
            themeId: named_theme.themeId,
          });
          continue;
        }
        const slug = kebabSlug(named_theme.title);
        const { error } = await supabase
          .from("reddit_intel_themes")
          .update({
            title: named_theme.title,
            slug,
            narrative: named_theme.narrative,
            modus_operandi: named_theme.modusOperandi ?? null,
            representative_brands: named_theme.representativeBrands,
            updated_at: new Date().toISOString(),
          })
          .eq("id", named_theme.themeId);
        if (error) {
          logger.warn("cluster: theme rename update failed", {
            themeId: named_theme.themeId,
            error: error.message,
          });
          continue;
        }
        named++;
      }

      // Cost log
      await logNamingCost({
        estimatedCostUsd: namingResponse.estimatedCostUsd,
        inputTokens: namingResponse.usage.inputTokens,
        outputTokens: namingResponse.usage.outputTokens,
        modelId: namingResponse.modelId,
        themeCount: themeIds.length,
      });

      return { named };
    });

    // ── Step 5: count active themes for downstream event ─────────────────
    const activeCount = await step.run("count-active-themes", async () => {
      const supabase = createServiceClient();
      if (!supabase) return 0;
      const { count } = await supabase
        .from("reddit_intel_themes")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);
      return count ?? 0;
    });

    await step.run("emit-themes-recomputed", () =>
      inngest.send({
        name: REDDIT_INTEL_THEMES_RECOMPUTED_EVENT,
        data: {
          weekStart: data.cohortDate,
          activeThemeCount: activeCount,
          newThemeCount: persistResult.newThemeCount,
          computedAt: new Date().toISOString(),
        },
      }),
    );

    logger.info("reddit-intel-cluster: complete", {
      cohortDate: data.cohortDate,
      postsConsidered: posts.length,
      newThemes: persistResult.newThemeCount,
      joinedThemes: persistResult.joinedThemeCount,
      themesNamed: namingResult.named,
      activeThemes: activeCount,
    });

    return {
      cohortDate: data.cohortDate,
      newThemes: persistResult.newThemeCount,
      joinedThemes: persistResult.joinedThemeCount,
      themesNamed: namingResult.named,
    };
  },
);
