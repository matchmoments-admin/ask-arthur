import { describe, expect, it } from "vitest";
import {
  computeWeaponisationRisk,
  primarySignalType,
  type WeaponisationRiskInput,
} from "@/lib/clone-watch/weaponisation-risk";
import { selectTopRiskCandidates } from "@/app/api/inngest/functions/clone-watch-lifecycle-recheck";

// Fixed clock for determinism (2026-07-12T00:00:00Z).
const NOW = Date.parse("2026-07-12T00:00:00Z");

const NULLS: WeaponisationRiskInput = {
  urlscanClassification: null,
  signals: null,
  isClone: null,
  confidence: null,
  attackIntent: null,
  brandCategory: null,
  whoisCreatedDate: null,
  ipAbuseConfidenceScore: null,
  nowMs: NOW,
};

describe("computeWeaponisationRisk", () => {
  it("all-null input → valid low score, never throws", () => {
    const r = computeWeaponisationRisk(NULLS);
    // unresolved prior (6) + unknown age (4)
    expect(r.score).toBe(10);
    expect(r.band).toBe("low");
  });

  it("is deterministic for a fixed clock", () => {
    const input = { ...NULLS, urlscanClassification: "neutral" };
    expect(computeWeaponisationRisk(input)).toEqual(computeWeaponisationRisk(input));
  });

  it("urlscan prior ordering: likely_phishing > neutral > unresolved > parked", () => {
    const score = (c: string) =>
      computeWeaponisationRisk({ ...NULLS, urlscanClassification: c }).score;
    expect(score("likely_phishing")).toBeGreaterThan(score("neutral"));
    expect(score("neutral")).toBeGreaterThan(score("unresolved"));
    expect(score("unresolved")).toBeGreaterThan(score("parked_for_sale"));
  });

  it("each weight contributes exactly its points", () => {
    const base = computeWeaponisationRisk(NULLS).score;
    expect(
      computeWeaponisationRisk({ ...NULLS, isClone: true, confidence: 1 }).score,
    ).toBe(base + 20);
    expect(
      computeWeaponisationRisk({ ...NULLS, isClone: true, confidence: 0.5 }).score,
    ).toBe(base + 10);
    // Haiku confidence only counts when is_clone=true
    expect(
      computeWeaponisationRisk({ ...NULLS, isClone: false, confidence: 1 }).score,
    ).toBe(base);
    expect(
      computeWeaponisationRisk({ ...NULLS, attackIntent: "credential_phishing" })
        .score,
    ).toBe(base + 10);
    expect(
      computeWeaponisationRisk({ ...NULLS, attackIntent: "unknown" }).score,
    ).toBe(base);
    expect(
      computeWeaponisationRisk({
        ...NULLS,
        signals: [{ signal_type: "confusable", score: 0.9 }],
      }).score,
    ).toBe(base + 12);
    expect(
      computeWeaponisationRisk({
        ...NULLS,
        signals: [{ signal_type: "substring", score: 0.9 }],
      }).score,
    ).toBe(base + 4);
    expect(computeWeaponisationRisk({ ...NULLS, brandCategory: "bank" }).score).toBe(
      base + 12,
    );
    expect(computeWeaponisationRisk({ ...NULLS, brandCategory: "retail" }).score).toBe(
      base + 4,
    );
    expect(
      computeWeaponisationRisk({ ...NULLS, ipAbuseConfidenceScore: 80 }).score,
    ).toBe(base + 14);
    expect(
      computeWeaponisationRisk({ ...NULLS, ipAbuseConfidenceScore: 30 }).score,
    ).toBe(base + 7);
    expect(
      computeWeaponisationRisk({ ...NULLS, ipAbuseConfidenceScore: 10 }).score,
    ).toBe(base);
  });

  it("domain age bands: fresh(<30d) > recent(<90d) > established; unknown mildly elevated", () => {
    const score = (created: string | null) =>
      computeWeaponisationRisk({ ...NULLS, whoisCreatedDate: created }).score;
    const fresh = score("2026-07-01T00:00:00Z"); // 11 days
    const recent = score("2026-05-01T00:00:00Z"); // ~72 days
    const established = score("2024-01-01T00:00:00Z");
    const unknown = score(null);
    expect(fresh).toBeGreaterThan(recent);
    expect(recent).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(established);
    // garbage date reads as unknown, never throws
    expect(score("not-a-date")).toBe(unknown);
  });

  it("clamps at 100 on a maxed input and bands at the documented edges", () => {
    const maxed = computeWeaponisationRisk({
      urlscanClassification: "likely_phishing",
      signals: [{ signal_type: "confusable", score: 1 }],
      isClone: true,
      confidence: 1,
      attackIntent: "payment_fraud",
      brandCategory: "super",
      whoisCreatedDate: "2026-07-10T00:00:00Z",
      ipAbuseConfidenceScore: 100,
      nowMs: NOW,
    });
    expect(maxed.score).toBe(100);
    expect(maxed.band).toBe("critical");

    // Band edges: 39/40 and 69/70. Construct exact scores from known weights:
    // base 10 (null prior 6 + unknown age 4).
    const at40 = computeWeaponisationRisk({
      ...NULLS,
      urlscanClassification: "likely_phishing", // 30 (+4 unknown age = 34)
      brandCategory: "gov", // +8 → 42
    });
    expect(at40.band).toBe("elevated");
    const at70 = computeWeaponisationRisk({
      ...NULLS,
      urlscanClassification: "likely_phishing", // 30
      isClone: true,
      confidence: 1, // +20
      brandCategory: "bank", // +12
      whoisCreatedDate: "2026-07-10T00:00:00Z", // fresh +12 (replaces unknown 4)
    });
    // 30+20+12+12 = 74
    expect(at70.score).toBe(74);
    expect(at70.band).toBe("critical");
  });
});

