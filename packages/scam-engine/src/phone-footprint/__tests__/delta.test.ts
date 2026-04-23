import { describe, it, expect } from "vitest";
import { computeDelta } from "../delta";
import type { Footprint, PillarId, PillarResult } from "../types";

function buildFootprint(
  overrides: Partial<Footprint> = {},
  pillarOverrides: Partial<Record<PillarId, Partial<PillarResult>>> = {},
): Footprint {
  const pillar = (id: PillarId): PillarResult => ({
    id,
    score: 0,
    confidence: 1,
    available: true,
    detail: {},
    ...pillarOverrides[id],
  });
  return {
    msisdn_e164: "+61412345678",
    msisdn_hash: "hash",
    tier: "full",
    composite_score: 20,
    band: "safe",
    pillars: {
      scam_reports: pillar("scam_reports"),
      breach: pillar("breach"),
      reputation: pillar("reputation"),
      sim_swap: pillar("sim_swap"),
      identity: pillar("identity"),
    },
    coverage: {
      vonage: "live",
      leakcheck: "live",
      ipqs: "fallback",
      twilio: "live",
      internal: "live",
    },
    providers_used: [],
    explanation: null,
    generated_at: new Date().toISOString(),
    expires_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeDelta", () => {
  it("emits nothing when the snapshots are identical", () => {
    const fp = buildFootprint();
    expect(computeDelta(fp, fp)).toEqual([]);
  });

  it("emits band_change critical when worsening safe→high", () => {
    const prev = buildFootprint({ band: "safe", composite_score: 20 });
    const next = buildFootprint({ band: "high", composite_score: 60 });
    const d = computeDelta(prev, next);
    expect(d.length).toBeGreaterThan(0);
    const band = d.find((x) => x.type === "band_change");
    expect(band?.severity).toBe("critical");
  });

  it("emits band_change info when improving high→safe", () => {
    const prev = buildFootprint({ band: "high", composite_score: 60 });
    const next = buildFootprint({ band: "safe", composite_score: 20 });
    const d = computeDelta(prev, next);
    const band = d.find((x) => x.type === "band_change");
    expect(band?.severity).toBe("info");
  });

  it("emits score_delta when |delta| >= threshold AND band unchanged", () => {
    const prev = buildFootprint({ band: "caution", composite_score: 30 });
    const next = buildFootprint({ band: "caution", composite_score: 46 });
    const d = computeDelta(prev, next);
    expect(d.some((x) => x.type === "score_delta")).toBe(true);
  });

  it("does not double-emit: band_change suppresses score_delta", () => {
    // Band changes means the composite crossed a bucket boundary. Reporting
    // both events would spam the user, so the delta.ts logic intentionally
    // skips score_delta when band changed.
    const prev = buildFootprint({ band: "caution", composite_score: 40 });
    const next = buildFootprint({ band: "high", composite_score: 60 });
    const d = computeDelta(prev, next);
    expect(d.some((x) => x.type === "band_change")).toBe(true);
    expect(d.some((x) => x.type === "score_delta")).toBe(false);
  });

  it("emits new_breach when a breach name appears", () => {
    const prev = buildFootprint(
      {},
      { breach: { score: 0, detail: { breaches: [] } } },
    );
    const next = buildFootprint(
      {},
      { breach: { score: 30, detail: { breaches: ["Optus 2022"] } } },
    );
    const d = computeDelta(prev, next);
    const b = d.find((x) => x.type === "new_breach");
    expect(b).toBeDefined();
    expect(b?.severity).toBe("critical");
    expect((b?.detail as { new: string[] }).new).toEqual(["Optus 2022"]);
  });

  it("emits new_scam_reports when entity_report_count rises", () => {
    const prev = buildFootprint(
      {},
      { scam_reports: { score: 10, detail: { entity_report_count: 1 } } },
    );
    const next = buildFootprint(
      {},
      { scam_reports: { score: 30, detail: { entity_report_count: 5 } } },
    );
    const d = computeDelta(prev, next);
    const r = d.find((x) => x.type === "new_scam_reports");
    expect(r).toBeDefined();
    expect(r?.severity).toBe("warning"); // 4+ new
  });

  it("emits sim_swap critical when most_recent_swap_at is set/changed", () => {
    const prev = buildFootprint(
      {},
      { sim_swap: { score: 0, detail: { most_recent_swap_at: undefined } } },
    );
    const next = buildFootprint(
      {},
      { sim_swap: { score: 80, detail: { most_recent_swap_at: "2026-04-20T00:00:00Z" } } },
    );
    const d = computeDelta(prev, next);
    const s = d.find((x) => x.type === "sim_swap");
    expect(s?.severity).toBe("critical");
  });

  it("emits carrier_change when identity.carrier string flips", () => {
    const prev = buildFootprint(
      {},
      { identity: { score: 10, detail: { carrier: "Telstra" } } },
    );
    const next = buildFootprint(
      {},
      { identity: { score: 10, detail: { carrier: "Optus" } } },
    );
    const d = computeDelta(prev, next);
    expect(d.some((x) => x.type === "carrier_change")).toBe(true);
  });

  it("emits fraud_score_delta on 25+ jump even if band unchanged", () => {
    const prev = buildFootprint(
      { band: "caution", composite_score: 30 },
      { reputation: { score: 30, detail: { fraud_score: 30 } } },
    );
    const next = buildFootprint(
      { band: "caution", composite_score: 35 },
      { reputation: { score: 60, detail: { fraud_score: 60 } } },
    );
    const d = computeDelta(prev, next);
    expect(d.some((x) => x.type === "fraud_score_delta")).toBe(true);
  });
});
