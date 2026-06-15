import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import BrandStewardshipReport from "../emails/BrandStewardshipReport";
import BrandAbuseReport from "../emails/BrandAbuseReport";

describe("BrandStewardshipReport email", () => {
  it("renders the monthly summary with brand, period, destinations + examples", async () => {
    const html = await render(
      BrandStewardshipReport({
        brandName: "7-Eleven",
        periodLabel: "May 2026",
        detected: 4,
        reportedByDestination: { openphish: 4, apwg: 4 },
        reportsSent: 8,
        sampleDomains: ["7eleven-fuelrewards.shop", "7-eleven-au.com"],
        reportRef: "BSR-7_eleven-2026-05",
      }),
    );
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("7-Eleven");
    expect(html).toContain("May 2026");
    expect(html).toContain("OpenPhish community blocklist");
    expect(html).toContain("APWG eCrime Exchange");
    expect(html).toContain("7eleven-fuelrewards.shop");
    expect(html).toContain("ABN 72 695 772 313");
    // CTA block (always rendered) with UTM-tagged links.
    expect(html).toContain("Leave a Trustpilot review");
    expect(html).toContain("utm_campaign=brand-stewardship");
    expect(html).toContain("au.trustpilot.com/evaluate/askarthur.au");
    // Brief "What we do" with the prevention message + scam-checker link.
    expect(html).toContain("aims to protect Australians from scams");
    expect(html).toContain("scam checker");
    expect(html).toContain("askarthur.au/?utm_source=email");
    // Unsubscribe link in the footer.
    expect(html).toContain("Unsubscribe");
  });

  it("renders cleanly with zero detections / no examples", async () => {
    const html = await render(
      BrandStewardshipReport({
        brandName: "Acme",
        periodLabel: "May 2026",
        detected: 0,
        reportedByDestination: {},
        reportsSent: 0,
        reportRef: "BSR-acme-2026-05",
      }),
    );
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("No outbound reports this period.");
  });

  it("renders the clone-watch hosting + registrar section", async () => {
    const html = await render(
      BrandStewardshipReport({
        brandName: "ANZ",
        periodLabel: "May 2026",
        detected: 0,
        reportedByDestination: {},
        reportsSent: 0,
        cloneDetections: {
          detected: 3,
          byClassification: { likely_phishing: 1, neutral: 2 },
          byCountry: { SG: 1, FR: 1, US: 1 },
          byRegistrar: { "NameSilo, LLC": 1, "GoDaddy.com, LLC": 1, Unknown: 1 },
          byAsn: { AS132203: 1, AS16276: 1, AS13335: 1 },
          domains: [
            {
              domain: "login-anz-rewards.click",
              classification: "likely_phishing",
              ip: "43.160.223.254",
              asn: "AS132203",
              country: "SG",
              registrar: "NameSilo, LLC",
              abuseEmail: "abuse@namesilo.com",
            },
            {
              domain: "anz-secure.top",
              classification: "neutral",
              ip: "1.2.3.4",
              asn: "AS16276",
              country: "FR",
              registrar: null,
              abuseEmail: null,
            },
          ],
        },
        shareUrl: "https://askarthur.au/clone-report/test-token-uuid",
        reportRef: "BSR-anz-2026-05",
      }),
    );
    expect(html).toContain("login-anz-rewards.click");
    expect(html).toContain("43.160.223.254"); // hosting IP
    expect(html).toContain("AS132203"); // ASN
    expect(html).toContain("NameSilo, LLC"); // registrar
    expect(html).toContain("abuse@namesilo.com"); // abuse contact
    expect(html).toContain("Likely phishing"); // classification chip
    expect(html).toContain("full list available on request"); // overflow line (detected 3 > 2 shown)
    // Breakdown bars + abuse-report links + share link.
    expect(html).toContain("Where they&#x27;re hosted (country)");
    expect(html).toContain("Who registered them");
    expect(html).toContain("Report to registrar");
    expect(html).toContain("supportcenter.godaddy.com"); // GoDaddy abuse URL from the registrar breakdown
    expect(html).toContain("abuse.cloudflare.com"); // host abuse for the Cloudflare ASN row
    expect(html).toContain("/clone-report/test-token-uuid"); // share link
  });

  // Honesty guard: these are fire-and-forget blocklist forwards with no
  // takedown callback — the email must NEVER claim a takedown.
  it("never claims a takedown", async () => {
    const html = await render(
      BrandStewardshipReport({
        brandName: "7-Eleven",
        periodLabel: "May 2026",
        detected: 4,
        reportedByDestination: { openphish: 4 },
        reportsSent: 4,
        reportRef: "BSR-7_eleven-2026-05",
      }),
    );
    expect(html.toLowerCase()).not.toContain("taken down");
    expect(html.toLowerCase()).not.toContain("we removed");
    expect(html.toLowerCase()).not.toContain("we took down");
  });
});

describe("BrandAbuseReport email (refreshed chrome)", () => {
  it("renders the branded abuse letter with evidence", async () => {
    const html = await render(
      BrandAbuseReport({
        brandName: "Bunnings",
        scamType: "phishing",
        channel: "email",
        scammerUrls: ["https://bunnings-rewards.shop/login"],
        scammerPhones: [],
        scammerEmails: [],
        redactedContent: "Your Bunnings rewards are expiring. Verify [EMAIL].",
        redFlags: ["urgency / expiry pressure", "lookalike domain"],
        receivedAt: "2026-05-29",
        reportRef: "ASK-001234",
      }),
    );
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("Scam impersonating Bunnings");
    expect(html).toContain("Ask Arthur");
    expect(html).toContain("bunnings-rewards.shop/login");
    expect(html).toContain("ABN 72 695 772 313");
  });
});