describe("primarySignalType (moved home)", () => {
  it("behaviour preserved: first signal's type; null on empty/garbage", () => {
    expect(primarySignalType([{ signal_type: "confusable" }])).toBe("confusable");
    expect(primarySignalType([])).toBeNull();
    expect(primarySignalType(null)).toBeNull();
    expect(primarySignalType([{ nope: true }])).toBeNull();
    expect(primarySignalType([{ signal_type: 42 }])).toBeNull();
  });
});

describe("selectTopRiskCandidates (recheck ranking)", () => {
  const row = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    candidate_domain: `d${id}.click`,
    candidate_url: `https://d${id}.click/`,
    lifecycle_state: "declined",
    urlscan_classification: null,
    recheck_count: 0,
    last_rechecked_at: null,
    signals: null,
    attribution: null,
    clf_is_clone: null,
    clf_confidence: null,
    clf_attack_intent: null,
    clf_clone_tactic: null,
    brand_category: null,
    ...over,
  });

  it("selects exactly the top-N by risk; unselected rows are simply not returned", () => {
    const rows = [
      row(1), // base score
      row(2, { urlscan_classification: "likely_phishing", brand_category: "bank" }),
      row(3, { brand_category: "gov" }),
    ];
    const top2 = selectTopRiskCandidates(rows, 2, NOW);
    expect(top2.map((r) => r.id)).toEqual([2, 3]);
    expect(top2[0].risk).toBeGreaterThan(top2[1].risk);
  });

  it("tiebreak is staleness (asc, nulls first) then id", () => {
    const rows = [
      row(3, { last_rechecked_at: "2026-07-10T00:00:00Z" }),
      row(2, { last_rechecked_at: "2026-07-01T00:00:00Z" }),
      row(1, { last_rechecked_at: null }),
      row(4, { last_rechecked_at: null }),
    ];
    const all = selectTopRiskCandidates(rows, 4, NOW);
    expect(all.map((r) => r.id)).toEqual([1, 4, 2, 3]);
  });
});
