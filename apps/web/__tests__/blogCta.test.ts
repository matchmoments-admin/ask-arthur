import { describe, it, expect } from "vitest";
import { appendBlogCtaBlock, BLOG_CTA_MARKER } from "@/lib/blog-cta";

const SAMPLE = `## Phishing Scams

This week saw a rise in CommBank phishing.

> [!WARNING]
> Never click links in unexpected texts.`;

describe("appendBlogCtaBlock", () => {
  it("appends the canonical CTA block with the scan + contact links", () => {
    const out = appendBlogCtaBlock(SAMPLE);
    expect(out).toContain(BLOG_CTA_MARKER);
    expect(out).toContain("](/)"); // free scan CTA -> homepage scanner
    expect(out).toContain("](/contact)"); // B2B CTA
  });

  it("preserves the original content ahead of the block", () => {
    const out = appendBlogCtaBlock(SAMPLE);
    expect(out.startsWith("## Phishing Scams")).toBe(true);
    expect(out.indexOf("CommBank phishing")).toBeLessThan(out.indexOf(BLOG_CTA_MARKER));
  });

  it("puts NO utm params on the internal links (first-touch model)", () => {
    const out = appendBlogCtaBlock(SAMPLE);
    expect(out).not.toContain("utm_");
  });

  it("does not link the gated /clone-watch pillar by default", () => {
    const out = appendBlogCtaBlock(SAMPLE);
    expect(out).not.toContain("](/clone-watch)");
  });

  it("is idempotent — never injects the block twice", () => {
    const once = appendBlogCtaBlock(SAMPLE);
    const twice = appendBlogCtaBlock(once);
    expect(twice).toBe(once);
    const occurrences = twice.split(BLOG_CTA_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });
});
