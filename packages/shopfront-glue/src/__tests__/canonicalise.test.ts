import { describe, expect, it } from "vitest";
import { canonicaliseCandidateUrl, urlHash } from "../canonicalise";

describe("canonicaliseCandidateUrl", () => {
  it("wraps a domain in https:// + trailing slash", () => {
    expect(canonicaliseCandidateUrl("bunings.shop")).toBe(
      "https://bunings.shop/",
    );
  });

  it("lowercases the domain", () => {
    expect(canonicaliseCandidateUrl("Bunings-AU.Shop")).toBe(
      "https://bunings-au.shop/",
    );
  });

  it("trims whitespace", () => {
    expect(canonicaliseCandidateUrl("  example.com  ")).toBe(
      "https://example.com/",
    );
  });

  it("strips a single trailing dot from FQDN form", () => {
    expect(canonicaliseCandidateUrl("example.com.")).toBe(
      "https://example.com/",
    );
  });
});

describe("urlHash", () => {
  it("produces a stable lowercase hex sha256", async () => {
    const hash = await urlHash("https://bunings.shop/");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the same hash for the same input across calls", async () => {
    const a = await urlHash("https://bunings.shop/");
    const b = await urlHash("https://bunings.shop/");
    expect(a).toBe(b);
  });

  it("differs for different inputs", async () => {
    const a = await urlHash("https://a.com/");
    const b = await urlHash("https://b.com/");
    expect(a).not.toBe(b);
  });
});
