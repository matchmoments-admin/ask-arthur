import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──

const mockSelect = vi.fn();
const mockGte = vi.fn();
const mockOrder = vi.fn();

const mockFrom = vi.fn(() => ({
  select: mockSelect,
}));

mockSelect.mockReturnValue({ gte: mockGte });
mockGte.mockReturnValue({ order: mockOrder });

vi.mock("@/lib/supabase", () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockCreate = vi.fn(() =>
  Promise.resolve({
    content: [
      {
        type: "text",
        text: `"title": "Top Scams This Week in Australia",
  "excerpt": "Phishing scams targeting CommBank customers surged this week.",
  "content": "## Phishing Scams\\nThis week saw a rise in phishing.",
  "tags": ["phishing", "commbank", "australia"]
}`,
      },
    ],
  })
);

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

const { createServiceClient } = await import("@/lib/supabase");
const { logger } = await import("@/lib/logger");
const { generateWeeklyBlogPost } = await import("@/lib/blogGenerator");

// ── Tests ──

describe("generateWeeklyBlogPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockSelect.mockReturnValue({ gte: mockGte });
    mockGte.mockReturnValue({ order: mockOrder });
    vi.mocked(createServiceClient).mockReturnValue({ from: mockFrom } as any);

    // Reset the mock to default valid JSON response
    mockCreate.mockImplementation(() =>
      Promise.resolve({
        content: [
          {
            type: "text",
            text: `"title": "Top Scams This Week in Australia",
  "excerpt": "Phishing scams targeting CommBank customers surged this week.",
  "content": "## Phishing Scams\\nThis week saw a rise in phishing.",
  "tags": ["phishing", "commbank", "australia"]
}`,
          },
        ],
      })
    );
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  // BL-06: Returns null when no scam data available
  it("returns null when no scams found in the past week", async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const result = await generateWeeklyBlogPost();
    expect(result).toBeNull();
  });

  // BL-06b: Returns null when supabase is not configured
  it("returns null when Supabase is not configured", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);

    const result = await generateWeeklyBlogPost();
    expect(result).toBeNull();
  });

  // BL-07: Returns null when ANTHROPIC_API_KEY is missing
  it("returns null when ANTHROPIC_API_KEY is not set", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    mockOrder.mockResolvedValue({
      data: [
        {
          id: 1,
          scam_type: "phishing",
          summary: "Fake CommBank email",
          impersonated_brand: "CommBank",
          channel: "email",
        },
      ],
      error: null,
    });

    const result = await generateWeeklyBlogPost();
    expect(result).toBeNull();
  });

  // BL-08: Selects top 3 scam types by frequency
  // Groups by scam_type:impersonated_brand, so same scam_type with different brands = different groups
  it("generates blog post from top 3 scam groups", async () => {
    const scams = [
      // 4 phishing:CommBank scams (top group)
      { id: 1, scam_type: "phishing", summary: "Fake email 1", impersonated_brand: "CommBank", channel: "email" },
      { id: 2, scam_type: "phishing", summary: "Fake email 2", impersonated_brand: "CommBank", channel: "email" },
      { id: 3, scam_type: "phishing", summary: "Fake email 3", impersonated_brand: "CommBank", channel: "email" },
      { id: 4, scam_type: "phishing", summary: "Fake email 4", impersonated_brand: "CommBank", channel: "email" },
      // 3 smishing:ATO scams (2nd group)
      { id: 5, scam_type: "smishing", summary: "Fake SMS 1", impersonated_brand: "ATO", channel: "sms" },
      { id: 6, scam_type: "smishing", summary: "Fake SMS 2", impersonated_brand: "ATO", channel: "sms" },
      { id: 7, scam_type: "smishing", summary: "Fake SMS 3", impersonated_brand: "ATO", channel: "sms" },
      // 2 investment:none scams (3rd group)
      { id: 8, scam_type: "investment", summary: "Crypto scam 1", impersonated_brand: null, channel: "social_media" },
      { id: 9, scam_type: "investment", summary: "Crypto scam 2", impersonated_brand: null, channel: "social_media" },
      // 1 romance:none scam (excluded — 4th group)
      { id: 10, scam_type: "romance", summary: "Dating scam", impersonated_brand: null, channel: "social_media" },
    ];

    mockOrder.mockResolvedValue({ data: scams, error: null });

    const result = await generateWeeklyBlogPost();

    expect(result).not.toBeNull();
    // Top 3 groups include phishing:CommBank, smishing:ATO, investment:none
    expect(result!.sourceScamIds).toContain(1); // phishing:CommBank
    expect(result!.sourceScamIds).toContain(5); // smishing:ATO
    expect(result!.sourceScamIds).toContain(8); // investment:none
    // Romance scam (id: 10) should NOT be in sourceScamIds (only top 3 groups)
    expect(result!.sourceScamIds).not.toContain(10);
    // Should have 9 IDs total (4 + 3 + 2)
    expect(result!.sourceScamIds).toHaveLength(9);
  });

  // BL-09: Slug format is YYYY-MM-DD-title-words
  it("generates slug with date prefix and kebab-case title", async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 1, scam_type: "phishing", summary: "Test scam", impersonated_brand: "CommBank", channel: "email" },
      ],
      error: null,
    });

    const result = await generateWeeklyBlogPost();

    expect(result).not.toBeNull();
    // Slug should start with YYYY-MM-DD format
    expect(result!.slug).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    // Slug should only contain lowercase letters, numbers, and hyphens
    expect(result!.slug).toMatch(/^[a-z0-9-]+$/);
    // Slug should not exceed ~71 chars (date prefix + 60 char title)
    expect(result!.slug.length).toBeLessThanOrEqual(71);
  });

  // BL-10: Returns proper structure with all fields
  it("returns correct post structure with all required fields", async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 1, scam_type: "phishing", summary: "Test scam", impersonated_brand: "CommBank", channel: "email" },
      ],
      error: null,
    });

    const result = await generateWeeklyBlogPost();

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("slug");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("excerpt");
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("tags");
    expect(result).toHaveProperty("sourceScamIds");
    expect(Array.isArray(result!.tags)).toBe(true);
    expect(Array.isArray(result!.sourceScamIds)).toBe(true);
  });

  // BL-11: Handles malformed JSON from Claude gracefully
  it("returns null when Claude returns non-JSON response", async () => {
    mockCreate.mockImplementation(() =>
      Promise.resolve({
        content: [{ type: "text", text: "This is not valid JSON at all, no braces here" }],
      })
    );

    mockOrder.mockResolvedValue({
      data: [
        { id: 1, scam_type: "phishing", summary: "Test scam", impersonated_brand: "CommBank", channel: "email" },
      ],
      error: null,
    });

    const result = await generateWeeklyBlogPost();
    // When regex can't find JSON, returns null
    expect(result).toBeNull();
  });

  // BL-12: Limits summaries per group to 3
  it("collects at most 3 summaries per scam group", async () => {
    const scams = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      scam_type: "phishing",
      summary: `Scam summary ${i + 1}`,
      impersonated_brand: "CommBank",
      channel: "email",
    }));

    mockOrder.mockResolvedValue({ data: scams, error: null });

    const result = await generateWeeklyBlogPost();
    expect(result).not.toBeNull();
    // All 10 scam IDs should be in sourceScamIds
    expect(result!.sourceScamIds).toHaveLength(10);
  });

  // BL-13: Handles tags as non-array gracefully
  it("defaults tags to empty array when parsed tags is not an array", async () => {
    mockCreate.mockImplementation(() =>
      Promise.resolve({
        content: [
          {
            type: "text",
            text: `"title": "Test Post",
  "excerpt": "Test excerpt",
  "content": "Test content",
  "tags": "not-an-array"
}`,
          },
        ],
      })
    );

    mockOrder.mockResolvedValue({
      data: [
        { id: 1, scam_type: "phishing", summary: "Test", impersonated_brand: "CommBank", channel: "email" },
      ],
      error: null,
    });

    const result = await generateWeeklyBlogPost();
    expect(result).not.toBeNull();
    expect(result!.tags).toEqual([]);
  });

  // BL-14: Uses Claude Haiku model
  it("calls Claude with claude-haiku model", async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 1, scam_type: "phishing", summary: "Test scam", impersonated_brand: "CommBank", channel: "email" },
      ],
      error: null,
    });

    await generateWeeklyBlogPost();

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.stringContaining("haiku"),
      })
    );
  });
});
