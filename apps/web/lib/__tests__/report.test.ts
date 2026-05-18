// Regression guard for the React.cache wrap on getLatestAuditByDomain.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { getLatestAuditByDomain } from "../report";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLatestAuditByDomain — cache wrap regression guard", () => {
  it("imports cache from react at the definition site", () => {
    const src = readFileSync(join(__dirname, "..", "report.ts"), "utf8");
    expect(src).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
  });

  it("wraps the exported async function with cache(", () => {
    const src = readFileSync(join(__dirname, "..", "report.ts"), "utf8");
    expect(src).toMatch(/export\s+const\s+getLatestAuditByDomain\s*=\s*cache\(/);
  });
});

describe("getLatestAuditByDomain — null-client fallback", () => {
  it("returns null when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getLatestAuditByDomain("never-cached-domain-1.test")).toBeNull();
  });
});

describe("getLatestAuditByDomain — happy path", () => {
  it("returns site + audit when both lookups succeed", async () => {
    const site = { id: "site-1", domain: "example.test", normalized_url: "https://example.test" };
    const audit = {
      id: "audit-1",
      overall_score: 87,
      grade: "B+",
      test_results: [],
      category_scores: [],
      recommendations: [],
      duration_ms: 1234,
      scanned_at: "2026-05-18T00:00:00Z",
      share_token: "share-1",
    };
    const sitesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: site, error: null }),
    };
    const auditsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: audit, error: null }),
    };
    const supabase = {
      from: vi.fn((table: string) =>
        table === "sites" ? sitesChain : auditsChain,
      ),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getLatestAuditByDomain("never-cached-domain-2.test");
    expect(result?.site.domain).toBe("example.test");
    expect(result?.audit.grade).toBe("B+");
  });

  it("returns null when site lookup fails", async () => {
    const sitesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: "no rows" } }),
    };
    const supabase = {
      from: vi.fn(() => sitesChain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    expect(
      await getLatestAuditByDomain("never-cached-domain-3.test"),
    ).toBeNull();
  });
});
