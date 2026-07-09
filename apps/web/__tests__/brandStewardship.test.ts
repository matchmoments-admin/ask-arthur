import { describe, expect, it } from "vitest";
import {
  aggregateOnwardByBrand,
  aggregateClonesByDomain,
  aggregateRedditByBrand,
  deriveBrandKey,
  matchKnownBrand,
  priorMonthStart,
  type CloneAlertRow,
} from "@/app/api/inngest/functions/report-brand-stewardship";

const cloneRow = (over: Partial<CloneAlertRow>): CloneAlertRow => ({
  id: over.id ?? 1,
  candidate_domain: over.candidate_domain ?? "anz-login.click",
  inferred_target_domain:
    over.inferred_target_domain === undefined
      ? "anz.com.au"
      : over.inferred_target_domain,
  urlscan_classification:
    over.urlscan_classification === undefined ? "neutral" : over.urlscan_classification,
  urlscan_evidence:
    over.urlscan_evidence ?? { server: { ip: "1.2.3.4", asn: "AS123", country: "SG" } },
  attribution: over.attribution ?? null,
  submitted_to: over.submitted_to ?? null,
  lifecycle_state: over.lifecycle_state ?? null,
  netcraft_declined_at: over.netcraft_declined_at ?? null,
  weaponised_at: over.weaponised_at ?? null,
});

describe("aggregateClonesByDomain", () => {
  it("groups by inferred_target_domain, extracts hosting, ranks phishing first", () => {
    const agg = aggregateClonesByDomain([
      cloneRow({ id: 1, candidate_domain: "anz-login.click", inferred_target_domain: "anz.com.au" }),
      cloneRow({
        id: 2,
        candidate_domain: "anz-rewards.click",
        inferred_target_domain: "anz.com.au",
        urlscan_classification: "likely_phishing",
      }),
      cloneRow({ id: 3, candidate_domain: "kmart-sale.shop", inferred_target_domain: "kmart.com.au" }),
    ]);
    expect(agg.get("anz.com.au")?.detected).toBe(2);
    expect(agg.get("kmart.com.au")?.detected).toBe(1);
    const anz = agg.get("anz.com.au")!;
    expect(anz.domains[0].classification).toBe("likely_phishing"); // sorted first
    expect(anz.domains[0].ip).toBe("1.2.3.4");
    expect(anz.domains[0].asn).toBe("AS123");
    expect(anz.byClassification.likely_phishing).toBe(1);
    expect(anz.alertIds).toContain(2);
  });

  it("dedupes the same candidate domain across rows", () => {
    const agg = aggregateClonesByDomain([
      cloneRow({ id: 1, candidate_domain: "dup.click" }),
      cloneRow({ id: 2, candidate_domain: "dup.click" }),
    ]);
    expect(agg.get("anz.com.au")?.detected).toBe(1);
  });

  it("pulls registrar + abuse email from attribution when present", () => {
    const agg = aggregateClonesByDomain([
      cloneRow({
        attribution: {
          whois: { registrar: "NameSilo, LLC", registrarAbuseEmail: "abuse@namesilo.com" },
        },
      }),
    ]);
    const d = agg.get("anz.com.au")!.domains[0];
    expect(d.registrar).toBe("NameSilo, LLC");
    expect(d.abuse_email).toBe("abuse@namesilo.com");
  });

  it("does not throw when a JSONB dimension is a non-string (array/number registrar)", () => {
    // Regression for 2026-06-15: one prod clone had attribution.whois.registrar
    // as an ARRAY (WHOIS returned multiple records), and bump() called .trim()
    // on it → `TypeError: t.trim is not a function`, aborting the whole monthly
    // prepare run. The aggregator must coerce non-string JSONB values.
    const agg = aggregateClonesByDomain([
      cloneRow({
        id: 1,
        candidate_domain: "anz-arr.click",
        attribution: {
          whois: { registrar: ["GoDaddy.com, LLC", "Reseller"] },
        } as unknown as CloneAlertRow["attribution"],
      }),
      cloneRow({
        id: 2,
        candidate_domain: "anz-num.click",
        // No server.asn so the numeric hosting.asn is what reaches bump().
        urlscan_evidence: { server: { ip: "5.6.7.8", country: "US" } } as unknown as CloneAlertRow["urlscan_evidence"],
        attribution: {
          hosting: { asn: 13335 },
        } as unknown as CloneAlertRow["attribution"],
      }),
    ]);
    const m = agg.get("anz.com.au")!;
    expect(m.detected).toBe(2);
    // coerced to a string bucket, not crashed
    expect(Object.keys(m.byRegistrar)).toContain("GoDaddy.com, LLC,Reseller");
    expect(Object.keys(m.byAsn)).toContain("13335");
  });

  it("counts netcraftReported from submitted_to.netcraft (deduped by domain)", () => {
    const agg = aggregateClonesByDomain([
      cloneRow({ id: 1, candidate_domain: "a.click", submitted_to: { netcraft: { uuid: "x" } } }),
      cloneRow({ id: 2, candidate_domain: "b.click", submitted_to: null }),
      cloneRow({ id: 3, candidate_domain: "c.click", submitted_to: { netcraft: { uuid: "y" } } }),
    ]);
    const m = agg.get("anz.com.au")!;
    expect(m.detected).toBe(3);
    expect(m.netcraftReported).toBe(2);
  });

  it("counts the lifecycle-transition metrics (taken_down / declined / escalated / weaponised / re-taken-down)", () => {
    const agg = aggregateClonesByDomain([
      cloneRow({ id: 1, candidate_domain: "a.click", lifecycle_state: "taken_down" }),
      cloneRow({ id: 2, candidate_domain: "b.click", lifecycle_state: "declined" }),
      cloneRow({ id: 3, candidate_domain: "c.click", lifecycle_state: "weaponised" }),
      // escalated (report_issue filed) AND taken_down → re-taken-down win
      cloneRow({
        id: 4,
        candidate_domain: "d.click",
        lifecycle_state: "taken_down",
        submitted_to: { netcraft: { uuid: "z" }, netcraft_issue: { issue_reported_at: "2026-07-10" } },
      }),
    ]);
    const m = agg.get("anz.com.au")!;
    expect(m.takenDown).toBe(2);
    expect(m.declined).toBe(1);
    expect(m.weaponised).toBe(1);
    expect(m.escalated).toBe(1);
    expect(m.reTakenDown).toBe(1);
  });

  it("skips rows without an inferred_target_domain", () => {
    expect(aggregateClonesByDomain([cloneRow({ inferred_target_domain: null })]).size).toBe(0);
  });

  it("normalises the brand-domain key to lowercase", () => {
    const agg = aggregateClonesByDomain([cloneRow({ inferred_target_domain: "ANZ.com.au" })]);
    expect(agg.has("anz.com.au")).toBe(true);
  });
});

