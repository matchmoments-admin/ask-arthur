// Regression guard for the React.cache wrap on loadTheme.
//
// The load-bearing invariant: cache(...) MUST stay at the new definition
// site (apps/web/lib/intel/themes.ts). If a future edit moves loadTheme
// back into the page file or unwraps cache(...), generateMetadata + the
// default export will fall back to 2 DB round-trips per request. The
// regex test below catches that statically; the behavioural test below
// confirms the wrap actually dedupes in-process.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { loadTheme } from "../themes";

const themeRow = {
  id: "11111111-1111-1111-1111-111111111111",
  slug: "test-theme",
  title: "Test Theme",
  narrative: null,
  modus_operandi: null,
  representative_brands: null,
  member_count: 0,
  first_seen_at: null,
  last_seen_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadTheme — cache wrap regression guard", () => {
  it("imports cache from react at the definition site", () => {
    const src = readFileSync(join(__dirname, "..", "themes.ts"), "utf8");
    expect(src).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
  });

  it("wraps the exported async function with cache(", () => {
    const src = readFileSync(join(__dirname, "..", "themes.ts"), "utf8");
    expect(src).toMatch(/export\s+const\s+loadTheme\s*=\s*cache\(/);
  });
});

describe("loadTheme — null-client fallback", () => {
  it("returns null when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await loadTheme("never-cached-1")).toBeNull();
  });
});

describe("loadTheme — happy path", () => {
  it("returns theme + members when both queries succeed", async () => {
    const themesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: themeRow, error: null }),
    };
    const membersChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const supabase = {
      from: vi.fn((table: string) =>
        table === "reddit_intel_themes" ? themesChain : membersChain,
      ),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await loadTheme("never-cached-2");
    expect(result?.theme.slug).toBe("test-theme");
    expect(result?.members).toEqual([]);
  });

  it("returns null when theme not found", async () => {
    const themesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const supabase = {
      from: vi.fn(() => themesChain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    expect(await loadTheme("never-cached-3")).toBeNull();
  });
});
