// Voyage reranker — second-stage scorer that takes a query + a list of
// candidate documents (typically the top-N results from a vector ANN
// retrieval) and returns them re-ordered by an instruction-following
// relevance model. The Anthropic contextual-retrieval study measured a
// 67% reduction in top-20 retrieval-failure rate when adding a reranker
// after embedding similarity (5.7% → 1.9%). The added cost is ~$0.002
// per call on rerank-2.5-lite at 100 docs × 500 tokens average.
//
// Usage shape (canonical two-stage retrieval):
//
//   const queryVec = await embedQuery([q]);
//   const candidates = await supabase.rpc("match_reddit_intel", {
//     p_query_embedding: queryVec.vectors[0], p_match_count: 50
//   });
//   const ranked = await rerank(q, candidates.map(c => c.text));
//   const top10 = ranked.results.slice(0, 10).map(r => candidates[r.index]);
//
// Why a separate module rather than folding into embeddings.ts: the rerank
// endpoint has a different request shape (a single query + N documents,
// not a flat list to embed), a different pricing model (query × N + sum
// docs, billed as a single tokens count), and a different default model
// (rerank-2.5-lite). Splitting them makes both APIs easier to read and
// tag in cost_telemetry.
//
// Model selection:
//   - rerank-2.5-lite (default): $0.02/M tokens, instruction-following.
//     Cost-pareto pick — Anthropic's 67% improvement number was measured
//     on the lite tier.
//   - rerank-2.5: $0.05/M tokens, slightly better at instruction following.
//     Worth swapping in only when the lite tier produces measurable miss
//     on Ask Arthur's hold-out set.
//
// VOYAGE_RERANK_MODEL env var overrides the default model id; defaults to
// rerank-2.5-lite. Unknown model ids fail loudly rather than silently
// routing to the wrong tier.

import { logger } from "@askarthur/utils/logger";

interface RerankModelSpec {
  modelId: string;
  usdPerToken: number;
}

const RERANK_REGISTRY: Record<string, RerankModelSpec> = {
  "rerank-2.5-lite": {
    modelId: "rerank-2.5-lite",
    usdPerToken: 0.02 / 1_000_000,
  },
  "rerank-2.5": {
    modelId: "rerank-2.5",
    usdPerToken: 0.05 / 1_000_000,
  },
  "rerank-2-lite": {
    modelId: "rerank-2-lite",
    usdPerToken: 0.02 / 1_000_000,
  },
  "rerank-2": {
    modelId: "rerank-2",
    usdPerToken: 0.05 / 1_000_000,
  },
};

const DEFAULT_RERANK_MODEL = "rerank-2.5-lite";

export interface RerankResult {
  results: Array<{
    // Index into the original `documents` array. Caller maps this back
    // to whatever metadata they stored alongside the document text.
    index: number;
    relevanceScore: number;
  }>;
  modelId: string;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface RerankOptions {
  // How many of the input documents to return after reranking. Defaults
  // to all of them — the caller can slice further if they want top-K only.
  topK?: number;
  // Direct model id override (e.g. "rerank-2.5" for the bigger tier).
  // Bypasses the VOYAGE_RERANK_MODEL env var.
  modelId?: string;
  // Optional correlation ID for log traces.
  requestId?: string;
}

/**
 * Re-order `documents` by relevance to `query` using a Voyage reranker.
 * Returns the documents' original indices paired with relevance scores
 * sorted descending. The caller looks up document content via the index.
 *
 * Throws on provider HTTP failure — callers running this inside Inngest
 * step.run get retries for free; in synchronous endpoint paths catch and
 * fall back to the embedding-only ordering.
 *
 * Empty documents list returns immediately with an empty result. A
 * single document is returned as-is — there's nothing to rerank.
 */
export async function rerank(
  query: string,
  documents: string[],
  opts: RerankOptions = {},
): Promise<RerankResult> {
  const spec = resolveSpec(opts);

  if (documents.length === 0) {
    return {
      results: [],
      modelId: spec.modelId,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  }

  if (documents.length === 1) {
    return {
      results: [{ index: 0, relevanceScore: 1 }],
      modelId: spec.modelId,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
  }

  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error("VOYAGE_API_KEY not set — required for Voyage rerank");
  }

  const body: Record<string, unknown> = {
    query,
    documents,
    model: spec.modelId,
    return_documents: false,
  };
  if (opts.topK !== undefined) {
    body.top_k = opts.topK;
  }

  const res = await fetch("https://api.voyageai.com/v1/rerank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    logger.error("Voyage rerank request failed", {
      requestId: opts.requestId,
      status: res.status,
      modelId: spec.modelId,
      docCount: documents.length,
      preview: errBody.slice(0, 200),
    });
    throw new Error(
      `Voyage rerank ${res.status}: ${errBody.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    data: Array<{ index: number; relevance_score: number }>;
    model: string;
    usage: { total_tokens: number };
  };

  // Voyage returns data sorted by relevance_score DESC. Trust their order
  // but normalise to our shape. (We re-sort defensively — cheap, removes
  // a class of "what if a future API version stops sorting" bugs.)
  const results = [...json.data]
    .map((d) => ({
      index: d.index,
      relevanceScore: d.relevance_score,
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  return {
    results,
    modelId: spec.modelId,
    totalTokens: json.usage.total_tokens,
    estimatedCostUsd: json.usage.total_tokens * spec.usdPerToken,
  };
}

function resolveSpec(opts: RerankOptions): RerankModelSpec {
  if (opts.modelId) {
    const spec = RERANK_REGISTRY[opts.modelId];
    if (!spec) {
      throw new Error(
        `Unknown rerank modelId "${opts.modelId}" — not in RERANK_REGISTRY`,
      );
    }
    return spec;
  }

  const fromEnv = process.env.VOYAGE_RERANK_MODEL;
  if (fromEnv) {
    const spec = RERANK_REGISTRY[fromEnv];
    if (spec) return spec;
    logger.warn(
      `Unknown VOYAGE_RERANK_MODEL="${fromEnv}", defaulting to ${DEFAULT_RERANK_MODEL}`,
    );
  }

  return RERANK_REGISTRY[DEFAULT_RERANK_MODEL]!;
}
