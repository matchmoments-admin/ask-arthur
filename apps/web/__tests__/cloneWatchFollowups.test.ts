import { describe, expect, it } from "vitest";
import { parseSecurityTxtContacts } from "@/app/api/inngest/functions/known-brands-discover";
import { buildInternalDigestHtml } from "@/app/api/inngest/functions/clone-watch-internal-digest";
import type { CloneBrandMetrics } from "@/app/api/inngest/functions/report-brand-stewardship";

describe("parseSecurityTxtContacts", () => {
  it("extracts a mailto: contact as an email", () => {
    const r = parseSecurityTxtContacts("Contact: mailto:security@example.com\nExpires: 2027-01-01");
    expect(r.emails).toEqual(["security@example.com"]);
    expect(r.urls).toEqual([]);
  });

  it("extracts an https: contact as a url", () => {
    const r = parseSecurityTxtContacts("Contact: https://example.com/security");
    expect(r.urls).toEqual(["https://example.com/security"]);
    expect(r.emails).toEqual([]);
  });

  it("accepts a bare email and lowercases it", () => {
    const r = parseSecurityTxtContacts("Contact: Security@Example.COM");
    expect(r.emails).toEqual(["security@example.com"]);
  });

  it("ignores comments + non-contact lines, keeps multiple contacts", () => {
    const body = [
      "# our security policy",
      "Contact: mailto:vdp@brand.com",
      "Contact: https://brand.com/report",
      "Encryption: https://brand.com/pgp.txt",
    ].join("\n");
    const r = parseSecurityTxtContacts(body);
    expect(r.emails).toEqual(["vdp@brand.com"]);
    expect(r.urls).toEqual(["https://brand.com/report"]);
  });

  it("returns empty for a body with no Contact field", () => {
    expect(parseSecurityTxtContacts("Expires: 2027-01-01")).toEqual({ emails: [], urls: [] });
  });
});

describe("buildInternalDigestHtml", () => {
  const metrics = (over: Partial<CloneBrandMetrics>): CloneBrandMetrics => ({
    detected: over.detected ?? 1,
    byClassification: over.byClassification ?? { neutral: 1 },
    byCountry: over.byCountry ?? { SG: 1 },
    byRegistrar: over.byRegistrar ?? { NameSilo: 1 },
    byAsn: over.byAsn ?? { AS123: 1 },
    domains: over.domains ?? [
      {
        domain: "anz-login.click",
        classification: "neutral",
        ip: "1.2.3.4",
        asn: "AS123",
        country: "SG",
        registrar: "NameSilo",
        abuse_email: "abuse@namesilo.com",
      },
    ],
    alertIds: over.alertIds ?? [1],
  });

  it("renders totals, brand sections, hosting, and phishing emphasis, sorted by volume", () => {
    const byBrand = new Map<string, CloneBrandMetrics>([
      ["kmart.com.au", metrics({ detected: 2, byClassification: { neutral: 2 } })],
      [
        "anz.com.au",
        metrics({
          detected: 5,
          byClassification: { likely_phishing: 1, neutral: 4 },
        }),
      ],
    ]);
    const html = buildInternalDigestHtml("June 2026", byBrand);
    expect(html).toContain("Clone-Watch internal digest — June 2026");
    expect(html).toContain("<b>7</b> lookalike domains"); // 2 + 5
    expect(html).toContain("<b>2</b> brands");
    expect(html).toContain("likely phishing");
    expect(html).toContain("anz-login.click");
    expect(html).toContain("1.2.3.4 · AS123 · SG"); // hosting
    // anz (5) section appears before kmart (2)
    expect(html.indexOf("anz.com.au")).toBeLessThan(html.indexOf("kmart.com.au"));
  });

  it("escapes HTML in domain values", () => {
    const byBrand = new Map<string, CloneBrandMetrics>([
      ["x.com", metrics({ domains: [{ domain: "a<script>.com", classification: null, ip: null, asn: null, country: null, registrar: null, abuse_email: null }] })],
    ]);
    const html = buildInternalDigestHtml("June 2026", byBrand);
    expect(html).toContain("a&lt;script&gt;.com");
    expect(html).not.toContain("a<script>.com");
  });
});
