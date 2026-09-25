import { describe, expect, it } from "vitest";
import { SafeHtml, escapeHtml, headerSafe, html, joinHtml, raw } from "../html";

describe("escapeHtml", () => {
  it("escapes & < > \" ' (attribute-safe)", () => {
    expect(escapeHtml(`<a href="x" title='y'>AT&T</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;AT&amp;T&lt;/a&gt;",
    );
  });
  it("escapes & first (no double-escaping of the entities it emits)", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("headerSafe", () => {
  it("flattens control characters and caps length", () => {
    expect(headerSafe("a\r\nBcc: x@y.z")).toBe("a Bcc: x@y.z");
    expect(headerSafe("x".repeat(100), 10)).toBe("xxxxxxxxx…");
  });
});

describe("html template", () => {
  it("keeps literal markup and escapes every interpolation", () => {
    const name = `<script>alert("x")</script>`;
    expect(html`<b>${name}</b>`.value).toBe(
      "<b>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</b>",
    );
  });

  it("passes nested SafeHtml through unescaped (no double escaping)", () => {
    const inner = html`<i>${"a&b"}</i>`;
    expect(html`<b>${inner}</b>`.value).toBe("<b><i>a&amp;b</i></b>");
  });

  it("renders numbers, true, arrays; drops null/undefined/false", () => {
    expect(html`${1}|${true}|${null}|${undefined}|${false}|${["<", html`<br>`]}`.value).toBe(
      "1|true||||&lt;<br>",
    );
  });

  it("raw() is the explicit escape hatch", () => {
    expect(html`${raw("<b>trusted</b>")}`.value).toBe("<b>trusted</b>");
  });

  it("joinHtml escapes plain items and separators, keeps SafeHtml, skips nullish", () => {
    expect(joinHtml([html`<b>a</b>`, "<c>", null, false, undefined], "\n").value).toBe(
      "<b>a</b>\n&lt;c&gt;",
    );
  });

  it("toString/JSON render the HTML, so string APIs and payload logs keep working", () => {
    const h = html`<b>${"x"}</b>`;
    expect(`${h}`).toBe("<b>x</b>");
    expect(JSON.stringify({ h })).toBe('{"h":"<b>x</b>"}');
    expect([html`a`, html`b`].join("\n")).toBe("a\nb");
  });

  it("cannot be forged from a plain object", () => {
    const fake = { value: "<script>" } as unknown;
    expect(fake instanceof SafeHtml).toBe(false);
    expect(html`${fake as string}`.value).toBe("[object Object]");
  });
});