describe("deriveBrandKey", () => {
  it("matches the SQL convention (lower + non-alnum → _)", () => {
    expect(deriveBrandKey("JB Hi-Fi")).toBe("jb_hi_fi");
    expect(deriveBrandKey("Australia Post")).toBe("australia_post");
    expect(deriveBrandKey("CommBank")).toBe("commbank");
  });

  // Contract test (ultrareview F4): these MUST stay equal to the v119 SQL
  // `lower(regexp_replace(brand, '[^a-zA-Z0-9]+', '_', 'g'))`. If that SQL
  // formula ever changes (e.g. starts trimming trailing `_`), this TS copy
  // would silently mis-join brands to known_brands contacts → a brand's
  // stewardship report routes to the wrong/no recipient. Edge cases chosen to
  // catch exactly that drift: punctuation runs, trailing punctuation, digits.
  it("agrees with the SQL formula on drift-prone edge cases", () => {
    expect(deriveBrandKey("St.George Bank")).toBe("st_george_bank");
    // A run of non-alnum collapses to ONE underscore; trailing ")" leaves a
    // trailing "_" (Postgres regexp_replace does NOT trim) — both must match.
    expect(deriveBrandKey("Linkt (Transurban)")).toBe("linkt_transurban_");
    expect(deriveBrandKey("7-Eleven")).toBe("7_eleven");
    expect(deriveBrandKey("Domino's")).toBe("domino_s");
    expect(deriveBrandKey(" Westpac ")).toBe("_westpac_");
  });
});

describe("aggregateOnwardByBrand", () => {
  const brandById = new Map<number, string>([
    [1, "Australia Post"],
    [2, "Australia Post"],
    [3, "CommBank"],
  ]);

  it("counts only SENT rows and de-dupes detected by scam_report_id", () => {
    const rows = [
      { scam_report_id: 1, destination: "openphish", status: "sent" },
      { scam_report_id: 1, destination: "apwg", status: "sent" }, // same scam, 2nd dest
      { scam_report_id: 2, destination: "openphish", status: "sent" },
      { scam_report_id: 3, destination: "openphish", status: "queued" }, // not sent → ignored
    ];
    const agg = aggregateOnwardByBrand(rows, brandById);

    const auspost = agg.get("Australia Post")!;
    expect(auspost.detected).toBe(2); // scam 1 + scam 2 (not double-counted by dest)
    expect(auspost.reportsSent).toBe(3);
    expect(auspost.reportedByDestination).toEqual({ openphish: 2, apwg: 1 });
    expect(auspost.scamReportIds.sort()).toEqual([1, 2]);

    // CommBank's only row was 'queued' → no entry (we never claim unsent reports).
    expect(agg.has("CommBank")).toBe(false);
  });

  it("ignores rows whose scam_report_id has no resolved brand", () => {
    const rows = [{ scam_report_id: 99, destination: "openphish", status: "sent" }];
    expect(aggregateOnwardByBrand(rows, brandById).size).toBe(0);
  });
});

