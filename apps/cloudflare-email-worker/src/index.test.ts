import { describe, expect, it } from "vitest";

import { extractFirstUrl, htmlToText } from "./index";

describe("htmlToText (#238 regression)", () => {
  it("preserves anchor href on button-only confirm CTAs (TLDR / SANS / THN shape)", () => {
    const html =
      `<table><tr><td><a href="https://tldr.tech/confirm/abc123">Confirm Signup</a></td></tr></table>`;
    const out = htmlToText(html);
    expect(out).toContain("https://tldr.tech/confirm/abc123");
    expect(out).toContain("Confirm Signup");
  });

  it("preserves anchor href on inline-link Mailchimp confirm (ACCC Scamwatch shape)", () => {
    const html = `<p>Click here: <a href="https://accc.us10.list-manage.com/subscribe/confirm?u=abc&id=def&e=ghi">Yes, subscribe me to this list.</a></p>`;
    const out = htmlToText(html);
    expect(out).toContain(
      "https://accc.us10.list-manage.com/subscribe/confirm?u=abc&id=def&e=ghi",
    );
    expect(out).toContain("Yes, subscribe me to this list.");
  });

  it("strips nested tags inside an anchor label", () => {
    const html =
      `<a href="https://example.com"><span>Click</span> <strong>here</strong></a>`;
    const out = htmlToText(html);
    expect(out).toContain("https://example.com");
    expect(out).toContain("Click");
    expect(out).toContain("here");
    expect(out).not.toContain("<span>");
  });

  it("handles single-quoted hrefs", () => {
    const html = `<a href='https://example.com/x'>Click</a>`;
    expect(htmlToText(html)).toContain("https://example.com/x");
  });
});

describe("extractFirstUrl (#237 regression)", () => {
  it("strips a trailing closing paren from Markdown-wrapped links", () => {
    const text =
      `Yes, subscribe me to this list. (https://accc.us10.list-manage.com/subscribe/confirm?u=abc&id=def&e=ghi)`;
    expect(extractFirstUrl(text)).toBe(
      "https://accc.us10.list-manage.com/subscribe/confirm?u=abc&id=def&e=ghi",
    );
  });

  it("strips trailing sentence-final punctuation", () => {
    expect(extractFirstUrl("See https://example.com/x.")).toBe(
      "https://example.com/x",
    );
    expect(extractFirstUrl("Visit https://example.com/y; today.")).toBe(
      "https://example.com/y",
    );
  });

  it("does not strip non-punctuation suffixes", () => {
    expect(
      extractFirstUrl("https://example.com/path?a=1&b=2 trailing"),
    ).toBe("https://example.com/path?a=1&b=2");
  });

  it("returns undefined when no URL is present", () => {
    expect(extractFirstUrl("no url here")).toBeUndefined();
  });
});
