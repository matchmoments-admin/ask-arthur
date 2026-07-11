import { describe, expect, it } from "vitest";
import { parseSecurityTxtContacts } from "@/app/api/inngest/functions/known-brands-discover";
import {
  buildInternalDigestHtml,
  buildRegistrarRollup,
} from "@/app/api/inngest/functions/clone-watch-internal-digest";
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
    netcraftReported: over.netcraftReported ?? 0,
    takenDown: over.takenDown ?? 0,
    declined: over.declined ?? 0,
    escalated: over.escalated ?? 0,
    weaponisedAfterDecline: over.weaponisedAfterDecline ?? 0,
    weaponised: over.weaponised ?? 0,
    reTakenDown: over.reTakenDown ?? 0,
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
        lifecycle_state: null, first_seen_at: null, screenshot_url: null, result_url: null, still_live_as_of: null,
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
      ["x.com", metrics({ domains: [{ domain: "a<script>.com", classification: null, ip: null, asn: null, country: null, registrar: null, abuse_email: null, lifecycle_state: null, first_seen_at: null, screenshot_url: null, result_url: null, still_live_as_of: null }] })],
    ]);
    const html = buildInternalDigestHtml("June 2026", byBrand);
    expect(html).toContain("a&lt;script&gt;.com");
    expect(html).not.toContain("a<script>.com");
  });

  it("FULL mode renders every clone URL per brand + a registrar rollup (off path unchanged)", () => {
    const byBrand = new Map<string, CloneBrandMetrics>([
      [
        "anz.com.au",
        metrics({
          detected: 2,
          byRegistrar: { NameSilo: 2 },
          domains: [
            { domain: "anz-a.click", classification: null, ip: null, asn: null, country: null, registrar: "NameSilo", abuse_email: "abuse@namesilo.com", lifecycle_state: null, first_seen_at: null, screenshot_url: null, result_url: null, still_live_as_of: null },
          ],
        }),
      ],
    ]);
    const urlsByBrand = new Map<string, string[]>([
      ["anz.com.au", ["https://anz-a.click/login", "https://anz-b.click/verify"]],
    ]);
    const html = buildInternalDigestHtml("June 2026", byBrand, { urlsByBrand, full: true });
    // every URL rendered (uncapped)
    expect(html).toContain("https://anz-a.click/login");
    expect(html).toContain("https://anz-b.click/verify");
    // registrar rollup with abuse email
    expect(html).toContain("Registrars that provided these clones");
    expect(html).toContain("NameSilo");
    expect(html).toContain("abuse@namesilo.com");
    expect(html).toContain("report.scamwatch.gov.au");
  });

  it("FULL mode notes the Unknown-registrar bucket", () => {
    const byBrand = new Map<string, CloneBrandMetrics>([
      ["x.com", metrics({ detected: 3, byRegistrar: { Unknown: 3 }, domains: [] })],
    ]);
    const html = buildInternalDigestHtml("June 2026", byBrand, {
      urlsByBrand: new Map([["x.com", ["https://x-clone.click"]]]),
      full: true,
    });
    expect(html).toContain("Registrar unknown for 3 domains");
  });
});

describe("buildRegistrarRollup", () => {
  const m = (byRegistrar: Record<string, number>, domains: CloneBrandMetrics["domains"]): CloneBrandMetrics => ({
    detected: Object.values(byRegistrar).reduce((a, b) => a + b, 0),
    netcraftReported: 0,
    takenDown: 0,
    declined: 0,
    weaponisedAfterDecline: 0,
    escalated: 0,
    weaponised: 0,
    reTakenDown: 0,
    byClassification: {},
    byCountry: {},
    byRegistrar,
    byAsn: {},
    domains,
    alertIds: [],
  });

  it("sums per-brand registrar counts across brands, maps abuse emails, and counts Unknown", () => {
    const byBrand = new Map<string, CloneBrandMetrics>([
      ["a.com", m({ NameSilo: 2, Unknown: 1 }, [
        { domain: "a1", classification: null, ip: null, asn: null, country: null, registrar: "NameSilo", abuse_email: "abuse@namesilo.com", lifecycle_state: null, first_seen_at: null, screenshot_url: null, result_url: null, still_live_as_of: null },
      ])],
      ["b.com", m({ NameSilo: 3, GoDaddy: 1 }, [
        { domain: "b1", classification: null, ip: null, asn: null, country: null, registrar: "GoDaddy", abuse_email: "abuse@godaddy.com", lifecycle_state: null, first_seen_at: null, screenshot_url: null, result_url: null, still_live_as_of: null },
      ])],
    ]);
    const { rows, unknownCount } = buildRegistrarRollup(byBrand);
    // NameSilo total = 2 + 3 = 5, sorted first
    expect(rows[0]).toMatchObject({ registrar: "NameSilo", clones: 5, abuseEmail: "abuse@namesilo.com" });
    expect(rows.find((r) => r.registrar === "GoDaddy")).toMatchObject({ clones: 1, abuseEmail: "abuse@godaddy.com" });
    expect(unknownCount).toBe(1);
  });
});
