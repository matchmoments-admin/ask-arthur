import { describe, expect, it } from "vitest";
import { summariseCampaigns } from "@/lib/clone-watch/campaign-summary";

const r = (
  key: string | null,
  registrar: string | null = "NameCheap",
  weaponised = false,
) => ({
  campaign_key: key,
  weaponised_at: weaponised ? "2026-07-10T00:00:00Z" : null,
  attribution: { whois: { registrar } },
});

describe("summariseCampaigns", () => {
  it("clusters >=2-domain campaigns, excludes singletons + insufficient + null", () => {
    const s = summariseCampaigns([
      r("aaa"), r("aaa"), r("aaa"), // campaign of 3
      r("bbb"), r("bbb"), // campaign of 2
      r("ccc"), // singleton — not a campaign
      r("insufficient"), r("insufficient"), // sentinel — excluded
      r(null), // no key — excluded
    ]);
    expect(s.campaignCount).toBe(2);
    expect(s.largestCampaign).toBe(3);
    expect(s.clusteredDomains).toBe(5); // 3 + 2
    expect(s.top[0].domainCount).toBe(3);
    expect(s.top[0].key).toBe("aaa");
  });

  it("counts weaponised domains per campaign + surfaces the modal registrar", () => {
    const s = summariseCampaigns([
      r("aaa", "GoDaddy", true),
      r("aaa", "GoDaddy", false),
      r("aaa", "NameCheap", true),
    ]);
    expect(s.top[0].weaponisedCount).toBe(2);
    // GoDaddy is modal (2 vs 1) — canonicalRegistrar folds spelling.
    expect(s.top[0].registrar).toBe("GoDaddy");
  });

  it("empty cohort → zeroed summary", () => {
    const s = summariseCampaigns([]);
    expect(s).toEqual({
      campaignCount: 0,
      clusteredDomains: 0,
      largestCampaign: 0,
      top: [],
    });
  });

  it("caps the top list", () => {
    const rows = Array.from({ length: 20 }, (_, i) => [r(`c${i}`), r(`c${i}`)]).flat();
    const s = summariseCampaigns(rows, 3);
    expect(s.campaignCount).toBe(20);
    expect(s.top.length).toBe(3);
  });
});
