import { describe, expect, it } from "vitest";

import { extractFirstUrl, htmlToText, isBoilerplatePlainText } from "./index";

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

describe("isBoilerplatePlainText (2026-05-17 THN regression)", () => {
  // The exact text/plain body THN sent on 2026-05-16. 561 chars; pure
  // boilerplate; the real article content was HTML-only.
  const thnBoilerplate = `This email is not formatted for viewing in a
text email client. Please read it with an HTML friendly
email client like Outlook, Yahoo Mail, Gmail, etc.

=====================================================================
You are receiving this message because you subscribed to receive
the newsletter: OpenClaw Vulnerabilities, Kazuar P2P Botnet, MS Exchange Server Exploit

Copyright (c) 2014 NetLine Corporation. All rights reserved.
750 University Avenue, Suite 200, Los Gatos, CA 95032
=====================================================================`;

  it("detects the prod THN boilerplate shape", () => {
    expect(isBoilerplatePlainText(thnBoilerplate)).toBe(true);
  });

  it("detects 'view this email as a web page' variant (Marketo / Pardot)", () => {
    const text =
      "To view this email as a web page, go to the link below or copy and paste it into your browser's address window.\nhttps://example.com/view";
    expect(isBoilerplatePlainText(text)).toBe(true);
  });

  it("detects 'view in browser' variant (HubSpot)", () => {
    const text = "Having trouble viewing this email? View this email in your browser.";
    expect(isBoilerplatePlainText(text)).toBe(true);
  });

  it("keeps real one-paragraph alerts that happen to be short", () => {
    const text =
      "URGENT: Critical Microsoft Exchange vulnerability CVE-2026-1234 actively exploited. " +
      "Apply patches immediately. Indicators: malicious URL hxxps://evil.example, sender id 0x4a..";
    expect(isBoilerplatePlainText(text)).toBe(false);
  });

  it("keeps long bodies even if they contain 'view in browser' (real digests)", () => {
    // SecurityWeek's real 40KB digest has a "view in browser" link in its
    // header but the body is real content. Length safety-check (>2KB)
    // prevents false-positive on real long digests.
    const text = "A".repeat(5000) + "\nview in browser";
    expect(isBoilerplatePlainText(text)).toBe(false);
  });

  it("handles empty + whitespace-only input", () => {
    expect(isBoilerplatePlainText("")).toBe(false);
    expect(isBoilerplatePlainText("   \n\t  ")).toBe(false);
  });
});
