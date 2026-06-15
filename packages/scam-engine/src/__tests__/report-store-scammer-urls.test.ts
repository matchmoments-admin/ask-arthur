import { describe, expect, it } from "vitest";

import { stripUrlToHostPath } from "../report-store";

// The onward-report pipeline persists scammerUrls onto analysis_result and
// later forwards them to third-party blocklists. A captured scam URL can carry
// victim PII in its query string (?email=, ?abn=), so we must never store the
// query/fragment. stripUrlToHostPath enforces that at the persistence boundary.

describe("stripUrlToHostPath", () => {
  it("keeps scheme/host/path and drops the query string", () => {
    expect(
      stripUrlToHostPath("https://qantasw.shop/login?email=victim@example.com"),
    ).toBe("https://qantasw.shop/login");
  });

  it("drops the fragment", () => {
    expect(stripUrlToHostPath("https://evil.test/path#token=abc")).toBe(
      "https://evil.test/path",
    );
  });

  it("preserves a bare host with no path", () => {
    expect(stripUrlToHostPath("http://scam.example/")).toBe(
      "http://scam.example/",
    );
  });

  it("falls back to a manual split for an unparseable URL (never returns it whole)", () => {
    const out = stripUrlToHostPath("not a url ?secret=1#frag");
    expect(out).toBe("not a url ");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("frag");
  });

  it("preserves port + path, drops query", () => {
    expect(stripUrlToHostPath("https://host.test:8443/a/b?x=1")).toBe(
      "https://host.test:8443/a/b",
    );
  });
});
