import { describe, expect, it } from "vitest";

import {
  CLONE_WATCH_WEAPONISED_EVENT,
  parseCloneWatchWeaponisedData,
} from "@askarthur/scam-engine/inngest/events";

/**
 * Contract test for the Wave 0 PR-B escalation seam. clone-watch-urlscan-retrieve
 * emits this event when apply_clone_urlscan_verdict reports newly_weaponised; the
 * Wave 1 enforcement layer consumes it. Pin the name + payload shape so a rename
 * on either side is caught.
 */
describe("shopfront/clone.weaponised.v1 contract", () => {
  it("has the stable event name", () => {
    expect(CLONE_WATCH_WEAPONISED_EVENT).toBe("shopfront/clone.weaponised.v1");
  });

  it("accepts a well-formed recheck-weaponisation payload", () => {
    const data = parseCloneWatchWeaponisedData({
      alertId: 1473,
      candidateDomain: "facebookk.xyz",
      candidateUrl: "https://facebookk.xyz/login",
      via: "recheck",
    });
    expect(data.via).toBe("recheck");
    expect(data.alertId).toBe(1473);
  });

  it("rejects an invalid `via` and a non-positive alertId", () => {
    expect(() =>
      parseCloneWatchWeaponisedData({
        alertId: 1,
        candidateDomain: "x.com",
        candidateUrl: "https://x.com",
        via: "sideways",
      }),
    ).toThrow();
    expect(() =>
      parseCloneWatchWeaponisedData({
        alertId: 0,
        candidateDomain: "x.com",
        candidateUrl: "https://x.com",
        via: "initial",
      }),
    ).toThrow();
  });
});
