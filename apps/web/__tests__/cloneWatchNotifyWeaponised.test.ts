import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import WeaponisedCloneAlert from "../emails/WeaponisedCloneAlert";
import {
  buildWeaponisedAlertProps,
  buildWeaponisedSubject,
  buildWeaponisedTelegramMessage,
} from "@/app/api/inngest/functions/clone-watch-notify-weaponised";
import { WEAPONISED_CLONE_SLOTS, EMAIL_TEMPLATES } from "@/lib/email/copy-registry";

// F1 — weaponisation early-warning alert. Covers the pure prop/subject/
// Telegram builders + full template renders with honesty-invariant
// assertions. The Inngest step machinery (gates, enqueue, assign-batch) is
// exercised e2e on preview per the PR checklist, not mocked here — same
// convention as cloneWatchOutreach.test.ts.

const BASE_ALERT = {
  candidate_domain: "cba-secure-login.com",
  candidate_url: "https://cba-secure-login.com/",
  inferred_target_domain: "commbank.com.au",
  weaponised_at: "2026-07-09T22:14:00.000Z",
  netcraft_declined_at: null as string | null,
  attribution: null as unknown,
};

describe("buildWeaponisedAlertProps", () => {
  it("omits registrar/hosting fields when attribution is NULL (unenriched alert)", () => {
    const props = buildWeaponisedAlertProps(BASE_ALERT, {
      brandName: "CommBank",
      reportRef: "CW-weaponised-1",
    });
    expect(props.registrar).toBeUndefined();
    expect(props.registrarAbuseEmail).toBeUndefined();
    expect(props.hostingIp).toBeUndefined();
    expect(props.hostingCountry).toBeUndefined();
    expect(props.hostingAsn).toBeUndefined();
    expect(props.netcraftDeclinedAt).toBeUndefined();
    expect(props.legitimateDomain).toBe("commbank.com.au");
    expect(props.weaponisedAt).toBe(BASE_ALERT.weaponised_at);
  });

  it("reads the enricher's nested attribution shape (whois/hosting)", () => {
    const props = buildWeaponisedAlertProps(
      {
        ...BASE_ALERT,
        attribution: {
          whois: {
            registrar: "NameCheap, Inc.",
            registrarAbuseEmail: "abuse@namecheap.com",
          },
          hosting: { ip: "203.0.113.7", country: "US", asn: "AS13335" },
        },
      },
      { brandName: "CommBank", reportRef: "CW-weaponised-1" },
    );
    expect(props.registrar).toBe("NameCheap, Inc.");
    expect(props.registrarAbuseEmail).toBe("abuse@namecheap.com");
    expect(props.hostingIp).toBe("203.0.113.7");
    expect(props.hostingCountry).toBe("US");
    expect(props.hostingAsn).toBe("AS13335");
  });

  it("tolerates the legacy flat attribution shape", () => {
    const props = buildWeaponisedAlertProps(
      {
        ...BASE_ALERT,
        attribution: {
          registrar: "GoDaddy",
          registrar_abuse_email: "abuse@godaddy.com",
        },
      },
      { brandName: "CommBank", reportRef: "CW-weaponised-1" },
    );
    expect(props.registrar).toBe("GoDaddy");
    expect(props.registrarAbuseEmail).toBe("abuse@godaddy.com");
  });

  it("carries netcraft_declined_at through only when set", () => {
    const props = buildWeaponisedAlertProps(
      { ...BASE_ALERT, netcraft_declined_at: "2026-06-01T00:00:00.000Z" },
      { brandName: "CommBank", reportRef: "CW-weaponised-1" },
    );
    expect(props.netcraftDeclinedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("falls back to brandName when inferred_target_domain is null", () => {
    const props = buildWeaponisedAlertProps(
      { ...BASE_ALERT, inferred_target_domain: null },
      { brandName: "CommBank", reportRef: "CW-weaponised-1" },
    );
    expect(props.legitimateDomain).toBe("CommBank");
  });
});

describe("buildWeaponisedSubject", () => {
  it("names the brand and the candidate domain, factually", () => {
    const s = buildWeaponisedSubject("CommBank", "cba-secure-login.com");
    expect(s).toContain("CommBank");
    expect(s).toContain("cba-secure-login.com");
    expect(s.toLowerCase()).toContain("suspected");
    // Honesty invariant: no takedown claims, no "confirmed".
    expect(s.toLowerCase()).not.toContain("confirmed");
    expect(s.toLowerCase()).not.toContain("taken down");
  });
});

describe("buildWeaponisedTelegramMessage", () => {
  it("staged: contains the siren, brand, domain, via and dashboard link", () => {
    const msg = buildWeaponisedTelegramMessage({
      stage: "staged",
      brand: "CommBank",
      candidateDomain: "cba-secure-login.com",
      via: "recheck",
      urlscanResultUrl: "https://urlscan.io/result/abc-123/",
      channelType: "fraud_inbox",
    });
    expect(msg).toContain("🚨");
    expect(msg).toContain("WEAPONISED");
    expect(msg).toContain("CommBank");
    expect(msg).toContain("cba-secure-login.com");
    expect(msg).toContain("via recheck");
    expect(msg).toContain("https://urlscan.io/result/abc-123/");
    expect(msg).toContain("askarthur.au/admin/clone-watch#approvals");
  });

  it("no_contact: pages the admin to add a directory row", () => {
    const msg = buildWeaponisedTelegramMessage({
      stage: "no_contact",
      brand: "someunknownbrand.com.au",
      candidateDomain: "someunknownbrand-login.com",
      via: "initial",
      detail: "no_directory_row",
    });
    expect(msg).toContain("🚨");
    expect(msg).toContain("No brand contact on file");
    expect(msg).toContain("brand_contact_directory");
  });

  it("manual_channel: surfaces the channel and the open-link", () => {
    const msg = buildWeaponisedTelegramMessage({
      stage: "manual_channel",
      brand: "Kmart",
      candidateDomain: "kmart-au-sale.com",
      via: "recheck",
      detail: "bugcrowd_vdp",
      recipient: "https://bugcrowd.com/kmart-vdp",
    });
    expect(msg).toContain("bugcrowd_vdp");
    expect(msg).toContain("https://bugcrowd.com/kmart-vdp");
  });

  it("escapes HTML in attacker-controlled domain strings", () => {
    const msg = buildWeaponisedTelegramMessage({
      stage: "no_contact",
      brand: "x<b>y</b>",
      candidateDomain: "<script>alert(1)</script>.com",
      via: "initial",
    });
    expect(msg).not.toContain("<script>");
    expect(msg).toContain("&lt;script&gt;");
  });
});

describe("WeaponisedCloneAlert template", () => {
  const fullProps = buildWeaponisedAlertProps(
    {
      ...BASE_ALERT,
      netcraft_declined_at: "2026-06-01T00:00:00.000Z",
      attribution: {
        whois: {
          registrar: "NameCheap, Inc.",
          registrarAbuseEmail: "abuse@namecheap.com",
        },
        hosting: { ip: "203.0.113.7", country: "US", asn: "AS13335" },
      },
    },
    {
      brandName: "CommBank",
      reportRef: "CW-weaponised-42",
      urlscanResultUrl: "https://urlscan.io/result/abc-123/",
      urlscanScreenshotUrl: "https://urlscan.io/screenshots/abc-123.png",
    },
  );

  it("renders the full evidence block", async () => {
    const html = await render(WeaponisedCloneAlert(fullProps));
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("CommBank");
    expect(html).toContain("cba-secure-login.com");
    expect(html).toContain("2026-07-09"); // weaponised date
    expect(html).toContain("NameCheap, Inc.");
    expect(html).toContain("abuse@namecheap.com");
    expect(html).toContain("203.0.113.7");
    expect(html).toContain("https://urlscan.io/result/abc-123/");
    expect(html).toContain("https://urlscan.io/screenshots/abc-123.png");
    expect(html).toContain("ABN 72 695 772 313");
    expect(html).toContain("CW-weaponised-42");
  });

  it("carries the STOP mailto + FALSE POSITIVE instruction (carried invariants)", async () => {
    const html = await render(WeaponisedCloneAlert(fullProps));
    expect(html).toContain("STOP%20clone-watch%20notifications");
    expect(html).toContain("FALSE POSITIVE");
    expect(html).toContain("factual signal report");
  });

  it("honesty invariants: never claims a confirmed verdict or a takedown", async () => {
    const html = await render(WeaponisedCloneAlert(fullProps));
    const lower = html.toLowerCase();
    expect(lower).not.toContain("confirmed phishing");
    expect(lower).not.toContain("has been taken down");
    expect(lower).not.toContain("we will file");
    // The factual framing is present instead.
    expect(lower).toContain("likely phishing");
    expect(lower).toContain("not a legal determination");
  });

  it("renders the vendor-decline honesty line ONLY when netcraftDeclinedAt is set", async () => {
    const withDecline = await render(WeaponisedCloneAlert(fullProps));
    expect(withDecline).toContain("not actioned at that time");
    expect(withDecline).toContain("2026-06-01");

    const withoutDecline = await render(
      WeaponisedCloneAlert({ ...fullProps, netcraftDeclinedAt: undefined }),
    );
    expect(withoutDecline).not.toContain("not actioned at that time");
  });

  it("gracefully omits registrar/hosting/screenshot when absent", async () => {
    const html = await render(
      WeaponisedCloneAlert(
        buildWeaponisedAlertProps(BASE_ALERT, {
          brandName: "CommBank",
          reportRef: "CW-weaponised-1",
        }),
      ),
    );
    expect(html).not.toContain("Registrar:");
    expect(html).not.toContain("Hosting:");
    expect(html).not.toContain("urlscan.io/screenshots");
    expect(html).toContain("cba-secure-login.com");
  });
});

describe("copy registry", () => {
  it("registers the weaponised_clone_alert template with its slot", () => {
    expect(EMAIL_TEMPLATES.weaponised_clone_alert).toBeDefined();
    expect(EMAIL_TEMPLATES.weaponised_clone_alert.slots).toBe(
      WEAPONISED_CLONE_SLOTS,
    );
    expect(WEAPONISED_CLONE_SLOTS.what_you_can_do.default).not.toContain(
      "we will file",
    );
  });
});
