import { describe, expect, it } from "vitest";

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

  it("adds registrar/hosting abuse ONLY when attribution gives a recipient", () => {
    const withAttr = selectChannels({
      ...base,
      attribution: {
        registrar: "NameCheap",
        registrar_abuse_email: "abuse@namecheap.com",
        hosting: { provider: "Cloudflare", abuse_email: "abuse@cloudflare.com" },
      },
    });
    const channels = withAttr.map((p) => p.channel);
    expect(channels).toContain("registrar_abuse");
    expect(channels).toContain("hosting_abuse");
    // both are human-gated (never auto — itch.io)
    expect(
      withAttr
        .filter((p) => ["registrar_abuse", "hosting_abuse"].includes(p.channel))
        .every((p) => p.autonomy === "human_required"),
    ).toBe(true);
  });

  it("omits registrar/hosting when no abuse recipient is known (no noise reports)", () => {
    const plans = selectChannels({
      ...base,
      attribution: { registrar: "NameCheap", registrar_abuse_email: null },
    });
    expect(plans.find((p) => p.channel === "registrar_abuse")).toBeUndefined();
    expect(plans.find((p) => p.channel === "hosting_abuse")).toBeUndefined();
  });
});
