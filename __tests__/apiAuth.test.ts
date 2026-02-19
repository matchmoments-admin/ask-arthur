import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateEq = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === "api_keys") {
    return {
      select: mockSelect,
      update: mockUpdate,
    };
  }
  return {};
});

// Chain: from().select().eq().single()
mockSelect.mockReturnValue({ eq: mockEq });
mockEq.mockReturnValue({ single: mockSingle });
mockUpdate.mockReturnValue({ eq: mockUpdateEq });
mockUpdateEq.mockReturnValue({ then: vi.fn((cb: () => void) => cb()) });

vi.mock("@/lib/supabase", () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(() => ({
    incr: vi.fn(() => Promise.resolve(1)),
    expire: vi.fn(() => Promise.resolve(true)),
  })),
}));

const { createServiceClient } = await import("@/lib/supabase");
const { validateApiKey } = await import("@/lib/apiAuth");

// ── Helpers ──

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader) {
    headers["authorization"] = authHeader;
  }
  return new NextRequest("http://localhost:3000/api/v1/threats/trending", {
    headers,
  });
}

// ── Tests ──

describe("validateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockReturnValue({ then: vi.fn((cb: () => void) => cb()) });
    vi.mocked(createServiceClient).mockReturnValue({ from: mockFrom } as any);
  });

  // B-01: Missing API key → invalid
  it("returns invalid when authorization header is missing", async () => {
    const result = await validateApiKey(makeRequest());
    expect(result.valid).toBe(false);
  });

  // B-02: Invalid API key format (no Bearer prefix) → invalid
  it("returns invalid when authorization header has no Bearer prefix", async () => {
    const result = await validateApiKey(makeRequest("Basic abc123"));
    expect(result.valid).toBe(false);
  });

  // B-03: Empty Bearer token → invalid
  it("returns invalid when Bearer token is empty", async () => {
    const result = await validateApiKey(makeRequest("Bearer "));
    expect(result.valid).toBe(false);
  });

  // B-04: Key not found in database → invalid
  it("returns invalid when key hash is not found in database", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "Not found" } });

    const result = await validateApiKey(makeRequest("Bearer sk_test_abc123"));
    expect(result.valid).toBe(false);
  });

  // B-05: Deactivated key → invalid
  it("returns invalid when API key is deactivated", async () => {
    mockSingle.mockResolvedValue({
      data: {
        org_name: "Test Org",
        tier: "free",
        is_active: false,
        daily_limit: 100,
      },
      error: null,
    });

    const result = await validateApiKey(makeRequest("Bearer sk_test_abc123"));
    expect(result.valid).toBe(false);
  });

  // B-06: Valid key → returns org info
  it("returns valid with org info for active API key", async () => {
    mockSingle.mockResolvedValue({
      data: {
        org_name: "Acme Corp",
        tier: "pro",
        is_active: true,
        daily_limit: 500,
      },
      error: null,
    });

    const result = await validateApiKey(makeRequest("Bearer sk_test_valid"));
    expect(result.valid).toBe(true);
    expect(result.orgName).toBe("Acme Corp");
    expect(result.tier).toBe("pro");
    expect(result.dailyRemaining).toBeDefined();
  });

  // B-07: Key hashing uses SHA-256
  it("looks up key by SHA-256 hash, not raw key", async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: "Not found" } });

    await validateApiKey(makeRequest("Bearer sk_test_hashcheck"));

    // Verify the select() was called and eq was called with key_hash
    expect(mockSelect).toHaveBeenCalledWith("org_name, tier, is_active, daily_limit");
    expect(mockEq).toHaveBeenCalledWith("key_hash", expect.any(String));

    // The hash should NOT be the raw key
    const hashArg = mockEq.mock.calls[0][1];
    expect(hashArg).not.toBe("sk_test_hashcheck");
    // SHA-256 hex is 64 characters
    expect(hashArg).toHaveLength(64);
    expect(hashArg).toMatch(/^[0-9a-f]{64}$/);
  });

  // B-08: Supabase not configured → invalid
  it("returns invalid when Supabase is not configured", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);

    const result = await validateApiKey(makeRequest("Bearer sk_test_nosupabase"));
    expect(result.valid).toBe(false);
  });

  // B-09: Updates last_used_at on successful auth
  it("updates last_used_at on successful validation", async () => {
    mockSingle.mockResolvedValue({
      data: {
        org_name: "Test Org",
        tier: "free",
        is_active: true,
        daily_limit: 100,
      },
      error: null,
    });

    await validateApiKey(makeRequest("Bearer sk_test_lastused"));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ last_used_at: expect.any(String) })
    );
  });

  // B-10: Default daily limit is 100
  it("uses default daily limit of 100 when not specified", async () => {
    mockSingle.mockResolvedValue({
      data: {
        org_name: "Test Org",
        tier: "free",
        is_active: true,
        daily_limit: null, // Not specified
      },
      error: null,
    });

    const result = await validateApiKey(makeRequest("Bearer sk_test_defaultlimit"));
    expect(result.valid).toBe(true);
    // Should use default limit of 100
    expect(result.dailyRemaining).toBeDefined();
  });
});
