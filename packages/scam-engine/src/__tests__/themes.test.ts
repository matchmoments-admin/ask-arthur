import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../embeddings", () => ({
  embedQuery: vi.fn(),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import {
  getRelevantThemes,
  renderThemesForPrompt,
  type RelevantTheme,
} from "../retrieval/themes";
import { embedQuery } from "../embeddings";
import { createServiceClient } from "@askarthur/supabase/server";

const mockEmbedQuery = vi.mocked(embedQuery);
const mockCreateServiceClient = vi.mocked(createServiceClient);

function makeSupabaseMock(
  rpcResult: { data: unknown[] | null; error: { message: string } | null },
  telemetryInsert: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({ error: null }),
) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    // from() handles fire-and-forget cost_telemetry writes. Default no-op.
    from: vi.fn().mockReturnValue({ insert: telemetryInsert }),
  } as unknown as ReturnType<typeof createServiceClient>;
}

const sampleRow = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "payid-relative-collect",
  title: "PayID 'relative will collect'",
  narrative:
    "Marketplace buyer offers PayID and sends a relative to collect.",
  modus_operandi:
    "Buyer fakes urgency, sends a forged PayID confirmation email.",
  representative_brands: ["PayID", "Facebook Marketplace"],
  top_tactic_tags: ["urgency_window", "authority_appeal"],
  signal_strength: "strong" as const,
  member_count: 14,
  similarity: 0.78,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedQuery.mockResolvedValue({
    vectors: [Array(1024).fill(0.01)],
    provider: "voyage",
    modelId: "voyage-3.5",
    domain: "generic",
    totalTokens: 50,
    estimatedCostUsd: 0.000003,
  });
});

describe("getRelevantThemes", () => {
  it("returns [] for empty/whitespace text without calling embed", async () => {
    const result = await getRelevantThemes("   ");
    expect(result).toEqual([]);
    expect(mockEmbedQuery).not.toHaveBeenCalled();
  });

  it("returns [] when supabase is not configured", async () => {
    mockCreateServiceClient.mockReturnValue(null);
    const result = await getRelevantThemes("hello scam");
    expect(result).toEqual([]);
    expect(mockEmbedQuery).not.toHaveBeenCalled();
  });

  it("maps the RPC row shape to camelCase RelevantTheme", async () => {
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: [sampleRow], error: null }),
    );
    const result = await getRelevantThemes("payid scam");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: sampleRow.id,
      slug: "payid-relative-collect",
      title: "PayID 'relative will collect'",
      narrative: sampleRow.narrative,
      modusOperandi: sampleRow.modus_operandi,
      representativeBrands: ["PayID", "Facebook Marketplace"],
      topTacticTags: ["urgency_window", "authority_appeal"],
      signalStrength: "strong",
      memberCount: 14,
      similarity: 0.78,
    });
  });

  it("forwards opts to the RPC", async () => {
    const rpcSpy = vi.fn().mockResolvedValue({ data: [], error: null });
    mockCreateServiceClient.mockReturnValue({
      rpc: rpcSpy,
    } as unknown as ReturnType<typeof createServiceClient>);

    await getRelevantThemes("test", {
      k: 5,
      minSimilarity: 0.6,
      minSignalStrength: "strong",
      requestId: "req-1",
    });

    expect(rpcSpy).toHaveBeenCalledWith("match_themes_by_centroid", {
      p_query_embedding: expect.any(Array),
      p_match_count: 5,
      p_min_similarity: 0.6,
      p_min_signal_strength: "strong",
    });
  });

  it("returns [] (does NOT throw) when RPC errors — RAG is decorative", async () => {
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: null, error: { message: "boom" } }),
    );
    const result = await getRelevantThemes("text");
    expect(result).toEqual([]);
  });

  it("returns [] when embedQuery throws — RAG is decorative", async () => {
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: [], error: null }),
    );
    mockEmbedQuery.mockRejectedValueOnce(new Error("voyage down"));
    const result = await getRelevantThemes("text");
    expect(result).toEqual([]);
  });

  it("emits a themes-retrieval cost_telemetry row on each call", async () => {
    const telemetryInsert = vi.fn().mockResolvedValue({ error: null });
    mockCreateServiceClient.mockReturnValue(
      makeSupabaseMock({ data: [sampleRow], error: null }, telemetryInsert),
    );

    await getRelevantThemes("payid scam");
    // Fire-and-forget — flush microtasks before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(telemetryInsert).toHaveBeenCalledTimes(1);
    const row = telemetryInsert.mock.calls[0]?.[0];
    expect(row?.feature).toBe("themes-retrieval");
    expect(row?.operation).toBe("embeddings.create");
    expect(row?.units).toBe(50);
    expect(row?.estimated_cost_usd).toBeCloseTo(0.000003);
  });
});

describe("renderThemesForPrompt", () => {
  it("returns empty string for empty list", () => {
    expect(renderThemesForPrompt([])).toBe("");
  });

  it("includes title, narrative, brands, and modus operandi", () => {
    const themes: RelevantTheme[] = [
      {
        id: "1",
        slug: "payid-relative",
        title: "PayID 'relative will collect'",
        narrative:
          "Marketplace buyer offers PayID and sends a relative to collect.",
        modusOperandi:
          "Buyer sends forged PayID confirmation requesting an account upgrade fee.",
        representativeBrands: ["PayID", "Facebook Marketplace"],
        topTacticTags: ["urgency_window", "authority_appeal"],
        signalStrength: "strong",
        memberCount: 14,
        similarity: 0.8,
      },
    ];
    const out = renderThemesForPrompt(themes);
    expect(out).toContain("RECENT AUSTRALIAN SCAM PATTERNS");
    expect(out).toContain("PayID 'relative will collect'");
    expect(out).toContain("Marketplace buyer offers PayID");
    expect(out).toContain("Targets: PayID, Facebook Marketplace");
    expect(out).toContain("Modus operandi:");
    expect(out).toContain("Common tactics: urgency_window, authority_appeal");
    expect(out).toContain(
      "name it in the summary using the title above",
    );
  });

  it("omits the tactics line when there are no tactic tags", () => {
    const themes: RelevantTheme[] = [
      {
        id: "1",
        slug: "x",
        title: "X",
        narrative: "n",
        modusOperandi: null,
        representativeBrands: [],
        topTacticTags: [],
        signalStrength: "weak",
        memberCount: 1,
        similarity: 0.5,
      },
    ];
    expect(renderThemesForPrompt(themes)).not.toContain("Common tactics");
  });

  it("caps targets at 3 brands", () => {
    const themes: RelevantTheme[] = [
      {
        id: "1",
        slug: "x",
        title: "X",
        narrative: null,
        modusOperandi: null,
        representativeBrands: ["A", "B", "C", "D", "E"],
        topTacticTags: [],
        signalStrength: "weak",
        memberCount: 1,
        similarity: 0.5,
      },
    ];
    const out = renderThemesForPrompt(themes);
    // Targets line names exactly the first three brands.
    expect(out).toMatch(/Targets: A, B, C\./);
    // Letters D and E never appear in the targets list (they CAN appear
    // in the surrounding scaffolding like "RECENT" — assert only that
    // they're not in the brands list).
    expect(out).not.toMatch(/Targets: [^.]*[DE]/);
  });
});
