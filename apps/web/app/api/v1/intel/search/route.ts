// POST /api/v1/intel/search — semantic search over Reddit Intel.
//
// Two-stage retrieval pipeline:
//   1. embedQuery(query) → 1024-dim vector
//   2. match_reddit_intel RPC → top-50 by cosine over reddit_post_intel
//      (and optionally match_reddit_intel_themes for theme-level hits)
//   3. rerank-2.5-lite → re-orders the top-50 to top-K by relevance
//   4. respond with the reranked subset + cosine + relevance score
//
// Reranking is non-fatal: if the rerank call fails (Voyage outage, rate
// limit) we fall back to the cosine-only ordering and tag fallback=true
// in the response so clients can detect quality degradation.
//
// Gated by featureFlags.redditIntelB2bApi (same flag as /api/v1/intel/
// themes). Auth via API key + daily rate limit.
//
// Request body: { query: string, scope?: "posts" | "themes" | "both",
// limit?: number, minSimilarity?: number }
// Response: { posts, themes, usage, fallback }

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { embedQuery } from "@askarthur/scam-engine/embeddings";
import { rerank } from "@askarthur/scam-engine/rerank";
import { logCost } from "@/lib/cost-telemetry";

interface SearchBody {
  query?: unknown;
  scope?: unknown;
  limit?: unknown;
  minSimilarity?: unknown;
}

interface PostMatchRow {
  id: string;
  feed_item_id: number;
  intent_label: string;
  brands_impersonated: string[] | null;
  narrative_summary: string | null;
  modus_operandi: string | null;
  processed_at: string;
  similarity: number;
}

interface ThemeMatchRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  member_count: number;
  ioc_url_count: number;
  ioc_phone_count: number;
  similarity: number;
}

const MAX_QUERY_LEN = 1000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const ANN_TOP_N = 50;
const DEFAULT_MIN_SIMILARITY = 0.55;

