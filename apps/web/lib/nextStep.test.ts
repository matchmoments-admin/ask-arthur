import { describe, it, expect } from "vitest";
import { resolveBestNextStep, type RoutingContext, type LossState } from "./nextStep";
import {
  ACTION_000,
  ACTION_BANK,
  ACTION_ESAFETY,
  ACTION_SCAMWATCH,
  ACTION_REPORTCYBER,
  ACTION_ID_SUPPORT_NSW,
  BRAND_ROUTES,
  STATE_POLICE_FALLBACK,
} from "./onward/destinations";
import type { Verdict } from "@askarthur/types";

const base: RoutingContext = {
  verdict: "SUSPICIOUS",
  scamType: null,
  impersonatedBrand: null,
  channel: null,
  countryCode: "AU",
  stateCode: null,
  lossState: null,
};

describe("resolveBestNextStep", () => {
  it("returns nothing for SAFE", () => {
    expect(resolveBestNextStep({ ...base, verdict: "SAFE" })).toEqual([]);
  });

  it("never returns empty for a non-SAFE AU verdict (property sweep)", () => {
    const verdicts: Verdict[] = ["UNCERTAIN", "SUSPICIOUS", "HIGH_RISK"];
    const brands = [null, "ATO", "myGov", "Australia Post", "Some Unknown Bank"];
    const states = [null, "NSW", "VIC", "QLD"];
    const losses: LossState[] = [null, "money", "details", "neither"];
    const scamTypes = [null, "phishing", "remote access scam"];
    for (const verdict of verdicts)
      for (const impersonatedBrand of brands)
        for (const stateCode of states)
          for (const lossState of losses)
            for (const scamType of scamTypes) {
              const out = resolveBestNextStep({
                ...base,
                verdict,
                impersonatedBrand,
                stateCode,
                lossState,
                scamType,
              });
              expect(out.length).toBeGreaterThan(0);
            }
  });

  it("routes sensitive scams (sextortion) to eSafety + 000, not generic scam framing", () => {
    const out = resolveBestNextStep({
      ...base,
      verdict: "HIGH_RISK",
      scamType: "sextortion",
    });
    expect(out.map((a) => a.value)).toContain(ACTION_ESAFETY.value);
    expect(out.map((a) => a.value)).toContain(ACTION_000.value);
    expect(out.map((a) => a.value)).not.toContain(ACTION_SCAMWATCH.value);
  });

  it("leads with the bank when money was sent", () => {
    const out = resolveBestNextStep({ ...base, lossState: "money" });
    expect(out[0].value).toBe(ACTION_BANK.value);
    expect(out.map((a) => a.value)).toContain(ACTION_REPORTCYBER.value);
  });

  it("adds ID Support NSW only for NSW identity compromise", () => {
    const nsw = resolveBestNextStep({ ...base, lossState: "details", stateCode: "NSW" });
    expect(nsw.map((a) => a.value)).toContain(ACTION_ID_SUPPORT_NSW.value);
    const vic = resolveBestNextStep({ ...base, lossState: "details", stateCode: "VIC" });
    expect(vic.map((a) => a.value)).not.toContain(ACTION_ID_SUPPORT_NSW.value);
  });

  it("surfaces the brand-specific route for a known brand", () => {
    const out = resolveBestNextStep({ ...base, impersonatedBrand: "the ATO" });
    expect(out.map((a) => a.value)).toContain("ReportScams@ato.gov.au");
  });

  it("degrades non-AU geo to a generic fallback, never a dead end", () => {
    const out = resolveBestNextStep({ ...base, countryCode: "US" });
    expect(out.length).toBeGreaterThan(0);
    // No AU-only agency routes leak to non-AU users.
    expect(out.map((a) => a.value)).not.toContain(ACTION_SCAMWATCH.value);
  });

  it("does NOT leak AU-only 000/eSafety to a non-AU sensitive-scam victim", () => {
    const out = resolveBestNextStep({
      ...base,
      verdict: "HIGH_RISK",
      scamType: "sextortion",
      countryCode: "US",
    });
    const values = out.map((a) => a.value);
    expect(values).not.toContain(ACTION_000.value);
    expect(values).not.toContain(ACTION_ESAFETY.value);
    expect(out.length).toBeGreaterThan(0); // still routed somewhere
  });

  it("pins 000 only for HIGH_RISK active-threat scam types", () => {
    const remote = resolveBestNextStep({ ...base, verdict: "HIGH_RISK", scamType: "remote access scam" });
    expect(remote.map((a) => a.value)).toContain(ACTION_000.value);
    const phishing = resolveBestNextStep({ ...base, verdict: "HIGH_RISK", scamType: "phishing" });
    expect(phishing.map((a) => a.value)).not.toContain(ACTION_000.value);
  });

  it("returns a deduped, priority-sorted list", () => {
    const out = resolveBestNextStep({ ...base, lossState: "details", stateCode: "NSW", impersonatedBrand: "ATO" });
    const values = out.map((a) => a.value);
    expect(new Set(values).size).toBe(values.length); // no dupes
    const priorities = out.map((a) => a.priority);
    expect([...priorities].sort((x, y) => x - y)).toEqual(priorities); // sorted
  });
});

describe("reporting data integrity (safety guard)", () => {
  it("contains no placeholder contact values", () => {
    const contactActions = [
      ACTION_000,
      ACTION_BANK,
      ACTION_ESAFETY,
      ACTION_SCAMWATCH,
      ACTION_REPORTCYBER,
      ACTION_ID_SUPPORT_NSW,
      ...Object.values(BRAND_ROUTES).flat(),
      ...Object.values(STATE_POLICE_FALLBACK),
    ];
    const forbidden = /TODO|PLACEHOLDER|FIXME|xxxx|example\.com|1234567/i;
    for (const a of contactActions) {
      // `value` is the actual phone/URL/email (info actions carry guidance text
      // and are exempt); assert real contacts carry no placeholder token.
      if (a.kind === "info") continue;
      expect(a.value, `placeholder in ${a.label}`).not.toMatch(forbidden);
      // URLs must be official gov/au or known brand domains, https.
      if (a.kind === "url") {
        expect(a.value, `non-https url in ${a.label}`).toMatch(/^https:\/\//);
      }
    }
  });
});