describe("matchKnownBrand", () => {
  const contacts = [
    { brand_key: "auspost", brand_name: "Australia Post", security_contact_email: "abuse@auspost.com.au" },
    { brand_key: "cba", brand_name: "CommBank", security_contact_email: null },
  ];

  it("matches by brand_name case-insensitively", () => {
    const m = matchKnownBrand("australia post", contacts);
    expect(m?.security_contact_email).toBe("abuse@auspost.com.au");
  });

  it("skips contacts without an email even on a name match", () => {
    // "CommBank" matches by name but has no email → no usable contact.
    expect(matchKnownBrand("CommBank", contacts)).toBeNull();
  });

  it("returns null when no brand matches", () => {
    expect(matchKnownBrand("Telstra", contacts)).toBeNull();
  });

  describe("canonical-equivalence fallback (brand_aliases layer)", () => {
    // Fake resolver standing in for resolve_brand / the loaded brand_aliases map:
    // every "Commonwealth Bank" spelling canonicalises to "CBA".
    const resolve = (s: string): string | null => {
      const k = s.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const m: Record<string, string> = {
        commonwealthbank: "CBA",
        commonwealthbankofaustralia: "CBA",
        commbank: "CBA",
        cba: "CBA",
        nationalaustraliabank: "NAB",
        nab: "NAB",
      };
      return m[k] ?? null;
    };
    const withEmail = [
      { brand_key: "cba", brand_name: "CommBank", security_contact_email: "soc@cba.com.au" },
    ];

    it("matches a long-form report brand to a short-form contact via canonical", () => {
      // Direct match fails ("Commonwealth Bank of Australia" ≠ "CommBank"),
      // canonical fallback succeeds (both → "CBA").
      const m = matchKnownBrand("Commonwealth Bank of Australia", withEmail, resolve);
      expect(m?.security_contact_email).toBe("soc@cba.com.au");
    });

    it("does not fall back when the resolver yields no canonical", () => {
      expect(matchKnownBrand("Some Unknown Co", withEmail, resolve)).toBeNull();
    });

    it("never returns a canonical match that lacks an email", () => {
      const noEmail = [
        { brand_key: "nab", brand_name: "NAB", security_contact_email: null },
      ];
      expect(matchKnownBrand("National Australia Bank", noEmail, resolve)).toBeNull();
    });

    it("behaves identically to before when no resolver is passed", () => {
      expect(matchKnownBrand("Commonwealth Bank of Australia", withEmail)).toBeNull();
    });
  });
});

describe("priorMonthStart", () => {
  it("returns the first day of the previous month (UTC)", () => {
    expect(priorMonthStart(new Date("2026-05-29T09:00:00Z")).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z",
    );
  });

  it("handles the January → December year rollover", () => {
    expect(priorMonthStart(new Date("2026-01-01T09:00:00Z")).toISOString()).toBe(
      "2025-12-01T00:00:00.000Z",
    );
  });
});

describe("aggregateRedditByBrand", () => {
  it("counts one mention per distinct normalized brand per post + keeps narratives", () => {
    const agg = aggregateRedditByBrand([
      { brands_impersonated: ["PayPal", "Amazon"], narrative_summary: "Fake PayPal refund text." },
      { brands_impersonated: ["paypal"], narrative_summary: "PayPal login phish email." },
      { brands_impersonated: null, narrative_summary: "x" },
    ]);
    expect(agg.get("paypal")?.mentions).toBe(2);
    expect(agg.get("amazon")?.mentions).toBe(1);
    expect(agg.get("paypal")?.sampleNarratives).toEqual([
      "Fake PayPal refund text.",
      "PayPal login phish email.",
    ]);
  });

  it("dedupes a brand named twice in one post and skips symbol-only entries", () => {
    const agg = aggregateRedditByBrand([
      { brands_impersonated: ["NAB", "NAB", "!!!"], narrative_summary: null },
    ]);
    expect(agg.get("nab")?.mentions).toBe(1);
    expect(agg.size).toBe(1);
  });

  it("caps sample narratives at 3 and dedupes identical narratives", () => {
    const agg = aggregateRedditByBrand([
      { brands_impersonated: ["Auspost"], narrative_summary: "A" },
      { brands_impersonated: ["Auspost"], narrative_summary: "A" }, // dup → not added
      { brands_impersonated: ["Auspost"], narrative_summary: "B" },
      { brands_impersonated: ["Auspost"], narrative_summary: "C" },
      { brands_impersonated: ["Auspost"], narrative_summary: "D" }, // 4th distinct → capped
    ]);
    expect(agg.get("auspost")?.mentions).toBe(5);
    expect(agg.get("auspost")?.sampleNarratives).toEqual(["A", "B", "C"]);
  });
});
