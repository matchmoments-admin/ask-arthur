import { describe, it, expect } from "vitest";
import { extractURLs } from "@/lib/safebrowsing";

describe("extractURLs", () => {
  it("extracts a single URL", () => {
    const result = extractURLs("Check this out: https://example.com");
    expect(result).toEqual(["https://example.com"]);
  });

  it("extracts multiple URLs", () => {
    const result = extractURLs(
      "Visit https://example.com and http://test.org for more"
    );
    expect(result).toHaveLength(2);
    expect(result).toContain("https://example.com");
    expect(result).toContain("http://test.org");
  });

  it("deduplicates URLs", () => {
    const result = extractURLs(
      "https://example.com click here https://example.com again"
    );
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no URLs found", () => {
    const result = extractURLs("No URLs here, just plain text.");
    expect(result).toEqual([]);
  });

  it("handles URLs with paths and query strings", () => {
    const result = extractURLs(
      "Go to https://example.com/path?query=value&other=123#hash"
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/path?query=value");
  });

  it("does not extract non-URL text", () => {
    const result = extractURLs("This is not a URL: ftp://files.example.com");
    expect(result).toEqual([]);
  });

  it("handles Australian domain URLs", () => {
    const result = extractURLs(
      "Verify at https://my.gov.au/account and https://commbank.com.au/login"
    );
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty string", () => {
    expect(extractURLs("")).toEqual([]);
  });
});
