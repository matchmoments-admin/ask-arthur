import { describe, it, expect } from "vitest";

import { checkedDomains } from "../on-demand-url-enrich";

describe("checkedDomains — D3 on-demand enrichment domain selection", () => {
  it("extracts the registrable domain (subdomain stripped, matching scam_urls.domain)", () => {
    // extractDomain + normalizeURL (which populates scam_urls.domain) both
    // return the registrable domain, so the .eq('domain', …) lookup matches.
    expect(checkedDomains(["https://evil.example.com/login"])).toEqual([
      "example.com",
    ]);
  });

  it("dedups URLs that share a domain (path/query differ)", () => {
    const got = checkedDomains([
      "https://shop.test/a",
      "https://shop.test/b?x=1",
      "http://shop.test",
    ]);
    expect(got).toEqual(["shop.test"]);
  });

  it("drops URLs with no extractable domain", () => {
    const got = checkedDomains(["not a url", "https://ok.test/x", ""]);
    expect(got).toEqual(["ok.test"]);
  });

  it("caps the number of domains", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://d${i}.test/`);
    expect(checkedDomains(urls, 5)).toHaveLength(5);
    // cap preserves first-seen order
    expect(checkedDomains(urls, 3)).toEqual(["d0.test", "d1.test", "d2.test"]);
  });

  it("returns empty for empty input", () => {
    expect(checkedDomains([])).toEqual([]);
  });
});
