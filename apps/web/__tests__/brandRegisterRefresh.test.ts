import { describe, expect, it } from "vitest";
import { buildBrandResolver } from "@askarthur/shopfront-glue";
import {
  rollupBrandRegister,
  type StreamBrand,
} from "@/app/api/inngest/functions/brand-register-refresh";

const resolve = buildBrandResolver({
  nab: "NAB",
  nationalaustraliabank: "NAB",
  depop: "Depop",
});

const s = (brandNormalized: string, rawBrand: string, count: number): StreamBrand => ({
  brandNormalized,
  rawBrand,
  count,
});

describe("rollupBrandRegister", () => {
  it("merges all three streams for one brand across alias spellings", () => {
    const rows = rollupBrandRegister({
      watchlistBrands: ["NAB", "Woolworths"],
      scam: [s("nab", "nab", 5)],
      reddit: [s("nationalaustraliabank", "National Australia Bank", 2)],
      cloneByNormalized: new Map([["nab", 4]]),
      candidateStatusByNormalized: new Map(),
      resolve,
    });
    const nab = rows.find((r) => r.canonical_brand === "NAB");
    expect(nab).toBeDefined();
    expect(nab!.scam_30d).toBe(5);
    expect(nab!.reddit_30d).toBe(2);
    expect(nab!.clone_open_alerts).toBe(4);
    expect(nab!.on_au_watchlist).toBe(true);
    // priority = scam*3 + clone*2 + reddit*1 = 15 + 8 + 2
    expect(nab!.cross_stream_priority).toBe(25);
    // one row for NAB despite three spellings
    expect(rows.filter((r) => r.canonical_brand === "NAB")).toHaveLength(1);
  });

  it("includes zero-activity watchlist brands (full platform list)", () => {
    const rows = rollupBrandRegister({
      watchlistBrands: ["NAB", "Woolworths"],
      scam: [],
      reddit: [],
      cloneByNormalized: new Map(),
      candidateStatusByNormalized: new Map(),
      resolve,
    });
    const woolies = rows.find((r) => r.canonical_brand === "Woolworths");
    expect(woolies).toMatchObject({
      on_au_watchlist: true,
      scam_30d: 0,
      cross_stream_priority: 0,
    });
  });

  it("keeps an unresolved brand as its own row and attaches curation status", () => {
    const rows = rollupBrandRegister({
      watchlistBrands: [],
      scam: [],
      reddit: [s("hinge", "Hinge", 3)],
      cloneByNormalized: new Map(),
      candidateStatusByNormalized: new Map([["hinge", "pending"]]),
      resolve,
    });
    const hinge = rows.find((r) => r.canonical_brand === "Hinge");
    expect(hinge).toMatchObject({
      display_name: "Hinge",
      on_au_watchlist: false,
      reddit_30d: 3,
      curation_status: "pending",
      cross_stream_priority: 3,
    });
  });
});
