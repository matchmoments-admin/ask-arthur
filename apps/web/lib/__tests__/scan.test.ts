// Regression guard for the React.cache wrap on getScanByToken.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { getScanByToken } from "../scan";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const INVALID_UUID = "not-a-uuid";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getScanByToken — cache wrap regression guard", () => {
  it("imports cache from react at the definition site", () => {
    const src = readFileSync(join(__dirname, "..", "scan.ts"), "utf8");
    expect(src).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
  });

  it("wraps the exported async function with cache(", () => {
    const src = readFileSync(join(__dirname, "..", "scan.ts"), "utf8");
    expect(src).toMatch(/export\s+const\s+getScanByToken\s*=\s*cache\(/);
  });
});

describe("getScanByToken — input validation", () => {
  it("returns null for non-UUID input without calling Supabase", async () => {
    const mockCreate = vi.mocked(createServiceClient);
    expect(await getScanByToken(INVALID_UUID)).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("getScanByToken — null-client fallback", () => {
  it("returns null when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getScanByToken(VALID_UUID)).toBeNull();
  });
});

describe("getScanByToken — happy path", () => {
  it("returns scan row when query succeeds", async () => {
    const scanRow = {
      id: "scan-1",
      scan_type: "website",
      target: "example.test",
      target_display: "example.test",
      overall_score: 90,
      grade: "A",
      share_token: VALID_UUID,
      scanned_at: "2026-05-18T00:00:00Z",
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: scanRow, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getScanByToken(VALID_UUID);
    expect(result?.grade).toBe("A");
  });
});
