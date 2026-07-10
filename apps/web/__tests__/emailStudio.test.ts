import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { renderCopySlot } from "@/lib/email/resolve-copy";
import { EMAIL_TEMPLATES } from "@/lib/email/copy-registry";
import BrandStewardshipReport from "@/emails/BrandStewardshipReport";

describe("renderCopySlot", () => {
  it("interpolates {{vars}} (HTML-escaped)", () => {
    expect(renderCopySlot("Hello {{brandName}}", { brandName: "Kmart" })).toBe(
      "Hello Kmart",
    );
    // value is HTML-escaped to defeat injection via a var
    expect(renderCopySlot("{{x}}", { x: "<b>hi</b>" })).not.toContain("<b>");
  });

  it("renders markdown bold / links / lists", () => {
    expect(renderCopySlot("**bold**")).toContain("<strong>bold</strong>");
    expect(renderCopySlot("[x](https://ok.test)")).toContain(
      'href="https://ok.test"',
    );
    expect(renderCopySlot("- a\n- b")).toContain("<li>");
  });

  it("unwraps a single paragraph so one-liners render inline", () => {
    expect(renderCopySlot("just text")).toBe("just text");
  });

  // Sanitization — admin-only input, but it's emailed externally, so be strict.
  it("strips raw HTML pasted into the source (escaped to inert text)", () => {
    const out = renderCopySlot("<script>alert(1)</script> hi");
    expect(out).not.toContain("<script"); // no live tag
    const img = renderCopySlot('<img src=x onerror="alert(1)">');
    expect(img).not.toContain("<img"); // no live tag — it's escaped to text
    expect(img).toContain("&lt;img"); // proof it became inert text, not markup
  });

  it("neutralises non-http(s)/mailto link protocols", () => {
    const out = renderCopySlot("[click](javascript:alert(1))");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="#"');
  });
});

describe("EMAIL_TEMPLATES registry", () => {
  it("marks the 4 brand-facing templates editable with slots", () => {
    for (const key of [
      "brand_stewardship",
      "brand_abuse",
      "clone_watch_brand_alert",
      "weaponised_clone_alert",
    ]) {
      const t = EMAIL_TEMPLATES[key];
      expect(t.editable).toBe(true);
      expect(Object.keys(t.slots).length).toBeGreaterThan(0);
    }
  });
  it("lists all 14 templates for the preview gallery", () => {
    expect(Object.keys(EMAIL_TEMPLATES).length).toBe(14);
  });
});

describe("template uses slot overrides", () => {
  it("BrandStewardshipReport renders an overridden greeting", async () => {
    const html = await render(
      BrandStewardshipReport({
        brandName: "Kmart",
        periodLabel: "May 2026",
        detected: 4,
        reportedByDestination: { openphish: 4 },
        reportsSent: 4,
        reportRef: "BSR-kmart-2026-05",
        copy: { greeting: "Custom intro for **{{brandName}}** here." },
      }),
    );
    expect(html).toContain("Custom intro for");
    expect(html).toContain("Kmart");
    // honesty guard still holds (lives in the code shell, not a slot)
    expect(html.toLowerCase()).not.toContain("taken down");
  });

  it("falls back to defaults when no copy is supplied", async () => {
    const html = await render(
      BrandStewardshipReport({
        brandName: "Kmart",
        periodLabel: "May 2026",
        detected: 1,
        reportedByDestination: {},
        reportsSent: 0,
        reportRef: "BSR-kmart-2026-05",
      }),
    );
    expect(html).toContain("what Ask Arthur"); // default greeting prose
  });
});
