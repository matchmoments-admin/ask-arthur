import { describe, expect, it } from "vitest";

import { alertsFromEvents } from "@/app/api/inngest/functions/clone-watch-haiku-preclassify";

// The batch's input contract (2026-09-23): one entry per alert, bad payloads
// counted not thrown — one malformed event must not fail the other 49.
const ev = (alertId: unknown) => ({
  data: {
    alertId,
    brand: "nab.com.au",
    candidateDomain: "nab-login.com",
    candidateUrl: "https://nab-login.com/",
  },
});

describe("alertsFromEvents", () => {
  it("dedupes by alertId (two event ids for one alert in one batch)", () => {
    const { alerts, invalid } = alertsFromEvents([ev(1), ev(2), ev(1)]);
    expect(alerts.map((a) => a.alertId)).toEqual([1, 2]);
    expect(invalid).toBe(0);
  });

  it("counts an unparseable payload instead of throwing", () => {
    const { alerts, invalid } = alertsFromEvents([ev(1), { data: { nope: true } }, {}]);
    expect(alerts.map((a) => a.alertId)).toEqual([1]);
    expect(invalid).toBe(2);
  });
});
