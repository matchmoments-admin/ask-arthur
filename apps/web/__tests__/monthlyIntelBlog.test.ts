import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => null),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@askarthur/scam-engine/sanitize", () => ({
  scrubPII: (s: string) => s,
}));

vi.mock("@/lib/cost-telemetry", () => ({
  logCost: vi.fn(),
  claudeSonnet46CostUsd: vi.fn(() => 0.1),
}));

vi.mock("@/lib/blog-cta", () => ({
  appendBlogCtaBlock: (md: string) => `${md}\n\n[CTA]`,
}));

// Flat shape (2026-08-07): post fields live at top level — the nested
// `post` object invited persistent stringified-JSON tool outputs.
const validGeneration = {
  ideas: Array.from({ length: 10 }, (_, i) => ({
    title: `Idea number ${i + 1} about scams`,
    angle: "A one sentence angle",
    dataPoints: ["fact"],
    targetKeyword: "scam",
  })),
  title: "Fake stores flooded June",
  subtitle: "A subtitle",
  excerpt: "Clone-watch logged hundreds of lookalike domains last month.",
  content: "x".repeat(500),
  tags: ["clone-watch"],
  category: "scam-alerts",
};

const mockCallClaudeJson = vi.fn();
// Spread the real module rather than listing what to keep. The first version
// returned only `callClaudeJson`, so when monthlyGenerationSchema started
// importing the shared `objectOrJsonString` from here, this whole FILE failed
// to load — and a file that fails to load reports no failing test, it reports
// fifteen fewer passing ones. The suite still said "1,565 passed".
//
// Only the network call needs stubbing; every pure helper in this module
// should stay real, or the schema under test is not the schema that ships.
vi.mock("@askarthur/scam-engine/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@askarthur/scam-engine/anthropic")>()),
  callClaudeJson: (opts: unknown) => mockCallClaudeJson(opts),
}));

function claudeResult(result: unknown) {
  return {
    result,
    usage: { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cacheHit: false,
    estimatedCostUsd: 0.07,
    modelId: "claude-sonnet-4-6",
  };
}

const { generateMonthlyIntelPost, factsAreTooThin, monthlyGenerationSchema } =
  await import("@/lib/monthly-intel-blog");
const { ghostAdminToken } = await import("@/lib/ghost-admin");
import type { MonthlyIntelFacts } from "@/lib/monthly-intel-blog";

function facts(overrides: Partial<MonthlyIntelFacts> = {}): MonthlyIntelFacts {
  return {
    periodMonth: "2026-06",
    reddit: {
      cohortSize: 100,
      categories: [{ label: "phishing", count: 40 }],
      brands: [{ label: "Apple", count: 10 }],
      tactics: [{ label: "urgency_window", count: 30 }],
      noveltySignals: [],
    },
    competitorObservations: [],
    cloneWatch: {
      totalClones: 804,
      brandCount: 129,
      reportedOnward: 628,
      topBrands: [{ brand: "target.com.au", clones: 43, reported: 34 }],
      weaponisedDomains: [{ domain: "taget.one", target: "target.com.au", date: "2026-07-03" }],
      lifecycle: [
        { label: "detected", count: 523 },
        { label: "declined", count: 802 },
        { label: "weaponised", count: 37 },
      ],
    },
    regulatorAlerts: [{ source: "scamwatch_alert", title: "Food delivery scams", date: "2026-06-12" }],
    consumerReports: { total: 20, categories: [], channels: [], brands: [] },
    existingCoverage: [{ slug: "how-ask-arthur-works", title: "How Ask Arthur Works" }],
    ...overrides,
  };
}

// ── Tests ──

describe("factsAreTooThin", () => {
  it("is false when any stream has data", () => {
    expect(factsAreTooThin(facts())).toBe(false);
  });

  it("is true when reddit, clone-watch and regulator streams are all empty", () => {
    expect(
      factsAreTooThin(
        facts({
          reddit: { cohortSize: 0, categories: [], brands: [], tactics: [], noveltySignals: [] },
          cloneWatch: { totalClones: 0, brandCount: 0, reportedOnward: 0, topBrands: [], weaponisedDomains: [], lifecycle: [] },
          regulatorAlerts: [],
        })
      )
    ).toBe(true);
  });
});

describe("generateMonthlyIntelPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("returns a processed post + ideas for a valid model response", async () => {
    mockCallClaudeJson.mockResolvedValue(claudeResult(validGeneration));

    const result = await generateMonthlyIntelPost(facts());
    expect(result).not.toBeNull();
    expect(result!.slug).toMatch(/^2026-06-fake-stores-flooded-june/);
    expect(result!.content).toContain("[CTA]");
    expect(result!.ideas).toHaveLength(10);
    expect(result!.category).toBe("scam-alerts");
    expect(result!.readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });

  it("coerces an unknown category to scam-alerts", async () => {
    const gen = structuredClone(validGeneration);
    gen.category = "not-a-category";
    mockCallClaudeJson.mockResolvedValue(claudeResult(gen));

    const result = await generateMonthlyIntelPost(facts());
    expect(result!.category).toBe("scam-alerts");
  });

  it("throws when callClaudeJson fails so step.run retries (was a green-lie null)", async () => {
    mockCallClaudeJson.mockRejectedValue(
      new Error("Claude JSON response failed schema validation")
    );

    await expect(generateMonthlyIntelPost(facts())).rejects.toThrow(
      /generation failed validation/
    );
  });

  it("returns null without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await generateMonthlyIntelPost(facts())).toBeNull();
    expect(mockCallClaudeJson).not.toHaveBeenCalled();
  });

  it("rejects drafts containing placeholder tokens like [NAME]", async () => {
    const gen = structuredClone(validGeneration);
    gen.content = "x".repeat(300) + " [NAME] is one of Australia's most popular platforms " + "y".repeat(200);
    mockCallClaudeJson.mockResolvedValue(claudeResult(gen));

    await expect(generateMonthlyIntelPost(facts())).rejects.toThrow(
      /placeholder token/
    );
  });

  it("does not flag callout markers or ALL-CAPS markdown links as placeholders", async () => {
    const gen = structuredClone(validGeneration);
    gen.content =
      "> [!WARNING] real warning\n\nSee [ACCC](https://www.accc.gov.au) guidance. " + "x".repeat(450);
    mockCallClaudeJson.mockResolvedValue(claudeResult(gen));

    expect(await generateMonthlyIntelPost(facts())).not.toBeNull();
  });

  it("forces tool-use JSON with the generation schema", async () => {
    mockCallClaudeJson.mockResolvedValue(claudeResult(validGeneration));
    await generateMonthlyIntelPost(facts());
    expect(mockCallClaudeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "SONNET_4_6",
        useToolUse: true,
        toolName: "submit_monthly_blog",
      })
    );
  });
});

