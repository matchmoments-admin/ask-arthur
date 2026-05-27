import { describe, expect, it } from "vitest";
import {
  buildClusterKey,
  summariseFpClusters,
  buildProposedException,
  buildTelegramMessage,
  longestCommonPrefix,
  type FpRow,
} from "@/app/api/inngest/functions/clone-watch-fp-cluster-digest";

describe("buildClusterKey", () => {
  it("composes key as brand|tld", () => {
    const { key, brand, tld } = buildClusterKey({
      brand: "Bonds",
      candidate_domain: "bondi.design",
    });
    expect(brand).toBe("Bonds");
    expect(tld).toBe("design");
    expect(key).toBe("Bonds|design");
  });

  it("lower-cases the candidate TLD but preserves brand casing", () => {
    const { key, tld } = buildClusterKey({
      brand: "Hellostake",
      candidate_domain: "STAKEMAX.SHOP",
    });
    expect(tld).toBe("shop");
    expect(key).toBe("Hellostake|shop");
  });

  it("uses last label as TLD for nested SLDs", () => {
    const { tld } = buildClusterKey({
      brand: "Bonds",
      candidate_domain: "bondi.example.co.uk",
    });
    expect(tld).toBe("uk");
  });
});

describe("longestCommonPrefix", () => {
  it("returns the shared prefix when candidates share one", () => {
    expect(
      longestCommonPrefix(["bondi.design", "bondx.design", "bondy.design"]),
    ).toBe("bond");
  });

  it("returns empty string when no shared prefix", () => {
    expect(
      longestCommonPrefix(["stakemax.shop", "payouts.shop", "richest.shop"]),
    ).toBe("");
  });

  it("caps the prefix at CLUSTER_PREFIX_LEN (5)", () => {
    expect(
      longestCommonPrefix(["bondings1.com", "bondings2.com", "bondings3.com"]),
    ).toBe("bondi");
  });

  it("returns empty string for empty input", () => {
    expect(longestCommonPrefix([])).toBe("");
  });

  it("handles a single candidate (full label up to cap)", () => {
    expect(longestCommonPrefix(["abcdefg.shop"])).toBe("abcde");
  });
});

describe("summariseFpClusters", () => {
  it("returns clusters with ≥3 hits, sorted DESC by count", () => {
    const rows: FpRow[] = [
      // Bonds × design — 3 with shared prefix "bond"
      { brand: "Bonds", candidate_domain: "bondi.design" },
      { brand: "Bonds", candidate_domain: "bondx.design" },
      { brand: "Bonds", candidate_domain: "bondy.design" },
      // Hellostake × shop — 4 with shared prefix "stake"
      { brand: "Hellostake", candidate_domain: "stakemax.shop" },
      { brand: "Hellostake", candidate_domain: "stakefoo.shop" },
      { brand: "Hellostake", candidate_domain: "stakebaz.shop" },
      { brand: "Hellostake", candidate_domain: "stakequx.shop" },
      // Single-hit cluster — must be dropped (< MIN_CLUSTER_SIZE)
      { brand: "NAB", candidate_domain: "nabby.example.com" },
    ];

    const clusters = summariseFpClusters(rows);
    expect(clusters).toHaveLength(2);
    // Hellostake (4) before Bonds (3) — sort DESC by count
    expect(clusters[0]!.brand).toBe("Hellostake");
    expect(clusters[0]!.count).toBe(4);
    expect(clusters[0]!.prefix).toBe("stake");
    expect(clusters[1]!.brand).toBe("Bonds");
    expect(clusters[1]!.count).toBe(3);
    expect(clusters[1]!.prefix).toBe("bond");
  });

  it("drops clusters strictly below MIN_CLUSTER_SIZE (3)", () => {
    const rows: FpRow[] = [
      { brand: "Bonds", candidate_domain: "bondi.design" },
      { brand: "Bonds", candidate_domain: "bondx.design" },
    ];
    expect(summariseFpClusters(rows)).toEqual([]);
  });

  it("caps examples at 3 per cluster", () => {
    const rows: FpRow[] = Array.from({ length: 8 }, (_, i) => ({
      brand: "Bonds",
      candidate_domain: `bondi${i}.design`,
    }));
    const clusters = summariseFpClusters(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.examples).toHaveLength(3);
    expect(clusters[0]!.count).toBe(8);
  });

  it("keeps different-TLD same-brand as separate clusters", () => {
    const rows: FpRow[] = [
      { brand: "Bonds", candidate_domain: "bondi.design" },
      { brand: "Bonds", candidate_domain: "bondx.design" },
      { brand: "Bonds", candidate_domain: "bondy.design" },
      { brand: "Bonds", candidate_domain: "bondi.shop" },
      { brand: "Bonds", candidate_domain: "bondx.shop" },
      { brand: "Bonds", candidate_domain: "bondy.shop" },
    ];
    const clusters = summariseFpClusters(rows);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.tld).sort()).toEqual(["design", "shop"]);
  });

  it("surfaces a cluster with no common prefix (heterogeneous bucket)", () => {
    const rows: FpRow[] = [
      { brand: "Hellostake", candidate_domain: "stakemax.shop" },
      { brand: "Hellostake", candidate_domain: "payouts.shop" },
      { brand: "Hellostake", candidate_domain: "richest.shop" },
    ];
    const clusters = summariseFpClusters(rows);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.prefix).toBe("");
    expect(clusters[0]!.proposed_exception).toContain("no common prefix");
  });

  it("returns empty for empty input", () => {
    expect(summariseFpClusters([])).toEqual([]);
  });
});

