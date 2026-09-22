import { describe, expect, it } from "vitest";

import type { CloneAttribution } from "@/lib/clone-watch/enrich-attribution";
import { selectChannels } from "@/lib/clone-watch/enforcement/matrix";

const base = {
  candidateUrl: "https://facebookk.xyz/login",
  candidateDomain: "facebookk.xyz",
};

describe("selectChannels — clone enforcement matrix", () => {
  it("always plans the two auto ecosystem feeds + the two browser-block forms", () => {
    const plans = selectChannels({ ...base, attribution: null });
    const channels = plans.map((p) => p.channel).sort();
    expect(channels).toEqual([
      "apwg",
      "openphish",
      "safe_browsing",
      "smartscreen",
    ]);
  });

  it("only APWG/OpenPhish are auto; browser-block forms are human_required", () => {
    const plans = selectChannels({ ...base, attribution: null });
    const auto = plans.filter((p) => p.autonomy === "auto").map((p) => p.channel);
    expect(auto.sort()).toEqual(["apwg", "openphish"]);
    // itch.io invariant: GSB/SmartScreen never auto.
    for (const c of ["safe_browsing", "smartscreen"]) {
      expect(plans.find((p) => p.channel === c)?.autonomy).toBe("human_required");
    }
  });

  it("GSB deep-link is URL-scoped (the exact phishing URL, encoded)", () => {
    const plans = selectChannels({ ...base, attribution: null });
    const gsb = plans.find((p) => p.channel === "safe_browsing");
    expect(gsb?.deepLink).toContain(encodeURIComponent(base.candidateUrl));
  });

  it("adds registrar + hosting abuse when the real dossier evidences them", () => {
    const withAttr = selectChannels({
      ...base,
      attribution: {
        whois: { registrar: "NameCheap, Inc.", registrarAbuseEmail: "abuse@namecheap.com" },
        hosting: { ip: "104.21.34.215", asn: "AS13335", country: "US" },
      },
    });
    const channels = withAttr.map((p) => p.channel);
    expect(channels).toContain("registrar_abuse");
    expect(channels).toContain("hosting_abuse");
    expect(withAttr.find((p) => p.channel === "hosting_abuse")?.deepLink).toBe(
      "https://abuse.cloudflare.com/",
    );
    // both are human-gated (never auto — itch.io)
    expect(
      withAttr
        .filter((p) => ["registrar_abuse", "hosting_abuse"].includes(p.channel))
        .every((p) => p.autonomy === "human_required"),
    ).toBe(true);
  });

  it("known registrar without an abuse email → the registrar's abuse form", () => {
    const plan = selectChannels({
      ...base,
      attribution: { whois: { registrar: "GoDaddy.com, LLC", registrarAbuseEmail: null } },
    }).find((p) => p.channel === "registrar_abuse");
    expect(plan?.deepLink).toBe("https://supportcenter.godaddy.com/AbuseReport");
  });

  it("omits registrar/hosting when nothing evidences a recipient (no noise reports)", () => {
    const plans = selectChannels({
      ...base,
      attribution: { whois: null, hosting: { ip: "1.2.3.4", asn: "AS9999", country: "RU" } },
    });
    expect(plans.find((p) => p.channel === "registrar_abuse")).toBeUndefined();
    expect(plans.find((p) => p.channel === "hosting_abuse")).toBeUndefined();
  });

  // The dossier shape the enricher ACTUALLY writes (typed as CloneAttribution,
  // so a drift in either module breaks this at compile time). Until 2026-09-22
  // the matrix read a flat `registrar_abuse_email` nothing ever wrote, and the
  // tests above pinned that fictional shape — so registrar abuse was never
  // offered on any of 2,455 enriched alerts while every test stayed green.
  it("offers registrar abuse from the enricher's real whois dossier", () => {
    const dossier: CloneAttribution = {
      whois: {
        registrar: "Dynadot Inc",
        registrarAbuseEmail: "abuse@dynadot.com",
        registrantCountry: null,
        createdDate: "2026-09-19",
        nameServers: ["ns1.cloudflare.com"],
        statuses: ["active"],
        registrarIanaId: "472",
        source: "rdap",
      },
      ct: null,
      ip_rep: null,
      hosting: { ip: null, country: null, asn: null },
      enriched_at: "2026-09-22T13:33:00Z",
    };
    const plan = selectChannels({ ...base, attribution: dossier }).find(
      (p) => p.channel === "registrar_abuse",
    );
    expect(plan?.autonomy).toBe("human_required");
    expect(plan?.note).toContain("abuse@dynadot.com");
    expect(plan?.note).toContain("Dynadot Inc");
  });
});
