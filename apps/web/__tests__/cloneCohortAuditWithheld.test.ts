import { describe, expect, it } from "vitest";
import {
  applyCohortRules,
  AUDIT_SAMPLE_EMBED,
  CLONE_COHORT_SELECT,
  isAuditMiss,
  isAuditWithheld,
  withholdAuditVerdict,
  type CloneAlertRow,
} from "@/lib/clone-watch/clone-cohort";
import { aggregateClonesByDomain } from "@/lib/clone-watch/clone-metrics";
import { monthWindow, priorWindow } from "@/lib/clone-watch/month-window";
import {
  buildReportCard,
  buildTrendRows,
  type CardInputs,
} from "@/lib/clone-watch/report-card";
import {
  probeChunk,
  STOCK_ROW_SELECT,
  type StockRow,
} from "@/lib/clone-watch/month-end-stock";
import {
  CLONE_SAMPLE_SELECT,
  shapeCloneAlert,
  type RawCloneAlert,
} from "@/lib/email/brand-outreach-pilot";

/**
 * #1256: a not-a-clone audit sample (v330) must not carry its urlscan verdict
 * into brand-attributed counts. It stays in `clones` because it was a lexical
 * match, and it counts as `unclassified` for the brand the classifier rejected.
 *
 * The prod case: threesbrewingdirect.shop matched ing.com.au lexically, the
 * pre-classifier said is_clone=false, and the audit's urlscan said
 * likely_phishing. Before this fix, the 1 Oct edition would have published it
 * as one of ING's likely-phishing lookalikes.
 *
 * Go-red record (2026-09-27, each guard verified by reinstating the bug and
 * running this file, then restored):
 *   - cohort mask: drop `.map(withholdAuditVerdict)` from applyCohortRules →
 *     4 red (applyCohortRules, per-brand byClassification, the ING trend row
 *     reads likely_phishing 2, the card KPI reads likelyPhishing 2).
 *   - release on operator confirmation: drop the OPERATOR_CONFIRMED check →
 *     a tp_confirmed miss stays withheld.
 *   - release on re-judgement: drop `is_clone !== true` from isAuditWithheld →
 *     1 red (the operator-confirmed sample loses its verdict).
 *   - array tolerance: return the raw array from auditSampleOf → 1 red (`[]`,
 *     a to-many resolution, withholds an unsampled row).
 *   - lifecycle: drop the monitoring → detected reset → 3 red (the miss, the
 *     per-brand detail row, the outreach row all read `monitoring`).
 *   - select drift: replace AUDIT_SAMPLE_EMBED in CLONE_COHORT_SELECT with "" →
 *     1 red (the select test; it asserts all three selects).
 *   - outreach: drop withholdAuditVerdict from shapeCloneAlert → 1 red (the
 *     pitch row shows likely_phishing with a urlscan link).
 *   - stock: pass row.urlscan_classification unmasked in probeChunk → 1 red
 *     (the sampled parked_for_sale reads `parked` rather than `live`).
 */

const ING = "ing.com.au";
const MISS_AT = "2026-09-20T03:00:00Z";

function row(id: number, domain: string, over: Partial<CloneAlertRow> = {}): CloneAlertRow {
  return {
    id,
    candidate_domain: domain,
    inferred_target_domain: ING,
    target_brand_normalized: null,
    urlscan_classification: null,
    urlscan_evidence: null,
    attribution: null,
    campaign_key: null,
    submitted_to: null,
    lifecycle_state: "detected",
    netcraft_declined_at: null,
    weaponised_at: null,
    first_seen_at: "2026-09-10T00:00:00Z",
    triage_status: null,
    clone_watch_classifications: {
      is_clone: true,
      confidence: 0.9,
      attack_intent: null,
    },
    clone_watch_not_a_clone_samples: null,
    ...over,
  } as CloneAlertRow;
}

/** The prod case: a lexical match the classifier rejected, which the audit
 *  scanned as phishing. */
const miss = (id = 1) =>
  row(id, "threesbrewingdirect.shop", {
    urlscan_classification: "likely_phishing",
    urlscan_evidence: {
      server: { ip: "203.0.113.9", asn: "AS13335", country: "US" },
      screenshot_url: "https://urlscan.io/screenshots/x.png",
      uuid: "abc",
    },
    lifecycle_state: "monitoring",
    clone_watch_classifications: { is_clone: false, confidence: 0.2, attack_intent: null },
    clone_watch_not_a_clone_samples: { miss_at: MISS_AT },
  });

