import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildCoverageRows,
  parseBrands,
  repoRoot,
} from "@/scripts/backfill-brand-coverage";

/**
 * Guards the reconstruction the whole trend gate rests on. If parsing silently
 * degrades, coverage rows go missing and brands wrongly pass the gate — the
 * failure would look like data, not a bug.
 */
describe("parseBrands", () => {
  it("parses the CURRENT watchlist to its full size", () => {
    // The entries are single-line objects, so `^\s*brand:` matches only the
    // handful of multi-line ones (55 of 293). This test exists because that
    // exact mistake was made while writing the backfill and read as a watchlist
    // that had not grown since June.
    const src = execFileSync(
      "git",
      ["-C", repoRoot(), "show", "HEAD:packages/shopfront-glue/src/au-brand-watchlist.ts"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const brands = parseBrands(src);
    expect(brands.length).toBeGreaterThanOrEqual(290);
    expect(brands.map((b) => b.brand)).toContain("Bunnings");
    expect(brands.map((b) => b.brand)).toContain("The Ordinary");
  });

  it("captures legitimate_domains[0] — THE key the monthly stats join on", () => {
    // clone_watch_monthly_brand_stats.brand holds the primary DOMAIN
    // ('apple.com', 'hellostake.com'), not the normalised name. Keying coverage
    // on the name joins to nothing, and because the gate fails closed that
    // silently suppresses every trend claim while looking like it works.
    // Verified against prod 2026-09-03.
    const src = execFileSync(
      "git",
      ["-C", repoRoot(), "show", "HEAD:packages/shopfront-glue/src/au-brand-watchlist.ts"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const byBrand = new Map(parseBrands(src).map((b) => [b.brand, b.primaryDomain]));
    expect(byBrand.get("Apple")).toBe("apple.com");
    expect(byBrand.get("Stake")).toBe("hellostake.com");
    expect(byBrand.get("Target")).toBe("target.com.au");
    // Every parsed entry must carry a domain — a blank one is an unjoinable row.
    expect([...byBrand.values()].filter((d) => !d)).toHaveLength(0);
  });

  it("ignores the BrandEntry interface declaration", () => {
    const src = `
      export interface BrandEntry {
        brand: string;
        aliases?: string[];
      }
      export const AU_BRAND_WATCHLIST: BrandEntry[] = [
        { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
      ];`;
    // `brand: string;` has neither quotes nor a legitimate_domains, so it must
    // not be captured.
    expect(parseBrands(src)).toEqual([
      { brand: "Bunnings", primaryDomain: "bunnings.com.au" },
    ]);
  });
});

describe("buildCoverageRows", () => {
  it("dates each brand to the revision that FIRST introduced it", () => {
    const bunnings = { brand: "Bunnings", primaryDomain: "bunnings.com.au" };
    const ordinary = { brand: "The Ordinary", primaryDomain: "theordinary.com" };
    const rows = buildCoverageRows([
      { sha: "aaa", date: "2026-05-24", brands: [bunnings] },
      { sha: "bbb", date: "2026-07-21", brands: [bunnings, ordinary] },
    ]);
    expect(rows).toEqual([
      {
        brand: "Bunnings",
        brand_normalized: "bunnings",
        brand_domain: "bunnings.com.au",
        covered_from: "2026-05-24",
        source: "git-backfill",
        source_ref: "aaa",
      },
      {
        brand: "The Ordinary",
        brand_normalized: "theordinary",
        brand_domain: "theordinary.com",
        covered_from: "2026-07-21",
        source: "git-backfill",
        source_ref: "bbb",
      },
    ]);
  });

  it("does not re-date a brand that persists across revisions", () => {
    const bunnings = { brand: "Bunnings", primaryDomain: "bunnings.com.au" };
    const rows = buildCoverageRows([
      { sha: "aaa", date: "2026-05-24", brands: [bunnings] },
      { sha: "bbb", date: "2026-06-16", brands: [bunnings] },
      { sha: "ccc", date: "2026-07-21", brands: [bunnings] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].covered_from).toBe("2026-05-24");
  });

  it("normalises the brand key the way alerts are keyed", () => {
    const rows = buildCoverageRows([
      {
        sha: "aaa",
        date: "2026-07-21",
        brands: [
          { brand: "The Ordinary", primaryDomain: "theordinary.com" },
          { brand: "7-Eleven", primaryDomain: "7eleven.com.au" },
        ],
      },
    ]);
    // Must match shopfront_clone_alerts.target_brand_normalized, or the join in
    // the trend gate silently finds nothing and every brand reads as
    // coverage_unknown.
    expect(rows.map((r) => r.brand_normalized)).toEqual(["theordinary", "7eleven"]);
  });

  it("reconstructs the real 2026-07-21 beauty cohort from git", () => {
    // The 11 brands whose Jul->Aug rise is a coverage artefact. If this set
    // ever changes shape, the published trend claims change with it.
    const revs = execFileSync(
      "git",
      [
        "-C",
        repoRoot(),
        "log",
        "--follow",
        "--reverse",
        "--format=%H %ad",
        "--date=short",
        "--",
        "packages/shopfront-glue/src/au-brand-watchlist.ts",
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    )
      .trim()
      .split("\n")
      .map((line) => {
        const [sha, date] = line.split(" ");
        const src = execFileSync(
          "git",
          ["-C", repoRoot(), "show", `${sha}:packages/shopfront-glue/src/au-brand-watchlist.ts`],
          { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
        );
        return { sha, date, brands: parseBrands(src) };
      });

    const rows = buildCoverageRows(revs);
    const addedJul21 = rows
      .filter((r) => r.covered_from === "2026-07-21")
      .map((r) => r.brand)
      .sort();

    expect(addedJul21).toEqual([
      "Adore Beauty",
      "Aesop",
      "Deciem",
      "Frank Body",
      "Go-To Skincare",
      "MCoBeauty",
      "Mecca",
      "NIOD",
      "Naturium",
      "Sephora",
      "The Ordinary",
    ]);
  });
});