describe("monthlyGenerationSchema leniency", () => {
  it("accepts the flat structure", () => {
    expect(monthlyGenerationSchema.safeParse(validGeneration).success).toBe(true);
  });

  it("accepts JSON-stringified ideas/tags arrays and re-validates them", () => {
    const parsed = monthlyGenerationSchema.parse({
      ...validGeneration,
      ideas: JSON.stringify(validGeneration.ideas),
      tags: JSON.stringify(validGeneration.tags),
    });
    expect(Array.isArray(parsed.ideas)).toBe(true);
    expect(Array.isArray(parsed.tags)).toBe(true);
  });

  it("rejects stringified ideas that fail the inner schema", () => {
    expect(
      monthlyGenerationSchema.safeParse({
        ...validGeneration,
        ideas: JSON.stringify([{ title: "only one idea" }]),
      }).success
    ).toBe(false);
  });

  it("stays representable as a tool-use JSON Schema (what callClaudeJson does)", async () => {
    const { z } = await import("zod");
    const jsonSchema = z.toJSONSchema(monthlyGenerationSchema, { io: "input" });
    expect(jsonSchema).toHaveProperty("properties.title");
    expect(jsonSchema).toHaveProperty("properties.content");
    expect(jsonSchema).toHaveProperty("properties.ideas");
  });
});

describe("ghostAdminToken", () => {
  it("produces a three-part JWT carrying the key id", () => {
    const token = ghostAdminToken("abc123:deadbeef");
    expect(token).not.toBeNull();
    const [header, payload, sig] = token!.split(".");
    expect(sig).toBeTruthy();
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString());
    expect(decodedHeader).toMatchObject({ alg: "HS256", kid: "abc123" });
    const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(decodedPayload.aud).toBe("/admin/");
    expect(decodedPayload.exp - decodedPayload.iat).toBe(300);
  });

  it("rejects a key without the id:secret shape", () => {
    expect(ghostAdminToken("no-colon-here")).toBeNull();
  });
});
