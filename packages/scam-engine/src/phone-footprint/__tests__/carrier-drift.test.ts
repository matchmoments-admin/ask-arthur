import { describe, it, expect } from "vitest";
import { computeCarrierDrift } from "../providers/carrier-drift";
import type { Footprint, PillarResult } from "../types";

function identity(detail: Record<string, unknown>): PillarResult {
  return {
    id: "identity",
    score: 10,
    confidence: 0.7,
    available: true,
    detail,
  };
}

function footprintWithIdentity(detail: Record<string, unknown>): Footprint {
  return {
    msisdn_e164: "+61412345678",
    msisdn_hash: "hash",
    tier: "full",
    composite_score: 20,
    band: "safe",
    pillars: {
      scam_reports: { id: "scam_reports", score: 0, confidence: 0, available: false },
      breach: { id: "breach", score: 0, confidence: 0, available: false },
      reputation: { id: "reputation", score: 0, confidence: 0, available: false },
      sim_swap: { id: "sim_swap", score: 0, confidence: 0, available: false },
      identity: identity(detail),
    },
    coverage: {
      vonage: "disabled",
      leakcheck: "disabled",
      ipqs: "disabled",
      twilio: "live",
      internal: "live",
    },
    providers_used: [],
    explanation: null,
    generated_at: "2026-04-23T00:00:00Z",
    expires_at: "2026-04-30T00:00:00Z",
  };
}

describe("computeCarrierDrift", () => {
  it("returns unavailable when no previous footprint", () => {
    const r = computeCarrierDrift({
      current: identity({ carrier: "Telstra", lineType: "mobile", isVoip: false }),
      previous: null,
    });
    expect(r.available).toBe(false);
    expect(r.reason).toBe("carrier_drift_no_baseline");
  });

  it("returns unavailable when current identity is unavailable", () => {
    const r = computeCarrierDrift({
      current: { id: "identity", score: 0, confidence: 0, available: false },
      previous: footprintWithIdentity({ carrier: "Telstra", lineType: "mobile" }),
    });
    expect(r.available).toBe(false);
    expect(r.reason).toBe("carrier_drift_current_unavailable");
  });

  it("returns score 0 when nothing changed", () => {
    const detail = { carrier: "Telstra", lineType: "mobile", isVoip: false };
    const r = computeCarrierDrift({
      current: identity(detail),
      previous: footprintWithIdentity(detail),
    });
    expect(r.available).toBe(true);
    expect(r.score).toBe(0);
    expect((r.detail as { carrier_changed: boolean }).carrier_changed).toBe(false);
  });

  it("scores 60 on carrier change alone (port-out detection)", () => {
    const r = computeCarrierDrift({
      current: identity({ carrier: "Optus", lineType: "mobile", isVoip: false }),
      previous: footprintWithIdentity({ carrier: "Telstra", lineType: "mobile", isVoip: false }),
    });
    expect(r.available).toBe(true);
    expect(r.score).toBe(60);
    expect((r.detail as { carrier_changed: boolean }).carrier_changed).toBe(true);
    expect((r.detail as { most_recent_swap_at: string }).most_recent_swap_at).toBe(
      "2026-04-23T00:00:00Z",
    );
  });

  it("scores 25 on line-type-only change", () => {
    const r = computeCarrierDrift({
      current: identity({ carrier: "Telstra", lineType: "fixedVoip", isVoip: false }),
      previous: footprintWithIdentity({ carrier: "Telstra", lineType: "mobile", isVoip: false }),
    });
    expect(r.available).toBe(true);
    expect(r.score).toBe(25);
  });

  it("scores 100 (capped) when carrier + lineType + flippedToVoip all fire", () => {
    const r = computeCarrierDrift({
      current: identity({ carrier: "Optus", lineType: "nonFixedVoip", isVoip: true }),
      previous: footprintWithIdentity({ carrier: "Telstra", lineType: "mobile", isVoip: false }),
    });
    expect(r.score).toBe(100); // 60 + 25 + 15 = 100
  });

  it("treats carrier name comparison case-insensitively", () => {
    // Twilio sometimes returns "Telstra" vs "TELSTRA" depending on the
    // numbering plan. Don't false-positive on casing differences.
    const r = computeCarrierDrift({
      current: identity({ carrier: "TELSTRA", lineType: "mobile" }),
      previous: footprintWithIdentity({ carrier: "Telstra", lineType: "mobile" }),
    });
    expect(r.score).toBe(0);
  });

  it("uses confidence 0.5 (lower than carrier-authoritative Vonage at 0.95)", () => {
    const r = computeCarrierDrift({
      current: identity({ carrier: "Optus", lineType: "mobile" }),
      previous: footprintWithIdentity({ carrier: "Telstra", lineType: "mobile" }),
    });
    expect(r.confidence).toBe(0.5);
  });

  it("returns unavailable when previous identity pillar is unavailable", () => {
    const prev = footprintWithIdentity({ carrier: "Telstra", lineType: "mobile" });
    prev.pillars.identity.available = false;
    const r = computeCarrierDrift({
      current: identity({ carrier: "Telstra", lineType: "mobile" }),
      previous: prev,
    });
    expect(r.available).toBe(false);
    expect(r.reason).toBe("carrier_drift_no_prev_identity");
  });
});
