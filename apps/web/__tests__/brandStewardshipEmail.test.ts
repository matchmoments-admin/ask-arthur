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
          netcraftReported: 2,
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
    expect(html).toContain("see the full breakdown above"); // overflow line w/ shareUrl (detected 3 > 2 shown)
    // Breakdown bars + abuse-report links + share link.
    expect(html).toContain("Where they&#x27;re hosted (country)");
    expect(html).toContain("Who registered them");
    // Plain-language intro so the brand understands what they're seeing.
    expect(html).toContain("suspected clone");
    expect(html).toContain("reported on your behalf");
    // Header reconciles with the clone list: detected=0 (onward) + 3 clones → "3"
    // detected, and the 2 Netcraft-reported clones show in "Reported on your behalf"
    // (no more "0 detected / No outbound reports" contradiction). Strip the
    // react-email <!-- --> comment markers first.
    const clean = html.replace(/<!--.*?-->/g, "");
    expect(clean).toMatch(/>3<\/p>/); // combined detected count, not 0
    expect(clean).toContain("Reported on your behalf (2 report");
    expect(clean).toContain("Netcraft (browser + blocklist takedown)");
    expect(clean).not.toContain("No outbound reports this period");
    // Per-clone "Report to registrar" appears ONLY for the clone that has a
    // registrar (login-anz-rewards.click); anz-secure.top has registrar=null so
    // its link is hidden → exactly one in the per-clone list. (The "Who
    // registered them" breakdown bar links are separate.)
    expect((html.match(/Report to registrar/g) ?? []).length).toBe(1);
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

describe("F2 watch-list rendering", () => {
  const base = {
    brandName: "ANZ",
    periodLabel: "July 2026",
    detected: 0,
    reportedByDestination: {},
    reportsSent: 0,
    reportRef: "BSR-anz-2026-07",
  };

  const watchList = {
    detected: 3,
    netcraftReported: 3,
    takenDown: 1,
    declined: 1,
    weaponised: 1,
    weaponisedAfterDecline: 1,
    byClassification: {},
    byCountry: {},
    byRegistrar: {},
    byAsn: {},
    domains: [
      {
        domain: "anz-weap.click",
        classification: "likely_phishing",
        ip: "1.1.1.1",
        asn: "AS1",
        country: "US",
        registrar: "NameSilo, LLC",
        abuseEmail: "abuse@namesilo.com",
        lifecycleState: "weaponised",
        firstSeenAt: "2026-07-01T00:00:00Z",
        screenshotUrl: "https://urlscan.io/screenshots/weap.png",
        resultUrl: "https://urlscan.io/result/weap-uuid/",
        stillLiveAsOf: "2026-07-10T00:00:00Z",
      },
      {
        domain: "anz-decl.click",
        classification: "neutral",
        ip: "2.2.2.2",
        asn: "AS2",
        country: "SG",
        registrar: "GoDaddy",
        abuseEmail: null,
        lifecycleState: "declined",
        firstSeenAt: "2026-07-02T00:00:00Z",
        screenshotUrl: "https://urlscan.io/screenshots/decl.png",
        resultUrl: "https://urlscan.io/result/decl-uuid/",
        stillLiveAsOf: "2026-07-05T00:00:00Z",
      },
      {
        domain: "anz-taken.click",
        classification: "neutral",
        ip: null,
        asn: null,
        country: null,
        registrar: null,
        abuseEmail: null,
        lifecycleState: "taken_down",
        firstSeenAt: "2026-07-03T00:00:00Z",
        screenshotUrl: null,
        resultUrl: null,
        stillLiveAsOf: null,
      },
    ],
  };

  it("renders badges, dates line, scan link; screenshot ONLY on the weaponised row", async () => {
    const raw = await render(BrandStewardshipReport({ ...base, cloneDetections: watchList }));
    const html = raw.replace(/<!-- -->/g, "");
    expect(html).toContain("ACTIVE PHISHING");
    expect(html).toContain("GRADED NO-THREAT — UNACTIONED");
    expect(html).toContain("ACTIONED BY NETCRAFT");
    expect(html).toContain("First seen 1 Jul 2026");
    expect(html).toContain("still live as of 10 Jul 2026");
    expect(html).toContain("https://urlscan.io/result/weap-uuid/");
    // Screenshot: weaponised row embedded, declined row link-only.
    expect(html).toContain("https://urlscan.io/screenshots/weap.png");
    expect(html).not.toContain("https://urlscan.io/screenshots/decl.png");
    // Honesty: never "removed"/"we took down".
    expect(html.toLowerCase()).not.toContain("we took down");
    expect(html.toLowerCase()).not.toContain("removed");
  });

  it("renders the why_still_up + what_you_can_do slots when unactioned rows exist, with override support", async () => {
    const html = await render(BrandStewardshipReport({ ...base, cloneDetections: watchList }));
    expect(html).toContain("evidence threshold"); // why_still_up default
    expect(html).toContain("auDRP"); // what_you_can_do default
    const overridden = await render(
      BrandStewardshipReport({
        ...base,
        cloneDetections: watchList,
        copy: { why_still_up: "Custom explainer for **{{brandName}}**." },
      }),
    );
    expect(overridden).toContain("Custom explainer for");
    expect(overridden).not.toContain("evidence threshold");
  });

  it("legacy ledger rows (no F2 fields) render exactly as before — no badge/dates/scan/img, no crash", async () => {
    const html = await render(
      BrandStewardshipReport({
        ...base,
        cloneDetections: {
          detected: 1,
          byClassification: {},
          byCountry: {},
          byRegistrar: {},
          byAsn: {},
          domains: [
            {
              domain: "anz-old.click",
              classification: "neutral",
              ip: "3.3.3.3",
              asn: "AS3",
              country: "AU",
              registrar: "NameSilo, LLC",
              abuseEmail: null,
            },
          ],
        },
      }),
    );
    expect(html).toContain("anz-old.click");
    expect(html).not.toContain("First seen");
    expect(html).not.toContain("View scan");
    expect(html).not.toContain("ACTIVE PHISHING");
    expect(html).not.toContain("urlscan.io/screenshots");
    // No unactioned counts → the two new slots stay hidden.
    expect(html).not.toContain("evidence threshold");
    expect(html).not.toContain("auDRP");
  });
});

describe("F2 slot gating (review fix)", () => {
  it("monitoring-only brands still get the why/what guidance (no counts, rows only)", async () => {
    const html = await render(
      BrandStewardshipReport({
        brandName: "ANZ",
        periodLabel: "July 2026",
        detected: 0,
        reportedByDestination: {},
        reportsSent: 0,
        reportRef: "BSR-anz-2026-07",
        cloneDetections: {
          detected: 1,
          declined: 0,
          weaponised: 0,
          byClassification: {},
          byCountry: {},
          byRegistrar: {},
          byAsn: {},
          domains: [
            {
              domain: "anz-mon.click",
              classification: "neutral",
              ip: null,
              asn: null,
              country: null,
              registrar: null,
              abuseEmail: null,
              lifecycleState: "monitoring",
              firstSeenAt: "2026-07-03T00:00:00Z",
              screenshotUrl: null,
              resultUrl: null,
              stillLiveAsOf: null,
            },
          ],
        },
      }),
    );
    expect(html).toContain("UNDER MONITORING");
    expect(html).toContain("evidence threshold"); // why_still_up renders
    expect(html).toContain("auDRP"); // what_you_can_do renders
    expect(html).toContain("unactioned lookalikes above"); // updated slot copy
  });
});
