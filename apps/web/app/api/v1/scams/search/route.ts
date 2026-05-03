// POST /api/v1/scams/search — semantic search over scam_reports +
// verified_scams.
//
// Two-stage retrieval, same shape as /api/v1/intel/search:
//   1. embedQuery(query, { domain }) → 1024-dim vector
//   2. match_scam_reports + match_verified_scams RPCs → top-N each by
//      cosine over the partial HNSW indexes
//   3. rerank-2.5-lite over the merged result set → reorders to top-K
//   4. respond with reports / verified scams + similarity + relevance scores
//
// Domain routing on the query embed: caller can hint via body.scamType,
// otherwise we default to "generic". For finance-shaped queries the caller
// gets the better recall on voyage-finance-2; everything else uses
// voyage-3.5.
//
// Rerank failure is non-fatal — falls back to cosine ordering with
// fallback=true.
//
// Gated by featureFlags.scamsSearchB2bApi (NEXT_PUBLIC_FF_SCAMS_SEARCH_B2B_API).

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import {
  embedQuery,
  type EmbeddingDomain,
} from "@askarthur/scam-engine/embeddings";
import { rerank } from "@askarthur/scam-engine/rerank";
import { logCost } from "@/lib/cost-telemetry";

interface SearchBody {
  query?: unknown;
  scamType?: unknown;
  scope?: unknown;
  limit?: unknown;
  sinceDays?: unknown;
  minSimilarity?: unknown;
}

interface ScamReportRow {
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
}

interface VerifiedScamRow {
  id: number;
  scam_type: string | null;
  channel: string | null;
  summary: string | null;
  impersonated_brand: string | null;
  region: string | null;
  confidence_score: number;
  created_at: string;
  similarity: number;
}

const FINANCE_SCAM_TYPES = new Set<string>([
  "investment",
  "investment_scam",
  "investment_fraud",
  "crypto",
  "crypto_scam",
  "bec",
  "business_email_compromise",
  "invoice",
  "invoice_fraud",
  "bank_impersonation",
]);

const MAX_QUERY_LEN = 2000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const ANN_TOP_N = 50;
const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_MIN_SIMILARITY = 0.55;