function vectorToPgString(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export async function POST(req: NextRequest) {
  const auth = await validateApiKey(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 },
    );
  }
  if (auth.rateLimited) {
    return NextResponse.json(
      { error: "Daily API limit exceeded. Resets at midnight UTC." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  if (!featureFlags.redditIntelB2bApi) {
    return NextResponse.json(
      { error: "Reddit Intel API not enabled on this deployment" },
      { status: 503 },
    );
  }

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  if (typeof body.query !== "string" || body.query.trim().length === 0) {
    return NextResponse.json(
      { error: "query (string, non-empty) is required" },
      { status: 400 },
    );
  }
  const query = body.query.trim().slice(0, MAX_QUERY_LEN);

  const scope =
    body.scope === "themes" || body.scope === "both" ? body.scope : "posts";

  const limit = Math.min(
    Math.max(typeof body.limit === "number" ? body.limit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const minSimilarity =
    typeof body.minSimilarity === "number" &&
    body.minSimilarity >= 0 &&
    body.minSimilarity <= 1
      ? body.minSimilarity
      : DEFAULT_MIN_SIMILARITY;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // ── Stage 1: embed query ────────────────────────────────────────────
  let queryVector: number[];
  let embedTokens = 0;
  let embedCostUsd = 0;
  let embedModelId = "";
  try {
    const embedResult = await embedQuery([query], { domain: "generic" });
    if (embedResult.vectors.length === 0) {
      return NextResponse.json(
        { error: "Failed to embed query" },
        { status: 500 },
      );
    }
    queryVector = embedResult.vectors[0];
    embedTokens = embedResult.totalTokens;
    embedCostUsd = embedResult.estimatedCostUsd;
    embedModelId = embedResult.modelId;
  } catch (err) {
    logger.error("intel/search embed failed", {
      error: String(err),
      apiKeyId: auth.keyHash,
    });
    return NextResponse.json({ error: "Embedding failed" }, { status: 502 });
  }

  logCost({
    feature: "intel-search",
    provider: "voyage",
    operation: "embeddings.create",
    units: embedTokens,
    estimatedCostUsd: embedCostUsd,
    metadata: { model: embedModelId, stage: "query-embed" },
    requestId: auth.keyHash ?? null,
  });

  // ── Stage 2: ANN over posts and/or themes ───────────────────────────
  const queryVecPg = vectorToPgString(queryVector);

  let posts: PostMatchRow[] = [];
  let themes: ThemeMatchRow[] = [];

  if (scope === "posts" || scope === "both") {
    const { data, error } = await supabase.rpc("match_reddit_intel", {
      p_query_embedding: queryVecPg,
      p_match_count: ANN_TOP_N,
      p_min_similarity: minSimilarity,
    });
    if (error) {
      logger.error("match_reddit_intel RPC failed", { error: error.message });
      return NextResponse.json(
        { error: "Search RPC failed" },
        { status: 500 },
      );
    }
    posts = (data ?? []) as PostMatchRow[];
  }

  if (scope === "themes" || scope === "both") {
    const { data, error } = await supabase.rpc("match_reddit_intel_themes", {
      p_query_embedding: queryVecPg,
      p_match_count: ANN_TOP_N,
      p_min_similarity: minSimilarity,
    });
    if (error) {
      logger.error("match_reddit_intel_themes RPC failed", { error: error.message });
      return NextResponse.json(
        { error: "Search RPC failed" },
        { status: 500 },
      );
    }
    themes = (data ?? []) as ThemeMatchRow[];
  }

  // ── Stage 3: rerank posts (themes are usually few enough to skip) ───
  let rerankTokens = 0;
  let rerankCostUsd = 0;
  let rerankModelId = "";
  let rerankFallback = false;

  if (posts.length > 1) {
    const docs = posts.map((p) =>
      [
        `category: ${p.intent_label}`,
        p.brands_impersonated?.length
          ? `brands: ${p.brands_impersonated.join(", ")}`
          : "",
        p.narrative_summary ?? "",
      ]
        .filter(Boolean)
        .join(" | "),
    );

    try {
      const rr = await rerank(query, docs, {
        topK: limit,
        requestId: auth.keyHash ?? undefined,
      });
      const reordered = rr.results
        .slice(0, limit)
        .map((r) => ({
          ...posts[r.index],
          relevance_score: r.relevanceScore,
        }));
      posts = reordered as Array<PostMatchRow & { relevance_score: number }>;
      rerankTokens = rr.totalTokens;
      rerankCostUsd = rr.estimatedCostUsd;
      rerankModelId = rr.modelId;

      logCost({
        feature: "intel-search",
        provider: "voyage",
        operation: "rerank",
        units: rerankTokens,
        estimatedCostUsd: rerankCostUsd,
        metadata: {
          model: rerankModelId,
          stage: "post-rerank",
          doc_count: docs.length,
        },
        requestId: auth.keyHash ?? null,
      });
    } catch (err) {
      logger.warn("intel/search rerank failed, falling back to cosine order", {
        error: String(err),
      });
      rerankFallback = true;
      posts = posts.slice(0, limit);
    }
  } else {
    posts = posts.slice(0, limit);
  }

  themes = themes.slice(0, limit);

  return NextResponse.json({
    query,
    posts: posts.map((p) => ({
      id: p.id,
      feedItemId: p.feed_item_id,
      intentLabel: p.intent_label,
      brandsImpersonated: p.brands_impersonated ?? [],
      narrativeSummary: p.narrative_summary,
      modusOperandi: p.modus_operandi,
      processedAt: p.processed_at,
      similarity: p.similarity,
      relevanceScore:
        "relevance_score" in p
          ? (p as PostMatchRow & { relevance_score: number }).relevance_score
          : null,
    })),
    themes: themes.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
      memberCount: t.member_count,
      iocUrlCount: t.ioc_url_count,
      iocPhoneCount: t.ioc_phone_count,
      similarity: t.similarity,
    })),
    usage: {
      embedTokens,
      embedCostUsd,
      embedModel: embedModelId,
      rerankTokens,
      rerankCostUsd,
      rerankModel: rerankModelId || null,
    },
    fallback: rerankFallback,
  });
}