/** A real ING clone the classifier accepted and urlscan graded phishing. */
const realPhish = (id = 2) =>
  row(id, "ing-secure-login.com", {
    urlscan_classification: "likely_phishing",
    lifecycle_state: "weaponised",
    weaponised_at: "2026-09-12T00:00:00Z",
  });

function inputs(rows: CloneAlertRow[]): CardInputs {
  const window = monthWindow("2026-09");
  return {
    window,
    priorWindow: priorWindow(window.startIso),
    rows,
    priorRows: [],
    coverage: [],
    priorSpotlightBrand: null,
    watchlistFallbackSize: 293,
  };
}

describe("withholdAuditVerdict — which rows are withheld", () => {
  it("withholds a miss: verdict, evidence and the audit's lifecycle move", () => {
    const out = withholdAuditVerdict(miss());
    expect(out.urlscan_classification).toBeNull();
    expect(out.urlscan_evidence).toBeNull();
    expect(out.lifecycle_state).toBe("detected");
    expect(isAuditMiss(miss())).toBe(true);
  });

  it("withholds a benign or parked sample too, since the audit verdict is not a brand fact", () => {
    const parked = row(3, "ingparked.shop", {
      urlscan_classification: "parked_for_sale",
      lifecycle_state: "monitoring",
      clone_watch_classifications: { is_clone: false, confidence: 0.1, attack_intent: null },
      clone_watch_not_a_clone_samples: { miss_at: null },
    });
    expect(isAuditWithheld(parked)).toBe(true);
    expect(isAuditMiss(parked)).toBe(false);
    expect(withholdAuditVerdict(parked).urlscan_classification).toBeNull();
  });

  it("withholds a sample whose classification row is missing (is_clone IS NOT TRUE, as in v330)", () => {
    const r = { ...miss(), clone_watch_classifications: null };
    expect(isAuditWithheld(r)).toBe(true);
  });

  it("releases a sample an operator re-judged is_clone=true", () => {
    const r = {
      ...miss(),
      clone_watch_classifications: { is_clone: true, confidence: 1, attack_intent: null },
    };
    expect(isAuditWithheld(r)).toBe(false);
    expect(withholdAuditVerdict(r)).toBe(r);
  });

  it("releases a sample an operator confirmed (tp_confirmed / tp_actioned), whatever is_clone says", () => {
    for (const triage_status of ["tp_confirmed", "tp_actioned"]) {
      const r = { ...miss(), triage_status };
      expect(isAuditWithheld(r)).toBe(false);
    }
    // Any other triage state keeps it withheld.
    expect(isAuditWithheld({ ...miss(), triage_status: "needs_investigation" })).toBe(true);
  });

  it("leaves an unsampled row untouched (identity, not a copy)", () => {
    const r = realPhish();
    expect(withholdAuditVerdict(r)).toBe(r);
  });

  it("reads a to-many `[]` embed as UNSAMPLED, so it cannot withhold a whole month", () => {
    const r = row(4, "x.com", {
      urlscan_classification: "likely_phishing",
      clone_watch_classifications: { is_clone: false, confidence: 0.2, attack_intent: null },
      clone_watch_not_a_clone_samples: [],
    });
    expect(isAuditWithheld(r)).toBe(false);
    const sampled = { ...r, clone_watch_not_a_clone_samples: [{ miss_at: MISS_AT }] };
    expect(isAuditMiss(sampled)).toBe(true);
  });
});

