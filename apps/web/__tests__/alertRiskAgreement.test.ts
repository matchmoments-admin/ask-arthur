/**
 * #1298 — the recheck ranking and the Brand Stewardship watch-list must score
 * the same alert identically. Each fixture is ONE alert written in both row
 * shapes its callers read: the list_clone_alerts_for_recheck worklist row
 * (flat clf_* columns) and the clone-cohort row (PostgREST classification
 * embed). The recheck side goes through the lane's real exported ranking.
 */
import { describe, expect, it } from "vitest";
import { selectTopRiskCandidates } from "@/app/api/inngest/functions/clone-watch-lifecycle-recheck";
import {
  brandCategoryLookup,
  scoreAlertRisk,
} from "@/lib/clone-watch/alert-risk";
import { computeWeaponisationRisk } from "@/lib/clone-watch/weaponisation-risk";

const NOW = Date.parse("2026-10-13T00:00:00Z");

// known_brands as prod has it: commbank has a categorised row AND a NULL twin.
const CATEGORIES = brandCategoryLookup([
  { id: 3, brand_domain: "commbank.com.au", brand_category: "bank" },
  { id: 290, brand_domain: "commbank.com.au", brand_category: null },
  { id: 40, brand_domain: "apple.com", brand_category: "tech" },
]);

interface Alert {
  id: number;
  domain: string;
  target: string | null;
  urlscan: string | null;
  signals: unknown;
  attribution: unknown;
  firstSeenAt: string;
  clf: { is_clone: boolean; confidence: number; attack_intent: string } | null;
  /** What the pre-v344 RPC's unordered LIMIT 1 happened to return. */
  rpcCategory: string | null;
}

const ALERTS: Alert[] = [
  {
    // prod #3577-shaped: eu.cc-style parent zone's 1997 createdDate.
    id: 1,
    domain: "appley.eu.cc",
    target: "apple.com",
    urlscan: "neutral",
    signals: [{ signal_type: "levenshtein" }],
    attribution: { whois: { createdDate: "1997-05-01" } },
    firstSeenAt: "2026-09-20T08:30:00Z",
    clf: { is_clone: true, confidence: 0.8, attack_intent: "credential_phishing" },
    rpcCategory: "tech",
  },
  {
    // The NULL-category twin won the unordered LIMIT 1.
    id: 2,
    domain: "comnbank.help",
    target: "commbank.com.au",
    urlscan: "unresolved",
    signals: [{ signal_type: "confusable" }],
    attribution: { whois: { createdDate: "2026-10-01" }, ip_rep: { abuseConfidenceScore: 30 } },
    firstSeenAt: "2026-10-02T08:30:00Z",
    clf: { is_clone: true, confidence: 0.9, attack_intent: "payment_fraud" },
    rpcCategory: null,
  },
  {
    id: 3,
    domain: "unrelated.shop",
    target: null,
    urlscan: null,
    signals: null,
    attribution: null,
    firstSeenAt: "2026-10-10T08:30:00Z",
    clf: null,
    rpcCategory: null,
  },
];

function asWorklistRow(a: Alert) {
  return {
    id: a.id,
    candidate_domain: a.domain,
    candidate_url: `https://${a.domain}/`,
    lifecycle_state: "declined",
    urlscan_classification: a.urlscan,
    recheck_count: 0,
    last_rechecked_at: null,
    signals: a.signals,
    attribution: a.attribution,
    clf_is_clone: a.clf?.is_clone ?? null,
    clf_confidence: a.clf?.confidence ?? null,
    clf_attack_intent: a.clf?.attack_intent ?? null,
    clf_clone_tactic: null,
    brand_category: a.rpcCategory,
    inferred_target_domain: a.target,
    first_seen_at: a.firstSeenAt,
  };
}

function asCohortRow(a: Alert) {
  return {
    id: a.id,
    candidate_domain: a.domain,
    inferred_target_domain: a.target,
    urlscan_classification: a.urlscan,
    signals: a.signals,
    attribution: a.attribution,
    first_seen_at: a.firstSeenAt,
    clone_watch_classifications: a.clf,
  };
}

function recheckRisk(a: Alert): number {
  const [picked] = selectTopRiskCandidates(
    [asWorklistRow(a)],
    1,
    NOW,
    CATEGORIES,
    0,
  );
  return picked.risk;
}

describe("weaponisation risk: recheck and stewardship agree (#1298)", () => {
  it.each(ALERTS.map((a) => [a.domain, a] as const))(
    "%s scores the same through the recheck ranking and the stewardship row",
    (_d, a) => {
      expect(recheckRisk(a)).toBe(scoreAlertRisk(asCohortRow(a), CATEGORIES, NOW).score);
    },
  );

  it("a parent-zone createdDate scores as unknown age in the recheck lane too", () => {
    const appley = ALERTS[0];
    const unknownAge = computeWeaponisationRisk({
      urlscanClassification: "neutral",
      signals: appley.signals,
      isClone: true,
      confidence: 0.8,
      attackIntent: "credential_phishing",
      brandCategory: "tech",
      whoisCreatedDate: null,
      ipAbuseConfidenceScore: null,
      nowMs: NOW,
    }).score;
    expect(recheckRisk(appley)).toBe(unknownAge);
  });

  it("the recheck lane reads the category from the lookup, not the RPC's unordered pick", () => {
    const comnbank = ALERTS[1];
    const withBank = scoreAlertRisk(asCohortRow(comnbank), CATEGORIES, NOW).score;
    const withoutCategory = scoreAlertRisk(
      { ...asCohortRow(comnbank), inferred_target_domain: null },
      CATEGORIES,
      NOW,
    ).score;
    expect(withBank - withoutCategory).toBe(12); // bank points
    expect(recheckRisk(comnbank)).toBe(withBank);
  });
});

describe("brandCategoryLookup", () => {
  it("lowest id's non-null category wins, whatever the input order", () => {
    const rows = [
      { id: 9, brand_domain: "x.com", brand_category: "tech" },
      { id: 2, brand_domain: "x.com", brand_category: null },
      { id: 5, brand_domain: "x.com", brand_category: "bank" },
      { id: 1, brand_domain: null, brand_category: "gov" },
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const lookup = brandCategoryLookup(order);
      expect(lookup.get("x.com")).toBe("bank");
      expect(lookup.size).toBe(1);
    }
  });
});

describe("scoreAlertRisk deploy-window fallback", () => {
  it("uses the RPC's brand_category only when the row has no inferred_target_domain key", () => {
    const row = {
      urlscan_classification: null,
      attribution: null,
      brand_category: "bank",
    };
    const fallback = scoreAlertRisk(row, new Map(), NOW).score;
    const none = scoreAlertRisk({ ...row, brand_category: null }, new Map(), NOW).score;
    expect(fallback - none).toBe(12);
    // With the key present (post-v344) the lookup is authoritative.
    expect(
      scoreAlertRisk({ ...row, inferred_target_domain: "nope.com" }, new Map(), NOW).score,
    ).toBe(none);
  });
});
