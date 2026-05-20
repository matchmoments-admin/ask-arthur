import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { verifyRedditIntelClusterHealth } from "../reddit-intel-cluster-health";

type ThemeFixture = {
  id: string;
  slug?: string;
  title?: string;
  member_count: number;
  wow_delta_pct?: number | string | null;
  last_seen_at?: string | null;
};

type MemberFixture = {
  intel_id: string;
  theme_id: string;
};

function fakeSupabase(args: {
  themes: ThemeFixture[];
  memberships: MemberFixture[];
}): SupabaseClient {
  return {
    from(table: string) {
      const data =
        table === "reddit_intel_themes" ? args.themes : args.memberships;
      return queryResult(data);
    },
  } as unknown as SupabaseClient;
}

function queryResult(data: unknown[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data, error: null }),
  };
  return chain;
}

function membersFor(
  themeId: string,
  count: number,
  start = 0,
): MemberFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    theme_id: themeId,
    intel_id: `post-${start + index}`,
  }));
}

describe("verifyRedditIntelClusterHealth", () => {
  it("returns HEALTHY when median member_count is >=3 and p95 is <=50", async () => {
    const supabase = fakeSupabase({
      themes: [theme("t1", 3, 15), theme("t2", 4, 35), theme("t3", 5, 5)],
      memberships: [
        ...membersFor("t1", 3, 0),
        ...membersFor("t2", 4, 10),
        ...membersFor("t3", 5, 20),
      ],
    });

    const report = await verifyRedditIntelClusterHealth(supabase);

    expect(report.verdict).toBe("HEALTHY");
    expect(report.stats.memberCountMedian).toBe(4);
    expect(report.stats.memberCountP95).toBe(5);
    expect(report.stats.totalPostCount).toBe(12);
    expect(report.evidence).toContain("Cluster health HEALTHY");
  });

  it("returns NEEDS_RETUNING when the 1:1 singleton pattern reappears", async () => {
    const supabase = fakeSupabase({
      themes: [theme("t1", 1), theme("t2", 1), theme("t3", 3)],
      memberships: [
        ...membersFor("t1", 1, 0),
        ...membersFor("t2", 1, 10),
        ...membersFor("t3", 3, 20),
      ],
    });

    const report = await verifyRedditIntelClusterHealth(supabase);

    expect(report.verdict).toBe("NEEDS_RETUNING");
    expect(report.stats.memberCountMedian).toBe(1);
    expect(report.stats.memberCountP95).toBe(3);
  });

  it("returns DEGENERATE when theme count exceeds unique post count", async () => {
    const supabase = fakeSupabase({
      themes: [theme("t1", 1), theme("t2", 1), theme("t3", 1), theme("t4", 1)],
      memberships: [
        { theme_id: "t1", intel_id: "post-1" },
        { theme_id: "t2", intel_id: "post-2" },
        { theme_id: "t3", intel_id: "post-2" },
      ],
    });

    const report = await verifyRedditIntelClusterHealth(supabase);

    expect(report.verdict).toBe("DEGENERATE");
    expect(report.stats.totalThemeCount).toBe(4);
    expect(report.stats.totalPostCount).toBe(2);
  });

  it("returns DEGENERATE when p95 member_count is above the mega-theme ceiling", async () => {
    const supabase = fakeSupabase({
      themes: [theme("t1", 3), theme("t2", 4), theme("t3", 120)],
      memberships: [
        ...membersFor("t1", 3, 0),
        ...membersFor("t2", 4, 10),
        ...membersFor("t3", 120, 100),
      ],
    });

    const report = await verifyRedditIntelClusterHealth(supabase);

    expect(report.verdict).toBe("DEGENERATE");
    expect(report.stats.memberCountP95).toBe(120);
  });

  it("sorts top themes by recent velocity, then recency", async () => {
    const supabase = fakeSupabase({
      themes: [
        theme("slow", 3, 4, "2026-05-01T00:00:00Z"),
        theme("fast", 4, "35.5", "2026-05-02T00:00:00Z"),
        theme("fresh", 5, 35.5, "2026-05-03T00:00:00Z"),
      ],
      memberships: [
        ...membersFor("slow", 3, 0),
        ...membersFor("fast", 4, 10),
        ...membersFor("fresh", 5, 20),
      ],
    });

    const report = await verifyRedditIntelClusterHealth(supabase, {
      topThemeLimit: 2,
    });

    expect(report.stats.topThemesByRecentVelocity.map((t) => t.id)).toEqual([
      "fresh",
      "fast",
    ]);
  });
});

const url = process.env.SUPABASE_INTEGRATION_TEST_URL;
const serviceKey = process.env.SUPABASE_INTEGRATION_TEST_SERVICE_KEY;
const hasEnv = Boolean(url && serviceKey);

describe.skipIf(!hasEnv)("reddit intel cluster-health integration", () => {
  it("runs read-only against a Supabase preview branch", async () => {
    const supabase = getIntegrationClient();

    const report = await verifyRedditIntelClusterHealth(supabase);

    expect(["HEALTHY", "NEEDS_RETUNING", "DEGENERATE"]).toContain(
      report.verdict,
    );
    expect(report.evidence).toContain("Cluster health");
    expect(report.stats.totalThemeCount).toBeGreaterThanOrEqual(0);
  });
});

function getIntegrationClient(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      "reddit-intel cluster-health integration requires SUPABASE_INTEGRATION_TEST_URL and SUPABASE_INTEGRATION_TEST_SERVICE_KEY",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe.skipIf(hasEnv)(
  "reddit intel cluster-health integration — env not configured",
  () => {
    it("skipped (set SUPABASE_INTEGRATION_TEST_URL + SERVICE_KEY to enable)", () => {
      expect(hasEnv).toBe(false);
    });
  },
);

function theme(
  id: string,
  memberCount: number,
  wowDeltaPct: number | string | null = null,
  lastSeenAt = "2026-05-01T00:00:00Z",
): ThemeFixture {
  return {
    id,
    slug: id,
    title: `Theme ${id}`,
    member_count: memberCount,
    wow_delta_pct: wowDeltaPct,
    last_seen_at: lastSeenAt,
  };
}
