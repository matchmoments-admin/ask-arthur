import { describe, expect, it } from "vitest";
import {
  enabledUrlBlocklistDestinations,
  extractScammerUrls,
} from "@/app/api/inngest/functions/onward-auto-report";

describe("enabledUrlBlocklistDestinations", () => {
  it("returns nothing when both destination flags are OFF", () => {
    expect(
      enabledUrlBlocklistDestinations({
        onwardOpenphish: false,
        onwardApwg: false,
      }),
    ).toEqual([]);
  });

  it("returns only the destinations whose flag is ON", () => {
    const got = enabledUrlBlocklistDestinations({
      onwardOpenphish: true,
      onwardApwg: false,
    });
    expect(got.map((d) => d.destination)).toEqual(["openphish"]);
    expect(got[0].destinationKey).toBe("report@openphish.com");
  });

  it("returns both when both flags are ON", () => {
    const got = enabledUrlBlocklistDestinations({
      onwardOpenphish: true,
      onwardApwg: true,
    });
    expect(got.map((d) => d.destination)).toEqual(["openphish", "apwg"]);
  });
});

describe("extractScammerUrls", () => {
  it("pulls the camelCase scammerUrls array", () => {
    expect(
      extractScammerUrls({ scammerUrls: ["http://evil.test", "http://x.test"] }),
    ).toEqual(["http://evil.test", "http://x.test"]);
  });

  it("falls back to snake_case scammer_urls", () => {
    expect(extractScammerUrls({ scammer_urls: ["http://evil.test"] })).toEqual([
      "http://evil.test",
    ]);
  });

  it("drops non-string / empty entries", () => {
    expect(
      extractScammerUrls({ scammerUrls: ["http://ok.test", "", 42, null] }),
    ).toEqual(["http://ok.test"]);
  });

  it("returns [] for missing / malformed input (no auto-report without a URL)", () => {
    expect(extractScammerUrls(null)).toEqual([]);
    expect(extractScammerUrls({})).toEqual([]);
    expect(extractScammerUrls("nope")).toEqual([]);
    expect(extractScammerUrls({ scammerUrls: "not-an-array" })).toEqual([]);
  });
});
