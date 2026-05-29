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
