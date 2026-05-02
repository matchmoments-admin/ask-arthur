import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { embed, embedQuery } from "../embeddings";

// Locks in the document/query asymmetry: embed() must send
// input_type=document and embedQuery() must send input_type=query.
// Skipping that distinction silently halves recall on retrieval, so the
// guarantee is encoded as a test rather than a comment alone.
//
// Mocks fetch directly — neither network nor an API key is needed.

const FAKE_VOYAGE_RESPONSE = {
  data: [{ embedding: new Array(1024).fill(0.01), index: 0 }],
  model: "voyage-3.5",
  usage: { total_tokens: 1 },
};

describe("embed / embedQuery — Voyage input_type", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.VOYAGE_API_KEY = "test-key";
    process.env.EMBEDDING_PROVIDER = "voyage";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(FAKE_VOYAGE_RESPONSE), {
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
  });
});
