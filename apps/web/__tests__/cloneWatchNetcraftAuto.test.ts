import { describe, expect, it } from "vitest";

import {
  buildNetcraftAutoEvents,
  type NetcraftAutoCandidate,
} from "@/app/api/inngest/functions/clone-watch-netcraft-auto";
import { parseCloneWatchTriagedData } from "@askarthur/scam-engine/inngest/events";

const TS = "2026-06-15T09:30:00.000Z";

function candidate(o: Partial<NetcraftAutoCandidate> = {}): NetcraftAutoCandidate {
  return {
    id: 501,
    candidate_url: "https://qantasw.shop/login",
    candidate_domain: "qantasw.shop",
    inferred_target_domain: "qantas.com.au",
    severity_tier: "low",
    signals: [{ signal_type: "lexical", score: 0.82 }],
    ...o,
  };
}

describe("buildNetcraftAutoEvents", () => {
  it("maps a candidate to a netcraft-auto event with a stable id + valid triaged shape", () => {
    const [ev] = buildNetcraftAutoEvents([candidate()], TS);
    expect(ev.name).toBe("shopfront/clone.netcraft-auto.v1");
    expect(ev.id).toBe("clone-netcraft-auto:501");
    expect(ev.data).toMatchObject({
      alertId: 501,
      brand: "qantas.com.au",
      candidateDomain: "qantasw.shop",
      candidateUrl: "https://qantasw.shop/login",
      severityTier: "low",
      signalType: "lexical",
      score: 0.82,
      triagedAt: TS,
    });
  });

  it("produces data the worker's parseCloneWatchTriagedData accepts (round-trip)", () => {
    const [ev] = buildNetcraftAutoEvents([candidate()], TS);
    const parsed = parseCloneWatchTriagedData(ev.data);
    expect(parsed.alertId).toBe(501);
    expect(parsed.triagedAt).toBe(TS);
  });

  it("falls back to unknown/0 when signals are missing or malformed", () => {
    const [ev] = buildNetcraftAutoEvents(
      [candidate({ signals: null })],
      TS,
    );
    expect(ev.data.signalType).toBe("unknown");
    expect(ev.data.score).toBe(0);
  });

  it("defaults severityTier to low when null", () => {
    const [ev] = buildNetcraftAutoEvents(
      [candidate({ severity_tier: null })],
      TS,
    );
    expect(ev.data.severityTier).toBe("low");
  });

  it("maps each candidate independently", () => {
    const evs = buildNetcraftAutoEvents(
      [candidate({ id: 1 }), candidate({ id: 2 })],
      TS,
    );
    expect(evs.map((e) => e.id)).toEqual([
      "clone-netcraft-auto:1",
      "clone-netcraft-auto:2",
    ]);
  });
});
