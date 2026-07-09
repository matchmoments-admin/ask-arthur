import { describe, expect, it } from "vitest";

import {
  normHost,
  selectFalseNegativeCandidates,
  type NetcraftUrlEntry,
  type PendingAlert,
} from "@/lib/clone-watch/netcraft-urls";
import { buildIssuePayload } from "@/lib/clone-watch/netcraft-issue-report";
import acDbUrls from "./fixtures/netcraft-acDb-urls.json";

/**
 * Unit tests for the Netcraft false-negative reporter's pure core.
 *
 * These pin the two places the ultracode adversary review flagged as silent
 * detection failures: hostname normalisation (IDN/www/port/scheme) and the
 * per-URL escalation predicate (only `no threats`/`unavailable`, never when a
 * matched host has an actioned/unsettled entry).
 */

function alert(id: number, domain: string, brand = "Instagram"): PendingAlert {
  return {
    id,
    candidate_url: `https://${domain}/`,
    candidate_domain: domain,
    inferred_target_domain: "instagram.com",
    target_brand_normalized: brand,
    netcraft_uuid: "UUID1",
  };
}

function urlEntry(hostname: string, url_state: string): NetcraftUrlEntry {
  return { hostname, url: `https://${hostname}/`, url_state };
}

describe("normHost", () => {
  it("normalises scheme, www, case, port, trailing dot, path to the same host", () => {
    const forms = [
      "https://www.Example.COM:443/login?x=1",
      "example.com.",
      "http://example.com",
      "WWW.EXAMPLE.COM",
      "example.com/some/path",
    ];
    for (const f of forms) expect(normHost(f)).toBe("example.com");
  });

  it("punycodes IDN homographs so ASCII candidate matches Unicode netcraft host", () => {
    // Cyrillic 'а' (U+0430) apple.com — our whoisds side is ASCII punycode,
    // Netcraft may return the decoded Unicode. Both must normalise equal.
    const unicode = "аpple.com";
    const puny = normHost(unicode);
    expect(puny.startsWith("xn--")).toBe(true);
    expect(normHost(puny)).toBe(puny); // idempotent
  });
});

describe("selectFalseNegativeCandidates", () => {
  const alerts = [alert(1, "inistagram.ir")];

  it("flags a branded 'no threats' URL as a candidate", () => {
    const r = selectFalseNegativeCandidates(
      alerts,
      [urlEntry("inistagram.ir", "no threats")],
      { allowUnavailable: false },
    );
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ alertId: 1, urlState: "no threats" });
  });

  it("gates 'unavailable' behind allowUnavailable", () => {
    const entries = [urlEntry("inistagram.ir", "unavailable")];
    expect(
      selectFalseNegativeCandidates(alerts, entries, { allowUnavailable: false })
        .candidates,
    ).toHaveLength(0);
    expect(
      selectFalseNegativeCandidates(alerts, entries, { allowUnavailable: true })
        .candidates,
    ).toHaveLength(1);
  });

  it.each(["malicious", "suspicious", "processing"])(
    "never escalates a %s URL",
    (state) => {
      const r = selectFalseNegativeCandidates(
        alerts,
        [urlEntry("inistagram.ir", state)],
        { allowUnavailable: true },
      );
      expect(r.candidates).toHaveLength(0);
    },
  );

  it("does not escalate when the host has ANY actioned entry (multi-entry safety)", () => {
    const r = selectFalseNegativeCandidates(
      alerts,
      [
        urlEntry("inistagram.ir", "no threats"),
        urlEntry("inistagram.ir", "malicious"), // same host, actioned
      ],
      { allowUnavailable: true },
    );
    expect(r.candidates).toHaveLength(0);
  });

  it("reports alerts whose host is absent from /urls as notInUrls", () => {
    const r = selectFalseNegativeCandidates(
      alerts,
      [urlEntry("someone-else.com", "no threats")],
      { allowUnavailable: false },
    );
    expect(r.candidates).toHaveLength(0);
    expect(r.notInUrls.map((a) => a.id)).toEqual([1]);
  });

  it("collects unknown url_state values as drift", () => {
    const r = selectFalseNegativeCandidates(
      alerts,
      [urlEntry("inistagram.ir", "quarantined")],
      { allowUnavailable: true },
    );
    expect(r.driftStates).toContain("quarantined");
    expect(r.candidates).toHaveLength(0);
  });

  it("maps N alerts in one batch to N candidates", () => {
    const many = [alert(1, "a-bank.com"), alert(2, "b-bank.com"), alert(3, "c-bank.com")];
    const entries = many.map((a) => urlEntry(a.candidate_domain, "no threats"));
    const r = selectFalseNegativeCandidates(many, entries, { allowUnavailable: false });
    expect(r.candidates.map((c) => c.alertId).sort()).toEqual([1, 2, 3]);
  });
});