function selectDomain(scamType: string | null): EmbeddingDomain {
  if (!scamType) return "generic";
  return FINANCE_SCAM_TYPES.has(scamType.toLowerCase()) ? "finance" : "generic";
}

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

  if (!featureFlags.scamsSearchB2bApi) {
    return NextResponse.json(
      { error: "Scams Search API not enabled on this deployment" },
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

  const scamTypeHint =
    typeof body.scamType === "string" ? body.scamType : null;

  const scope =
    body.scope === "verified" || body.scope === "both" || body.scope === "reports"
      ? body.scope
      : "both";

  const limit = Math.min(
    Math.max(typeof body.limit === "number" ? body.limit : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const sinceDays =
    typeof body.sinceDays === "number" &&
    body.sinceDays >= 1 &&
    body.sinceDays <= 365
      ? Math.floor(body.sinceDays)
      : DEFAULT_SINCE_DAYS;

  const minSimilarity =
    typeof body.minSimilarity === "number" &&
    body.minSimilarity >= 0 &&
    body.minSimilarity <= 1
      ? body.minSimilarity
      : DEFAULT_MIN_SIMILARITY;

  const domain = selectDomain(scamTypeHint);

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
    const embedResult = await embedQuery([query], { domain });
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
    logger.error("scams/search embed failed", {
      error: String(err),
      keyHash: auth.keyHash,
    });
    return NextResponse.json({ error: "Embedding failed" }, { status: 502 });
  }

  logCost({
    feature: "scams-search",
    provider: "voyage",
    operation: "embeddings.create",
    units: embedTokens,
    estimatedCostUsd: embedCostUsd,
    metadata: { model: embedModelId, domain, stage: "query-embed" },
    requestId: auth.keyHash ?? null,
  });

  // ── Stage 2: ANN over scam_reports and/or verified_scams ────────────
  const queryVecPg = vectorToPgString(queryVector);

  let reports: ScamReportRow[] = [];
  let verified: VerifiedScamRow[] = [];

  if (scope === "reports" || scope === "both") {
    const { data, error } = await supabase.rpc("match_scam_reports", {
      p_query_embedding: queryVecPg,
      p_match_count: ANN_TOP_N,
      p_min_similarity: minSimilarity,
      p_since_days: sinceDays,
    });
    if (error) {
      logger.error("match_scam_reports RPC failed", { error: error.message });
      return NextResponse.json(
        { error: "Search RPC failed" },
        { status: 500 },
      );
    }
    reports = (data ?? []) as ScamReportRow[];
  }

  if (scope === "verified" || scope === "both") {
    const { data, error } = await supabase.rpc("match_verified_scams", {
      p_query_embedding: queryVecPg,
      p_match_count: ANN_TOP_N,
      p_min_similarity: minSimilarity,
    });
    if (error) {
      logger.error("match_verified_scams RPC failed", { error: error.message });
      return NextResponse.json(
        { error: "Search RPC failed" },
        { status: 500 },
      );
    }
    verified = (data ?? []) as VerifiedScamRow[];
  }

  // ── Stage 3: rerank — single combined call across both result sets ──
  let rerankTokens = 0;
  let rerankCostUsd = 0;
  let rerankModelId = "";
  let rerankFallback = false;

  type Combined =
    | { kind: "report"; row: ScamReportRow; doc: string }
    | { kind: "verified"; row: VerifiedScamRow; doc: string };

  const combined: Combined[] = [
    ...reports.map((r) => ({
      kind: "report" as const,
      row: r,
      doc: [
        r.scam_type ? `type:${r.scam_type}` : "",
        r.impersonated_brand ? `brand:${r.impersonated_brand}` : "",
        r.scrubbed_content ?? "",
      ]
        .filter(Boolean)
        .join(" | "),
    })),
    ...verified.map((v) => ({
      kind: "verified" as const,
      row: v,
      doc: [
        v.scam_type ? `type:${v.scam_type}` : "",
        v.impersonated_brand ? `brand:${v.impersonated_brand}` : "",
        v.summary ?? "",
      ]
        .filter(Boolean)
        .join(" | "),
    })),
  ];

  let ranked: Combined[];
  if (combined.length > 1) {
    try {
      const rr = await rerank(
        query,
        combined.map((c) => c.doc),
        {
          topK: limit,
          requestId: auth.keyHash ?? undefined,
        },
      );
      ranked = rr.results
        .slice(0, limit)
        .map((r) => combined[r.index])
        .filter((c): c is Combined => c !== undefined);
      rerankTokens = rr.totalTokens;
      rerankCostUsd = rr.estimatedCostUsd;
      rerankModelId = rr.modelId;

      logCost({
        feature: "scams-search",
        provider: "voyage",
        operation: "rerank",
        units: rerankTokens,
        estimatedCostUsd: rerankCostUsd,
        metadata: {
          model: rerankModelId,
          stage: "post-rerank",
          doc_count: combined.length,
        },
        requestId: auth.keyHash ?? null,
      });
    } catch (err) {
      logger.warn("scams/search rerank failed, falling back to cosine order", {
        error: String(err),
      });
      rerankFallback = true;
      // Cosine-order fallback: merge the two pre-sorted lists by similarity.
      ranked = combined
        .sort((a, b) => b.row.similarity - a.row.similarity)
        .slice(0, limit);
    }
  } else {
    ranked = combined.slice(0, limit);
  }

  return NextResponse.json({
    query,
    domain,
    reports: ranked
      .filter((c) => c.kind === "report")
      .map((c) => {
        const r = c.row as ScamReportRow;
        return {
          id: r.id,
          scamType: r.scam_type,
          verdict: r.verdict,
          confidenceScore: r.confidence_score,
          impersonatedBrand: r.impersonated_brand,
          channel: r.channel,
          region: r.region,
          scrubbedContent: r.scrubbed_content,
          createdAt: r.created_at,
          similarity: r.similarity,
        };
      }),
    verifiedScams: ranked
      .filter((c) => c.kind === "verified")
      .map((c) => {
        const v = c.row as VerifiedScamRow;
        return {
          id: v.id,
          scamType: v.scam_type,
          channel: v.channel,
          summary: v.summary,
          impersonatedBrand: v.impersonated_brand,
          region: v.region,
          confidenceScore: v.confidence_score,
          createdAt: v.created_at,
          similarity: v.similarity,
        };
      }),
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