describe("buildProposedException", () => {
  it("emits an anchored regex covering prefix + chars + TLD when LCP exists", () => {
    expect(buildProposedException("bond", "design")).toBe(
      "/^bond[a-z0-9-]*\\.design$/",
    );
  });

  it("escapes the TLD's dot", () => {
    const exception = buildProposedException("stake", "shop");
    expect(exception).toContain("\\.shop");
  });

  it("falls back to a no-common-prefix message when LCP is empty", () => {
    expect(buildProposedException("", "shop")).toBe(
      "(no common prefix — review TLD .shop candidates and decide)",
    );
  });
});

describe("buildTelegramMessage", () => {
  it("includes total FP count + cluster count in header", () => {
    const message = buildTelegramMessage(
      [
        {
          brand: "Bonds",
          tld: "design",
          prefix: "bond",
          count: 3,
          examples: ["bondi.design", "bondx.design", "bondy.design"],
          proposed_exception: "/^bond[a-z0-9-]*\\.design$/",
        },
      ],
      27,
    );
    expect(message).toContain("27");
    expect(message).toContain("1");
    expect(message).toContain("FP patterns");
  });

  it("renders the proposed exception in code formatting", () => {
    const message = buildTelegramMessage(
      [
        {
          brand: "Bonds",
          tld: "design",
          prefix: "bond",
          count: 3,
          examples: ["bondi.design"],
          proposed_exception: "/^bond[a-z0-9-]*\\.design$/",
        },
      ],
      3,
    );
    expect(message).toContain("<code>/^bond[a-z0-9-]*\\.design$/</code>");
  });

  it("escapes HTML in brand + candidate names", () => {
    const message = buildTelegramMessage(
      [
        {
          brand: "<script>",
          tld: "shop",
          prefix: "evil",
          count: 3,
          examples: ["evil1.shop", "evil2.shop"],
          proposed_exception: "/^evil[a-z0-9-]*\\.shop$/",
        },
      ],
      3,
    );
    expect(message).not.toContain("<script>");
    expect(message).toContain("&lt;script&gt;");
  });

  it("caps cluster listing at 15 with an overflow line", () => {
    const clusters = Array.from({ length: 20 }, (_, i) => ({
      brand: `Brand${i}`,
      tld: "shop",
      prefix: `pref${i}`,
      count: 3,
      examples: [`example${i}.shop`],
      proposed_exception: `/^pref${i}[a-z0-9-]*\\.shop$/`,
    }));
    const message = buildTelegramMessage(clusters, 60);
    // 15 shown, 5 omitted
    expect(message).toContain("+5 smaller clusters omitted");
  });
});
