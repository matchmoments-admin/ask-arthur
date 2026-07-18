// Tests for the styled brand-outreach PILOT email: the live clone-sample
// helper (fetch/shape/rank/threshold) and the React Email template render.
//
// Contract under test:
//   • getBrandCloneSample reads shopfront_clone_alerts and shapes it into the
//     lean sample the template needs, prioritising the clones we ACTIONED /
//     reported on the brand's behalf (weaponised → taken_down → netcraft) over
//     merely-detected rows.
//   • The "enough data to pitch" floor (founder's rule) drives insufficientData.
//   • The template proves value with the sample AND keeps the honesty framing
//     (factual verbs, "evidence of OUR detections", never an SPF-compliance
//     claim, never a registrant characterisation).

import { describe, it, expect, vi } from "vitest";
import { render } from "@react-email/components";
import BrandOutreachPilot, {
  type BrandCloneSample,
} from "@/emails/BrandOutreachPilot";
import {
  buildBrandCloneSample,
  shapeCloneAlert,
  isReportedRow,
  compareSampleRows,
  getBrandCloneSample,
  MIN_REPORTED_CLONES_FOR_OUTREACH,
  CLONE_SAMPLE_SIZE,
  type RawCloneAlert,
} from "@/lib/email/brand-outreach-pilot";

// ── Fixtures ──

function raw(overrides: Partial<RawCloneAlert>): RawCloneAlert {
  return {
    candidate_domain: "reece-rewards.click",
    inferred_target_domain: "reece.com.au",
    urlscan_classification: null,
    urlscan_evidence: null,
    urlscan_uuid: null,
    attribution: null,
    submitted_to: null,
    lifecycle_state: null,
    first_seen_at: "2026-07-10T00:00:00Z",
    ...overrides,
  };
}

// ── shapeCloneAlert ──

describe("shapeCloneAlert", () => {
  it("maps hosting, registrar, evidence url + netcraft-reported flag", () => {
    const row = shapeCloneAlert(
      raw({
        candidate_domain: "reece-au-login.click",
        urlscan_classification: "likely_phishing",
        urlscan_evidence: {
          server: { ip: "1.2.3.4", asn: "AS132203", country: "US" },
        },
        urlscan_uuid: "uuid-123",
        attribution: { whois: { registrar: "NameSilo, LLC" } },
        submitted_to: { netcraft: { submitted_at: "2026-07-11T00:00:00Z" } },
        lifecycle_state: "weaponised",
      }),
    );
    expect(row.domain).toBe("reece-au-login.click");
    expect(row.classification).toBe("likely_phishing");
    expect(row.host).toBe("1.2.3.4 · AS132203 · US");
    expect(row.registrar).toBe("NameSilo, LLC");
    expect(row.resultUrl).toBe("https://urlscan.io/result/uuid-123/");
    expect(row.reportedToNetcraft).toBe(true);
    expect(row.lifecycleState).toBe("weaponised");
  });

  it("falls back to attribution hosting + null-safe fields", () => {
    const row = shapeCloneAlert(
      raw({
        urlscan_evidence: null,
        attribution: { hosting: { ip: "9.9.9.9", country: "AU" } },
      }),
    );
    expect(row.host).toBe("9.9.9.9 · AU");
    expect(row.registrar).toBeNull();
    expect(row.resultUrl).toBeNull();
    expect(row.reportedToNetcraft).toBe(false);
  });
});

// ── isReportedRow ("reported on their behalf") ──

describe("isReportedRow", () => {
  it("counts netcraft-submitted, weaponised and taken_down as reported", () => {
    expect(isReportedRow(shapeCloneAlert(raw({ lifecycle_state: "weaponised" })))).toBe(true);
    expect(isReportedRow(shapeCloneAlert(raw({ lifecycle_state: "taken_down" })))).toBe(true);
    expect(
      isReportedRow(shapeCloneAlert(raw({ submitted_to: { netcraft: {} } }))),
    ).toBe(true);
  });
  it("does NOT count a merely-detected / declined-without-report row", () => {
    expect(isReportedRow(shapeCloneAlert(raw({ lifecycle_state: "detected" })))).toBe(false);
    expect(isReportedRow(shapeCloneAlert(raw({ lifecycle_state: "monitoring" })))).toBe(false);
  });
});

// ── ranking ──

