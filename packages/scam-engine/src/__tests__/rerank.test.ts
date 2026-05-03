import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rerank } from "../rerank";

// Locks the rerank request shape (POST /v1/rerank, body fields, model id)
// and result-mapping invariants. The reranker is the high-leverage second
// stage in the two-stage retrieval pipeline (Anthropic measured 67%
// retrieval-failure reduction); a regression here silently degrades the
// /api/v1/intel/search endpoint to embedding-only ordering.

describe("rerank", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
    delete process.env.VOYAGE_RERANK_MODEL;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { index: 2, relevance_score: 0.92 },
            { index: 0, relevance_score: 0.74 },
            { index: 1, relevance_score: 0.31 },
          ],
          model: "rerank-2.5-lite",
          usage: { total_tokens: 150 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("posts to /v1/rerank with the canonical body shape", async () => {
    await rerank("query text", ["doc a", "doc b", "doc c"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.voyageai.com/v1/rerank");
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe("query text");
    expect(body.documents).toEqual(["doc a", "doc b", "doc c"]);
    expect(body.model).toBe("rerank-2.5-lite");
    expect(body.return_documents).toBe(false);
  });

  it("returns results sorted by relevance DESC and preserves original index", async () => {
    const r = await rerank("q", ["a", "b", "c"]);
    expect(r.results).toEqual([
      { index: 2, relevanceScore: 0.92 },
      { index: 0, relevanceScore: 0.74 },
      { index: 1, relevanceScore: 0.31 },
    ]);
  });

  it("computes cost from total_tokens × per-token rate", async () => {
    const r = await rerank("q", ["a", "b", "c"]);
    // rerank-2.5-lite = $0.02/M = 2e-8 per token, 150 tokens → 3e-6
    expect(r.estimatedCostUsd).toBeCloseTo(150 * (0.02 / 1_000_000), 12);
    expect(r.totalTokens).toBe(150);
    expect(r.modelId).toBe("rerank-2.5-lite");
  });

  it("VOYAGE_RERANK_MODEL=rerank-2.5 routes to the bigger tier", async () => {
    process.env.VOYAGE_RERANK_MODEL = "rerank-2.5";
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          object: "list",
          data: [{ index: 0, relevance_score: 1 }],
          model: "rerank-2.5",
          usage: { total_tokens: 100 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await rerank("q", ["a", "b"]);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.model).toBe("rerank-2.5");
    // rerank-2.5 = $0.05/M = 5e-8 per token, 100 tokens → 5e-6
    expect(r.estimatedCostUsd).toBeCloseTo(100 * (0.05 / 1_000_000), 12);
  });

  it("empty documents list short-circuits without fetch", async () => {
    const r = await rerank("q", []);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.results).toEqual([]);
    expect(r.totalTokens).toBe(0);
  });

  it("single document returns as-is without fetch", async () => {
    const r = await rerank("q", ["solo"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.results).toEqual([{ index: 0, relevanceScore: 1 }]);
  });

  it("topK is forwarded as top_k", async () => {
    await rerank("q", ["a", "b", "c", "d"], { topK: 2 });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.top_k).toBe(2);
  });

  it("HTTP failure throws — caller's retry boundary handles it", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("rate limit", { status: 429 }),
    );
    await expect(rerank("q", ["a", "b"])).rejects.toThrow(/Voyage rerank 429/);
  });

  it("unknown modelId throws clearly", async () => {
    await expect(
      rerank("q", ["a", "b"], { modelId: "rerank-99-imaginary" }),
    ).rejects.toThrow(/Unknown rerank modelId/);
  });

  it("missing VOYAGE_API_KEY throws clearly", async () => {
    delete process.env.VOYAGE_API_KEY;
    await expect(rerank("q", ["a", "b"])).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});
