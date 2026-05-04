import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks must be hoisted before the import.
vi.mock("../embeddings", () => ({
  embedQuery: vi.fn(),
}));
vi.mock("../rerank", () => ({
  rerank: vi.fn(),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { getSimilarReports } from "../retrieval/similar-reports";
import { embedQuery } from "../embeddings";
import { rerank } from "../rerank";
import { createServiceClient } from "@askarthur/supabase/server";

const mockEmbedQuery = vi.mocked(embedQuery);
const mockRerank = vi.mocked(rerank);
const mockCreateServiceClient = vi.mocked(createServiceClient);

function makeSupabaseMock(rpcResult: { data: unknown[] | null; error: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as ReturnType<typeof createServiceClient>;
}

const sampleHybridRow = {
  id: 1,
  scam_type: "phishing",
  verdict: "HIGH_RISK",
  confidence_score: 0.91,
  impersonated_brand: "MyGov",
  channel: "email",
  region: "Sydney, New South Wales",
  scrubbed_content: "Your tax refund is ready, click here to claim",
  created_at: "2026-04-29T03:00:00Z",
  similarity: 0.78,
  bm25_rank: 1,
  dense_rank: 2,
  rrf_score: 0.032,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedQuery.mockResolvedValue({
    vectors: [Array(1024).fill(0.1)],
    provider: "voyage",
    modelId: "voyage-3.5",
    domain: "generic",
    totalTokens: 50,
    estimatedCostUsd: 0.000003,
  });
});

describe("getSimilarReports", () => {
  it("returns [] for empty text without calling embed/rerank/RPC", async () => {
    const result = await getSimilarReports("   ");
    expect(result).toEqual([]);
    expect(mockEmbedQuery).not.toHaveBeenCalled();
    expect(mockRerank).not.toHaveBeenCalled();
  });

  it("returns [] when supabase is not configured", async () => {
    mockCreateServiceClient.mockReturnValue(null);
    const result = await getSimilarReports("hello scam");
    expect(result).toEqual([]);
    expect(mockEmbedQuery).not.toHaveBeenCalled();
  });

  it("returns [] when hybrid RPC returns zero candidates", async () => {
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: [], error: null }),
    );
    const result = await getSimilarReports("nothing matches");
    expect(result).toEqual([]);
    expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
    expect(mockRerank).not.toHaveBeenCalled(); // skipped on empty pool
  });

  it("filters out candidates below minRelevance after rerank", async () => {
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: [sampleHybridRow, { ...sampleHybridRow, id: 2 }], error: null }),
    );
    mockRerank.mockResolvedValue({
      results: [
        { index: 0, relevanceScore: 0.85 },
        { index: 1, relevanceScore: 0.2 }, // below 0.4 default cutoff
      ],
      modelId: "rerank-2.5-lite",
      totalTokens: 1000,
      estimatedCostUsd: 0.00002,
    });

    const result = await getSimilarReports("tax refund email");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].rerankRelevance).toBe(0.85);
  });

  it("respects topK after relevance filtering", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      ...sampleHybridRow,
      id: i + 1,
    }));
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: candidates, error: null }),
    );
    mockRerank.mockResolvedValue({
      results: candidates.map((_, i) => ({
        index: i,
        relevanceScore: 0.9 - i * 0.05, // 0.9, 0.85, 0.80, ...
      })),
      modelId: "rerank-2.5-lite",
      totalTokens: 5000,
      estimatedCostUsd: 0.0001,
    });

    const result = await getSimilarReports("scam pattern", { k: 3 });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("excludes candidates with NULL scrubbed_content from reranker input", async () => {
    const withContent = { ...sampleHybridRow, id: 1 };
    const noContent = { ...sampleHybridRow, id: 2, scrubbed_content: null };

    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: [withContent, noContent], error: null }),
    );
    mockRerank.mockResolvedValue({
      results: [{ index: 0, relevanceScore: 0.7 }],
      modelId: "rerank-2.5-lite",
      totalTokens: 200,
      estimatedCostUsd: 0.000004,
    });

    await getSimilarReports("anything");

    // Rerank should be called with only the row that has content (length 1).
    expect(mockRerank).toHaveBeenCalledTimes(1);
    const docs = mockRerank.mock.calls[0]?.[1];
    expect(docs).toHaveLength(1);
    expect(docs?.[0]).toBe(withContent.scrubbed_content);
  });

  it("throws on supabase RPC error so the caller can fall back", async () => {
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: null, error: { message: "connection lost" } }),
    );
    await expect(getSimilarReports("scam")).rejects.toThrow(/connection lost/);
  });

  it("rejects non-allowed verdict values defensively", async () => {
    // Defensive narrowing: if a future migration adds a new verdict literal
    // to scam_reports, the helper must not surface it as one of the typed
    // allowed values without a type-level update first.
    const weirdVerdict = { ...sampleHybridRow, id: 99, verdict: "FUTURE_NEW_VERDICT" };
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: [weirdVerdict], error: null }),
    );
    mockRerank.mockResolvedValue({
      results: [{ index: 0, relevanceScore: 0.9 }],
      modelId: "rerank-2.5-lite",
      totalTokens: 200,
      estimatedCostUsd: 0.000004,
    });

    const result = await getSimilarReports("anything");
    expect(result).toEqual([]);
  });
});
