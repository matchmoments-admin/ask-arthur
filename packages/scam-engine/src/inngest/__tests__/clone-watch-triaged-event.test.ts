import { describe, expect, it } from "vitest";

import { parseCloneWatchTriagedData } from "../events";

// Regression for the 2026-06-15 Axiom error burst: both the submit-netcraft
// and notify-brand consumers call parseCloneWatchTriagedData(event.data), and
// a backfill re-emitted the triaged event with a DB-sourced `triaged_at`
// carrying a timezone offset, which the old `z.string().datetime()` rejected.
// The schema now accepts any parseable datetime and normalises to ISO-Z.

function base(triagedAt: string) {
  return {
    alertId: 123,
    brand: "Qantas",
    candidateDomain: "qantasw.shop",
    candidateUrl: "https://qantasw.shop/login",
    severityTier: "low",
    signalType: "lexical",
    score: 0.82,
    triagedAt,
  };
}

describe("parseCloneWatchTriagedData — triagedAt normalisation", () => {
  it("accepts canonical ISO-Z and round-trips it", () => {
    const out = parseCloneWatchTriagedData(base("2026-06-15T06:20:00.000Z"));
    expect(out.triagedAt).toBe("2026-06-15T06:20:00.000Z");
  });

  it("accepts an ISO string with a +00:00 offset (the backfill shape) and normalises to Z", () => {
    const out = parseCloneWatchTriagedData(base("2026-06-15T06:20:00.591+00:00"));
    expect(out.triagedAt).toBe("2026-06-15T06:20:00.591Z");
  });

  it("accepts a non-UTC offset and converts to UTC Z", () => {
    const out = parseCloneWatchTriagedData(base("2026-06-15T16:20:00+10:00"));
    expect(out.triagedAt).toBe("2026-06-15T06:20:00.000Z");
  });

  it("accepts a raw Postgres timestamp (space separator + offset)", () => {
    const out = parseCloneWatchTriagedData(base("2026-06-15 06:20:00.591+00"));
    expect(out.triagedAt).toBe("2026-06-15T06:20:00.591Z");
  });

  it("rejects a genuinely unparseable datetime", () => {
    expect(() => parseCloneWatchTriagedData(base("not-a-date"))).toThrow();
  });

  it("rejects an empty triagedAt", () => {
    expect(() => parseCloneWatchTriagedData(base(""))).toThrow();
  });
});
