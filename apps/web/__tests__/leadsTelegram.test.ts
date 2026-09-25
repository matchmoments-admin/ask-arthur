import { describe, expect, it } from "vitest";
import { buildFeedbackTelegram } from "@/lib/leads-telegram";

const msg = (url: unknown) =>
  buildFeedbackTelegram(
    "bug",
    { title: "Broken <b>", description: "desc", url },
    "Jo",
    "jo@example.com",
    "Acme & Co",
    null,
  ).value;

describe("buildFeedbackTelegram", () => {
  it("links an http(s) page URL and escapes the form fields", () => {
    const m = msg("https://askarthur.au/check?a=1&b=2");
    expect(m).toContain('🔗 <a href="https://askarthur.au/check?a=1&amp;b=2">Page</a>');
    expect(m).toContain("<b>Broken &lt;b&gt;</b>");
    expect(m).toContain("Acme &amp; Co");
  });

  it.each(["javascript:alert(document.cookie)", "data:text/html,<script>", "vbscript:x"])(
    "never emits an <a href> for %j (shown as escaped text)",
    (url) => {
      const m = msg(url);
      expect(m).not.toMatch(/<a\s/);
      expect(m).toContain("🔗 Page (");
    },
  );
});