describe("compareSampleRows / buildBrandCloneSample ranking", () => {
  it("orders weaponised → taken_down → reported → declined → detected", () => {
    const rows = [
      shapeCloneAlert(raw({ candidate_domain: "d-detected.click", lifecycle_state: "detected" })),
      shapeCloneAlert(raw({ candidate_domain: "c-declined.click", lifecycle_state: "declined" })),
      shapeCloneAlert(raw({ candidate_domain: "a-weap.click", lifecycle_state: "weaponised" })),
      shapeCloneAlert(raw({ candidate_domain: "b-down.click", lifecycle_state: "taken_down" })),
    ].sort(compareSampleRows);
    expect(rows.map((r) => r.domain)).toEqual([
      "a-weap.click",
      "b-down.click",
      "c-declined.click",
      "d-detected.click",
    ]);
  });

  it("dedupes by clone domain, counts true totals, and caps rows", () => {
    const rawRows: RawCloneAlert[] = [
      // duplicate clone domain — keep the higher-priority (weaponised) copy
      raw({ candidate_domain: "dup.click", lifecycle_state: "detected" }),
      raw({ candidate_domain: "dup.click", lifecycle_state: "weaponised" }),
      raw({ candidate_domain: "b.click", lifecycle_state: "taken_down" }),
      raw({ candidate_domain: "c.click", submitted_to: { netcraft: {} }, lifecycle_state: "declined" }),
      raw({ candidate_domain: "d.click", lifecycle_state: "detected" }),
      raw({ candidate_domain: "e.click", lifecycle_state: "monitoring" }),
      raw({ candidate_domain: "f.click", lifecycle_state: "detected" }),
      raw({ candidate_domain: "g.click", lifecycle_state: "detected" }),
    ];
    const s = buildBrandCloneSample(rawRows, "reece.com.au");
    expect(s.totalCount).toBe(7); // dup collapsed
    // reported = dup(weaponised) + b(taken_down) + c(netcraft) = 3
    expect(s.reportedCount).toBe(3);
    expect(s.weaponisedCount).toBe(1);
    expect(s.takenDownCount).toBe(1);
    expect(s.rows).toHaveLength(CLONE_SAMPLE_SIZE);
    expect(s.rows[0].domain).toBe("dup.click"); // weaponised leads
    expect(s.insufficientData).toBe(false); // 3 >= floor
  });

  it("flags insufficientData below the reported-clone floor", () => {
    const s = buildBrandCloneSample(
      [
        raw({ candidate_domain: "x.click", lifecycle_state: "detected" }),
        raw({ candidate_domain: "y.click", lifecycle_state: "weaponised" }),
      ],
      "smallbrand.com.au",
    );
    expect(s.reportedCount).toBe(1);
    expect(s.reportedCount).toBeLessThan(MIN_REPORTED_CLONES_FOR_OUTREACH);
    expect(s.insufficientData).toBe(true);
  });
});

// ── getBrandCloneSample (fetch wrapper) ──

describe("getBrandCloneSample", () => {
  it("returns null for an empty brand domain (ad-hoc send, no DB hit)", async () => {
    const sb = { from: vi.fn() } as never;
    expect(await getBrandCloneSample(sb, null)).toBeNull();
    expect(await getBrandCloneSample(sb, "  ")).toBeNull();
  });

  it("lowercases the domain, runs the filtered query, and shapes the result", async () => {
    const limit = vi
      .fn()
      .mockResolvedValue({
        data: [
          raw({ candidate_domain: "reece-login.click", lifecycle_state: "weaponised", submitted_to: { netcraft: {} } }),
        ],
        error: null,
      });
    const eq = vi.fn();
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: eq.mockImplementation(() => builder),
      gte: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit,
    };
    const sb = { from: vi.fn(() => builder) } as never;

    const s = await getBrandCloneSample(sb, "Reece.com.au");
    expect(s).not.toBeNull();
    expect(s!.brandDomain).toBe("reece.com.au");
    expect(s!.rows[0].domain).toBe("reece-login.click");
    // filtered on the lowercased brand domain
    expect(eq).toHaveBeenCalledWith("inferred_target_domain", "reece.com.au");
    expect(eq).toHaveBeenCalledWith("source", "nrd");
  });

  it("returns a shaped empty sample on a query error path (no throw)", async () => {
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    };
    const sb = { from: vi.fn(() => builder) } as never;
    expect(await getBrandCloneSample(sb, "reece.com.au")).toBeNull();
  });
});

// ── template render ──

describe("BrandOutreachPilot render", () => {
  const sample: BrandCloneSample = {
    brandDomain: "reece.com.au",
    windowDays: 30,
    totalCount: 9,
    reportedCount: 5,
    weaponisedCount: 2,
    takenDownCount: 1,
    insufficientData: false,
    rows: [
      {
        domain: "reece-rewards.click",
        lifecycleState: "weaponised",
        classification: "likely_phishing",
        detectedAt: "2026-07-10T00:00:00Z",
        reportedToNetcraft: true,
        registrar: "NameSilo, LLC",
        host: "1.2.3.4 · AS132203 · US",
        resultUrl: "https://urlscan.io/result/uuid-123/",
      },
    ],
  };

  it("renders the clone sample with factual, honest framing", async () => {
    const html = await render(
      BrandOutreachPilot({
        brandName: "Reece",
        bodyHtml: "<p>Hi Alex, a pilot idea.</p>",
        cloneSample: sample,
      }),
    );
    // the value-proof section + real domain
    expect(html).toContain("A sample of the clones");
    expect(html).toContain("reece-rewards.click");
    // factual verbs / counts
    expect(html).toContain("detected");
    expect(html).toContain("reported");
    // the lifecycle badge (from outcome-copy) — honest, not "we took it down"
    expect(html).toContain("ACTIVE PHISHING");
    // honesty: evidence-of-our-actions, NOT an SPF-compliance assessment
    expect(html).toContain("not an assessment of your organisation");
    expect(html.toLowerCase()).not.toContain("spf compliant");
    // never characterise a registrant as a criminal (brand-comms legal pack A)
    expect(html.toLowerCase()).not.toContain("criminal");
    expect(html.toLowerCase()).not.toContain("fraudster");
    // ABN legal footer + STOP path
    expect(html).toContain("72 695 772 313");
    expect(html.toUpperCase()).toContain("STOP");
  });

  it("omits the sample section entirely when there are no rows", async () => {
    const html = await render(
      BrandOutreachPilot({
        brandName: "Reece",
        bodyHtml: "<p>Hi Alex.</p>",
        cloneSample: { ...sample, rows: [], totalCount: 0, reportedCount: 0 },
      }),
    );
    expect(html).not.toContain("A sample of the clones");
    // pitch + signature still present
    expect(html).toContain("72 695 772 313");
  });
});