describe("smoke: real Netcraft submission acDb (state=malicious rollup)", () => {
  // Real /urls payload from submission acDbnxLBA2jy1dd2Q2P8tqQCma2ZvDQx — the
  // batch Brendan's email reported as "malicious" while 37/38 URLs were NEVER
  // actioned (1 malicious, 23 no threats, 14 unavailable). This is the exact
  // hidden-false-negative case the reporter exists to catch.
  const urls = acDbUrls.urls as NetcraftUrlEntry[];

  function alertFor(domain: string): PendingAlert {
    return {
      id: domain.length,
      candidate_url: `https://${domain}/`,
      candidate_domain: domain,
      inferred_target_domain: "brand.com",
      target_brand_normalized: "Brand",
      netcraft_uuid: "acDb",
    };
  }

  it("catches the founder's own examples (googlu.co, facebookk.xyz, statestreetcollective.shop) at 'no threats'", () => {
    const alerts = ["googlu.co", "facebookk.xyz", "statestreetcollective.shop"].map(
      alertFor,
    );
    const r = selectFalseNegativeCandidates(alerts, urls, { allowUnavailable: false });
    expect(r.candidates.map((c) => c.candidateDomain).sort()).toEqual(
      ["facebookk.xyz", "googlu.co", "statestreetcollective.shop"].sort(),
    );
    expect(r.candidates.every((c) => c.urlState === "no threats")).toBe(true);
  });

  it("only escalates 'unavailable' (inistagram.ir) when allowUnavailable=true", () => {
    const alerts = [alertFor("inistagram.ir")];
    expect(
      selectFalseNegativeCandidates(alerts, urls, { allowUnavailable: false }).candidates,
    ).toHaveLength(0);
    expect(
      selectFalseNegativeCandidates(alerts, urls, { allowUnavailable: true }).candidates,
    ).toHaveLength(1);
  });

  it("never escalates the one genuinely-malicious URL in the batch", () => {
    const malicious = urls.find((u) => u.url_state === "malicious")!;
    const r = selectFalseNegativeCandidates([alertFor(malicious.hostname)], urls, {
      allowUnavailable: true,
    });
    expect(r.candidates).toHaveLength(0);
  });
});

describe("buildIssuePayload", () => {
  it("builds report_issue body: PII-stripped urls, sends filename array, bounded info", () => {
    const payload = buildIssuePayload([
      {
        alertId: 1,
        candidateUrl: "https://inistagram.ir/login?email=victim@x.com",
        candidateDomain: "inistagram.ir",
        brand: "Instagram",
        urlState: "no threats",
      },
    ]);
    expect(payload.url_misclassifications).toHaveLength(1);
    expect(payload.url_misclassifications[0].url).not.toContain("victim@x.com");
    expect(payload.url_misclassifications[0].reason).toContain("Instagram");
    expect(payload.filename_misclassifications).toEqual([]);
    expect(payload.additional_info.length).toBeGreaterThan(0);
    expect(payload.additional_info.length).toBeLessThanOrEqual(10_000);
  });
});