describe("the cohort: a miss stays in clones and leaves likely_phishing", () => {
  it("applyCohortRules keeps the row (lexical membership) but masks it", () => {
    const out = applyCohortRules([miss(), realPhish()]);
    expect(out.map((r) => r.candidate_domain)).toEqual([
      "threesbrewingdirect.shop",
      "ing-secure-login.com",
    ]);
    expect(out[0].urlscan_classification).toBeNull();
    // The embed survives the mask, so a reader can still count what was withheld.
    expect(out.filter(isAuditWithheld)).toHaveLength(1);
  });

  it("per-brand metrics: 2 detected, 1 likely_phishing, 1 unclassified", () => {
    const m = aggregateClonesByDomain(applyCohortRules([miss(), realPhish()])).get(ING)!;
    expect(m.detected).toBe(2);
    expect(m.byClassification).toEqual({ likely_phishing: 1, unclassified: 1 });
    const detail = m.domains.find((d) => d.domain === "threesbrewingdirect.shop")!;
    expect(detail.classification).toBeNull();
    expect(detail.screenshot_url).toBeNull();
    expect(detail.lifecycle_state).toBe("detected");
  });

  it("monthly store row (buildTrendRows): clones 2, likely_phishing 1", () => {
    const t = buildTrendRows(inputs(applyCohortRules([miss(), realPhish()])));
    const ing = t.brandRows.find((b) => b.brand === ING)!;
    expect(ing.clones).toBe(2);
    expect(ing.likely_phishing).toBe(1);
  });

  it("report card (summary, caption, /clone-watch/[period]): total 2, likelyPhishing 1", () => {
    const card = buildReportCard(inputs(applyCohortRules([miss(), realPhish()])));
    expect(card.total).toBe(2);
    expect(card.kpis.likelyPhishing).toBe(1);
    expect(card.kpis.unclassified).toBe(1);
  });
});

describe("the reads that carry the marker", () => {
  it("every select embeds the audit sample", () => {
    expect(CLONE_COHORT_SELECT).toContain(AUDIT_SAMPLE_EMBED);
    expect(CLONE_SAMPLE_SELECT).toContain(AUDIT_SAMPLE_EMBED);
    expect(STOCK_ROW_SELECT).toContain(AUDIT_SAMPLE_EMBED);
  });

  it("the reads with their own column list also carry is_clone", () => {
    expect(CLONE_SAMPLE_SELECT).toContain("clone_watch_classifications(is_clone)");
    expect(STOCK_ROW_SELECT).toContain("clone_watch_classifications(is_clone)");
  });
});

describe("brand-outreach pilot sample", () => {
  it("shows a miss as a lookalike with no verdict and no urlscan link", () => {
    const raw: RawCloneAlert = {
      candidate_domain: "threesbrewingdirect.shop",
      inferred_target_domain: ING,
      urlscan_classification: "likely_phishing",
      urlscan_evidence: { server: { ip: "203.0.113.9" }, uuid: "abc" },
      urlscan_uuid: "abc",
      attribution: null,
      submitted_to: null,
      lifecycle_state: "monitoring",
      first_seen_at: "2026-09-10T00:00:00Z",
      clone_watch_classifications: { is_clone: false },
      clone_watch_not_a_clone_samples: { miss_at: MISS_AT },
    };
    const shaped = shapeCloneAlert(raw);
    expect(shaped.classification).toBeNull();
    expect(shaped.resultUrl).toBeNull();
    expect(shaped.host).toBeNull();
    expect(shaped.lifecycleState).toBe("detected");
  });
});

describe("month-end stock", () => {
  const stockRow = (over: Partial<StockRow> = {}): StockRow => ({
    id: 1,
    candidate_domain: "ingparked.shop",
    inferred_target_domain: ING,
    attribution: null,
    urlscan_classification: "parked_for_sale",
    lifecycle_state: "monitoring",
    urlscan_uuid: "u",
    urlscan_failure_streak: 0,
    urlscan_evidence: null,
    clone_watch_classifications: { is_clone: false },
    clone_watch_not_a_clone_samples: { miss_at: null },
    ...over,
  });
  const run = (row: StockRow) =>
    probeChunk({
      ids: [row.id],
      rows: [row],
      periodMonth: "2026-09-01",
      probe: async () => ({
        a: { records: ["1.2.3.4"] },
        aaaa: null,
        ns: { records: ["ns1.cloudflare.com"] },
      }),
      expired: () => false,
    });

  it("a sampled parked_for_sale verdict does not decide the status (DNS says live)", async () => {
    const res = await run(stockRow());
    expect(res.snapshots[0].status).toBe("live");
  });

  it("an unsampled row still reads its stored parked_for_sale verdict", async () => {
    const res = await run(stockRow({ clone_watch_not_a_clone_samples: null }));
    expect(res.snapshots[0].status).toBe("parked");
  });
});
