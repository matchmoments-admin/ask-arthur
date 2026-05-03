import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { embed, embedQuery } from "../embeddings";

// Locks in two invariants:
//   1. document/query asymmetry — embed() sends input_type=document and
//      embedQuery() sends input_type=query. Skipping that distinction
//      silently halves recall on Voyage retrieval.
//   2. domain routing — domain="finance" routes to voyage-finance-2 and
//      omits the output_dimension param (finance has no Matryoshka). A
//      regression here would silently mis-bill (wrong $/tok) AND mis-write
//      embeddings to the wrong column-version pair.
//
// Mocks fetch directly — neither network nor an API key is needed beyond
// the env-var presence check.

function fakeVoyageResponse(modelId: string) {
  return {
    data: [{ embedding: new Array(1024).fill(0.01), index: 0 }],
    model: modelId,
    usage: { total_tokens: 1 },
  };
}

describe("embed / embedQuery — Voyage input_type", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
    process.env.EMBEDDING_PROVIDER = "voyage";
    delete process.env.EMBEDDING_MODEL_GENERIC;
    delete process.env.EMBEDDING_MODEL_FINANCE;
    delete process.env.EMBEDDING_MODEL_MULTIMODAL;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeVoyageResponse("voyage-3.5")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("embed() sends input_type=document", async () => {
    await embed(["a document to be stored"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.input_type).toBe("document");
    expect(body.model).toBe("voyage-3.5");
    expect(body.output_dimension).toBe(1024);
  });

  it("embedQuery() sends input_type=query", async () => {
    await embedQuery(["a search query"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.input_type).toBe("query");
    expect(body.model).toBe("voyage-3.5");
  });

  it("returns the model id used (so callers can persist embedding_model_version)", async () => {
    const r = await embed(["doc"]);
    expect(r.modelId).toBe("voyage-3.5");
    expect(r.domain).toBe("generic");
    expect(r.provider).toBe("voyage");
  });
});

describe("embed — domain routing", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
    process.env.EMBEDDING_PROVIDER = "voyage";
    delete process.env.EMBEDDING_MODEL_GENERIC;
    delete process.env.EMBEDDING_MODEL_FINANCE;
    delete process.env.EMBEDDING_MODEL_MULTIMODAL;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("domain=finance routes to voyage-finance-2 with NO output_dimension", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeVoyageResponse("voyage-finance-2")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await embed(["invoice payable to ACME LLC"], {
      domain: "finance",
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.model).toBe("voyage-finance-2");
    // Finance model is not Matryoshka — output_dimension must NOT appear,
    // otherwise Voyage rejects the request.
    expect(body).not.toHaveProperty("output_dimension");
    expect(r.modelId).toBe("voyage-finance-2");
    expect(r.domain).toBe("finance");
    // 0.12 / 1M = 1.2e-7 per token; with usage.total_tokens=1 → 1.2e-7.
    expect(r.estimatedCostUsd).toBeCloseTo(0.12 / 1_000_000, 12);
  });

  it("EMBEDDING_MODEL_GENERIC env var overrides domain default", async () => {
    process.env.EMBEDDING_MODEL_GENERIC = "voyage-3.5-lite";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeVoyageResponse("voyage-3.5-lite")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await embed(["text"]);
    expect(r.modelId).toBe("voyage-3.5-lite");
    expect(r.estimatedCostUsd).toBeCloseTo(0.02 / 1_000_000, 12);
  });

  it("EMBEDDING_PROVIDER=openai still works (legacy backward compat)", async () => {
    process.env.EMBEDDING_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: new Array(1024).fill(0.01), index: 0 }],
          model: "text-embedding-3-small",
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await embed(["text"]);
    expect(r.provider).toBe("openai");
    expect(r.modelId).toBe("text-embedding-3-small");
  });

  it("domain=multimodal throws — call path not yet wired", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(embed(["text"], { domain: "multimodal" })).rejects.toThrow(
      /not yet implemented/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("modelId override bypasses domain routing", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(fakeVoyageResponse("voyage-finance-2")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await embed(["text"], { modelId: "voyage-finance-2" });
    expect(r.modelId).toBe("voyage-finance-2");
    expect(r.domain).toBe("finance");
  });

  it("unknown modelId throws clearly", async () => {
    await expect(
      embed(["text"], { modelId: "voyage-99-imaginary" }),
    ).rejects.toThrow(/Unknown modelId/);
  });
});
