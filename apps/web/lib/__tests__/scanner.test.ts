// Coverage for the two scanner loaders extracted from /health and
// /health/feed pages. Both have a null-client fallback that previously
// only existed in inline page code (untested before this PR).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { getCombinedRecentScans, getPublicScanFeed } from "../scanner";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCombinedRecentScans — null-client fallback", () => {
  it("returns [] when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getCombinedRecentScans()).toEqual([]);
  });
});

describe("getCombinedRecentScans — happy path", () => {
  it("merges scan_results and site_audits, sorts desc, slices to 20", async () => {
    const newerScan = {
      id: "abc",
      scan_type: "extension",
      target: "ext-1",
      target_display: "Extension One",
      grade: "B",
      overall_score: 80,
      share_token: "tok-1",
      scanned_at: "2026-05-18T10:00:00Z",
    };
    const olderAudit = {
      id: 7,
      overall_score: 75,
      grade: "C+",
      scanned_at: "2026-05-17T10:00:00Z",
      share_token: "tok-2",
      site_id: 7,
      sites: { domain: "older.test" },
    };
    const scanChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [newerScan], error: null }),
    };
    const auditChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [olderAudit], error: null }),
    };
    const supabase = {
      from: vi.fn((table: string) =>
        table === "scan_results" ? scanChain : auditChain,
      ),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getCombinedRecentScans();
    expect(result).toHaveLength(2);
    // Newer should sort first
    expect(result[0].id).toBe("sr-abc");
    expect(result[1].id).toBe("sa-7");
  });
});

describe("getPublicScanFeed — null-client fallback", () => {
  it("returns [] when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getPublicScanFeed()).toEqual([]);
  });
});

describe("getPublicScanFeed — happy path", () => {
  it("returns scan_results rows when query succeeds", async () => {
    const rows = [
      {
        id: 1,
        scan_type: "skill",
        target: "skill-1",
        target_display: "Skill One",
        overall_score: 90,
        grade: "A",
        share_token: "tok-3",
        scanned_at: "2026-05-18T00:00:00Z",
      },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getPublicScanFeed();
    expect(result).toHaveLength(1);
    expect(result[0].grade).toBe("A");
  });
});
