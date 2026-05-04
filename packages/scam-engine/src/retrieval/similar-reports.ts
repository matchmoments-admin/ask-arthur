// Similar-reports retrieval — two-stage RAG over scam_reports for the
// post-verdict UI surface. Caller passes the user's submission text;
// returns up to top-K similar non-SAFE reports from the last 30 days.
//
// Pipeline:
//   1. embedQuery(text) → 1024-dim Voyage 3.5 query vector
//   2. match_scam_reports_hybrid(text, vec, 50) → top 50 by RRF(BM25 ∪ dense)
//   3. rerank(text, top-50.scrubbed_content) → re-ordered by Voyage rerank-2.5-lite
//   4. Filter by relevance ≥ 0.4 and slice to topK
//
// Why two stages and not just dense cosine: Anthropic's Contextual Retrieval
// study reports a 67% reduction in retrieval failures when adding hybrid +
// rerank vs pure dense (vs 35% for hybrid alone). For an "is this scam
// pattern familiar?" surface, false positives in retrieval (showing the
// user a similar-looking scam that isn't actually similar) hurt trust more
// than false negatives. The reranker is the high-precision filter.
//
// Cost shape per call (against today's pricing):
//   - 1× embedQuery on voyage-3.5: ~50 tokens × $0.06/M = $0.000003
//   - 1× rerank-2.5-lite over 50 docs × ~200 tokens: ~10K × $0.02/M = $0.0002
//   Total: ~$0.0002/call. With FF gate + caching this stays well under
//   the existing analyze budget.
//
// Failure mode: throws on Voyage transport errors so the caller's catch
// boundary can surface "this surface is temporarily unavailable" without
// returning misleading empty results. Empty inputs return [] cleanly.

import { embedQuery } from "../embeddings";
import { rerank } from "../rerank";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export interface SimilarReport {
  id: number;
  scamType: string | null;
  verdict: "SUSPICIOUS" | "HIGH_RISK" | "UNCERTAIN";
  confidenceScore: number;
  impersonatedBrand: string | null;
  channel: string | null;
  region: string | null;
  scrubbedContent: string | null;
  createdAt: string;
  similarity: number;
  rerankRelevance: number;
}

export interface SimilarReportsOptions {
  /** Top-K after rerank. Default 5. */
  k?: number;
  /** Stage-1 (hybrid) candidate pool size. Default 50. */
  hybridPoolSize?: number;
  /** Recency window in days. Default 30. */
  sinceDays?: number;
  /** Minimum dense-leg cosine similarity for the hybrid stage. Default 0.50. */
  minSimilarity?: number;
  /** Minimum rerank relevance to surface in results. Default 0.4 (Voyage normalised score). */
  minRelevance?: number;
  /** Optional correlation ID for log traces. */
  requestId?: string;
}

interface HybridRow {
  id: number;
  scam_type: string | null;
  verdict: string;
  confidence_score: number;
  impersonated_brand: string | null;
  channel: string | null;
  region: string | null;
  scrubbed_content: string | null;
  created_at: string;
  similarity: number;
  bm25_rank: number | null;
  dense_rank: number | null;
  rrf_score: number;
}

/**
 * Run two-stage retrieval against scam_reports and return similar reports
 * to render alongside the user's verdict.
 *
 * Returns [] when:
 *   - text is empty / whitespace-only
 *   - Supabase service client is unavailable (env not configured)
 *   - the hybrid RPC returns zero rows
 *   - all reranked candidates fall below `minRelevance`
 *
 * Throws on Voyage HTTP errors and Supabase RPC errors — caller decides
 * whether to render a fallback or rethrow.
 */
export async function getSimilarReports(
  text: string,
  opts: SimilarReportsOptions = {},
): Promise<SimilarReport[]> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const {
    k = 5,
    hybridPoolSize = 50,
    sinceDays = 30,
    minSimilarity = 0.5,
    minRelevance = 0.4,
    requestId,
  } = opts;

  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("getSimilarReports: supabase service client unavailable", { requestId });
    return [];
  }

  // Stage 1: embed the query (asymmetric — query side of Voyage's prompt).
  const embedResult = await embedQuery([trimmed], { requestId });
  const queryVec = embedResult.vectors[0];
  if (!queryVec) return [];

  // Stage 2: hybrid retrieval — BM25 ∪ dense fused with RRF (k=60 in SQL).
  const { data, error } = await supabase.rpc("match_scam_reports_hybrid", {
    p_query_text: trimmed,
    p_query_embedding: queryVec,
    p_match_count: hybridPoolSize,
    p_min_similarity: minSimilarity,
    p_since_days: sinceDays,
  });

  if (error) {
    throw new Error(`match_scam_reports_hybrid: ${error.message}`);
  }

  const candidates = (data ?? []) as HybridRow[];
  if (candidates.length === 0) return [];

  // Filter to candidates that have content for the reranker. Reports with
  // NULL scrubbed_content can still appear in the dense leg (they may have
  // been embedded from an older richer pre-scrub state) but the reranker
  // needs text. Drop them from this surface.
  const withContent = candidates.filter(
    (c): c is HybridRow & { scrubbed_content: string } =>
      typeof c.scrubbed_content === "string" && c.scrubbed_content.length > 0,
  );
  if (withContent.length === 0) return [];

  // Stage 3: rerank the pool. rerank() returns indices into the documents
  // array sorted by relevanceScore desc.
  const rerankResult = await rerank(
    trimmed,
    withContent.map((c) => c.scrubbed_content),
    { topK: k, requestId },
  );

  const out: SimilarReport[] = [];
  for (const r of rerankResult.results) {
    if (r.relevanceScore < minRelevance) continue;
    const row = withContent[r.index];
    if (!row) continue;
    if (row.verdict !== "SUSPICIOUS" && row.verdict !== "HIGH_RISK" && row.verdict !== "UNCERTAIN") {
      // Defensive — the RPC already excludes SAFE but new verdicts could
      // creep in via a future migration. Keep the type narrow.
      continue;
    }
    out.push({
      id: row.id,
      scamType: row.scam_type,
      verdict: row.verdict,
      confidenceScore: row.confidence_score,
      impersonatedBrand: row.impersonated_brand,
      channel: row.channel,
      region: row.region,
      scrubbedContent: row.scrubbed_content,
      createdAt: row.created_at,
      similarity: row.similarity,
      rerankRelevance: r.relevanceScore,
    });
    if (out.length >= k) break;
  }

  return out;
}
